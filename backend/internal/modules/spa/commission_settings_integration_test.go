package spa_test

import (
	"net/http"
	"nuhabit/backend/internal/platform/testutil"
	"os"
	"testing"
)

func TestLevelCommissionSettingsAndCompletion(t *testing.T) {
	e := setup(t)
	admin := &e.admin
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	e.data(admin, "PUT", "/api/spa/outlets/"+e.org.BranchID, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true}, 200)
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{"code": "LC" + testutil.RandomHex(4), "name": "Level Commission", "variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}, map[string]any{"name": "90 menit", "duration_min": 90, "price_idr": 300000}}}, 201)
	variants := tr["variants"].([]any)
	v := variants[0].(map[string]any)["id"].(string)
	v2 := variants[1].(map[string]any)["id"].(string)
	if _, err := e.tx.Exec(e.ctx, `DELETE FROM spa.commission_rules WHERE variant_id IN($1,$2)`, v, v2); err != nil {
		t.Fatal(err)
	}
	save := func(values []any, status int) {
		e.call(admin, "PUT", "/api/spa/commission-settings", map[string]any{"rows": []any{map[string]any{"variant_id": v, "values": values}}}, status)
	}
	save([]any{10000, nil, 30000}, 400)
	save([]any{10000, 20000, -1}, 400)
	save([]any{10000, 20000, 1.5}, 400)
	save([]any{10000, 20000, 1e12}, 400)
	save([]any{10000, 20000, 30000}, 200)
	e.call(admin, "PUT", "/api/spa/commission-settings", map[string]any{"rows": []any{map[string]any{"variant_id": v, "values": []any{9, 9, 9}}, map[string]any{"variant_id": "00000000-0000-0000-0000-000000000001", "values": []any{1, 2, 3}}}}, 400)
	var amount float64
	if err := e.tx.QueryRow(e.ctx, `SELECT value::float8 FROM spa.commission_rules WHERE variant_id=$1 AND therapist_level=1`, v).Scan(&amount); err != nil || amount != 20000 {
		t.Fatalf("atomic save: %v %v", amount, err)
	}
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"spa.commission-settings": {"read"}}})
	e.call(&reader, "GET", "/api/spa/commission-settings", nil, 200)
	e.call(&reader, "PUT", "/api/spa/commission-settings", map[string]any{"rows": []any{map[string]any{"variant_id": v, "values": []any{1, 2, 3}}}}, 403)
	e.call(&e.therapist, "GET", "/api/spa/commission-settings", nil, 403)
	e.call(admin, "POST", "/api/spa/commission-rules", map[string]any{"variant_id": v, "value": 1, "commission_type": "fixed"}, 400)
	e.call(admin, "PUT", "/api/spa/treatments/"+tr["id"].(string)+"/prices", map[string]any{"prices": []any{map[string]any{"variant_id": v, "branch_id": e.org.BranchID, "price_idr": 999000, "commission_value": 1}}}, 400)
	e.call(admin, "PUT", "/api/spa/treatments/"+tr["id"].(string)+"/prices", map[string]any{"prices": []any{map[string]any{"variant_id": v, "branch_id": e.org.BranchID, "price_idr": 999000}}}, 200)
	emp := e.scheduledEmployee("Komisi Level", &e.therapist.UserID)
	therapist := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": e.org.BranchID}, 201)["id"].(string)
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.therapists SET level=1 WHERE id=$1`, therapist); err != nil {
		t.Fatal(err)
	}
	rates := e.data(&e.therapist, "GET", "/api/spa/me/commission-rates?therapist_id=ignored", nil, 200)
	if rates["level"] != float64(1) {
		t.Fatalf("rates %v", rates)
	}
	book := func(variant, at string) (string, string) {
		b := e.data(admin, "POST", "/api/spa/bookings", map[string]any{"branch_id": e.org.BranchID, "booking_type": "reservation", "customer_name": "Customer", "scheduled_at": at, "items": []any{map[string]any{"variant_id": variant, "therapist_id": therapist}}}, 201)
		return b["id"].(string), items(b)[0]["id"].(string)
	}
	bid, item := book(v, "2026-10-08T03:00:00Z")
	e.call(&e.therapist, "PATCH", "/api/spa/me/assignments/"+item, map[string]any{"action": "start"}, 200)
	done := e.data(&e.therapist, "PATCH", "/api/spa/me/assignments/"+item, map[string]any{"action": "complete"}, 200)
	if done["commission_idr"] != float64(20000) || done["commission_level"] != float64(1) {
		t.Fatalf("commission %v", done)
	}
	// Same level/variant in a different outlet with a different selling price.
	other := testutil.CreateOrg(t, e.tx)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.outlets(branch_id,warehouse_id,open_time,close_time)
        SELECT $1,id,'09:00','22:00' FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, other.BranchID); err != nil {
		t.Fatal(err)
	}
	emp2 := e.scheduledEmployee("Other outlet", nil)
	th2 := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp2, "home_branch_id": other.BranchID}, 201)["id"].(string)
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.therapists SET level=1 WHERE id=$1`, th2); err != nil {
		t.Fatal(err)
	}
	b2 := e.data(admin, "POST", "/api/spa/bookings", map[string]any{"branch_id": other.BranchID, "booking_type": "reservation", "customer_name": "Other customer", "scheduled_at": "2026-10-08T03:00:00Z", "items": []any{map[string]any{"variant_id": v, "therapist_id": th2}}}, 201)
	otherPath := "/api/spa/bookings/" + b2["id"].(string) + "/items/" + items(b2)[0]["id"].(string)
	e.call(admin, "PATCH", otherPath, map[string]any{"action": "start"}, 200)
	otherDone := e.data(admin, "PATCH", otherPath, map[string]any{"action": "complete"}, 200)
	if items(otherDone)[0]["commission_idr"] != float64(20000) || items(otherDone)[0]["price_idr"] == done["price_idr"] {
		t.Fatalf("cross outlet rate: %v", otherDone)
	}
	save([]any{11000, 22000, 33000}, 200)
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.therapists SET level=2 WHERE id=$1`, therapist); err != nil {
		t.Fatal(err)
	}
	b := e.data(admin, "GET", "/api/spa/bookings/"+bid, nil, 200)
	if items(b)[0]["commission_idr"] != float64(20000) {
		t.Fatal("history changed")
	}
	e.call(&e.therapist, "PATCH", "/api/spa/me/assignments/"+item, map[string]any{"action": "complete"}, http.StatusConflict)
	_, missing := book(v2, "2026-10-08T05:00:00Z")
	e.call(&e.therapist, "PATCH", "/api/spa/me/assignments/"+missing, map[string]any{"action": "start"}, 200)
	e.call(&e.therapist, "PATCH", "/api/spa/me/assignments/"+missing, map[string]any{"action": "complete"}, 409)
	rows := e.list(&e.therapist, "/api/spa/me/schedule?from=2026-10-08&days=1")
	for _, raw := range rows {
		r := raw.(map[string]any)
		if r["id"] == missing && r["commission_idr"] != nil {
			t.Fatalf("missing rate is not null: %v", r)
		}
	}
	e.call(admin, "PUT", "/api/spa/commission-settings", map[string]any{"rows": []any{map[string]any{"variant_id": v2, "values": []any{0, 0, 0}}}}, 200)
	zero := e.data(&e.therapist, "PATCH", "/api/spa/me/assignments/"+missing, map[string]any{"action": "complete"}, 200)
	if zero["commission_idr"] != float64(0) || zero["commission_level"] != float64(2) {
		t.Fatalf("explicit zero %v", zero)
	}
	_, promoted := book(v, "2026-10-08T07:00:00Z")
	e.call(&e.therapist, "PATCH", "/api/spa/me/assignments/"+promoted, map[string]any{"action": "start"}, 200)
	promotedDone := e.data(&e.therapist, "PATCH", "/api/spa/me/assignments/"+promoted, map[string]any{"action": "complete"}, 200)
	if promotedDone["commission_idr"] != float64(33000) || promotedDone["commission_level"] != float64(2) {
		t.Fatalf("promoted tariff %v", promotedDone)
	}
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.employees SET employment_status='resigned' WHERE id=$1`, emp); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.employees SET employment_status='contract',is_active=true WHERE id=$1`, emp); err != nil {
		t.Fatal(err)
	}
	_, rehired := book(v, "2026-10-08T09:00:00Z")
	e.call(&e.therapist, "PATCH", "/api/spa/me/assignments/"+rehired, map[string]any{"action": "start"}, 200)
	rehiredDone := e.data(&e.therapist, "PATCH", "/api/spa/me/assignments/"+rehired, map[string]any{"action": "complete"}, 200)
	if rehiredDone["commission_idr"] != float64(11000) || rehiredDone["commission_level"] != float64(0) {
		t.Fatalf("rehired tariff %v", rehiredDone)
	}
	// Historical reset must remain excluded even after new tariffs are configured.
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.booking_items SET commission_reset=true,commission_idr=0 WHERE id=$1`, item); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.bookings SET payment_status='paid' WHERE id=$1`, bid); err != nil {
		t.Fatal(err)
	}
	report := e.data(&e.therapist, "GET", "/api/spa/me/summary?month=2026-10", nil, 200)
	if report["earned_count"] != float64(0) || report["earned_idr"] != float64(0) {
		t.Fatalf("reset leaked %v", report)
	}
}

func TestCommissionResetMigrationPreservesOtherData(t *testing.T) {
	e := setup(t)
	employee := e.scheduledEmployee("Reset commission", nil)
	var therapist, booking, item, run, line string
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(e.tx.QueryRow(e.ctx, `INSERT INTO spa.therapists(employee_id,home_branch_id) VALUES($1,$2) RETURNING id::text`, employee, e.org.BranchID).Scan(&therapist))
	tr := e.data(&e.admin, "POST", "/api/spa/treatments", map[string]any{"code": "RESET" + testutil.RandomHex(3), "name": "Reset fixture", "variants": []any{map[string]any{"name": "60", "duration_min": 60, "price_idr": 100000}}}, 201)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	must(e.tx.QueryRow(e.ctx, `INSERT INTO spa.bookings(booking_code,branch_id,warehouse_id,booking_type,source,customer_name,scheduled_at,ends_at,status,payment_status,therapist_id)
 VALUES($1,$2,(SELECT id FROM configuration.warehouses WHERE branch_id=$2 LIMIT 1),'walk_in','front_office','Reset customer',now(),now()+interval '1 hour','completed','paid',$3) RETURNING id::text`, "RESET-"+testutil.RandomHex(5), e.org.BranchID, therapist).Scan(&booking))
	must(e.tx.QueryRow(e.ctx, `INSERT INTO spa.booking_items(booking_id,variant_id,treatment_name,variant_name,duration_min,price_idr,therapist_id,status,completed_at,commission_idr,commission_type,commission_value)
 VALUES($1,$2,'Reset fixture','60',60,100000,$3,'completed',now(),10000,'fixed',10000) RETURNING id::text`, booking, variant, therapist).Scan(&item))
	must(e.tx.QueryRow(e.ctx, `INSERT INTO spa.pay_runs(period_month,kind,period_start,period_end,pay_date,total_idr) VALUES('2099-01','regular','2099-01-01','2099-01-31','2099-01-31',16000) RETURNING id::text`).Scan(&run))
	must(e.tx.QueryRow(e.ctx, `INSERT INTO spa.pay_lines(run_id,therapist_id,pay_type,base_salary_idr,allowance_idr,commission_idr,commission_count,bonus_idr,deduction_idr,total_idr)
 VALUES($1,$2,'salary_commission',5000,1000,10000,1,500,500,16000) RETURNING id::text`, run, therapist).Scan(&line))
	_, err := e.tx.Exec(e.ctx, `INSERT INTO spa.pay_commission_items(run_id,line_id,item_id,commission_idr) VALUES($1,$2,$3,10000)`, run, line, item)
	must(err)
	// Restore the previous table shape inside this rolled-back test transaction.
	_, err = e.tx.Exec(e.ctx, `DELETE FROM spa.commission_rules;
 ALTER TABLE spa.commission_rules DROP CONSTRAINT spa_rules_global_fixed,DROP CONSTRAINT spa_rules_level_variant,DROP COLUMN therapist_level,DROP COLUMN updated_by,ALTER COLUMN variant_id DROP NOT NULL;
 CREATE UNIQUE INDEX uq_spa_commission_rules_scope ON spa.commission_rules(variant_id,branch_id);
 ALTER TABLE spa.booking_items DROP COLUMN commission_level,DROP COLUMN commission_reset;`)
	must(err)
	_, err = e.tx.Exec(e.ctx, `INSERT INTO spa.commission_rules(variant_id,branch_id,commission_type,value) VALUES($1,$2,'fixed',10000)`, variant, e.org.BranchID)
	must(err)
	migration, err := os.ReadFile("../../../database/migrations/deltas/20261026100000_spa_level_commissions.sql")
	must(err)
	_, err = e.tx.Exec(e.ctx, string(migration))
	must(err)
	var reset bool
	var commission, total, runTotal float64
	var payment string
	var count int
	must(e.tx.QueryRow(e.ctx, `SELECT i.commission_reset,i.commission_idr::float8,b.payment_status FROM spa.booking_items i JOIN spa.bookings b ON b.id=i.booking_id WHERE i.id=$1`, item).Scan(&reset, &commission, &payment))
	if !reset || commission != 0 || payment != "paid" {
		t.Fatalf("reset item %v %v %v", reset, commission, payment)
	}
	must(e.tx.QueryRow(e.ctx, `SELECT commission_idr::float8,total_idr::float8 FROM spa.pay_lines WHERE id=$1`, line).Scan(&commission, &total))
	must(e.tx.QueryRow(e.ctx, `SELECT total_idr::float8 FROM spa.pay_runs WHERE id=$1`, run).Scan(&runTotal))
	must(e.tx.QueryRow(e.ctx, `SELECT count(*) FROM spa.pay_commission_items WHERE item_id=$1`, item).Scan(&count))
	if commission != 0 || total != 6000 || runTotal != 6000 || count != 0 {
		t.Fatalf("payroll reset %v %v %v %v", commission, total, runTotal, count)
	}
}
