package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// The payroll attendance period adapter materializes the HRIS period of a
// payroll month with the cut-off from hris.attendance_settings; the hris
// side reads payroll runs per year.
func TestAttendancePeriodAdapters(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	if _, err := tx.Exec(ctx, `UPDATE hris.attendance_settings SET cutoff_day = 20, closing_offset_days = 3`); err != nil {
		t.Fatal(err)
	}
	p, err := payrollPorts().AttendancePeriods.ForMonth(ctx, tx, 2099, 1)
	if err != nil || p == nil {
		t.Fatalf("ForMonth = %v, %v", p, err)
	}
	if p.Start != "2098-12-21" || p.End != "2099-01-20" || p.ClosingDate != "2099-01-23" || p.Closed ||
		p.Label != "21 Des 2098 – 20 Jan 2099" || p.ID == "" {
		t.Fatalf("period = %+v", p)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO hris.payroll_runs (run_name, period_month, period_year, status)
		VALUES ('Payroll Januari 2099', 1, 2099, 'completed')`); err != nil {
		t.Fatal(err)
	}
	runs, err := hrisPayrollSQL{}.PeriodRuns(ctx, tx, 2099)
	if err != nil || len(runs) != 1 || runs[0].Month != 1 || runs[0].Status != "completed" || runs[0].Name != "Payroll Januari 2099" {
		t.Fatalf("PeriodRuns = %+v, %v", runs, err)
	}
}
