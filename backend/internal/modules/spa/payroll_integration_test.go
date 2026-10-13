package spa_test

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Revisi R1: therapist payroll twice a month. The commission run (15th)
// pays commission completed on days 1–15; the regular run (30th) pays the
// fixed salary of salary+commission therapists plus the rest of the month's
// commission. Each commission item is paid once; one paid late rolls into
// the next run.
func TestTherapistPayrollTwiceAMonth(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}
	e := setup(t)
	admin := &e.admin
	me := e.therapist
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	branch := e.org.BranchID
	e.data(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true, "public_booking": true}, http.StatusOK)
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{"code": "PAY" + testutil.RandomHex(3), "name": "Massage",
		"variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, http.StatusCreated)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	e.data(admin, "POST", "/api/spa/commission-rules", map[string]any{"commission_type": "percent", "value": 10}, http.StatusCreated)

	ayuEmp := e.employee("Ayu Gaji", &me.UserID)
	beniEmp := e.employee("Beni Komisi", nil)
	ayu := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": ayuEmp, "home_branch_id": branch, "gender": "female"}, http.StatusCreated)
	beni := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": beniEmp, "home_branch_id": branch, "gender": "male"}, http.StatusCreated)
	for emp, base := range map[string]float64{ayuEmp: 3000000, beniEmp: 2500000} {
		if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.employee_salary (employee_id, base_salary, fixed_allowance, effective_date, is_active)
		  VALUES ($1, $2, 500000, '2026-01-01', true)`, emp, base); err != nil {
			t.Fatal(err)
		}
	}
	// Beni is paid by commission only: his HRIS salary is ignored.
	e.data(admin, "PUT", "/api/spa/therapists/"+beni["id"].(string)+"/pay-type", map[string]any{"pay_type": "commission_only"}, http.StatusOK)
	e.call(admin, "PUT", "/api/spa/therapists/"+beni["id"].(string)+"/pay-type", map[string]any{"pay_type": "harian"}, http.StatusBadRequest)

	// Paydays: configurable, salary day after commission day.
	e.call(admin, "PUT", "/api/spa/pay-settings", map[string]any{"commission_day": 20, "salary_day": 15}, http.StatusBadRequest)
	cfg := e.data(admin, "PUT", "/api/spa/pay-settings", map[string]any{"commission_day": 15, "salary_day": 30}, http.StatusOK)
	if cfg["commission_day"] != float64(15) || cfg["salary_day"] != float64(30) {
		t.Fatalf("pay settings = %v", cfg)
	}

	// A completed treatment (completed today, 8 Oct) with a paid booking earns 10% = Rp20.000.
	done := func(therapistID, at string, paid bool) string {
		b := e.data(admin, "POST", "/api/spa/bookings", map[string]any{
			"branch_id": branch, "booking_type": "walk_in", "customer_name": "Tamu Gaji", "therapist_id": therapistID,
			"scheduled_at": at, "items": []any{map[string]any{"variant_id": variant}},
		}, http.StatusCreated)
		id := b["id"].(string)
		e.data(admin, "POST", "/api/spa/bookings/"+id+"/status", map[string]any{"action": "start"}, http.StatusOK)
		e.data(admin, "POST", "/api/spa/bookings/"+id+"/status", map[string]any{"action": "complete"}, http.StatusOK)
		if paid {
			if _, err := e.tx.Exec(e.ctx, `UPDATE spa.bookings SET payment_status = 'paid' WHERE id = $1`, id); err != nil {
				t.Fatal(err)
			}
		}
		return id
	}
	done(ayu["id"].(string), "2026-10-08T03:00:00Z", true)
	late := done(ayu["id"].(string), "2026-10-08T05:00:00Z", false) // paid only after the commission run
	beniBooking := done(beni["id"].(string), "2026-10-08T03:00:00Z", true)
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.booking_items SET completed_at = '2026-10-20T05:00:00Z' WHERE booking_id = $1`, beniBooking); err != nil {
		t.Fatal(err)
	}

	lineOf := func(run map[string]any, therapistID string) map[string]any {
		for _, x := range run["lines"].([]any) {
			if m := x.(map[string]any); m["therapist_id"] == therapistID {
				return m
			}
		}
		return nil
	}
	// Commission run (1–15 Oct, paid on the 15th): only Ayu's paid treatment.
	comm := e.data(admin, "POST", "/api/spa/pay-runs", map[string]any{"month": "2026-10", "kind": "commission"}, http.StatusCreated)
	if comm["period_start"] != "2026-10-01" || comm["period_end"] != "2026-10-15" || comm["pay_date"] != "2026-10-15" {
		t.Fatalf("commission run period = %v..%v pay %v", comm["period_start"], comm["period_end"], comm["pay_date"])
	}
	a := lineOf(comm, ayu["id"].(string))
	if a == nil || a["commission_idr"] != float64(20000) || a["base_salary_idr"] != float64(0) || a["total_idr"] != float64(20000) || lineOf(comm, beni["id"].(string)) != nil {
		t.Fatalf("commission run lines = %v", comm["lines"])
	}
	e.call(admin, "POST", "/api/spa/pay-runs", map[string]any{"month": "2026-10", "kind": "commission"}, http.StatusConflict)

	// The late booking is paid now: it rolls into the regular run.
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.bookings SET payment_status = 'paid' WHERE id = $1`, late); err != nil {
		t.Fatal(err)
	}
	reg := e.data(admin, "POST", "/api/spa/pay-runs", map[string]any{"month": "2026-10", "kind": "regular"}, http.StatusCreated)
	if reg["period_start"] != "2026-10-16" || reg["period_end"] != "2026-10-31" || reg["pay_date"] != "2026-10-30" {
		t.Fatalf("regular run period = %v..%v pay %v", reg["period_start"], reg["period_end"], reg["pay_date"])
	}
	a = lineOf(reg, ayu["id"].(string))
	b := lineOf(reg, beni["id"].(string))
	if a["base_salary_idr"] != float64(3000000) || a["allowance_idr"] != float64(500000) || a["commission_idr"] != float64(20000) || a["total_idr"] != float64(3520000) {
		t.Fatalf("Ayu regular line = %v", a)
	}
	if b["pay_type"] != "commission_only" || b["base_salary_idr"] != float64(0) || b["commission_idr"] != float64(20000) || b["total_idr"] != float64(20000) {
		t.Fatalf("Beni regular line = %v", b)
	}
	// Manual bonus/deduction on a draft line, kept on recalculation.
	upd := e.data(admin, "PATCH", "/api/spa/pay-lines/"+a["id"].(string), map[string]any{"bonus_idr": 100000, "deduction_idr": 50000, "note": "Bonus target"}, http.StatusOK)
	if l := lineOf(upd, ayu["id"].(string)); l["total_idr"] != float64(3570000) || upd["total_idr"] != float64(3590000) {
		t.Fatalf("after adjustment: line %v, run total %v", l["total_idr"], upd["total_idr"])
	}
	rec := e.data(admin, "POST", "/api/spa/pay-runs/"+reg["id"].(string)+"/recalculate", nil, http.StatusOK)
	a = lineOf(rec, ayu["id"].(string)) // recalculation rebuilds the lines
	if a["bonus_idr"] != float64(100000) || a["commission_idr"] != float64(20000) || a["note"] != "Bonus target" {
		t.Fatalf("recalculated line = %v", a)
	}
	// Approve → no more edits; pay; a paid run cannot be deleted.
	runPath := "/api/spa/pay-runs/" + reg["id"].(string)
	e.call(admin, "POST", runPath+"/status", map[string]any{"action": "pay"}, http.StatusConflict)
	e.data(admin, "POST", runPath+"/status", map[string]any{"action": "approve"}, http.StatusOK)
	e.call(admin, "PATCH", "/api/spa/pay-lines/"+a["id"].(string), map[string]any{"bonus_idr": 0}, http.StatusConflict)
	paid := e.data(admin, "POST", runPath+"/status", map[string]any{"action": "pay"}, http.StatusOK)
	if paid["status"] != "paid" || paid["paid_at"] == nil {
		t.Fatalf("paid run = %v", paid)
	}
	e.call(admin, "DELETE", runPath, nil, http.StatusConflict)

	// The therapist sees only approved/paid runs.
	mine := e.call(&me, "GET", "/api/spa/me/pay", nil, http.StatusOK)["data"].([]any)
	if len(mine) != 1 || mine[0].(map[string]any)["run_kind"] != "regular" || mine[0].(map[string]any)["total_idr"] != float64(3570000) {
		t.Fatalf("my pay = %v", mine)
	}
	// Deleting the draft commission run frees its item for a new run.
	e.data(admin, "DELETE", "/api/spa/pay-runs/"+comm["id"].(string), nil, http.StatusOK)
	again := e.data(admin, "POST", "/api/spa/pay-runs", map[string]any{"month": "2026-10", "kind": "commission"}, http.StatusCreated)
	if l := lineOf(again, ayu["id"].(string)); l == nil || l["commission_idr"] != float64(20000) {
		t.Fatalf("re-created commission run = %v", again["lines"])
	}
	list := e.list(admin, "/api/spa/pay-runs?year=2026")
	if len(list) != 2 {
		t.Fatalf("runs = %v", list)
	}
}
