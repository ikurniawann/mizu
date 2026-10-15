package payroll

import (
	"encoding/json"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// branch inserts a holding, company and store, returning the store id.
func (e *env) branch(name string) string {
	e.t.Helper()
	sfx := testutil.RandomHex(4)
	var holding, company, id string
	e.scalar(&holding, `INSERT INTO configuration.holdings (name, code) VALUES ($1, $2) RETURNING id::text`, "H "+sfx, "H-"+sfx)
	e.scalar(&company, `INSERT INTO configuration.companies (holding_id, name, code) VALUES ($1, $2, $3) RETURNING id::text`,
		holding, "Co "+sfx, "CO-"+sfx)
	e.scalar(&id, `INSERT INTO configuration.branches (company_id, name, code) VALUES ($1, $2, $3) RETURNING id::text`,
		company, name, "BR-"+sfx)
	return id
}

func hours(v float64) *float64 { return &v }

// allocationColumns checks every money column of every slip of the run adds
// up exactly over its store shares.
func (e *env) allocationsExact(runID string) {
	e.t.Helper()
	var checks []string
	for _, c := range domain.AllocationColumns {
		checks = append(checks, "d."+c+" <> COALESCE((SELECT sum(a."+allocationTableColumn(c)+
			") FROM hris.payroll_detail_allocations a WHERE a.payroll_detail_id = d.id), -1)")
	}
	var bad int
	e.scalar(&bad, `SELECT count(*)::int FROM hris.payroll_details d WHERE d.payroll_run_id = $1 AND (`+
		strings.Join(checks, " OR ")+`)`, runID)
	if bad != 0 {
		e.t.Fatalf("%d slips whose store shares do not add up", bad)
	}
}

func TestMultiStoreAllocation(t *testing.T) {
	e := setup(t)
	pvj, kopo := e.branch("Paddy PVJ Test"), e.branch("Paddy Kopo Test")
	multi := e.employee("Crew Dua Toko", "", true)
	single := e.employee("Crew Satu Toko", "", true)
	lost := e.employee("Crew Tanpa Toko", "", true)
	for _, id := range []string{multi, single, lost} {
		e.exec(`INSERT INTO hris.employee_salary (employee_id, company_id, base_salary, fixed_allowance, meal_allowance, ptkp_status,
			effective_date) VALUES ($1, $2, 4800000, 250000, 333333, 'TK/0', '2026-01-01')`, id, e.co)
		e.emps.companies[id] = "6f1d5c2e-3333-4a1b-9c1d-00000000000c"
	}
	e.work.placements = map[string][]domain.Placement{
		multi:  {{BranchID: pvj, IsPrimary: true, Start: "2026-01-01"}, {BranchID: kopo, Start: "2099-07-01"}},
		single: {{BranchID: kopo, IsPrimary: true, Start: "2026-01-01"}},
	}
	// 3 days PVJ (24h, one day without store → primary PVJ), 2 days Kopo (16h).
	e.work.records[multi] = domain.WorkforceRecords{Attendance: []domain.AttendanceRow{
		{Date: "2099-07-01", Status: "present", HasClockOut: true, BranchID: &pvj, WorkHours: hours(8)},
		{Date: "2099-07-02", Status: "present", HasClockOut: true, BranchID: &pvj, WorkHours: hours(8)},
		{Date: "2099-07-03", Status: "present", HasClockOut: true, WorkHours: hours(8)},
		{Date: "2099-07-04", Status: "present", HasClockOut: true, BranchID: &kopo, WorkHours: hours(8)},
		{Date: "2099-07-07", Status: "late", HasClockOut: true, BranchID: &kopo, WorkHours: hours(8)},
	}}

	run := e.call(&e.hr, "POST", "/api/hris/payroll", map[string]any{"period_month": 7, "period_year": 2099, "company_id": e.co}, 200)["data"].(map[string]any)
	runID := run["id"].(string)
	calc := e.call(&e.hr, "POST", "/api/hris/payroll/"+runID+"/calculate", nil, 200)
	warnings := calc["summary"].(map[string]any)["allocation_warnings"].([]any)
	if len(warnings) != 1 || warnings[0].(map[string]any)["employee_id"] != lost {
		t.Fatalf("warnings %v", calc)
	}
	e.allocationsExact(runID)

	var ratio, basis string
	e.scalar(&ratio, `SELECT string_agg(a.ratio::text, ',' ORDER BY a.sort_order) FROM hris.payroll_detail_allocations a
		JOIN hris.payroll_details d ON d.id = a.payroll_detail_id WHERE d.employee_id = $1`, multi)
	e.scalar(&basis, `SELECT string_agg(DISTINCT a.basis, ',') FROM hris.payroll_detail_allocations a WHERE a.employee_id = $1`, single)
	if ratio != "0.600000,0.400000" || basis != "primary" {
		t.Fatalf("ratio %s basis %s", ratio, basis)
	}

	// Recalculating replaces the shares (no duplicates).
	e.call(&e.hr, "POST", "/api/hris/payroll/"+runID+"/calculate", nil, 200)
	var shares int
	e.scalar(&shares, `SELECT count(*)::int FROM hris.payroll_detail_allocations WHERE payroll_run_id = $1`, runID)
	if shares != 4 {
		t.Fatalf("shares after recalculation = %d", shares)
	}
	e.allocationsExact(runID)

	// Run page: per-store totals and the slips outside any store.
	got := e.call(&e.hr, "GET", "/api/hris/payroll/"+runID, nil, 200)["data"].(map[string]any)
	sa := got["store_allocation"].(map[string]any)
	if len(sa["stores"].([]any)) != 3 || len(sa["unassigned"].([]any)) != 1 || sa["allocated_slips"] != 3.0 {
		t.Fatalf("store_allocation %v", sa)
	}
	for _, d := range got["payroll_details"].([]any) {
		row := d.(map[string]any)
		if row["employee_id"] == multi && len(row["allocations"].([]any)) != 2 {
			t.Fatalf("detail allocations %v", row)
		}
	}

	// Report: totals match the run, the stores and the drill-down rows.
	rep := e.call(&e.hr, "GET", "/api/hris/payroll/"+runID+"/store-costs", nil, 200)["data"].(map[string]any)
	var totalGross float64
	e.scalar(&totalGross, `SELECT total_gross::float8 FROM hris.payroll_runs WHERE id = $1`, runID)
	totals := rep["totals"].(map[string]any)
	if totals["gross_amount"] != totalGross || totals["employee_count"] != 3.0 || len(rep["employees"].([]any)) != 4 {
		t.Fatalf("report totals %v (gross %v)", totals, totalGross)
	}
	stores := rep["stores"].([]any)
	if len(stores) != 3 || stores[2].(map[string]any)["branch_id"] != nil || stores[2].(map[string]any)["branch_name"] != "Tanpa toko" {
		t.Fatalf("report stores %v", stores)
	}
	sum := 0.0
	for _, s := range stores {
		st := s.(map[string]any)
		sum += st["labor_cost"].(float64)
		if st["labor_cost"].(float64) != st["gross_amount"].(float64)+st["employer_contribution_amount"].(float64) {
			t.Fatalf("labor cost %v", st)
		}
	}
	if sum != totals["labor_cost"].(float64) {
		t.Fatalf("labor cost sum %v total %v", sum, totals["labor_cost"])
	}
	if rec := e.raw(&e.staff, "GET", "/api/hris/payroll/"+runID+"/store-costs", nil); rec.Code != 403 {
		t.Fatalf("report guard = %d", rec.Code)
	}
	csv := e.raw(&e.hr, "GET", "/api/hris/payroll/"+runID+"/store-costs/export", nil)
	if csv.Code != 200 || !strings.Contains(csv.Body.String(), "Paddy PVJ Test") ||
		!strings.Contains(csv.Header().Get("Content-Disposition"), "biaya-gaji-per-toko-2099-07.csv") {
		t.Fatalf("csv %d %s", csv.Code, csv.Header())
	}
	xl := e.raw(&e.hr, "GET", "/api/hris/payroll/"+runID+"/store-costs/export?format=xlsx", nil)
	if xl.Code != 200 || !strings.HasPrefix(xl.Body.String(), "PK") {
		t.Fatalf("xlsx %d", xl.Code)
	}

	// The slip carries its store split; the PDF renders with it.
	slips := e.call(&e.hr, "GET", "/api/hris/payslips?employee_id="+multi+"&payroll_run_id="+runID, nil, 200)["data"].([]any)
	slip := slips[0].(map[string]any)
	if alloc := slip["allocations"].([]any); len(alloc) != 2 || alloc[0].(map[string]any)["branch_name"] != "Paddy PVJ Test" ||
		alloc[0].(map[string]any)["days"] != 3.0 || alloc[1].(map[string]any)["hours"] != 16.0 {
		t.Fatalf("slip allocations %v", slip["allocations"])
	}
	if pdf := e.raw(&e.hr, "GET", "/api/hris/payslips/"+slip["id"].(string)+"/pdf", nil); pdf.Code != 200 ||
		!strings.HasPrefix(pdf.Body.String(), "%PDF") {
		t.Fatalf("pdf %d %s", pdf.Code, pdf.Body.String()[:min(80, pdf.Body.Len())])
	}

	// Paid: the event carries the store split of the expense amounts.
	e.call(&e.hr, "PUT", "/api/hris/payroll/"+runID, map[string]any{"status": "processing"}, 200)
	e.call(&e.hr, "PUT", "/api/hris/payroll/"+runID, map[string]any{"status": "completed"}, 200)
	e.call(&e.hr, "PUT", "/api/hris/payroll/"+runID, map[string]any{"status": "paid"}, 200)
	var payload string
	e.scalar(&payload, `SELECT payload::text FROM platform.outbox_events WHERE topic = 'payroll.run.paid' AND key = $1`, runID)
	var event struct {
		Companies []struct {
			TotalGross          float64 `json:"total_gross"`
			TotalBpjsTkEmployer float64 `json:"total_bpjs_tk_employer"`
			Branches            []struct {
				BranchID            *string `json:"branch_id"`
				TotalGross          float64 `json:"total_gross"`
				TotalBpjsTkEmployer float64 `json:"total_bpjs_tk_employer"`
			} `json:"branches"`
		} `json:"companies"`
	}
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		t.Fatal(err)
	}
	if len(event.Companies) != 1 || len(event.Companies[0].Branches) != 3 {
		t.Fatalf("event branches %s", payload)
	}
	c := event.Companies[0]
	var grossCents, tkCents int64
	for _, b := range c.Branches {
		grossCents += int64(b.TotalGross*100 + 0.5)
		tkCents += int64(b.TotalBpjsTkEmployer*100 + 0.5)
	}
	if grossCents != int64(c.TotalGross*100+0.5) || tkCents != int64(c.TotalBpjsTkEmployer*100+0.5) ||
		c.Branches[len(c.Branches)-1].BranchID != nil {
		t.Fatalf("branch split %+v", c)
	}
}
