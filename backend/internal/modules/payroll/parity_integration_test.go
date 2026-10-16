package payroll

import (
	"strings"
	"testing"
)

// EPIC-055: komponen manual & aturan perhitungan rule Odoo lewat API.
func TestManualInputsAndOdooRules(t *testing.T) {
	e := setup(t)
	e.employee("HR Payroll", e.hr.UserID, true)
	coB, _ := e.entity("Entitas B")
	emp := e.employee("Karyawan Bonus", "", true)
	other := e.employee("Digaji B", "", true)
	e.salary(other, coB, 3_000_000)
	// Struktur gaji lewat API dengan field baru: tunjangan jabatan & kesehatan, skema lembur.
	e.call(&e.hr, "POST", "/api/hris/employee-salary", map[string]any{
		"employee_id": emp, "company_id": e.co, "base_salary": 5_200_000, "effective_date": "2026-01-01",
		"position_allowance": 260_000, "health_allowance": 100_000, "health_min_service_days": 0,
		"working_days_divisor": 26, "overtime_scheme": "standard", "tapera_enrolled": false,
	}, 200)
	if rec := e.raw(&e.hr, "POST", "/api/hris/employee-salary", map[string]any{
		"employee_id": emp, "company_id": e.co, "base_salary": 1, "pay_basis": "weekly",
	}); rec.Code != 400 || !strings.Contains(rec.Body.String(), "pay_basis") {
		t.Fatalf("invalid pay_basis = %d %s", rec.Code, rec.Body.String())
	}

	run := e.newRun(6, 2099, e.co)
	path := "/api/hris/payroll/" + run + "/inputs"
	e.call(&e.hr, "PUT", path, map[string]any{"employee_id": emp, "code": "BONUS", "amount": 500_000, "note": "target"}, 200)
	e.call(&e.hr, "PUT", path, map[string]any{"employee_id": emp, "code": "PENALTY", "amount": 25_000}, 200)
	// Karyawan entitas lain tidak masuk run ini.
	wantErr(t, e.call(&e.hr, "PUT", path, map[string]any{"employee_id": other, "code": "BONUS", "amount": 1}, 400),
		"Karyawan tidak punya struktur gaji aktif di entitas run ini")
	if rec := e.raw(&e.staff, "GET", path, nil); rec.Code != 403 {
		t.Fatalf("non-compensation GET inputs = %d", rec.Code)
	}

	e.call(&e.hr, "POST", "/api/hris/payroll/"+run+"/calculate", nil, 200)
	var bonus, otherDed, position, health, gross float64
	var manual string
	e.scalar(&bonus, `SELECT bonus::float8 FROM hris.payroll_details WHERE payroll_run_id = $1 AND employee_id = $2`, run, emp)
	e.scalar(&otherDed, `SELECT other_deduction::float8 FROM hris.payroll_details WHERE payroll_run_id = $1 AND employee_id = $2`, run, emp)
	e.scalar(&position, `SELECT position_allowance::float8 FROM hris.payroll_details WHERE payroll_run_id = $1 AND employee_id = $2`, run, emp)
	e.scalar(&health, `SELECT health_allowance::float8 FROM hris.payroll_details WHERE payroll_run_id = $1 AND employee_id = $2`, run, emp)
	e.scalar(&gross, `SELECT gross_salary::float8 FROM hris.payroll_details WHERE payroll_run_id = $1 AND employee_id = $2`, run, emp)
	e.scalar(&manual, `SELECT manual_inputs::text FROM hris.payroll_details WHERE payroll_run_id = $1 AND employee_id = $2`, run, emp)
	if bonus != 500_000 || otherDed != 25_000 || position != 260_000 || health != 100_000 || gross != 5_200_000+260_000+100_000+500_000 {
		t.Fatalf("slip bonus %v ded %v pos %v health %v gross %v", bonus, otherDed, position, health, gross)
	}
	if !strings.Contains(manual, `"BONUS"`) || !strings.Contains(manual, `"PENALTY"`) {
		t.Fatalf("manual_inputs %s", manual)
	}

	// Import CSV: baris valid masuk, baris salah dilaporkan per baris.
	res := e.call(&e.hr, "POST", path+"/import", map[string]any{"csv": "nip,kode,nominal\nTIDAK-ADA,BONUS,1\n"}, 200)["data"].(map[string]any)
	if res["imported"].(float64) != 0 || len(res["errors"].([]any)) != 1 {
		t.Fatalf("import %v", res)
	}
	// Amount 0 menghapus komponen.
	e.call(&e.hr, "PUT", path, map[string]any{"employee_id": emp, "code": "BONUS", "amount": 0}, 200)
	var n int
	e.scalar(&n, `SELECT count(*)::int FROM hris.payroll_inputs WHERE payroll_run_id = $1`, run)
	if n != 1 {
		t.Fatalf("inputs after delete = %d", n)
	}
	// Run yang sudah tidak draft menolak perubahan komponen.
	e.exec(`UPDATE hris.payroll_runs SET status = 'completed' WHERE id = $1`, run)
	wantErr(t, e.call(&e.hr, "PUT", path, map[string]any{"employee_id": emp, "code": "BONUS", "amount": 1}, 400),
		"Komponen manual hanya bisa diubah saat payroll masih draft")
}
