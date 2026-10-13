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
func (store) arrivals(ctx context.Context, q Q, branchID, date string, start, end time.Time) ([]ArrivalEntry, error) {
	return many(ctx, q, func(r pgx.Row) (ArrivalEntry, error) {
		var e ArrivalEntry
		var clockIn, last *time.Time
		var assisting bool
		err := r.Scan(&e.ID, &e.EmployeeID, &e.FullName, &e.NIP, &e.Phone, &e.PhotoURL, &e.HomeBranchID, &e.HomeBranchName,
			&e.Gender, &e.IsActive, &assisting, &clockIn, &last, &e.AssignedToday)
		if clockIn != nil {
			t := jsTime(*clockIn)
			e.ClockIn, e.Present = &t, true
		}
		if last != nil {
			t := jsTime(*last)
			e.LastAssignedAt = &t
		}
		return e, err
	}, `SELECT `+therapistColumns+`, t.home_branch_id <> $1,
	        (SELECT min(a.clock_in) FROM hris.attendance a WHERE a.employee_id = t.employee_id AND a.date = $2::date AND a.clock_in IS NOT NULL),
	        (SELECT max(ev.created_at) FROM spa.booking_events ev JOIN spa.bookings bk ON bk.id = ev.booking_id
	          WHERE ev.action = 'assign' AND bk.therapist_id = t.id AND bk.branch_id = $1 AND bk.scheduled_at >= $3 AND bk.scheduled_at < $4),
	        (SELECT count(*) FROM spa.bookings bk WHERE bk.therapist_id = t.id AND bk.branch_id = $1 AND bk.scheduled_at >= $3 AND bk.scheduled_at < $4
	           AND bk.status IN ('assigned', 'in_treatment', 'completed'))::int
	   FROM `+therapistFrom+`
	  WHERE t.is_active AND COALESCE(e.is_active, true)
	    AND ((t.home_branch_id = $1 AND NOT EXISTS (
	            SELECT 1 FROM spa.therapist_assists a
	             WHERE a.therapist_id = t.id AND a.branch_id <> $1 AND $2::date BETWEEN a.start_date AND a.end_date))
	      OR EXISTS (SELECT 1 FROM spa.therapist_assists a
	             WHERE a.therapist_id = t.id AND a.branch_id = $1 AND $2::date BETWEEN a.start_date AND a.end_date))
	  ORDER BY e.full_name`, branchID, date, start, end)
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
			return time.Time(*a.ClockIn).Before(time.Time(*b.ClockIn))
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
	entries, err := s.st.arrivals(ctx, q, branchID, date, start, end)
	if err != nil {
		return nil, err
	}
	queue, absent := orderQueue(entries)
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
		reason := "Belum ada terapis yang absen masuk"
		err := s.tx(ctx, func(q Q) error {
			b, err := s.lockBooking(ctx, q, nil, id)
			if err != nil {
				return err
			}
			code = b.Code
			if b.Status != domain.BookingUnassigned {
				reason = "Sudah ditugaskan"
				return nil
			}
			aq, err := s.arrivalQueueIn(ctx, q, branchID, date)
			if err != nil {
				return err
			}
			items, err := s.st.itemRows(ctx, q, id, true)
			if err != nil {
				return err
			}
			for i := range aq.Queue {
				t := aq.Queue[i]
				if _, err := s.checkBookingTherapist(ctx, q, b, items, t.ID); err != nil {
					reason = err.Error()
					continue
				}
				if err := s.assignBooking(ctx, q, actor, b, t.ID); err != nil {
					reason = err.Error()
					continue
				}
				picked = &t
				return nil
			}
			return nil
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
