package spa_test

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/platform/testutil"
)

// Deposit (DP) for online bookings. Runs with XENDIT_MOCK=1 (the mock
// invoice adapter) — see the Makefile/test runner.

func TestDepositHoldsAndSettlesOnlineBookings(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}
	e := setup(t)
	admin := &e.admin
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	branch := e.org.BranchID
	e.data(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{"warehouse_id": warehouse, "open_time": "10:00", "close_time": "20:00", "slot_minutes": 30}, http.StatusOK)
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{
		"code": fmt.Sprintf("DP%s", testutil.RandomHex(2)), "name": "Reflexology",
		"variants": []any{map[string]any{"name": "45 menit", "duration_min": 45, "price_idr": 150000}},
	}, http.StatusCreated)
	v45 := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	emp := e.scheduledEmployee("Terapis DP", nil)
	therapist := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": branch, "gender": "female"}, http.StatusCreated)

	// Policy is readable and editable by staff with the outlets menu.
	cfg := e.data(admin, "GET", "/api/spa/settings/deposit", nil, http.StatusOK)
	if cfg["enabled"] != true {
		t.Skip("deposits need online payment: run with XENDIT_MOCK=1")
	}
	if cfg["amount_idr"] != float64(100000) || cfg["hold_minutes"] != float64(60) {
		t.Fatalf("default deposit policy = %v", cfg)
	}
	book := func(at, phone string) map[string]any {
		return e.data(nil, "POST", "/api/public/spa/bookings", map[string]any{"branch_id": branch, "scheduled_at": at, "customer_name": "Fajar",
			"customer_phone": phone, "variant_ids": []any{v45}}, http.StatusCreated)
	}
	res := book("2026-10-09T05:00:00.000Z", "0813 1111 2222")
	dep, _ := res["deposit"].(map[string]any)
	if dep["deposit_status"] != "pending" || dep["deposit_idr"] != float64(100000) || dep["deposit_hold_until"] == nil ||
		!strings.Contains(fmt.Sprint(dep["deposit_invoice_url"]), "bayar=dp-simulasi") || dep["remaining_idr"] != float64(150000) {
		t.Fatalf("new online booking deposit = %v", dep)
	}
	token := res["access_token"].(string)
	var pendingID string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM spa.bookings WHERE public_token = $1::uuid`, token).Scan(&pendingID); err != nil {
		t.Fatal(err)
	}
	pending := e.data(admin, "GET", "/api/spa/bookings/"+pendingID, nil, http.StatusOK)
	e.data(admin, "PATCH", "/api/spa/bookings/"+pendingID+"/items/"+items(pending)[0]["id"].(string), map[string]any{"action": "assign", "therapist_id": therapist["id"]}, http.StatusOK)
	// A DP-pending online booking cannot be started, even via the staff API.
	e.call(admin, "POST", "/api/spa/bookings/"+pendingID+"/status", map[string]any{"action": "start"}, http.StatusConflict)
	// The slot is held while the DP is pending: a second guest cannot take it.
	e.call(nil, "POST", "/api/public/spa/bookings", map[string]any{"branch_id": branch, "scheduled_at": "2026-10-09T05:00:00.000Z", "customer_name": "Lain",
		"customer_phone": "0813 3333 4444", "variant_ids": []any{v45}}, http.StatusConflict)
	// Paying the DP (mock) settles it; the remainder is due at the outlet.
	paid := e.data(nil, "POST", "/api/public/spa/bookings/"+token+"/mock-pay-deposit", nil, http.StatusOK)
	dep, _ = paid["deposit"].(map[string]any)
	if dep["deposit_status"] != "paid" || dep["remaining_idr"] != float64(50000) || paid["payment_status"] != "unpaid" {
		t.Fatalf("after DP: %v / %v", dep, paid["payment_status"])
	}
	e.call(nil, "POST", "/api/public/spa/bookings/"+token+"/deposit", nil, http.StatusConflict) // nothing pending any more
	var id string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM spa.bookings WHERE public_token = $1::uuid`, token).Scan(&id); err != nil {
		t.Fatal(err)
	}
	detail := e.data(admin, "GET", "/api/spa/bookings/"+id, nil, http.StatusOK)
	if d, _ := detail["deposit"].(map[string]any); d["deposit_status"] != "paid" {
		t.Fatalf("staff detail deposit = %v", detail["deposit"])
	}
	// The POS bill of a paid-DP booking is reduced by the deposit.
	var product string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM pos.pos_products LIMIT 1`).Scan(&product); err != nil {
		t.Fatal(err)
	}
	ref, err := app.SpaPorts().POS.OpenBill(e.ctx, e.tx, spa.Bill{BranchID: branch, WarehouseID: warehouse, CashierUserID: admin.UserID, ContactName: "Fajar",
		Notes: "uji", Prepaid: 100000, PrepaidNote: "DP booking X", Lines: []spa.BillLine{{ProductID: product, Name: "Reflexology (45 menit)", SKU: "SPA-T", UnitPrice: 150000}}})
	if err != nil {
		t.Fatal(err)
	}
	var subtotal, discount, total float64
	if err := e.tx.QueryRow(e.ctx, `SELECT subtotal::float8, discount_amount::float8, total_amount::float8 FROM pos.pos_orders WHERE id = $1::uuid`, ref.ID).Scan(&subtotal, &discount, &total); err != nil {
		t.Fatal(err)
	}
	if subtotal != 150000 || discount != 100000 || total != 50000 {
		t.Fatalf("bill: subtotal=%v discount=%v total=%v", subtotal, discount, total)
	}

	// An unpaid DP past its hold cancels the booking and frees the slot.
	second := book("2026-10-09T07:00:00.000Z", "0813 5555 6666")
	// The service clock is fixedNow: a hold that ended a minute before it is due.
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.bookings SET deposit_hold_until = $2 WHERE public_token = $1::uuid`, second["access_token"], fixedNow.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	e.list(admin, "/api/spa/bookings?branch_id="+branch) // reads run the sweep
	var status, depStatus, reason string
	if err := e.tx.QueryRow(e.ctx, `SELECT status, deposit_status, COALESCE(cancel_reason, '') FROM spa.bookings WHERE public_token = $1::uuid`, second["access_token"]).Scan(&status, &depStatus, &reason); err != nil {
		t.Fatal(err)
	}
	if status != "cancelled" || depStatus != "expired" || !strings.Contains(reason, "DP") {
		t.Fatalf("expired deposit: %s/%s/%s", status, depStatus, reason)
	}
	book("2026-10-09T07:00:00.000Z", "0813 7777 8888") // the slot is free again

	// The front office may waive or record a DP by hand.
	third := book("2026-10-09T09:00:00.000Z", "0813 9999 0000")
	var thirdID string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM spa.bookings WHERE public_token = $1::uuid`, third["access_token"]).Scan(&thirdID); err != nil {
		t.Fatal(err)
	}
	waived := e.data(admin, "POST", "/api/spa/bookings/"+thirdID+"/deposit", map[string]any{"action": "waive", "note": "tamu langganan"}, http.StatusOK)
	if d, _ := waived["deposit"].(map[string]any); d["deposit_status"] != "waived" || d["remaining_idr"] != float64(150000) {
		t.Fatalf("waived: %v", waived["deposit"])
	}
	// Changing the policy applies to new bookings.
	e.data(admin, "PUT", "/api/spa/settings/deposit", map[string]any{"amount_idr": 50000, "hold_minutes": 30}, http.StatusOK)
	fourth := book("2026-10-09T10:00:00.000Z", "0813 1212 3434")
	if d, _ := fourth["deposit"].(map[string]any); d["deposit_idr"] != float64(50000) {
		t.Fatalf("new policy: %v", fourth["deposit"])
	}
	// Front-office bookings carry no deposit.
	fo := e.data(admin, "POST", "/api/spa/bookings", map[string]any{"branch_id": branch, "scheduled_at": "2026-10-09T11:00:00.000Z", "customer_name": "Walk In",
		"customer_phone": "0813 2222 1111", "booking_type": "reservation", "items": []any{map[string]any{"variant_id": v45}}}, http.StatusCreated)
	if d, _ := fo["deposit"].(map[string]any); d["deposit_status"] != "none" {
		t.Fatalf("front office deposit = %v", fo["deposit"])
	}
	_ = context.Background()
}
