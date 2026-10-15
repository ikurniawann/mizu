package payroll

import (
	"context"
	"fmt"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Attendance period of a payroll run (closing absensi): payroll reads the
// attendance-side records over the period's dates (the cut-off period from
// the HRIS attendance settings) instead of the calendar month. A draft may
// be calculated while the period is open (with a warning); leaving draft
// (Process) and approving need the period closed, so the slips are built
// from attendance that can no longer change.

// periodInfo is the attendance period block of the run responses.
type periodInfo struct {
	ID          string `json:"id,omitempty"`
	Start       string `json:"start_date"`
	End         string `json:"end_date"`
	ClosingDate string `json:"closing_date,omitempty"`
	Label       string `json:"label"`
	Status      string `json:"status"`
}

// attendancePeriod is the run month's period; without the port it is the
// calendar month, treated as closed.
func (s *service) attendancePeriod(ctx context.Context, month, year int) (*AttendancePeriod, error) {
	if s.ports.AttendancePeriods != nil {
		p, err := s.ports.AttendancePeriods.ForMonth(ctx, s.db, year, month)
		if err != nil || p != nil {
			return p, err
		}
	}
	start, end := domain.PeriodBounds(month, year)
	return &AttendancePeriod{Start: start, End: end, Label: domain.PeriodLabelID(&month, year), Closed: true}, nil
}

func (p *AttendancePeriod) info() *periodInfo {
	status := "open"
	if p.Closed {
		status = "closed"
	}
	return &periodInfo{ID: p.ID, Start: p.Start, End: p.End, ClosingDate: p.ClosingDate, Label: p.Label, Status: status}
}

// openPeriodWarning is the run page note while the period is open.
func openPeriodWarning(p *AttendancePeriod) string {
	return fmt.Sprintf("Periode absensi %s belum di-closing — data absensi masih bisa berubah. "+
		"Hitung ulang setelah closing.", p.Label)
}

// requireClosedPeriod blocks processing/approving a run of an open period.
func (s *service) requireClosedPeriod(ctx context.Context, run *runHead, to string) error {
	p, err := s.attendancePeriod(ctx, run.PeriodMonth, run.PeriodYear)
	if err != nil {
		return err
	}
	if p.Closed {
		return nil
	}
	verb := "diproses"
	if to == "completed" {
		verb = "disetujui"
	}
	return httpx.Conflict(fmt.Sprintf("Payroll belum bisa %s: periode absensi %s belum di-closing. "+
		"Lakukan closing di HRIS → Absensi → Periode Absensi (closing otomatis %s), lalu hitung ulang payroll.",
		verb, p.Label, longDateID(p.ClosingDate)))
}

// longDateID is "20 Oktober 2026" for "2026-10-20" (the input otherwise).
func longDateID(date string) string {
	var y, m, d int
	if _, err := fmt.Sscanf(date, "%d-%d-%d", &y, &m, &d); err != nil || m < 1 || m > 12 {
		return date
	}
	return fmt.Sprintf("%d %s %d", d, domain.MonthNamesID[m-1], y)
}
