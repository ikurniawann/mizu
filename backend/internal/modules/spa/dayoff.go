package spa

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

/* ── Day-off booking (revisi R5) ──────────────────────────────────────
   A therapist books days off for the coming weeks from the therapist app.
   Per outlet HRD sets the minimum female and male therapists that must
   work each day and how many days off a week a therapist may have. The
   request is approved on the spot (first come, first served) unless it
   would leave the therapist's gender below the day's minimum. Approved days
   off make the therapist unavailable for bookings (the roster adapter
   reads them as a day off). Days off from the HRIS weekly pattern count
   toward the weekly limit. */

// DayOffQuota is an outlet's day-off rule.
type DayOffQuota struct {
	BranchID   string `json:"branch_id"`
	MinFemale  int    `json:"min_female"`
	MinMale    int    `json:"min_male"`
	MaxPerWeek int    `json:"max_per_week"`
	MinPerWeek int    `json:"min_per_week"`
}

// DefaultMaxPerWeek applies until HRD sets an outlet's quota.
const DefaultMaxPerWeek = 2

// DayOffRequest is one booked day off.
type DayOffRequest struct {
	ID            string        `json:"id"`
	TherapistID   string        `json:"therapist_id"`
	TherapistName string        `json:"therapist_name"`
	Gender        *string       `json:"gender"`
	BranchID      string        `json:"branch_id"`
	Date          string        `json:"date"`
	Status        string        `json:"status"`
	CreatedAt     httpx.JSTime  `json:"created_at"`
	CancelledAt   *httpx.JSTime `json:"cancelled_at"`
	CancelReason  *string       `json:"cancel_reason"`
}

// DayOffDay is one calendar day in a month view.
type DayOffDay struct {
	Date          string `json:"date"`
	Weekday       int    `json:"weekday"` // ISO, Monday = 1
	WorkingFemale int    `json:"working_female"`
	WorkingMale   int    `json:"working_male"`
	OffCount      int    `json:"off_count"` // booked days off at the outlet
	// Therapist view only: their own state that day.
	Mine      string `json:"mine,omitempty"`       // "requested" | "pattern" | "leave" | ""
	RequestID string `json:"request_id,omitempty"` // their approved request
	CanBook   bool   `json:"can_book"`
	Reason    string `json:"reason,omitempty"` // why they cannot book it
}

// DayOffMonth is GET /api/spa/me/day-offs and GET /api/spa/day-offs.
type DayOffMonth struct {
	Month    string          `json:"month"`
	BranchID string          `json:"branch_id"`
	Quota    DayOffQuota     `json:"quota"`
	Days     []DayOffDay     `json:"days"`
	Requests []DayOffRequest `json:"requests"`
}

/* ── store ───────────────────────────────────────────────────────────── */

func (store) dayOffQuota(ctx context.Context, q Q, branchID string) (DayOffQuota, error) {
	out := DayOffQuota{BranchID: branchID, MaxPerWeek: DefaultMaxPerWeek}
	err := q.QueryRow(ctx, `SELECT min_female, min_male, max_per_week, min_per_week FROM spa.day_off_quotas WHERE branch_id = $1`, branchID).
		Scan(&out.MinFemale, &out.MinMale, &out.MaxPerWeek, &out.MinPerWeek)
	if database.IsNoRows(err) {
		return out, nil
	}
	return out, err
}

func (store) saveDayOffQuota(ctx context.Context, q Q, in DayOffQuota, userID string) error {
	_, err := q.Exec(ctx, `INSERT INTO spa.day_off_quotas (branch_id, min_female, min_male, max_per_week, updated_by, min_per_week)
	  VALUES ($1, $2, $3, $4, NULLIF($5, '')::uuid, $6)
	  ON CONFLICT (branch_id) DO UPDATE SET min_female = EXCLUDED.min_female, min_male = EXCLUDED.min_male,
	    min_per_week = EXCLUDED.min_per_week, max_per_week = EXCLUDED.max_per_week, updated_by = EXCLUDED.updated_by, updated_at = now()`,
		in.BranchID, in.MinFemale, in.MinMale, in.MaxPerWeek, userID, in.MinPerWeek)
	return err
}

const dayOffColumns = `d.id::text, d.therapist_id::text, e.full_name, e.gender::text, d.branch_id::text, d.off_date::text, d.status,
	d.created_at, d.cancelled_at, d.cancel_reason`

func scanDayOff(r pgx.Row) (DayOffRequest, error) {
	var x DayOffRequest
	var created time.Time
	var cancelled *time.Time
	err := r.Scan(&x.ID, &x.TherapistID, &x.TherapistName, &x.Gender, &x.BranchID, &x.Date, &x.Status, &created, &cancelled, &x.CancelReason)
	x.CreatedAt = jsTime(created)
	if cancelled != nil {
		c := jsTime(*cancelled)
		x.CancelledAt = &c
	}
	return x, err
}

// dayOffs lists approved (and, with all, cancelled) requests in [from, to].
func (store) dayOffs(ctx context.Context, q Q, branchID, therapistID, from, to string, all bool) ([]DayOffRequest, error) {
	sql := `SELECT ` + dayOffColumns + ` FROM spa.day_off_requests d
	   JOIN spa.therapists t ON t.id = d.therapist_id JOIN hris.employees e ON e.id = t.employee_id
	  WHERE d.off_date BETWEEN $1::date AND $2::date`
	args := []any{from, to}
	if branchID != "" {
		args = append(args, branchID)
		sql += fmt.Sprintf(` AND d.branch_id = $%d`, len(args))
	}
	if therapistID != "" {
		args = append(args, therapistID)
		sql += fmt.Sprintf(` AND d.therapist_id = $%d`, len(args))
	}
	if !all {
		sql += ` AND d.status = 'approved'`
	}
	return many(ctx, q, scanDayOff, sql+` ORDER BY d.off_date, e.full_name`, args...)
}

func (store) dayOff(ctx context.Context, q Q, id string) (*DayOffRequest, error) {
	x, err := scanDayOff(q.QueryRow(ctx, `SELECT `+dayOffColumns+` FROM spa.day_off_requests d
	   JOIN spa.therapists t ON t.id = d.therapist_id JOIN hris.employees e ON e.id = t.employee_id WHERE d.id = $1`, id))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &x, err
}

// bookingsOnDay counts the therapist's open bookings on a WIB date.
func (store) bookingsOnDay(ctx context.Context, q Q, therapistID string, start, end time.Time) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM spa.bookings WHERE therapist_id = $1 AND scheduled_at >= $2 AND scheduled_at < $3
	   AND status IN ('assigned', 'in_treatment')`, therapistID, start, end).Scan(&n)
	return n, err
}

/* ── rules ───────────────────────────────────────────────────────────── */

// weekBounds is the ISO week (Monday–Sunday) holding date.
func weekBounds(date string) (string, string) {
	start, _, _ := domain.DayBounds(date)
	monday := start.AddDate(0, 0, 1-domain.Weekday(start))
	return monday.Format("2006-01-02"), monday.AddDate(0, 0, 6).Format("2006-01-02")
}

// dayWorkforce counts who works at the outlet on date by gender and tells,
// per therapist, whether they work (eligible, not on leave or day off).
func (s *Service) dayWorkforce(ctx context.Context, q Q, branchID, date string) (female, male int, working map[string]bool, eligible map[string]bool, err error) {
	list, err := s.st.eligibleTherapists(ctx, q, branchID, date)
	if err != nil {
		return 0, 0, nil, nil, err
	}
	employees := make([]string, 0, len(list))
	for _, t := range list {
		employees = append(employees, t.EmployeeID)
	}
	rosters, err := s.ports.People.Rosters(ctx, q, employees, date)
	if err != nil {
		return 0, 0, nil, nil, err
	}
	dayStart, dayEnd, _ := domain.DayBounds(date)
	assists, err := s.assistIntervals(ctx, q, "", dayStart, dayEnd.AddDate(0, 0, 1))
	if err != nil {
		return 0, 0, nil, nil, err
	}
	working, eligible = map[string]bool{}, map[string]bool{}
	for _, t := range list {
		eligible[t.ID] = true
		r := rosters[t.EmployeeID]
		if r.OnLeave || r.DayOff || r.Shift == nil {
			continue
		}
		intervals := map[string][]domain.Interval{}
		for _, a := range assists {
			if a.therapist == t.ID {
				intervals[a.branch] = append(intervals[a.branch], a.interval)
			}
		}
		if domain.QuotaBranch(t.HomeBranchID, shiftInterval(date, r.Shift.StartTime, r.Shift.EndTime), intervals) != branchID {
			delete(eligible, t.ID)
			continue
		}
		working[t.ID] = true
		if t.Gender != nil && *t.Gender == "female" {
			female++
		} else if t.Gender != nil && *t.Gender == "male" {
			male++
		}
	}
	return female, male, working, eligible, nil
}

// offDaysInWeek counts the therapist's days off (HRIS pattern or booked) in
// the ISO week of date.
func (s *Service) offDaysInWeek(ctx context.Context, q Q, t *Therapist, date string) (int, error) {
	from, _ := weekBounds(date)
	start, _, _ := domain.DayBounds(from)
	n := 0
	for i := 0; i < 7; i++ {
		d := start.AddDate(0, 0, i).Format("2006-01-02")
		r, err := s.ports.People.Rosters(ctx, q, []string{t.EmployeeID}, d)
		if err != nil {
			return 0, err
		}
		if r[t.EmployeeID].DayOff {
			n++
		}
	}
	return n, nil
}

// weeklyRestQuota combines home and destination rules only for assisted work
// dates in this ISO week, so later day-off edits cannot invalidate a transfer.
func (s *Service) weeklyRestQuota(ctx context.Context, q Q, t *Therapist, date string) (DayOffQuota, error) {
	quota, err := s.st.dayOffQuota(ctx, q, t.HomeBranchID)
	if err != nil {
		return quota, err
	}
	monday, _ := weekBounds(date)
	start, _, _ := domain.DayBounds(monday)
	assists, err := s.assistIntervals(ctx, q, t.ID, start, start.AddDate(0, 0, 8))
	if err != nil || len(assists) == 0 {
		return quota, err
	}
	branches := map[string]bool{}
	for i := 0; i < 7; i++ {
		day := domain.WIBDate(start.AddDate(0, 0, i))
		rosters, err := s.ports.People.Rosters(ctx, q, []string{t.EmployeeID}, day)
		if err != nil {
			return quota, err
		}
		r := rosters[t.EmployeeID]
		if r.Shift == nil || r.OnLeave || r.DayOff {
			continue
		}
		iv := shiftInterval(day, r.Shift.StartTime, r.Shift.EndTime)
		for _, a := range assists {
			if a.interval.Overlaps(iv) {
				branches[a.branch] = true
			}
		}
	}
	for branch := range branches {
		away, err := s.st.dayOffQuota(ctx, q, branch)
		if err != nil {
			return quota, err
		}
		quota.MinPerWeek = max(quota.MinPerWeek, away.MinPerWeek)
		quota.MaxPerWeek = min(quota.MaxPerWeek, away.MaxPerWeek)
	}
	return quota, nil
}

// dayOffWindow: from tomorrow to the end of next month (WIB).
func (s *Service) dayOffWindow() (string, string) {
	now := s.clock().In(domain.WIB)
	tomorrow := now.AddDate(0, 0, 1).Format("2006-01-02")
	firstNext := time.Date(now.Year(), now.Month()+2, 1, 0, 0, 0, 0, domain.WIB)
	return tomorrow, firstNext.AddDate(0, 0, -1).Format("2006-01-02")
}

// checkDayOff explains why t cannot take date off ("" = allowed).
func (s *Service) checkDayOff(ctx context.Context, q Q, t *Therapist, quota DayOffQuota, date string) (string, error) {
	from, to := s.dayOffWindow()
	if date < from || date > to {
		return "Libur bisa diajukan mulai besok sampai akhir bulan depan", nil
	}
	female, male, working, eligible, err := s.dayWorkforce(ctx, q, t.HomeBranchID, date)
	if err != nil {
		return "", err
	}
	if !eligible[t.ID] {
		return "Kamu sedang diperbantukan ke outlet lain pada tanggal itu", nil
	}
	if !working[t.ID] {
		return "Tanggal itu sudah jadwal libur atau cuti kamu", nil
	}
	off, err := s.offDaysInWeek(ctx, q, t, date)
	if err != nil {
		return "", err
	}
	restQuota, err := s.weeklyRestQuota(ctx, q, t, date)
	if err != nil {
		return "", err
	}
	quota.MaxPerWeek = restQuota.MaxPerWeek
	if off >= quota.MaxPerWeek {
		return fmt.Sprintf("Libur minggu ini sudah %d hari (maksimal %d)", off, quota.MaxPerWeek), nil
	}
	rosters, err := s.ports.People.Rosters(ctx, q, []string{t.EmployeeID}, date)
	if err != nil {
		return "", err
	}
	if shift := rosters[t.EmployeeID].Shift; shift != nil {
		iv := shiftInterval(date, shift.StartTime, shift.EndTime)
		assists, err := s.assistIntervals(ctx, q, t.ID, iv.Start, iv.End)
		if err != nil {
			return "", err
		}
		if len(assists) > 0 {
			return "Batalkan atau ubah perbantuan sebelum mengajukan libur pada tanggal ini", nil
		}
	}
	start, end, _ := domain.DayBounds(date)
	n, err := s.st.bookingsOnDay(ctx, q, t.ID, start, end)
	if err != nil {
		return "", err
	}
	if n > 0 {
		return "Kamu sudah punya booking pada tanggal itu; minta resepsionis memindahkannya dulu", nil
	}
	if t.Gender != nil {
		switch {
		case *t.Gender == "female" && female-1 < quota.MinFemale:
			return fmt.Sprintf("Kuota terapis wanita yang masuk sudah minimum (%d orang)", quota.MinFemale), nil
		case *t.Gender == "male" && male-1 < quota.MinMale:
			return fmt.Sprintf("Kuota terapis pria yang masuk sudah minimum (%d orang)", quota.MinMale), nil
		}
	}
	return "", nil
}

/* ── service: therapist ──────────────────────────────────────────────── */

// MyDayOffs is the therapist's month: their days off and which days they may still book.
func (s *Service) MyDayOffs(ctx context.Context, userID, month string) (*DayOffMonth, error) {
	t, err := s.requireMe(ctx, userID)
	if err != nil {
		return nil, err
	}
	start, end, ok := domain.MonthBounds(month)
	if !ok {
		return nil, httpx.BadRequest("Bulan tidak valid (YYYY-MM)")
	}
	quota, err := s.st.dayOffQuota(ctx, s.db, t.HomeBranchID)
	if err != nil {
		return nil, err
	}
	out := &DayOffMonth{Month: month, BranchID: t.HomeBranchID, Quota: quota, Days: []DayOffDay{}}
	first, last := start.Format("2006-01-02"), end.AddDate(0, 0, -1).Format("2006-01-02")
	if out.Requests, err = s.st.dayOffs(ctx, s.db, "", t.ID, first, last, false); err != nil {
		return nil, err
	}
	mine := map[string]string{}
	for _, r := range out.Requests {
		mine[r.Date] = r.ID
	}
	outletOffs, err := s.st.dayOffs(ctx, s.db, t.HomeBranchID, "", first, last, false)
	if err != nil {
		return nil, err
	}
	offCount := map[string]int{}
	for _, r := range outletOffs {
		offCount[r.Date]++
	}
	for d := start; d.Before(end); d = d.AddDate(0, 0, 1) {
		date := d.Format("2006-01-02")
		female, male, working, _, err := s.dayWorkforce(ctx, s.db, t.HomeBranchID, date)
		if err != nil {
			return nil, err
		}
		day := DayOffDay{Date: date, Weekday: domain.Weekday(d), WorkingFemale: female, WorkingMale: male, OffCount: offCount[date]}
		switch {
		case mine[date] != "":
			day.Mine, day.RequestID = "requested", mine[date]
		case !working[t.ID]:
			r, err := s.ports.People.Rosters(ctx, s.db, []string{t.EmployeeID}, date)
			if err != nil {
				return nil, err
			}
			if r[t.EmployeeID].OnLeave {
				day.Mine = "leave"
			} else if r[t.EmployeeID].DayOff {
				day.Mine = "pattern"
			} else {
				day.Reason = "Tidak dijadwalkan bekerja di outlet ini"
			}
		default:
			reason, err := s.checkDayOff(ctx, s.db, t, quota, date)
			if err != nil {
				return nil, err
			}
			day.CanBook, day.Reason = reason == "", reason
		}
		out.Days = append(out.Days, day)
	}
	return out, nil
}

// BookDayOff books date off for the therapist (first come, first served).
func (s *Service) BookDayOff(ctx context.Context, userID, date string) (*DayOffRequest, error) {
	t, err := s.requireMe(ctx, userID)
	if err != nil {
		return nil, err
	}
	if _, _, ok := domain.DayBounds(date); !ok {
		return nil, httpx.BadRequest("Tanggal tidak valid")
	}
	var id string
	err = s.tx(ctx, func(q Q) error {
		if err := rosterLock(ctx, q); err != nil {
			return err
		}
		// One booking at a time per outlet and day: the quota check and the
		// insert must see each other's results.
		if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('spa-dayoff:' || $1 || ':' || $2))`, t.HomeBranchID, date); err != nil {
			return err
		}
		if err := s.st.lockTherapist(ctx, q, t.ID); err != nil {
			return err
		}
		quota, err := s.st.dayOffQuota(ctx, q, t.HomeBranchID)
		if err != nil {
			return err
		}
		reason, err := s.checkDayOff(ctx, q, t, quota, date)
		if err != nil {
			return err
		}
		if reason != "" {
			return httpx.Conflict("Libur " + date + " ditolak: " + reason)
		}
		return q.QueryRow(ctx, `INSERT INTO spa.day_off_requests (therapist_id, branch_id, off_date, created_by)
		  VALUES ($1, $2, $3::date, NULLIF($4, '')::uuid) RETURNING id::text`, t.ID, t.HomeBranchID, date, userID).Scan(&id)
	})
	if err != nil {
		if database.IsUniqueViolation(err) {
			return nil, httpx.Conflict("Tanggal itu sudah kamu ajukan sebagai libur")
		}
		return nil, err
	}
	return s.st.dayOff(ctx, s.db, id)
}

// CancelMyDayOff withdraws one of the therapist's own future days off.
func (s *Service) CancelMyDayOff(ctx context.Context, userID, id string) (*DayOffRequest, error) {
	t, err := s.requireMe(ctx, userID)
	if err != nil {
		return nil, err
	}
	r, err := s.st.dayOff(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if r == nil || r.TherapistID != t.ID {
		return nil, httpx.NotFound("Jadwal libur tidak ditemukan")
	}
	return s.cancelDayOff(ctx, r, userID, "Dibatalkan terapis")
}

func (s *Service) cancelDayOff(ctx context.Context, r *DayOffRequest, userID, reason string) (*DayOffRequest, error) {
	if r.Status != "approved" {
		return nil, httpx.Conflict("Jadwal libur ini sudah dibatalkan")
	}
	if r.Date <= domain.WIBDate(s.clock()) {
		return nil, httpx.Conflict("Libur hari ini atau yang sudah lewat tidak bisa dibatalkan")
	}
	if err := s.tx(ctx, func(q Q) error {
		if err := rosterLock(ctx, q); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `UPDATE spa.day_off_requests SET status = 'cancelled', cancelled_at = now(), cancelled_by = NULLIF($2, '')::uuid, cancel_reason = $3 WHERE id = $1 AND status='approved'`, r.ID, userID, reason); err != nil {
			return err
		}
		t, err := s.st.therapist(ctx, q, r.TherapistID)
		if err != nil {
			return err
		}
		quota, err := s.weeklyRestQuota(ctx, q, t, r.Date)
		if err != nil {
			return err
		}
		off, err := s.offDaysInWeek(ctx, q, t, r.Date)
		if err != nil {
			return err
		}
		if off < quota.MinPerWeek {
			return httpx.Conflict("Pembatalan melanggar minimum libur mingguan")
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s.st.dayOff(ctx, s.db, r.ID)
}

/* ── service: HRD ────────────────────────────────────────────────────── */

// OutletDayOffs is HRD's month view of an outlet: quota, workforce per day
// and every booked day off (cancelled ones included).
func (s *Service) OutletDayOffs(ctx context.Context, userID, branchID, month string) (*DayOffMonth, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if _, err := s.outletIn(ctx, s.db, sc, branchID); err != nil {
		return nil, err
	}
	start, end, ok := domain.MonthBounds(month)
	if !ok {
		return nil, httpx.BadRequest("Bulan tidak valid (YYYY-MM)")
	}
	quota, err := s.st.dayOffQuota(ctx, s.db, branchID)
	if err != nil {
		return nil, err
	}
	first, last := start.Format("2006-01-02"), end.AddDate(0, 0, -1).Format("2006-01-02")
	out := &DayOffMonth{Month: month, BranchID: branchID, Quota: quota, Days: []DayOffDay{}}
	if out.Requests, err = s.st.dayOffs(ctx, s.db, branchID, "", first, last, true); err != nil {
		return nil, err
	}
	offCount := map[string]int{}
	for _, r := range out.Requests {
		if r.Status == "approved" {
			offCount[r.Date]++
		}
	}
	for d := start; d.Before(end); d = d.AddDate(0, 0, 1) {
		date := d.Format("2006-01-02")
		female, male, _, _, err := s.dayWorkforce(ctx, s.db, branchID, date)
		if err != nil {
			return nil, err
		}
		out.Days = append(out.Days, DayOffDay{Date: date, Weekday: domain.Weekday(d), WorkingFemale: female, WorkingMale: male, OffCount: offCount[date]})
	}
	return out, nil
}

// SaveDayOffQuota sets an outlet's minimum female/male therapists per day and weekly limit.
func (s *Service) SaveDayOffQuota(ctx context.Context, userID string, in DayOffQuota) (*DayOffQuota, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if _, err := s.outletIn(ctx, s.db, sc, in.BranchID); err != nil {
		return nil, err
	}
	if in.MinPerWeek < 0 || in.MinPerWeek > in.MaxPerWeek {
		return nil, httpx.BadRequest("Minimum libur tidak boleh melebihi maksimum")
	}
	if err := s.tx(ctx, func(q Q) error {
		if err := rosterLock(ctx, q); err != nil {
			return err
		}
		return s.st.saveDayOffQuota(ctx, q, in, userID)
	}); err != nil {
		return nil, err
	}
	q, err := s.st.dayOffQuota(ctx, s.db, in.BranchID)
	return &q, err
}

// CancelDayOff lets HRD withdraw a booked day off (e.g. staffing emergency).
func (s *Service) CancelDayOff(ctx context.Context, userID, id, reason string) (*DayOffRequest, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	r, err := s.st.dayOff(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, httpx.NotFound("Jadwal libur tidak ditemukan")
	}
	if _, err := s.outletIn(ctx, s.db, sc, r.BranchID); err != nil {
		return nil, err
	}
	if reason == "" {
		reason = "Dibatalkan HRD"
	}
	return s.cancelDayOff(ctx, r, userID, reason)
}
