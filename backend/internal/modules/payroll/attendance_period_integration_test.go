package payroll

import (
	"context"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/database"
)

// fakePeriods is the HRIS attendance period port: a cut-off period whose
// status the test flips.
type fakePeriods struct{ closed bool }

func (f *fakePeriods) ForMonth(_ context.Context, _ database.Querier, year, month int) (*AttendancePeriod, error) {
	return &AttendancePeriod{ID: "p-1", Start: "2099-05-21", End: "2099-06-20", ClosingDate: "2099-06-23",
		Label: "21 Mei – 20 Jun 2099", Closed: f.closed}, nil
}

// TestRunAttendancePeriod: the run reads attendance over the cut-off
// period, warns while it is open and cannot be processed until it closes.
func TestRunAttendancePeriod(t *testing.T) {
	periods := &fakePeriods{}
	e := setup(t, periods)
	worker := e.employee("Budi Periode", "", true)
	e.exec(`INSERT INTO hris.employee_salary (employee_id, company_id, base_salary, ptkp_status, effective_date)
		VALUES ($1, $2, 5000000, 'TK/0', '2026-01-01')`, worker, e.co)
	run := e.call(&e.hr, "POST", "/api/hris/payroll", map[string]any{"period_month": 6, "period_year": 2099, "company_id": e.co}, 200)["data"].(map[string]any)
	runID := run["id"].(string)

	calc := e.call(&e.hr, "POST", "/api/hris/payroll/"+runID+"/calculate", nil, 200)
	if e.work.lastRange != [2]string{"2099-05-21", "2099-06-20"} {
		t.Fatalf("attendance range = %v", e.work.lastRange)
	}
	period := calc["attendance_period"].(map[string]any)
	if period["status"] != "open" || period["label"] != "21 Mei – 20 Jun 2099" ||
		!strings.Contains(calc["warning"].(string), "belum di-closing") {
		t.Fatalf("calc period = %v", calc)
	}
	got := e.call(&e.hr, "GET", "/api/hris/payroll/"+runID, nil, 200)["data"].(map[string]any)
	if got["attendance_period"].(map[string]any)["start_date"] != "2099-05-21" {
		t.Fatalf("run period = %v", got["attendance_period"])
	}

	blocked := e.call(&e.hr, "PUT", "/api/hris/payroll/"+runID, map[string]any{"status": "processing"}, 409)
	if !strings.Contains(blocked["error"].(string), "Payroll belum bisa diproses: periode absensi 21 Mei – 20 Jun 2099 belum di-closing") {
		t.Fatalf("blocked = %v", blocked)
	}
	periods.closed = true
	e.call(&e.hr, "PUT", "/api/hris/payroll/"+runID, map[string]any{"status": "processing"}, 200)
	periods.closed = false // e.g. never closed: approving is blocked too
	blocked = e.call(&e.hr, "PUT", "/api/hris/payroll/"+runID, map[string]any{"status": "completed"}, 409)
	if !strings.Contains(blocked["error"].(string), "Payroll belum bisa disetujui") {
		t.Fatalf("approve blocked = %v", blocked)
	}
	list := e.call(&e.hr, "GET", "/api/hris/payroll?year=2099", nil, 200)["data"].([]any)
	if list[0].(map[string]any)["attendance_period"].(map[string]any)["status"] != "open" {
		t.Fatalf("list period = %v", list[0])
	}
}
