package spa

import (
	"context"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/httpx"
)

/* ── Arrival queue & auto-assignment (revisi R3) ──────────────────────
   Therapists who clocked in (hris.attendance) form the day's queue in
   arrival order. When a guest did not pick a therapist, the booking goes to
   the first free, suitable therapist in the queue; that therapist then moves
   to the back (fair rotation). Assignment happens on the day itself, once
   the therapist has clocked in — never the day before. */

// ArrivalEntry is one therapist in the outlet's queue for a day.
type ArrivalEntry struct {
	Therapist
	Present        bool          `json:"present"`
	QueueSince     *httpx.JSTime `json:"queue_since"`
	ClockIn        *httpx.JSTime `json:"clock_in"`
	LastAssignedAt *httpx.JSTime `json:"last_assigned_at"`
	AssignedToday  int           `json:"assigned_today"`
	// Position is the place in the rotation (1 = next to receive a booking); 0 when absent.
	Position int `json:"position"`
}

// ArrivalQueue is GET /api/spa/arrival-queue.
type ArrivalQueue struct {
	BranchID string         `json:"branch_id"`
	Date     string         `json:"date"`
	Queue    []ArrivalEntry `json:"queue"`  // present, in rotation order
	Absent   []ArrivalEntry `json:"absent"` // eligible today but not clocked in
}

// AutoAssignResult is POST /api/spa/auto-assign.
type AutoAssignResult struct {
	Assigned []AutoAssigned `json:"assigned"`
	Skipped  []AutoSkipped  `json:"skipped"`
}

type AutoAssigned struct {
	BookingID     string `json:"booking_id"`
	BookingCode   string `json:"booking_code"`
	TherapistID   string `json:"therapist_id"`
	TherapistName string `json:"therapist_name"`
}

type AutoSkipped struct {
	BookingID   string `json:"booking_id"`
	BookingCode string `json:"booking_code"`
	Reason      string `json:"reason"`
}

// AutoAssignEvery / AutoAssignHorizon: the background pass runs every few
// minutes and only touches bookings starting within the horizon, so a
// guest booked for the evening is matched once the evening shift is in.
const (
	AutoAssignEvery   = 5 * time.Minute
	AutoAssignHorizon = 3 * time.Hour
)

/* ── store ───────────────────────────────────────────────────────────── */

// arrivals lists the outlet's eligible therapists for a day with their
// clock-in and today's assignment history.
func (store) arrivals(ctx context.Context, q Q, branchID, date string, start, end, at time.Time) ([]ArrivalEntry, error) {
	return many(ctx, q, func(r pgx.Row) (ArrivalEntry, error) {
		var e ArrivalEntry
		var clockIn, last, since *time.Time
		var assisting bool
		err := r.Scan(&e.ID, &e.EmployeeID, &e.FullName, &e.NIP, &e.Phone, &e.PhotoURL, &e.HomeBranchID, &e.HomeBranchName,
			&e.Gender, &e.IsActive, &e.Level, &e.EmploymentCycle, &e.EmploymentStatus, &assisting, &clockIn, &last, &e.AssignedToday, &since)
		if clockIn != nil {
			t := jsTime(*clockIn)
			e.ClockIn, e.Present = &t, true
		}
		if since != nil {
			t := jsTime(*since)
			e.QueueSince = &t
		}
		if last != nil {
			t := jsTime(*last)
			e.LastAssignedAt = &t
		}
		return e, err
	}, `SELECT `+therapistColumns+`, t.home_branch_id <> $1,
	        (SELECT min(a.clock_in) FROM hris.attendance a WHERE a.employee_id = t.employee_id AND a.clock_in IS NOT NULL AND a.clock_out IS NULL AND
          (a.date=$2::date OR (a.date=$2::date-1 AND EXISTS (
           SELECT 1 FROM LATERAL (SELECT es.shift_id FROM hris.effective_employee_shifts es
            WHERE es.employee_id=t.employee_id AND es.day_of_week=extract(isodow FROM a.date)
            AND es.effective_from<=a.date AND (es.effective_to IS NULL OR es.effective_to>=a.date)
            ORDER BY es.effective_from DESC,es.effective_to ASC NULLS LAST LIMIT 1) es
           JOIN hris.shifts sh ON sh.id=es.shift_id
           WHERE sh.end_time<=sh.start_time AND (a.date+1+sh.end_time) AT TIME ZONE 'Asia/Jakarta'>$5)))),
	        (SELECT max(ev.created_at) FROM spa.booking_events ev JOIN spa.bookings bk ON bk.id = ev.booking_id
	          WHERE ev.action = 'assign' AND bk.therapist_id = t.id AND bk.branch_id = $1 AND bk.scheduled_at >= $3 AND bk.scheduled_at < $4),
	        (SELECT count(*) FROM spa.bookings bk WHERE bk.therapist_id = t.id AND bk.branch_id = $1 AND bk.scheduled_at >= $3 AND bk.scheduled_at < $4
	           AND bk.status IN ('assigned', 'in_treatment', 'completed'))::int,
 (SELECT max(a.starts_at) FROM spa.therapist_assists a WHERE a.therapist_id=t.id AND a.branch_id=$1 AND a.cancelled_at IS NULL AND a.starts_at<=$5 AND a.ends_at>$5)
	   FROM `+therapistFrom+`
	  WHERE t.is_active AND COALESCE(e.is_active, true) AND e.employment_status<>'resigned' AND NOT t.rehire_pending
	    AND ((t.home_branch_id = $1 AND NOT EXISTS (
	            SELECT 1 FROM spa.therapist_assists a
	             WHERE a.therapist_id = t.id AND a.branch_id <> $1 AND a.cancelled_at IS NULL AND a.starts_at <= $5 AND a.ends_at > $5))
	      OR EXISTS (SELECT 1 FROM spa.therapist_assists a
	             WHERE a.therapist_id = t.id AND a.branch_id = $1 AND a.cancelled_at IS NULL AND a.starts_at <= $5 AND a.ends_at > $5))
	  ORDER BY e.full_name`, branchID, date, start, end, at)
}

// unassignedBookings lists a day's bookings still waiting for a therapist,
// earliest first, optionally only those starting before `until`.
func (store) unassignedBookings(ctx context.Context, q Q, branchID string, start, end time.Time, until *time.Time) ([]string, error) {
	sql := `SELECT id::text FROM spa.bookings WHERE branch_id = $1 AND status = $2 AND scheduled_at >= $3 AND scheduled_at < $4`
	args := []any{branchID, domain.BookingUnassigned, start, end}
	if until != nil {
		sql += ` AND scheduled_at < $5`
		args = append(args, *until)
	}
	return many(ctx, q, func(r pgx.Row) (string, error) {
		var id string
		return id, r.Scan(&id)
	}, sql+` ORDER BY scheduled_at, created_at`, args...)
}

/* ── service ─────────────────────────────────────────────────────────── */

// orderQueue sorts present therapists into rotation order: never assigned
// today first (earliest arrival first), then by the time of their last
// assignment — the therapist assigned longest ago is next.
func orderQueue(entries []ArrivalEntry) (queue, absent []ArrivalEntry) {
	for _, e := range entries {
		if e.Present {
			queue = append(queue, e)
		} else {
			absent = append(absent, e)
		}
	}
	sort.SliceStable(queue, func(i, j int) bool {
		a, b := queue[i], queue[j]
		switch {
		case (a.LastAssignedAt == nil) != (b.LastAssignedAt == nil):
			return a.LastAssignedAt == nil
		case a.LastAssignedAt != nil && !time.Time(*a.LastAssignedAt).Equal(time.Time(*b.LastAssignedAt)):
			return time.Time(*a.LastAssignedAt).Before(time.Time(*b.LastAssignedAt))
		default:
			aTime, bTime := time.Time(*a.ClockIn), time.Time(*b.ClockIn)
			if a.QueueSince != nil && time.Time(*a.QueueSince).After(aTime) {
				aTime = time.Time(*a.QueueSince)
			}
			if b.QueueSince != nil && time.Time(*b.QueueSince).After(bTime) {
				bTime = time.Time(*b.QueueSince)
			}
			return aTime.Before(bTime)
		}
	})
	for i := range queue {
		queue[i].Position = i + 1
	}
	if queue == nil {
		queue = []ArrivalEntry{}
	}
	if absent == nil {
		absent = []ArrivalEntry{}
	}
	return queue, absent
}

func (s *Service) arrivalQueueIn(ctx context.Context, q Q, branchID, date string) (*ArrivalQueue, error) {
	start, end, ok := domain.DayBounds(date)
	if !ok {
		return nil, httpx.BadRequest("Tanggal tidak valid")
	}
	at := start
	if date == domain.WIBDate(s.clock()) {
		at = s.clock()
	}
	entries, err := s.st.arrivals(ctx, q, branchID, date, start, end, at)
	if err != nil {
		return nil, err
	}
	rosters, err := s.ports.People.Rosters(ctx, q, arrivalEmployees(entries), date)
	if err != nil {
		return nil, err
	}
	working, err := s.workingRosters(ctx, q, arrivalEmployees(entries), domain.Interval{Start: at, End: at.Add(time.Nanosecond)})
	if err != nil {
		return nil, err
	}
	filtered := []ArrivalEntry{}
	for _, e := range entries {
		r := rosters[e.EmployeeID]
		if _, onShift := working[e.EmployeeID]; !onShift {
			if r.DayOff || r.OnLeave || r.Shift == nil {
				continue
			}
			e.Present = false
		}
		filtered = append(filtered, e)
	}
	queue, absent := orderQueue(filtered)
	return &ArrivalQueue{BranchID: branchID, Date: date, Queue: queue, Absent: absent}, nil
}

// ArrivalQueue shows the day's rotation for an outlet.
func (s *Service) ArrivalQueue(ctx context.Context, userID, branchID, date string) (*ArrivalQueue, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if _, err := s.outletIn(ctx, s.db, sc, branchID); err != nil {
		return nil, err
	}
	return s.arrivalQueueIn(ctx, s.db, branchID, date)
}

// AutoAssign gives every unassigned booking of the day a therapist from the
// arrival queue (front office button: the whole day at once).
func (s *Service) AutoAssign(ctx context.Context, userID, branchID, date string) (*AutoAssignResult, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if _, err := s.outletIn(ctx, s.db, sc, branchID); err != nil {
		return nil, err
	}
	return s.autoAssign(ctx, userID, branchID, date, nil)
}

// AutoAssignBooking assigns only the requested booking if the drop target is
// the first eligible therapist in the latest server-side arrival queue.
func (s *Service) AutoAssignBooking(ctx context.Context, userID, bookingID, targetTherapistID string) (*AutoAssigned, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	var assigned *AutoAssigned
	err = s.tx(ctx, func(q Q) error {
		b, err := s.lockBooking(ctx, q, sc, bookingID)
		if err != nil {
			return err
		}
		picked, reason, err := s.autoAssignBookingIn(ctx, q, userID, b, targetTherapistID)
		if err != nil {
			return err
		}
		if picked == nil {
			return httpx.Conflict(reason)
		}
		assigned = &AutoAssigned{BookingID: b.ID, BookingCode: b.Code, TherapistID: picked.ID, TherapistName: picked.FullName}
		return nil
	})
	return assigned, err
}

// autoAssignBookingIn runs under a booking lock, shared by manual single-card
// assignment and the background/batch pass.
func (s *Service) autoAssignBookingIn(ctx context.Context, q Q, actor string, b *bookingRow, targetTherapistID string) (*ArrivalEntry, string, error) {
	if b.Status != domain.BookingUnassigned {
		return nil, "Booking sudah ditugaskan", nil
	}
	date := domain.WIBDate(b.ScheduledAt)
	aq, err := s.arrivalQueueIn(ctx, q, b.BranchID, date)
	if err != nil {
		return nil, "", err
	}
	if len(aq.Queue) == 0 {
		return nil, "Belum ada terapis yang absen masuk", nil
	}
	items, err := s.st.itemRows(ctx, q, b.ID, true)
	if err != nil {
		return nil, "", err
	}
	employees := make([]string, len(aq.Queue))
	for i, therapist := range aq.Queue {
		employees[i] = therapist.EmployeeID
	}
	rosters, err := s.ports.People.Rosters(ctx, q, employees, date)
	if err != nil {
		return nil, "", err
	}
	reason := "Tidak ada terapis yang tersedia"
	for i := range aq.Queue {
		t := &aq.Queue[i]
		if roster := rosters[t.EmployeeID]; roster.OnLeave || roster.DayOff {
			continue
		}
		if _, err := s.checkBookingTherapist(ctx, q, b, items, t.ID); err != nil {
			reason = err.Error()
			continue
		}
		if targetTherapistID != "" && t.ID != targetTherapistID {
			return nil, "Booking harus ditugaskan ke " + t.FullName + " sesuai prioritas antrian", nil
		}
		if err := s.assignBooking(ctx, q, actor, b, t.ID); err != nil {
			reason = err.Error()
			continue
		}
		return t, "", nil
	}
	return nil, reason, nil
}

// autoAssign is the shared pass; until limits it to bookings starting
// before that time (the background loop's horizon).
func (s *Service) autoAssign(ctx context.Context, actor, branchID, date string, until *time.Time) (*AutoAssignResult, error) {
	start, end, ok := domain.DayBounds(date)
	if !ok {
		return nil, httpx.BadRequest("Tanggal tidak valid")
	}
	result := &AutoAssignResult{Assigned: []AutoAssigned{}, Skipped: []AutoSkipped{}}
	ids, err := s.st.unassignedBookings(ctx, s.db, branchID, start, end, until)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		var picked *ArrivalEntry
		var code string
		var reason string
		err := s.tx(ctx, func(q Q) error {
			b, err := s.lockBooking(ctx, q, nil, id)
			if err != nil {
				return err
			}
			code = b.Code
			picked, reason, err = s.autoAssignBookingIn(ctx, q, actor, b, "")
			return err
		})
		if err != nil {
			return nil, err
		}
		if picked != nil {
			result.Assigned = append(result.Assigned, AutoAssigned{BookingID: id, BookingCode: code, TherapistID: picked.ID, TherapistName: picked.FullName})
		} else {
			result.Skipped = append(result.Skipped, AutoSkipped{BookingID: id, BookingCode: code, Reason: reason})
		}
	}
	return result, nil
}

// AutoAssignLoop runs the day-of pass for every active outlet until ctx
// ends: bookings starting within AutoAssignHorizon get a therapist from the
// arrival queue as soon as one has clocked in.
func (s *Service) AutoAssignLoop(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.autoAssignPass(ctx)
		}
	}
}

func (s *Service) autoAssignPass(ctx context.Context) {
	now := s.clock()
	date := domain.WIBDate(now)
	until := now.Add(AutoAssignHorizon)
	ids, err := s.st.activeOutletBranchIDs(ctx, s.db)
	if err != nil {
		s.warn("spa: auto-assign outlets read failed", err)
		return
	}
	for _, branchID := range ids {
		res, err := s.autoAssign(ctx, "", branchID, date, &until)
		if err != nil {
			s.warn("spa: auto-assign failed", err)
			continue
		}
		if len(res.Assigned) > 0 && s.log != nil {
			s.log.Info("[spa] penugasan otomatis dari antrian absensi", "branch", branchID, "assigned", len(res.Assigned), "skipped", len(res.Skipped))
		}
	}
}

func (store) activeOutletBranchIDs(ctx context.Context, q Q) ([]string, error) {
	return many(ctx, q, func(r pgx.Row) (string, error) {
		var id string
		return id, r.Scan(&id)
	}, `SELECT o.branch_id::text FROM spa.outlets o JOIN configuration.branches b ON b.id = o.branch_id WHERE o.is_active AND b.is_active`)
}

func arrivalEmployees(rows []ArrivalEntry) []string {
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.EmployeeID)
	}
	return ids
}
