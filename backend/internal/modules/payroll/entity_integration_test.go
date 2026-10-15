package payroll

import (
	"testing"

	"nuhabit/backend/internal/modules/payroll/domain"
)

func TestPayrollEntities(t *testing.T) {
	e := setup(t)
	e.entity("Pusat Uji")
	if rec := e.raw(&e.staff, "GET", "/api/hris/payroll/entities", nil); rec.Code != 403 {
		t.Fatalf("non-compensation = %d", rec.Code)
	}
	list := e.call(&e.hr, "GET", "/api/hris/payroll/entities", nil, 200)["data"].([]any)
	if len(list) != 2 || list[0].(map[string]any)["name"] != "Entitas Uji" ||
		list[1].(map[string]any)["holding_name"] != "Pusat Uji Group" {
		t.Fatalf("entities %v", list)
	}
}

func TestRunPerEntityCreate(t *testing.T) {
	e := setup(t)
	e.employee("HR Payroll", e.hr.UserID, true)
	pusat, _ := e.entity("Pusat Uji")

	wantErr(t, e.call(&e.hr, "POST", "/api/hris/payroll", map[string]any{"period_month": 6, "period_year": 2099}, 400),
		"Entitas wajib dipilih")
	wantErr(t, e.call(&e.hr, "POST", "/api/hris/payroll",
		map[string]any{"period_month": 6, "period_year": 2099, "company_id": "00000000-0000-0000-0000-000000000000"}, 400),
		"Entitas tidak ditemukan atau tidak aktif")

	runA := e.newRun(6, 2099, e.co)
	e.newRun(6, 2099, pusat) // another entity, same period: allowed
	wantErr(t, e.call(&e.hr, "POST", "/api/hris/payroll",
		map[string]any{"period_month": 6, "period_year": 2099, "company_id": e.co}, 400), "Payroll untuk periode ini sudah ada")

	got := e.call(&e.hr, "GET", "/api/hris/payroll/"+runA, nil, 200)["data"].(map[string]any)
	if got["run_name"] != "Payroll Juni 2099" || got["company"].(map[string]any)["name"] != "Entitas Uji" {
		t.Fatalf("run %v", got)
	}
	rows := e.call(&e.hr, "GET", "/api/hris/payroll?year=2099", nil, 200)["data"].([]any)
	if len(rows) != 2 || rows[0].(map[string]any)["company"] == nil {
		t.Fatalf("list %v", rows)
	}

	// A legacy run without entity blocks entity runs of its period and
	// cannot be recalculated.
	var legacy string
	e.scalar(&legacy, `INSERT INTO hris.payroll_runs (run_name, period_month, period_year, status)
		VALUES ('Payroll Juli 2099', 7, 2099, 'draft') RETURNING id::text`)
	wantErr(t, e.call(&e.hr, "POST", "/api/hris/payroll",
		map[string]any{"period_month": 7, "period_year": 2099, "company_id": e.co}, 400),
		"Periode ini masih punya payroll lama tanpa entitas (Payroll Juli 2099) — hapus run itu dulu untuk memproses per entitas")
	wantErr(t, e.call(&e.hr, "POST", "/api/hris/payroll/"+legacy+"/calculate", nil, 400),
		"Run lama tanpa entitas tidak bisa dihitung ulang — hapus lalu buat payroll per entitas")
	if c := e.call(&e.hr, "GET", "/api/hris/payroll/"+legacy, nil, 200)["data"].(map[string]any)["company"]; c != nil {
		t.Fatalf("legacy company %v", c)
	}
}

// A legacy salary with no entity yet is superseded once HR assigns one, so
// totals are not double counted; it still counts for the loan limit until then.
func TestSalaryNullCompanySuperseded(t *testing.T) {
	e := setup(t)
	emp := e.employee("Tanpa Entitas", "", true)
	e.exec(`INSERT INTO hris.employee_salary (employee_id, base_salary, effective_date) VALUES ($1, 5000000, '2026-01-01')`, emp)
	// Only a NULL-company salary: the loan limit still sees it (30% of 5.000.000).
	wantErr(t, e.call(&e.hr, "POST", "/api/hris/loans", map[string]any{"employee_id": emp, "loan_type": "loan",
		"principal_amount": 6000000, "tenor_months": 3}, 400),
		"Cicilan Rp 2.000.000/bulan melebihi batas 30% dari gaji pokok (maks Rp 1.500.000)")

	e.call(&e.hr, "POST", "/api/hris/employee-salary",
		map[string]any{"employee_id": emp, "base_salary": 6_000_000, "effective_date": "2026-03-01", "company_id": e.co}, 200)
	var active int
	var company string
	e.scalar(&active, `SELECT count(*)::int FROM hris.employee_salary WHERE employee_id = $1 AND is_active`, emp)
	e.scalar(&company, `SELECT COALESCE(company_id::text, '') FROM hris.employee_salary WHERE employee_id = $1 AND is_active`, emp)
	if active != 1 || company != e.co {
		t.Fatalf("active rows = %d (company %q), want only the %s one", active, company, e.co)
	}
}

func TestSalaryPerEntity(t *testing.T) {
	e := setup(t)
	pusat, _ := e.entity("Pusat Uji")
	emp := e.employee("Dua Entitas", "", true)
	post := func(company string, base int, status int) map[string]any {
		body := map[string]any{"employee_id": emp, "base_salary": base, "effective_date": "2026-01-01"}
		if company != "" {
			body["company_id"] = company
		}
		return e.call(&e.hr, "POST", "/api/hris/employee-salary", body, status)
	}
	wantErr(t, post("", 1_000_000, 400), "Entitas wajib dipilih")
	post(e.co, 1_000_000, 200)
	post(pusat, 2_000_000, 200)
	// A new version of one entity deactivates only that entity's version.
	e.call(&e.hr, "POST", "/api/hris/employee-salary",
		map[string]any{"employee_id": emp, "base_salary": 1_500_000, "effective_date": "2026-03-01", "company_id": e.co}, 200)

	var active int
	e.scalar(&active, `SELECT count(*)::int FROM hris.employee_salary WHERE employee_id = $1 AND is_active`, emp)
	if active != 2 {
		t.Fatalf("active versions = %d, want 2 (one per entity)", active)
	}
	rows := e.call(&e.hr, "GET", "/api/hris/employee-salary?employee_id="+emp, nil, 200)["data"].([]any)
	names := map[string]bool{}
	for _, r := range rows {
		if c, ok := r.(map[string]any)["company"].(map[string]any); ok {
			names[c["name"].(string)] = true
		}
	}
	if !names["Entitas Uji"] || !names["Pusat Uji"] {
		t.Fatalf("salary rows company embed %v", rows)
	}
}

func TestMultiEntityCalculate(t *testing.T) {
	e := setup(t)
	e.employee("HR Payroll", e.hr.UserID, true)
	coA, storeA := e.co, e.store
	coB, storeB := e.entity("Entitas B")
	shared := e.employee("Dua Entitas", "", true)
	refA := e.employee("Hanya A", "", true)
	refB := e.employee("Hanya B", "", true)
	e.salary(shared, coA, 1_000_000)
	e.salary(shared, coB, 9_000_000)
	e.salary(refA, coA, 1_000_000)
	e.salary(refB, coB, 9_000_000)
	e.exec(`INSERT INTO hris.loans (employee_id, loan_type, principal_amount, tenor_months, monthly_installment,
		remaining_balance, first_installment_month, first_installment_year, status, approved_at)
		VALUES ($1, 'kasbon', 300000, 3, 100000, 300000, 6, 2099, 'approved', now())`, shared)
	// Placed at A's store: A is the primary entity (B pays more).
	e.work.placements = map[string][]domain.Placement{
		shared: {{BranchID: storeA, IsPrimary: true, Start: "2026-01-01"}},
		refA:   {{BranchID: storeA, IsPrimary: true, Start: "2026-01-01"}},
		refB:   {{BranchID: storeB, IsPrimary: true, Start: "2026-01-01"}},
	}

	runA, runB := e.newRun(6, 2099, coA), e.newRun(6, 2099, coB)
	sumA := e.call(&e.hr, "POST", "/api/hris/payroll/"+runA+"/calculate", nil, 200)["summary"].(map[string]any)
	sumB := e.call(&e.hr, "POST", "/api/hris/payroll/"+runB+"/calculate", nil, 200)["summary"].(map[string]any)
	if sumA["total_employees"].(float64) != 2 || sumB["total_employees"].(float64) != 2 {
		t.Fatalf("A %v / B %v", sumA, sumB)
	}
	if sumA["other_entity_count"].(float64) != 1 { // Hanya B
		t.Fatalf("A other entity %v", sumA["other_entity_count"])
	}
	if sumB["other_entity_count"].(float64) != 1 { // Hanya A
		t.Fatalf("B other entity %v", sumB["other_entity_count"])
	}
	hrSkipped := false
	for _, sk := range sumA["skipped"].([]any) {
		m := sk.(map[string]any)
		if m["full_name"] == "HR Payroll" && m["reason"] == "Belum ada struktur gaji aktif" {
			hrSkipped = true
		}
	}
	if !hrSkipped {
		t.Fatalf("HR Payroll not skipped in A: %v", sumA["skipped"])
	}

	type slip struct{ gross, pph, bpjsKes, bpjsTk, loan string }
	read := func(runID, emp string) slip {
		var s slip
		if err := e.tx.QueryRow(e.ctx, `SELECT gross_salary::text, pph21_deduction::text, bpjs_kes_deduction::text,
			bpjs_tk_jht_deduction::text, loan_deduction::text FROM hris.payroll_details
			WHERE payroll_run_id = $1 AND employee_id = $2`, runID, emp).Scan(&s.gross, &s.pph, &s.bpjsKes, &s.bpjsTk, &s.loan); err != nil {
			t.Fatalf("slip %s/%s: %v", runID, emp, err)
		}
		return s
	}
	a, b := read(runA, shared), read(runB, shared)
	ra, rb := read(runA, refA), read(runB, refB)
	// K4: each slip's tax/BPJS equals that of an employee paid only by that entity.
	if a.gross != ra.gross || a.pph != ra.pph || a.bpjsKes != ra.bpjsKes || a.bpjsTk != ra.bpjsTk {
		t.Fatalf("A slip %+v vs reference %+v", a, ra)
	}
	if b.gross != rb.gross || b.pph != rb.pph || b.bpjsKes != rb.bpjsKes || b.bpjsTk != rb.bpjsTk {
		t.Fatalf("B slip %+v vs reference %+v", b, rb)
	}
	// K5 (interim policy): the installment is on the primary entity's slip only.
	if a.loan != "100000.00" || b.loan != "0.00" {
		t.Fatalf("loan A %s B %s", a.loan, b.loan)
	}
	// B's slip is never allocated to A's store.
	var leaked int
	e.scalar(&leaked, `SELECT count(*)::int FROM hris.payroll_detail_allocations
		WHERE payroll_run_id = $1 AND branch_id = $2`, runB, storeA)
	if leaked != 0 {
		t.Fatalf("%d allocations of run B at A's store", leaked)
	}
}

// A once-per-period item (loan installment, late deduction) already on a slip
// of another entity's run of the same period is never repeated, even when the
// primary entity changed between the two calculations.
func TestOnceItemsNotRepeatedAcrossRuns(t *testing.T) {
	e := setup(t)
	e.employee("HR Payroll", e.hr.UserID, true)
	coA, storeA := e.co, e.store
	coB, storeB := e.entity("Entitas B")
	shared := e.employee("Dua Entitas", "", true)
	e.salary(shared, coA, 1_000_000)
	e.salary(shared, coB, 9_000_000)
	e.exec(`INSERT INTO hris.loans (employee_id, loan_type, principal_amount, tenor_months, monthly_installment,
		remaining_balance, first_installment_month, first_installment_year, status, approved_at)
		VALUES ($1, 'kasbon', 300000, 3, 100000, 300000, 6, 2099, 'approved', now())`, shared)
	e.work.placements = map[string][]domain.Placement{
		shared: {{BranchID: storeA, IsPrimary: true, Start: "2026-01-01"}},
	}
	runA, runB := e.newRun(6, 2099, coA), e.newRun(6, 2099, coB)
	loan := func(runID string) string {
		var v string
		e.scalar(&v, `SELECT loan_deduction::text FROM hris.payroll_details WHERE payroll_run_id = $1 AND employee_id = $2`, runID, shared)
		return v
	}

	e.call(&e.hr, "POST", "/api/hris/payroll/"+runA+"/calculate", nil, 200)
	if got := loan(runA); got != "100000.00" {
		t.Fatalf("A loan %s", got)
	}
	// The employee moves to B's store: B is now the primary entity, but the
	// installment is already on A's slip.
	e.work.placements[shared] = []domain.Placement{{BranchID: storeB, IsPrimary: true, Start: "2026-01-01"}}
	e.call(&e.hr, "POST", "/api/hris/payroll/"+runB+"/calculate", nil, 200)
	if a, b := loan(runA), loan(runB); a != "100000.00" || b != "0.00" {
		t.Fatalf("loan A %s B %s", a, b)
	}
	// Recalculating A drops its own old details first; A is no longer the
	// primary entity, so the installment is on neither slip (never twice)...
	e.call(&e.hr, "POST", "/api/hris/payroll/"+runA+"/calculate", nil, 200)
	if a, b := loan(runA), loan(runB); a != "0.00" || b != "0.00" {
		t.Fatalf("after recalc A: loan A %s B %s", a, b)
	}
	// ...and recalculating the new primary entity picks it up again.
	e.call(&e.hr, "POST", "/api/hris/payroll/"+runB+"/calculate", nil, 200)
	if a, b := loan(runA), loan(runB); a != "0.00" || b != "100000.00" {
		t.Fatalf("after recalc B: loan A %s B %s", a, b)
	}
}
