package spa

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

type rosterRequest struct {
	BranchID        string              `json:"branch_id"`
	Month           string              `json:"month"`
	ShiftIDs        []string            `json:"shift_ids"`
	ReplaceExisting bool                `json:"replace_existing"`
	Revision        string              `json:"revision"`
	Cells           []domain.RosterCell `json:"cells"`
}
type rosterPreview struct {
	domain.GenerationResult
	Revision string      `json:"revision"`
	Quota    DayOffQuota `json:"quota"`
}

func rosterLock(ctx context.Context, q Q) error {
	// ponytail: serialize roster, day-off and assistance transactions; partition by outlet only
	// if measured contention warrants a shared multi-outlet lock protocol.
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('spa-roster'))`)
	return err
}
func (s *Service) rosterInput(ctx context.Context, q Q, req rosterRequest) (domain.GenerationInput, DayOffQuota, string, error) {
	in := domain.GenerationInput{Month: req.Month, BranchID: req.BranchID, Shifts: req.ShiftIDs, Cells: []domain.RosterCell{}}
	quota, err := s.st.dayOffQuota(ctx, q, req.BranchID)
	if err != nil {
		return in, quota, "", err
	}
	in.MinFemale, in.MinMale, in.MinOff, in.MaxOff = quota.MinFemale, quota.MinMale, quota.MinPerWeek, quota.MaxPerWeek
	start, end, ok := domain.MonthBounds(req.Month)
	if !ok {
		return in, quota, "", httpx.BadRequest("Bulan tidak valid")
	}
	first := start.AddDate(0, 0, 1-domain.Weekday(start))
	last := end.AddDate(0, 0, -1)
	last = last.AddDate(0, 0, 7-domain.Weekday(last))
	rows, err := q.Query(ctx, `SELECT e.id::text,e.full_name,COALESCE(e.gender::text,''),t.id::text,t.home_branch_id::text,d::date::text,
 COALESCE(es.shift_id::text,''), es.id IS NOT NULL,
 EXISTS(SELECT 1 FROM spa.day_off_requests r WHERE r.therapist_id=t.id AND r.off_date=d::date AND r.status='approved'),
 EXISTS(SELECT 1 FROM hris.leaves l WHERE l.employee_id=e.id AND l.status::text='approved' AND d::date BETWEEN l.start_date AND l.end_date),
 EXISTS(SELECT 1 FROM spa.bookings b WHERE b.therapist_id=t.id AND (b.scheduled_at AT TIME ZONE 'Asia/Jakarta')::date=d::date AND b.status IN ('assigned','in_treatment','completed')),
 EXISTS(SELECT 1 FROM hris.attendance a WHERE a.employee_id=e.id AND a.date=d::date),
 COALESCE(sh.start_time::text,''),COALESCE(sh.end_time::text,'')
 FROM spa.therapists t JOIN hris.employees e ON e.id=t.employee_id
 CROSS JOIN generate_series($2::date,$3::date,interval '1 day') d
 LEFT JOIN LATERAL (SELECT * FROM hris.effective_employee_shifts x WHERE x.employee_id=e.id AND x.day_of_week=extract(isodow FROM d) AND x.effective_from<=d::date AND (x.effective_to IS NULL OR x.effective_to>=d::date) ORDER BY x.effective_from DESC,x.effective_to ASC NULLS LAST LIMIT 1) es ON true
 LEFT JOIN hris.shifts sh ON sh.id=es.shift_id
 WHERE t.is_active AND COALESCE(e.is_active,true) AND e.employment_status<>'resigned' AND NOT t.rehire_pending
 AND (t.home_branch_id=$1 OR EXISTS(SELECT 1 FROM spa.therapist_assists a WHERE a.therapist_id=t.id AND a.branch_id=$1 AND a.cancelled_at IS NULL AND a.start_date<=$3::date AND a.end_date>=$2::date))
 ORDER BY e.id,d`, req.BranchID, domain.WIBDate(first), domain.WIBDate(last))
	if err != nil {
		return in, quota, "", err
	}
	type loaded struct {
		cell                        domain.RosterCell
		therapist, home, start, end string
	}
	data := []loaded{}
	for rows.Next() {
		var x loaded
		var scheduled, off, leave, booking, attendance bool
		c := &x.cell
		if err = rows.Scan(&c.EmployeeID, &c.Name, &c.Gender, &x.therapist, &x.home, &c.Date, &c.ShiftID, &scheduled, &off, &leave, &booking, &attendance, &x.start, &x.end); err != nil {
			rows.Close()
			return in, quota, "", err
		}
		c.BranchID = x.home
		c.Kind = "unscheduled"
		if scheduled {
			c.Kind = "off"
			if c.ShiftID != "" {
				c.Kind = "work"
			}
		}
		if off {
			c.Kind = "off"
			c.ShiftID = ""
			c.Reason = "Libur disetujui"
		}
		if leave {
			c.Kind = "leave"
			c.ShiftID = ""
			c.Reason = "Cuti disetujui"
		}
		c.Locked = x.home != req.BranchID || !strings.HasPrefix(c.Date, req.Month+"-") || c.Date <= domain.WIBDate(s.clock()) || off || leave || booking || attendance || (scheduled && !req.ReplaceExisting)
		if booking {
			c.Reason = "Sudah ada booking"
		}
		if attendance {
			c.Reason = "Sudah ada absensi"
		}
		data = append(data, x)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return in, quota, "", err
	}
	assists, err := s.assistIntervals(ctx, q, "", first, last.AddDate(0, 0, 2))
	if err != nil {
		return in, quota, "", err
	}
	in.WeekRules = map[string][2]int{}
	quotas := map[string]DayOffQuota{req.BranchID: quota}
	getQuota := func(branch string) (DayOffQuota, error) {
		if cached, ok := quotas[branch]; ok {
			return cached, nil
		}
		value, err := s.st.dayOffQuota(ctx, q, branch)
		if err == nil {
			quotas[branch] = value
		}
		return value, err
	}
	for _, x := range data {
		c := x.cell
		monday, _ := weekBounds(c.Date)
		weekKey := c.EmployeeID + ":" + monday
		if _, ok := in.WeekRules[weekKey]; !ok {
			homeQuota, err := getQuota(x.home)
			if err != nil {
				return in, quota, "", err
			}
			in.WeekRules[weekKey] = [2]int{homeQuota.MinPerWeek, homeQuota.MaxPerWeek}
		}
		iv := shiftInterval(c.Date, x.start, x.end)
		a := map[string][]domain.Interval{}
		hasAssist := false
		for _, v := range assists {
			if v.therapist == x.therapist && v.interval.Overlaps(iv) {
				awayQuota, err := getQuota(v.branch)
				if err != nil {
					return in, quota, "", err
				}
				rule := in.WeekRules[weekKey]
				in.WeekRules[weekKey] = [2]int{max(rule[0], awayQuota.MinPerWeek), min(rule[1], awayQuota.MaxPerWeek)}
				hasAssist = true
				a[v.branch] = append(a[v.branch], v.interval)
			}
		}
		if hasAssist {
			c.BranchID = domain.QuotaBranch(x.home, iv, a)
			c.Locked = true
			if c.Reason == "" {
				c.Reason = "Perbantuan"
			}
		}
		in.Cells = append(in.Cells, c)
	}
	in.ShiftMinutes = map[string][2]int{}
	shiftRows, err := q.Query(ctx, `SELECT id::text,start_time::text,end_time::text FROM hris.shifts`)
	if err != nil {
		return in, quota, "", err
	}
	for shiftRows.Next() {
		var id, a, b string
		if err := shiftRows.Scan(&id, &a, &b); err != nil {
			shiftRows.Close()
			return in, quota, "", err
		}
		start, _ := domain.ClockMinutes(a)
		end, _ := domain.ClockMinutes(b)
		in.ShiftMinutes[id] = [2]int{start, end}
	}
	shiftRows.Close()
	if err := shiftRows.Err(); err != nil {
		return in, quota, "", err
	}
	raw, _ := json.Marshal(in)
	sum := sha256.Sum256(raw)
	return in, quota, hex.EncodeToString(sum[:]), nil
}
func shiftInterval(date, start, end string) domain.Interval {
	d, _, _ := domain.DayBounds(date)
	sm, ok := domain.ClockMinutes(start)
	em, ok2 := domain.ClockMinutes(end)
	if !ok || !ok2 {
		return domain.Interval{Start: d, End: d.AddDate(0, 0, 1)}
	}
	if em <= sm {
		em += 1440
	}
	return domain.Interval{Start: d.Add(time.Duration(sm) * time.Minute), End: d.Add(time.Duration(em) * time.Minute)}
}
func (s *Service) roster(ctx context.Context, user string, req rosterRequest, apply bool) (*rosterPreview, error) {
	sc, err := s.scope(ctx, user)
	if err != nil {
		return nil, err
	}
	if _, err = s.outletIn(ctx, s.db, sc, req.BranchID); err != nil {
		return nil, err
	}
	start, _, ok := domain.MonthBounds(req.Month)
	if !ok || start.Before(time.Date(s.clock().In(domain.WIB).Year(), s.clock().In(domain.WIB).Month(), 1, 0, 0, 0, 0, domain.WIB)) {
		return nil, httpx.BadRequest("Pilih bulan ini atau bulan mendatang")
	}
	if len(req.ShiftIDs) == 0 || len(req.ShiftIDs) > 20 {
		return nil, httpx.BadRequest("Pilih 1–20 shift aktif")
	}
	var out *rosterPreview
	err = s.tx(ctx, func(q Q) error {
		if err := rosterLock(ctx, q); err != nil {
			return err
		}
		var n int
		if err := q.QueryRow(ctx, `SELECT count(*) FROM hris.shifts WHERE id::text=ANY($1::text[]) AND is_active`, req.ShiftIDs).Scan(&n); err != nil {
			return err
		}
		if n != len(req.ShiftIDs) {
			return httpx.BadRequest("Shift tidak aktif, duplikat, atau tidak ditemukan")
		}
		// Use the same therapist lock as booking assignment before the final read.
		ids, err := many(ctx, q, func(r pgx.Row) (string, error) { var id string; err := r.Scan(&id); return id, err }, `SELECT id::text FROM spa.therapists WHERE home_branch_id=$1 ORDER BY id`, req.BranchID)
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err = s.st.lockTherapist(ctx, q, id); err != nil {
				return err
			}
		}
		in, quota, rev, err := s.rosterInput(ctx, q, req)
		if err != nil {
			return err
		}
		if len(in.Cells) == 0 {
			return httpx.Conflict("Tidak ada terapis aktif di outlet")
		}
		if !apply && len(req.Cells) == 0 {
			out = &rosterPreview{GenerationResult: domain.GenerateMonthlyRoster(in), Revision: rev, Quota: quota}
			return nil
		}
		if req.Revision != rev {
			return httpx.Conflict("Jadwal atau syarat telah berubah. Generate ulang sebelum menerapkan")
		}
		if len(req.Cells) != len(in.Cells) {
			return httpx.BadRequest("Daftar jadwal tidak lengkap")
		}
		for i, old := range in.Cells {
			c := req.Cells[i]
			if c.EmployeeID != old.EmployeeID || c.Date != old.Date {
				return httpx.BadRequest("Urutan atau karyawan jadwal tidak sesuai")
			}
			if old.Locked && (c.Kind != old.Kind || c.ShiftID != old.ShiftID) {
				return httpx.Conflict("Jadwal terkunci: " + old.Name + " " + old.Date)
			}
			if !old.Locked {
				if c.Kind != "work" && c.Kind != "off" {
					return httpx.BadRequest("Pilih shift kerja atau libur")
				}
				if c.Kind == "work" {
					found := false
					for _, id := range req.ShiftIDs {
						if id == c.ShiftID {
							found = true
						}
					}
					if !found {
						return httpx.BadRequest("Shift di luar pilihan generator")
					}
				} else {
					c.ShiftID = ""
				}
				in.Cells[i].Kind, in.Cells[i].ShiftID = c.Kind, c.ShiftID
			}
		}
		violations := domain.ValidateRoster(in)
		if len(violations) > 0 {
			return &httpx.Error{Status: 409, Message: violations[0].Message, Details: violations}
		}
		if apply {
			for _, c := range in.Cells {
				if c.Locked {
					continue
				}
				_, err = q.Exec(ctx, `INSERT INTO hris.employee_shift_dates(employee_id,work_date,shift_id,created_by_name) VALUES($1,$2,NULLIF($3,'')::uuid,$4) ON CONFLICT(employee_id,work_date) DO UPDATE SET shift_id=EXCLUDED.shift_id,created_by_name=EXCLUDED.created_by_name,created_at=now()`, c.EmployeeID, c.Date, c.ShiftID, user)
				if err != nil {
					return err
				}
			}
		}
		if apply {
			if err = s.validateRosterTimes(ctx, q, in); err != nil {
				return err
			}
		}
		out = &rosterPreview{GenerationResult: domain.GenerationResult{Status: "valid", Cells: in.Cells, Violations: []domain.RosterViolation{}}, Revision: rev, Quota: quota}
		return nil
	})
	return out, err
}
func (s *Service) validateRosterTimes(ctx context.Context, q Q, in domain.GenerationInput) error {
	// Adjacent dates also cover overnight overlap at month boundaries.
	var name, date string
	err := q.QueryRow(ctx, `WITH days AS (SELECT e.id,e.full_name,d::date dt,x.shift_id FROM hris.employees e CROSS JOIN generate_series(($1||'-01')::date-1,(($1||'-01')::date+interval '1 month')::date,interval '1 day') d LEFT JOIN LATERAL (SELECT shift_id FROM hris.effective_employee_shifts z WHERE z.employee_id=e.id AND z.day_of_week=extract(isodow FROM d) AND z.effective_from<=d::date AND (z.effective_to IS NULL OR z.effective_to>=d::date) ORDER BY z.effective_from DESC,z.effective_to ASC NULLS LAST LIMIT 1) x ON true WHERE e.id::text=ANY($2::text[])), windows AS (SELECT d.*,dt+s.start_time a,dt+s.end_time+CASE WHEN s.end_time<=s.start_time THEN interval '1 day' ELSE interval '0' END b FROM days d JOIN hris.shifts s ON s.id=d.shift_id) SELECT a.full_name,a.dt::text FROM windows a JOIN windows b ON a.id=b.id AND b.dt=a.dt+1 WHERE a.b>b.a LIMIT 1`, in.Month, rosterEmployees(in.Cells)).Scan(&name, &date)
	if err == nil {
		return httpx.Conflict(fmt.Sprintf("Shift %s bertumpang tindih pada %s", name, date))
	}
	if !database.IsNoRows(err) {
		return err
	}
	return nil
}
func rosterEmployees(cells []domain.RosterCell) []string {
	seen := map[string]bool{}
	ids := []string{}
	for _, c := range cells {
		if !seen[c.EmployeeID] {
			ids = append(ids, c.EmployeeID)
			seen[c.EmployeeID] = true
		}
	}
	return ids
}
