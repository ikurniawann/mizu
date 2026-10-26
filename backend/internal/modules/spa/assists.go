package spa

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

type assistInterval struct {
	id, therapist, branch string
	interval              domain.Interval
}

func (s *Service) assistIntervals(ctx context.Context, q Q, therapist string, start, end time.Time) ([]assistInterval, error) {
	return many(ctx, q, func(r pgx.Row) (assistInterval, error) {
		var a assistInterval
		err := r.Scan(&a.id, &a.therapist, &a.branch, &a.interval.Start, &a.interval.End)
		return a, err
	}, `SELECT id::text,therapist_id::text,branch_id::text,starts_at,ends_at FROM spa.therapist_assists WHERE cancelled_at IS NULL AND ($1='' OR therapist_id::text=$1) AND starts_at<$3 AND ends_at>$2 ORDER BY starts_at,id`, therapist, start, end)
}
func (s *Service) eligibleTherapistsAt(ctx context.Context, q Q, branch string, iv domain.Interval) ([]eligibleTherapist, error) {
	list, err := s.st.eligibleTherapists(ctx, q, branch, domain.WIBDate(iv.Start))
	if err != nil {
		return nil, err
	}
	assists, err := s.assistIntervals(ctx, q, "", iv.Start, iv.End)
	if err != nil {
		return nil, err
	}
	out := []eligibleTherapist{}
	for _, t := range list {
		valid := t.HomeBranchID == branch
		for _, a := range assists {
			if a.therapist != t.ID {
				continue
			}
			if t.HomeBranchID == branch {
				valid = false
				break
			}
			if a.branch == branch && !a.interval.Start.After(iv.Start) && !a.interval.End.Before(iv.End) {
				valid = true
			}
		}
		if valid {
			out = append(out, t)
		}
	}
	return out, nil
}
func (s *Service) createTimedAssist(ctx context.Context, user, therapist, branch string, start, end time.Time, note string, dryRun ...bool) (*Assist, error) {
	now := s.clock()
	if start.IsZero() {
		start = now
	}
	if !end.After(start) || end.Sub(start) > 93*24*time.Hour {
		return nil, httpx.BadRequest("Jam selesai harus setelah jam mulai, maksimal 93 hari")
	}
	if start.Before(now) {
		return nil, httpx.BadRequest("Perbantuan tidak boleh berlaku surut")
	}
	sc, err := s.scope(ctx, user)
	if err != nil {
		return nil, err
	}
	var id string
	var simulated *Assist
	previewOnly := len(dryRun) > 0 && dryRun[0]
	previewRollback := errors.New("assist preview rollback")
	err = s.tx(ctx, func(q Q) error {
		if err := rosterLock(ctx, q); err != nil {
			return err
		}
		t, err := s.st.therapist(ctx, q, therapist)
		if err != nil {
			return err
		}
		if t == nil || !t.IsActive {
			return httpx.BadRequest("Terapis tidak aktif atau tidak ditemukan")
		}
		if t.HomeBranchID == branch {
			return httpx.BadRequest("Outlet tujuan sama dengan outlet asal")
		}
		for _, b := range []string{t.HomeBranchID, branch} {
			if _, err = s.outletIn(ctx, q, sc, b); err != nil {
				return err
			}
		}
		if err = s.st.lockTherapist(ctx, q, therapist); err != nil {
			return err
		}
		if err = s.refuseRunningTransfer(ctx, q, therapist); err != nil {
			return err
		}
		existing, err := s.assistIntervals(ctx, q, therapist, start, end)
		if err != nil {
			return err
		}
		if len(existing) > 0 {
			return httpx.Conflict("Perbantuan bertumpang tindih dengan perbantuan lain")
		}
		conflict, err := s.st.bookingConflicts(ctx, q, []string{therapist}, start, end, "")
		if err != nil {
			return err
		}
		if len(conflict[therapist]) > 0 {
			return httpx.Conflict("Ada booking atau treatment pada interval perpindahan; selesaikan atau alihkan penugasan dahulu")
		}
		first, _, _ := domain.DayBounds(domain.WIBDate(start))
		for d := first; d.Before(end); d = d.AddDate(0, 0, 1) {
			rosters, err := s.ports.People.Rosters(ctx, q, []string{t.EmployeeID}, domain.WIBDate(d))
			if err != nil {
				return err
			}
			r := rosters[t.EmployeeID]
			sliceStart, sliceEnd := d, d.AddDate(0, 0, 1)
			if start.After(sliceStart) {
				sliceStart = start
			}
			if end.Before(sliceEnd) {
				sliceEnd = end
			}
			working := !r.OnLeave && !r.DayOff && r.Shift != nil
			if working {
				working = shiftInterval(domain.WIBDate(d), r.Shift.StartTime, r.Shift.EndTime).Overlaps(domain.Interval{Start: sliceStart, End: sliceEnd})
			}
			if !working {
				prev, err := s.ports.People.Rosters(ctx, q, []string{t.EmployeeID}, domain.WIBDate(d.AddDate(0, 0, -1)))
				if err != nil {
					return err
				}
				p := prev[t.EmployeeID]
				if p.Shift == nil || p.OnLeave || p.DayOff {
					return httpx.Conflict("Perbantuan memerlukan jadwal kerja tanpa cuti/libur pada " + domain.WIBDate(d))
				}
				window := shiftInterval(domain.WIBDate(d.AddDate(0, 0, -1)), p.Shift.StartTime, p.Shift.EndTime)
				sliceEnd := d.AddDate(0, 0, 1)
				if end.Before(sliceEnd) {
					sliceEnd = end
				}
				if window.End.Before(sliceEnd) {
					return httpx.Conflict("Perbantuan di luar jadwal kerja pada " + domain.WIBDate(d))
				}
			}
		}
		before, err := s.assistImpact(ctx, q, therapist, t.HomeBranchID, branch, start, end)
		if err != nil {
			return err
		}
		weekStart, err := s.assistWorkStart(ctx, q, therapist, start)
		if err != nil {
			return err
		}
		for _, b := range []string{t.HomeBranchID, branch} {
			quota, err := s.st.dayOffQuota(ctx, q, b)
			if err != nil {
				return err
			}
			for d := weekStart.AddDate(0, 0, 1-domain.Weekday(weekStart)); d.Before(end); d = d.AddDate(0, 0, 7) {
				off, err := s.offDaysInWeek(ctx, q, t, domain.WIBDate(d))
				if err != nil {
					return err
				}
				if off < quota.MinPerWeek || off > quota.MaxPerWeek {
					return httpx.Conflict("Libur mingguan terapis tidak memenuhi syarat outlet " + b)
				}
			}
		}
		err = q.QueryRow(ctx, `INSERT INTO spa.therapist_assists(therapist_id,branch_id,start_date,end_date,starts_at,ends_at,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`, therapist, branch, domain.WIBDate(start), domain.WIBDate(end.Add(-time.Nanosecond)), start, end, note, nullable(user)).Scan(&id)
		if err != nil {
			return err
		}
		if err := s.validateAssistQuotas(ctx, q, therapist, t.HomeBranchID, branch, start, end); err != nil {
			return err
		}
		if previewOnly {
			after, err := s.assistImpact(ctx, q, therapist, t.HomeBranchID, branch, start, end)
			if err != nil {
				return err
			}
			for i := range after {
				after[i].BeforeFemale = before[i].Female
				after[i].BeforeMale = before[i].Male
			}
			simulated = &Assist{TherapistID: therapist, TherapistName: t.FullName, BranchID: branch, StartsAt: start, EndsAt: end, Impact: after}
			return previewRollback
		}
		return nil
	})
	if errors.Is(err, previewRollback) {
		return simulated, nil
	}
	if err != nil {
		return nil, err
	}
	list, err := s.st.assists(ctx, s.db, branch, domain.WIBDate(start), domain.WIBDate(end))
	if err != nil {
		return nil, err
	}
	for _, a := range list {
		if a.ID == id {
			return &a, nil
		}
	}
	return nil, httpx.NotFound("Perbantuan tidak ditemukan")
}
func (s *Service) validateAssistQuotas(ctx context.Context, q Q, therapist, home, branch string, start, end time.Time) error {
	first, err := s.assistWorkStart(ctx, q, therapist, start)
	if err != nil {
		return err
	}
	for d := first; d.Before(end); d = d.AddDate(0, 0, 1) {
		for _, b := range []string{home, branch} {
			quota, err := s.st.dayOffQuota(ctx, q, b)
			if err != nil {
				return err
			}
			female, male, _, _, err := s.dayWorkforce(ctx, q, b, domain.WIBDate(d))
			if err != nil {
				return err
			}
			if female < quota.MinFemale || male < quota.MinMale {
				return httpx.Conflict(fmt.Sprintf("Outlet %s, %s: perempuan %d/min %d, laki-laki %d/min %d", b, domain.WIBDate(d), female, quota.MinFemale, male, quota.MinMale))
			}
		}
	}
	return nil
}
func (s *Service) cancelAssist(ctx context.Context, user, id string) error {
	sc, err := s.scope(ctx, user)
	if err != nil {
		return err
	}
	return s.tx(ctx, func(q Q) error {
		if err := rosterLock(ctx, q); err != nil {
			return err
		}
		var therapist, home, branch string
		var start, end time.Time
		err := q.QueryRow(ctx, `SELECT a.therapist_id::text,t.home_branch_id::text,a.branch_id::text,a.starts_at,a.ends_at FROM spa.therapist_assists a JOIN spa.therapists t ON t.id=a.therapist_id WHERE a.id=$1 AND a.cancelled_at IS NULL FOR UPDATE OF a`, id).Scan(&therapist, &home, &branch, &start, &end)
		if database.IsNoRows(err) {
			return httpx.NotFound("Perbantuan tidak ditemukan")
		}
		if err != nil {
			return err
		}
		for _, b := range []string{home, branch} {
			if _, err = s.outletIn(ctx, q, sc, b); err != nil {
				return err
			}
		}
		now := s.clock()
		if !end.After(now) {
			return httpx.Conflict("Perbantuan yang sudah selesai tidak dapat dibatalkan")
		}
		effective := start
		if now.After(start) {
			effective = now
		}
		if err = s.st.lockTherapist(ctx, q, therapist); err != nil {
			return err
		}
		if err = s.refuseRunningTransfer(ctx, q, therapist); err != nil {
			return err
		}
		conflicts, err := s.st.bookingConflicts(ctx, q, []string{therapist}, effective, end, "")
		if err != nil {
			return err
		}
		if len(conflicts[therapist]) > 0 {
			return httpx.Conflict("Masih ada booking atau treatment di periode perbantuan")
		}
		if start.Before(now) {
			_, err = q.Exec(ctx, `UPDATE spa.therapist_assists SET ends_at=$2,end_date=($2 AT TIME ZONE 'Asia/Jakarta')::date,cancelled_by=$3 WHERE id=$1`, id, now, user)
		} else {
			_, err = q.Exec(ctx, `UPDATE spa.therapist_assists SET cancelled_at=$2,cancelled_by=$3 WHERE id=$1`, id, now, user)
		}
		if err != nil {
			return err
		}
		return s.validateAssistQuotas(ctx, q, therapist, home, branch, effective, end)
	})
}

type AssistImpact struct {
	BranchID     string `json:"branch_id"`
	Date         string `json:"date"`
	Female       int    `json:"female"`
	Male         int    `json:"male"`
	BeforeFemale int    `json:"before_female"`
	BeforeMale   int    `json:"before_male"`
	MinFemale    int    `json:"min_female"`
	MinMale      int    `json:"min_male"`
}

func (s *Service) assistImpact(ctx context.Context, q Q, therapist, home, branch string, start, end time.Time) ([]AssistImpact, error) {
	out := []AssistImpact{}
	first, err := s.assistWorkStart(ctx, q, therapist, start)
	if err != nil {
		return nil, err
	}
	for d := first; d.Before(end); d = d.AddDate(0, 0, 1) {
		for _, b := range []string{home, branch} {
			quota, err := s.st.dayOffQuota(ctx, q, b)
			if err != nil {
				return nil, err
			}
			f, m, _, _, err := s.dayWorkforce(ctx, q, b, domain.WIBDate(d))
			if err != nil {
				return nil, err
			}
			out = append(out, AssistImpact{BranchID: b, Date: domain.WIBDate(d), Female: f, Male: m, MinFemale: quota.MinFemale, MinMale: quota.MinMale})
		}
	}
	return out, nil
}

func (s *Service) assistWorkStart(ctx context.Context, q Q, therapist string, start time.Time) (time.Time, error) {
	first, _, _ := domain.DayBounds(domain.WIBDate(start))
	t, err := s.st.therapist(ctx, q, therapist)
	if err != nil {
		return first, err
	}
	if t == nil {
		return first, httpx.NotFound("Terapis tidak ditemukan")
	}
	prev := first.AddDate(0, 0, -1)
	rows, err := s.ports.People.Rosters(ctx, q, []string{t.EmployeeID}, domain.WIBDate(prev))
	if err != nil {
		return first, err
	}
	r := rows[t.EmployeeID]
	if r.Shift != nil && !r.OnLeave && !r.DayOff {
		iv := shiftInterval(domain.WIBDate(prev), r.Shift.StartTime, r.Shift.EndTime)
		if start.Before(iv.End) {
			return prev, nil
		}
	}
	return first, nil
}

func (s *Service) refuseRunningTransfer(ctx context.Context, q Q, therapist string) error {
	var running bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM spa.bookings WHERE therapist_id=$1 AND status='in_treatment')`, therapist).Scan(&running); err != nil {
		return err
	}
	if running {
		return httpx.Conflict("Terapis masih menjalankan treatment; selesaikan treatment sebelum perbantuan")
	}
	return nil
}
