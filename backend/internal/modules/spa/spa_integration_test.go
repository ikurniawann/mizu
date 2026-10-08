package spa_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/platform/testutil"
)

// One rolled-back transaction per test; staff fixtures come from testutil.

var fixedNow = time.Date(2026, 10, 8, 2, 0, 0, 0, time.UTC) // 09:00 WIB

type env struct {
	t         *testing.T
	ctx       context.Context
	tx        pgx.Tx
	mux       http.Handler
	admin     testutil.Staff
	therapist testutil.Staff // a plain login, linked to an employee by the test
	org       testutil.Org
}

func setup(t *testing.T) *env {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return fixedNow })
	admin := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{
		"spa.bookings": nil, "spa.book-order": nil, "spa.treatments": nil, "spa.therapists": nil,
		"spa.commissions": nil, "spa.outlets": nil,
	}})
	// Created before the transaction: cleanups run in reverse, so the
	// rollback releases rows that reference these users first.
	therapist := testutil.CreateStaff(t, testutil.StaffOptions{})
	tx := testutil.Tx(t)
	// Rules are global: start from none so the scope-uniqueness assertions do
	// not depend on what a seeded database already holds (rolled back after).
	if _, err := tx.Exec(context.Background(), `DELETE FROM spa.commission_rules`); err != nil {
		t.Fatal(err)
	}
	org := testutil.CreateOrg(t, tx)
	m := spa.NewOn(deps, tx, app.SpaPorts())
	return &env{t: t, ctx: context.Background(), tx: tx, mux: testutil.Mux(m), admin: admin, therapist: therapist, org: org}
}

func (e *env) call(as *testutil.Staff, method, path string, body any, status int) map[string]any {
	e.t.Helper()
	r := testutil.Request(method, path, body)
	if as != nil {
		r = testutil.AsStaff(r, *as)
	}
	rec, out := testutil.Do(e.t, e.mux, r)
	if rec.Code != status {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
	}
	return out
}

func (e *env) data(as *testutil.Staff, method, path string, body any, status int) map[string]any {
	e.t.Helper()
	d, _ := e.call(as, method, path, body, status)["data"].(map[string]any)
	return d
}

func (e *env) list(as *testutil.Staff, path string) []any {
	e.t.Helper()
	l, _ := e.call(as, "GET", path, nil, http.StatusOK)["data"].([]any)
	return l
}

func (e *env) employee(name string, userID *string) string {
	e.t.Helper()
	var id string
	err := e.tx.QueryRow(e.ctx, `INSERT INTO hris.employees (full_name, nip, email, phone, join_date, user_id)
	  VALUES ($1, 'SPA-'||$2, 'spa-'||$2||'@test.local', '0812', CURRENT_DATE, $3::uuid) RETURNING id::text`,
		name, testutil.RandomHex(4), userID).Scan(&id)
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func items(b map[string]any) []map[string]any {
	raw, _ := b["items"].([]any)
	out := make([]map[string]any, len(raw))
	for i, r := range raw {
		out[i], _ = r.(map[string]any)
	}
	return out
}

func TestSpaBookingFlow(t *testing.T) {
	e := setup(t)
	admin := &e.admin
	therapistUser := e.therapist

	// Outlet: the branch's default stall.
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 ORDER BY is_default DESC LIMIT 1`,
		e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	branch := e.org.BranchID
	outlet := e.data(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{
		"warehouse_id": warehouse, "open_time": "09:00", "close_time": "21:00", "slot_minutes": 30,
		"public_booking": true, "is_active": true,
	}, http.StatusOK)
	if outlet["configured"] != true || outlet["open_time"] != "09:00" {
		t.Fatalf("outlet = %v", outlet)
	}
	e.call(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{
		"warehouse_id": warehouse, "open_time": "21:00", "close_time": "09:00", "slot_minutes": 30,
	}, http.StatusBadRequest)

	// Treatment with two durations.
	code := fmt.Sprintf("BALI%s", testutil.RandomHex(2))
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{
		"code": code, "name": "Balinese Massage", "category": "Massage",
		"variants": []any{
			map[string]any{"name": "60 menit", "duration_min": 60, "buffer_min": 15, "price_idr": 200000},
			map[string]any{"name": "90 menit", "duration_min": 90, "price_idr": 280000},
		},
	}, http.StatusCreated)
	variants, _ := tr["variants"].([]any)
	if len(variants) != 2 {
		t.Fatalf("variants = %v", tr["variants"])
	}
	v60 := variants[0].(map[string]any)["id"].(string)
	v90 := variants[1].(map[string]any)["id"].(string)
	e.call(admin, "POST", "/api/spa/treatments", map[string]any{"code": code, "name": "Dup",
		"variants": []any{map[string]any{"name": "30", "duration_min": 30, "price_idr": 1}}}, http.StatusConflict)

	// Outlet price for the 60-minute variant.
	tr = e.data(admin, "PUT", "/api/spa/treatments/"+tr["id"].(string)+"/prices", map[string]any{
		"prices": []any{map[string]any{"variant_id": v60, "branch_id": branch, "price_idr": 220000}},
	}, http.StatusOK)

	// Therapists.
	empA := e.employee("Ayu Terapis", &therapistUser.UserID)
	empB := e.employee("Budi Terapis", nil)
	thA := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": empA, "home_branch_id": branch, "gender": "female"}, http.StatusCreated)
	thB := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": empB, "home_branch_id": branch, "gender": "male"}, http.StatusCreated)
	e.call(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": empA, "home_branch_id": branch}, http.StatusConflict)
	tA, tB := thA["id"].(string), thB["id"].(string)

	// Commission rules: default 10%, the 90-minute variant a flat 50k.
	e.data(admin, "POST", "/api/spa/commission-rules", map[string]any{"commission_type": "percent", "value": 10}, http.StatusCreated)
	e.data(admin, "POST", "/api/spa/commission-rules", map[string]any{"variant_id": v90, "commission_type": "fixed", "value": 50000}, http.StatusCreated)
	e.call(admin, "POST", "/api/spa/commission-rules", map[string]any{"commission_type": "percent", "value": 12}, http.StatusConflict)
	e.call(admin, "POST", "/api/spa/commission-rules", map[string]any{"commission_type": "percent", "value": 120, "branch_id": branch}, http.StatusBadRequest)

	// Booking 1: 10:00 WIB with therapist A, the outlet price applies.
	start := "2026-10-08T03:00:00.000Z"
	b1 := e.data(admin, "POST", "/api/spa/bookings", map[string]any{
		"branch_id": branch, "booking_type": "reservation", "customer_name": "Citra", "customer_phone": "+62 812-3456-7890",
		"scheduled_at": start, "items": []any{map[string]any{"variant_id": v60, "therapist_id": tA}},
	}, http.StatusCreated)
	if b1["status"] != "assigned" || b1["payment_status"] != "unpaid" || b1["customer_phone"] != "081234567890" {
		t.Fatalf("booking 1 = %v", b1)
	}
	if it := items(b1)[0]; it["price_idr"] != float64(220000) || it["therapist_id"] != tA {
		t.Fatalf("item = %v", it)
	}
	b1ID := b1["id"].(string)
	b1Item := items(b1)[0]["id"].(string)

	// Booking 2 at 11:00 overlaps A's 15-minute buffer (10:00–11:15).
	b2 := e.data(admin, "POST", "/api/spa/bookings", map[string]any{
		"branch_id": branch, "booking_type": "walk_in", "customer_name": "Dewi",
		"scheduled_at": "2026-10-08T04:00:00.000Z", "items": []any{map[string]any{"variant_id": v90}},
	}, http.StatusCreated)
	b2ID := b2["id"].(string)
	b2Item := items(b2)[0]["id"].(string)
	if b2["status"] != "unassigned" {
		t.Fatalf("booking 2 = %v", b2["status"])
	}
	out := e.call(admin, "PATCH", "/api/spa/bookings/"+b2ID+"/items/"+b2Item, map[string]any{"action": "assign", "therapist_id": tA}, http.StatusConflict)
	if msg, _ := out["error"].(string); msg == "" {
		t.Fatalf("conflict without message: %v", out)
	}
	e.call(admin, "POST", "/api/spa/bookings/"+b2ID+"/checkout", nil, http.StatusConflict) // unassigned item

	// Availability at 11:00–12:30: A busy, B free.
	avail := e.list(admin, "/api/spa/availability?branch_id="+branch+"&starts_at=2026-10-08T04:00:00.000Z&ends_at=2026-10-08T05:30:00.000Z")
	seen := map[string]bool{}
	for _, raw := range avail {
		a := raw.(map[string]any)
		id := a["therapist"].(map[string]any)["id"].(string)
		seen[id] = a["available"].(bool)
	}
	if seen[tA] || !seen[tB] {
		t.Fatalf("availability = %v", seen)
	}
	b2 = e.data(admin, "PATCH", "/api/spa/bookings/"+b2ID+"/items/"+b2Item, map[string]any{"action": "assign", "therapist_id": tB}, http.StatusOK)
	if b2["status"] != "assigned" {
		t.Fatalf("booking 2 after assign = %v", b2["status"])
	}

	// Board for the day.
	board := e.data(admin, "GET", "/api/spa/board?branch_id="+branch+"&date=2026-10-08", nil, http.StatusOK)
	if lanes, _ := board["therapists"].([]any); len(lanes) != 2 {
		t.Fatalf("board lanes = %v", board["therapists"])
	}

	// Checkout booking 1 into a POS open bill; a second checkout reuses it.
	co := e.data(admin, "POST", "/api/spa/bookings/"+b1ID+"/checkout", nil, http.StatusOK)
	orderID, _ := co["order_id"].(string)
	if orderID == "" {
		t.Fatalf("checkout = %v", co)
	}
	again := e.data(admin, "POST", "/api/spa/bookings/"+b1ID+"/checkout", nil, http.StatusOK)
	if again["order_id"] != orderID {
		t.Fatalf("second checkout made a new order: %v vs %v", again["order_id"], orderID)
	}
	var total float64
	var station, payment, wh string
	if err := e.tx.QueryRow(e.ctx, `SELECT o.total_amount::float8, i.station, o.payment_status::text, o.warehouse_id::text
	   FROM pos.pos_orders o JOIN pos.pos_order_items i ON i.order_id = o.id WHERE o.id = $1`, orderID).
		Scan(&total, &station, &payment, &wh); err != nil {
		t.Fatal(err)
	}
	if total != 220000 || station != "spa" || payment != "unpaid" || wh != warehouse {
		t.Fatalf("order total=%v station=%s payment=%s wh=%s", total, station, payment, wh)
	}
	// Adding a treatment after checkout is refused while the bill stands.
	e.call(admin, "POST", "/api/spa/bookings/"+b1ID+"/items", map[string]any{"variant_id": v90}, http.StatusConflict)

	// The therapist works from their own login.
	me := e.data(&therapistUser, "GET", "/api/spa/me", nil, http.StatusOK)
	if th, _ := me["therapist"].(map[string]any); th == nil || th["id"] != tA {
		t.Fatalf("me = %v", me)
	}
	mine := e.list(&therapistUser, "/api/spa/me/assignments?date=2026-10-08")
	if len(mine) != 1 {
		t.Fatalf("my assignments = %v", mine)
	}
	e.call(&therapistUser, "PATCH", "/api/spa/me/assignments/"+b1Item, map[string]any{"action": "complete"}, http.StatusConflict)
	e.call(&therapistUser, "PATCH", "/api/spa/me/assignments/"+b2Item, map[string]any{"action": "start"}, http.StatusNotFound)
	e.data(&therapistUser, "PATCH", "/api/spa/me/assignments/"+b1Item, map[string]any{"action": "start"}, http.StatusOK)
	done := e.data(&therapistUser, "PATCH", "/api/spa/me/assignments/"+b1Item, map[string]any{"action": "complete"}, http.StatusOK)
	if done["status"] != "completed" || done["commission_idr"] != float64(22000) || done["booking_status"] != "completed" {
		t.Fatalf("completed item = %v", done)
	}

	// Staff override: complete booking 2 without a start (flat 90-minute rule).
	b2 = e.data(admin, "PATCH", "/api/spa/bookings/"+b2ID+"/items/"+b2Item, map[string]any{"action": "complete"}, http.StatusOK)
	if items(b2)[0]["commission_idr"] != float64(50000) {
		t.Fatalf("booking 2 commission = %v", items(b2)[0]["commission_idr"])
	}

	// The cashier settles booking 1's bill: reads pick the payment up.
	if _, err := e.tx.Exec(e.ctx, `UPDATE pos.pos_orders SET payment_status = 'paid', status = 'completed' WHERE id = $1`, orderID); err != nil {
		t.Fatal(err)
	}
	b1 = e.data(admin, "GET", "/api/spa/bookings/"+b1ID, nil, http.StatusOK)
	if b1["payment_status"] != "paid" || b1["status"] != "completed" {
		t.Fatalf("booking 1 after payment = %v / %v", b1["status"], b1["payment_status"])
	}
	e.call(admin, "POST", "/api/spa/bookings/"+b1ID+"/cancel", map[string]any{"reason": "x"}, http.StatusConflict)

	// Commission report: only the paid booking counts.
	rep := e.data(admin, "GET", "/api/spa/commissions?from=2026-10-01&to=2026-10-31&branch_id="+branch, nil, http.StatusOK)
	if rep["total_idr"] != float64(22000) {
		t.Fatalf("report = %v", rep)
	}
	myRep := e.data(&therapistUser, "GET", "/api/spa/me/commissions?month=2026-10", nil, http.StatusOK)
	if myRep["total_idr"] != float64(22000) {
		t.Fatalf("my report = %v", myRep)
	}

	// Listing with filters.
	listOut := e.call(admin, "GET", "/api/spa/bookings?branch_id="+branch+"&from=2026-10-08&to=2026-10-08&payment_status=paid", nil, http.StatusOK)
	if rows, _ := listOut["data"].([]any); len(rows) != 1 {
		t.Fatalf("paid list = %v", listOut["data"])
	}
	if pag, _ := listOut["pagination"].(map[string]any); pag["total"] != float64(1) {
		t.Fatalf("pagination = %v", listOut["pagination"])
	}

	// Cancel: a fresh unassigned booking cancels with its reason.
	b3 := e.data(admin, "POST", "/api/spa/bookings", map[string]any{
		"branch_id": branch, "booking_type": "reservation", "customer_name": "Eka",
		"scheduled_at": "2026-10-08T08:00:00.000Z", "items": []any{map[string]any{"variant_id": v60}},
	}, http.StatusCreated)
	b3 = e.data(admin, "POST", "/api/spa/bookings/"+b3["id"].(string)+"/cancel", map[string]any{"reason": "Tamu batal"}, http.StatusOK)
	if b3["status"] != "cancelled" || b3["cancel_reason"] != "Tamu batal" {
		t.Fatalf("cancelled = %v", b3)
	}
}

func TestSpaPublicBookingAndAuth(t *testing.T) {
	e := setup(t)
	admin := &e.admin
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	branch := e.org.BranchID
	e.data(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{
		"warehouse_id": warehouse, "open_time": "10:00", "close_time": "20:00", "slot_minutes": 30,
	}, http.StatusOK)
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{
		"code": fmt.Sprintf("REF%s", testutil.RandomHex(2)), "name": "Reflexology",
		"variants": []any{map[string]any{"name": "45 menit", "duration_min": 45, "price_idr": 150000}},
	}, http.StatusCreated)
	v45 := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	emp := e.employee("Terapis Booking Online", nil)
	e.data(admin, "POST", "/api/spa/therapists", map[string]any{
		"employee_id": emp, "home_branch_id": branch, "gender": "female",
	}, http.StatusCreated)

	outlets := e.list(nil, "/api/public/spa/outlets")
	found := false
	for _, o := range outlets {
		if o.(map[string]any)["branch_id"] == branch {
			found = true
		}
	}
	if !found {
		t.Fatal("public outlets miss the configured branch")
	}
	if list := e.list(nil, "/api/public/spa/outlets/"+branch+"/treatments"); len(list) == 0 {
		t.Fatal("public treatments empty")
	}
	body := func(at string) map[string]any {
		return map[string]any{"branch_id": branch, "scheduled_at": at, "customer_name": "Fajar",
			"customer_phone": "0813 1111 2222", "variant_ids": []any{v45}}
	}
	e.call(nil, "POST", "/api/public/spa/bookings", body("2026-10-08T01:00:00.000Z"), http.StatusBadRequest) // past
	e.call(nil, "POST", "/api/public/spa/bookings", body("2026-10-09T12:30:00.000Z"), http.StatusConflict)   // 19:30 + 45 > 20:00
	res := e.data(nil, "POST", "/api/public/spa/bookings", body("2026-10-09T05:00:00.000Z"), http.StatusCreated)
	if res["booking_code"] == "" || res["total_idr"] != float64(150000) {
		t.Fatalf("public booking = %v", res)
	}
	token, ok := res["access_token"].(string)
	if !ok || token == "" {
		t.Fatalf("public booking missing access token: %v", res)
	}
	confirmed := e.data(nil, "GET", "/api/public/spa/bookings/"+token, nil, http.StatusOK)
	if confirmed["booking_code"] != res["booking_code"] {
		t.Fatalf("confirmation lookup = %v", confirmed)
	}
	e.call(nil, "POST", "/api/public/spa/bookings", body("2026-10-09T05:00:00.000Z"), http.StatusConflict)
	slots := e.list(nil, "/api/public/spa/outlets/"+branch+"/slots?date=2026-10-09&variant_ids="+v45)
	for _, raw := range slots {
		if raw.(map[string]any)["starts_at"] == "2026-10-09T05:00:00.000Z" {
			t.Fatalf("occupied slot offered: %v", raw)
		}
	}
	var source, status string
	if err := e.tx.QueryRow(e.ctx, `SELECT source, status FROM spa.bookings WHERE booking_code = $1`, res["booking_code"]).Scan(&source, &status); err != nil {
		t.Fatal(err)
	}
	if source != "public" || status != "unassigned" {
		t.Fatalf("stored public booking %s/%s", source, status)
	}
	for _, at := range []string{"2026-10-09T06:00:00.000Z", "2026-10-09T07:00:00.000Z"} {
		e.data(nil, "POST", "/api/public/spa/bookings", body(at), http.StatusCreated)
	}
	e.call(nil, "POST", "/api/public/spa/bookings", body("2026-10-09T08:00:00.000Z"), http.StatusTooManyRequests)
	// A previously cancelled treatment must not return when the guest moves the booking.
	var cancelledItemID string
	if err := e.tx.QueryRow(e.ctx, `INSERT INTO spa.booking_items
	  (booking_id, variant_id, treatment_name, variant_name, duration_min, buffer_min, price_idr,
	   starts_at, ends_at, status, sort_order)
	  SELECT booking_id, variant_id, treatment_name, variant_name, duration_min, buffer_min,
	         price_idr, starts_at, ends_at, 'cancelled', 99
	    FROM spa.booking_items WHERE booking_id = (SELECT id FROM spa.bookings WHERE public_token = $1::uuid)
	    LIMIT 1 RETURNING id::text`, token).Scan(&cancelledItemID); err != nil {
		t.Fatal(err)
	}
	grant := "10000000-0000-4000-8000-000000000001"
	digest := sha256.Sum256([]byte(grant))
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.public_booking_challenges
	  (booking_id, code_hash, expires_at, grant_hash, grant_expires_at)
	  SELECT id, 'test', now() + interval '5 minutes', $2, now() + interval '15 minutes'
	  FROM spa.bookings WHERE public_token = $1::uuid`, token, hex.EncodeToString(digest[:])); err != nil {
		t.Fatal(err)
	}
	changed := e.data(nil, "POST", "/api/public/spa/bookings/"+token+"/change", map[string]any{
		"grant": grant, "action": "reschedule", "scheduled_at": "2026-10-09T04:00:00.000Z",
	}, http.StatusOK)
	if changed["scheduled_at"] != "2026-10-09T04:00:00.000Z" || changed["status"] != "unassigned" {
		t.Fatalf("rescheduled public booking = %v", changed)
	}
	var cancelledItemStatus string
	if err := e.tx.QueryRow(e.ctx, `SELECT status FROM spa.booking_items WHERE id = $1`, cancelledItemID).Scan(&cancelledItemStatus); err != nil {
		t.Fatal(err)
	}
	if cancelledItemStatus != "cancelled" {
		t.Fatalf("reschedule revived cancelled item: %s", cancelledItemStatus)
	}
	e.call(nil, "POST", "/api/public/spa/bookings/"+token+"/change", map[string]any{
		"grant": grant, "action": "cancel",
	}, http.StatusForbidden) // grant is one-use
	grant2 := "10000000-0000-4000-8000-000000000002"
	digest2 := sha256.Sum256([]byte(grant2))
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.public_booking_challenges
	  (booking_id, code_hash, expires_at, grant_hash, grant_expires_at)
	  SELECT id, 'test', now() + interval '5 minutes', $2, now() + interval '15 minutes'
	  FROM spa.bookings WHERE public_token = $1::uuid`, token, hex.EncodeToString(digest2[:])); err != nil {
		t.Fatal(err)
	}
	cancelled := e.data(nil, "POST", "/api/public/spa/bookings/"+token+"/change", map[string]any{
		"grant": grant2, "action": "cancel",
	}, http.StatusOK)
	if cancelled["status"] != "cancelled" {
		t.Fatalf("cancelled public booking = %v", cancelled)
	}
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.public_booking_funnel_events (session_id, step)
	  VALUES ('12345678-1234-4234-8234-123456789abc', 'open'),
	         ('12345678-1234-4234-8234-123456789abc', 'outlet')`); err != nil {
		t.Fatal(err)
	}
	today := time.Now().In(time.FixedZone("WIB", 7*3600)).Format("2006-01-02")
	funnel := e.list(admin, "/api/spa/booking-funnel?from="+today+"&to="+today)
	if len(funnel) != 7 {
		t.Fatalf("funnel stages = %v", funnel)
	}
	if funnel[0].(map[string]any)["reached"] != float64(1) || funnel[1].(map[string]any)["reached"] != float64(1) {
		t.Fatalf("funnel progress = %v", funnel)
	}

	// A login without a spa menu, and anonymous callers, are refused.
	viewer := e.therapist
	e.call(&viewer, "GET", "/api/spa/bookings", nil, http.StatusForbidden)
	e.call(nil, "GET", "/api/spa/bookings", nil, http.StatusUnauthorized)
	e.data(&viewer, "GET", "/api/spa/me", nil, http.StatusOK)
	e.call(&viewer, "GET", "/api/spa/me/assignments", nil, http.StatusForbidden)
}
