package payroll

import "testing"

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
