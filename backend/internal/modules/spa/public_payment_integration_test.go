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

// fakePayments is a mock-mode Xendit: invoices point back at the redirect.
type fakePayments struct{ created *int }

func (fakePayments) Configured() bool                    { return true }
func (fakePayments) Mock() bool                          { return true }
func (fakePayments) ValidWebhookToken(token string) bool { return token == "cb-secret" }
func (f fakePayments) CreateInvoice(_ context.Context, in spa.InvoiceRequest) (spa.Invoice, error) {
	*f.created++
	return spa.Invoice{ID: fmt.Sprintf("mock-%s-%d", in.ExternalID, *f.created), URL: in.RedirectURL,
		ExpiresAt: time.Now().Add(2 * time.Hour), Mock: true}, nil
}
func (fakePayments) InvoiceStatus(context.Context, string) (string, error) { return "PENDING", nil }

func TestPublicTherapistChoiceAndOnlinePayment(t *testing.T) {
	e := setup(t)
	created := 0
	ports := app.SpaPorts()
	ports.Payments = fakePayments{created: &created}
	e.mux = testutil.Mux(spa.NewOn(testutil.Deps(t, func() time.Time { return fixedNow }), e.tx, ports))
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
		"code": "PAY" + testutil.RandomHex(2), "name": "Balinese",
		"variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 185000}},
	}, http.StatusCreated)
	v60 := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	ayu := e.data(admin, "POST", "/api/spa/therapists", map[string]any{
		"employee_id": e.employee("Ayu Lestari", nil), "home_branch_id": branch, "gender": "female",
	}, http.StatusCreated)["id"].(string)
	e.data(admin, "POST", "/api/spa/therapists", map[string]any{
		"employee_id": e.employee("Budi Santoso", nil), "home_branch_id": branch, "gender": "male",
	}, http.StatusCreated)

	for _, o := range e.list(nil, "/api/public/spa/outlets") {
		if o.(map[string]any)["branch_id"] == branch && o.(map[string]any)["online_payment"] != true {
			t.Fatalf("outlet should offer online payment: %v", o)
		}
	}

	// Free therapists for 12:00 WIB: both, short public names, filtered by preference.
	at := "2026-10-09T05:00:00.000Z"
	q := "/api/public/spa/outlets/" + branch + "/therapists?starts_at=" + at + "&variant_ids=" + v60
	names := map[string]bool{}
	for _, raw := range e.list(nil, q) {
		names[raw.(map[string]any)["name"].(string)] = true
	}
	if !names["Ayu L."] || !names["Budi S."] || len(names) != 2 {
		t.Fatalf("free therapists = %v", names)
	}
	if female := e.list(nil, q+"&therapist_gender_pref=female"); len(female) != 1 {
		t.Fatalf("female filter = %v", female)
	}

	book := func(phone, therapist, method string) map[string]any {
		body := map[string]any{"branch_id": branch, "scheduled_at": at, "customer_name": "Rina",
			"customer_phone": phone, "variant_ids": []any{v60}, "payment_method": method}
		if therapist != "" {
			body["therapist_id"] = therapist
		}
		return body
	}
	res := e.data(nil, "POST", "/api/public/spa/bookings", book("0813 2222 0001", ayu, "online"), http.StatusCreated)
	if res["status"] != "assigned" || res["therapist_name"] != "Ayu L." || res["payment_method"] != "online" {
		t.Fatalf("booking with chosen therapist = %v", res)
	}
	// Ayu is now taken at that time: the next guest cannot pick her, and the list drops her.
	out := e.call(nil, "POST", "/api/public/spa/bookings", book("0813 2222 0002", ayu, "outlet"), http.StatusConflict)
	if msg, _ := out["error"].(string); !strings.Contains(msg, "Terapis pilihanmu") || strings.Contains(msg, "MZ-") {
		t.Fatalf("taken therapist error leaks or is unclear: %v", out)
	}
	if left := e.list(nil, q); len(left) != 1 || left[0].(map[string]any)["name"] != "Budi S." {
		t.Fatalf("after booking, free therapists = %v", left)
	}

	// Payment link: simulation URL, reused while it lives, then the simulated payment settles it.
	token := res["access_token"].(string)
	pay := e.data(nil, "POST", "/api/public/spa/bookings/"+token+"/pay", nil, http.StatusOK)
	link, _ := pay["invoice_url"].(string)
	if !strings.HasSuffix(link, "/booking/spa/status/"+token+"?bayar=simulasi") || pay["mock"] != true {
		t.Fatalf("payment link = %v", pay)
	}
	if again := e.data(nil, "POST", "/api/public/spa/bookings/"+token+"/pay", nil, http.StatusOK); again["invoice_url"] != link || created != 1 {
		t.Fatalf("live link should be reused: %v (invoices %d)", again, created)
	}
	status := e.data(nil, "GET", "/api/public/spa/bookings/"+token, nil, http.StatusOK)
	if status["payment_status"] != "unpaid" || status["invoice_url"] != link || status["mock_payment"] != true {
		t.Fatalf("pending status = %v", status)
	}
	paid := e.data(nil, "POST", "/api/public/spa/bookings/"+token+"/mock-pay", nil, http.StatusOK)
	if paid["payment_status"] != "paid" || paid["paid_online"] != true || paid["invoice_url"] != nil || paid["can_manage"] != false {
		t.Fatalf("after simulated payment = %v", paid)
	}
	e.call(nil, "POST", "/api/public/spa/bookings/"+token+"/pay", nil, http.StatusConflict)

	// Webhook: token checked, short payment refused, full payment settles once.
	other := e.data(nil, "POST", "/api/public/spa/bookings", book("0813 2222 0003", "", "outlet"), http.StatusCreated)
	otherToken := other["access_token"].(string)
	e.data(nil, "POST", "/api/public/spa/bookings/"+otherToken+"/pay", nil, http.StatusOK)
	var bookingID, invoiceID string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text, xendit_invoice_id FROM spa.bookings WHERE public_token = $1::uuid`, otherToken).
		Scan(&bookingID, &invoiceID); err != nil {
		t.Fatal(err)
	}
	callback := func(token string, amount float64, want int) map[string]any {
		r := testutil.Request("POST", "/api/public/spa/webhook/xendit", map[string]any{
			"id": invoiceID, "external_id": "spa-booking-" + bookingID, "status": "PAID", "paid_amount": amount,
		})
		r.Header.Set("x-callback-token", token)
		rec, body := testutil.Do(t, e.mux, r)
		if rec.Code != want {
			t.Fatalf("webhook status %d, want %d: %s", rec.Code, want, rec.Body.String())
		}
		return body
	}
	callback("wrong", 185000, http.StatusUnauthorized)
	if body := callback("cb-secret", 1000, http.StatusOK); body["outcome"] != "unchanged" {
		t.Fatalf("short payment must not settle: %v", body)
	}
	if body := callback("cb-secret", 185000, http.StatusOK); body["outcome"] != "paid" {
		t.Fatalf("full payment should settle: %v", body)
	}
	if body := callback("cb-secret", 185000, http.StatusOK); body["outcome"] != "unchanged" {
		t.Fatalf("repeat callback should be idempotent: %v", body)
	}
	var events int
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*) FROM spa.booking_events WHERE booking_id = $1 AND action = 'paid'`, bookingID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 1 {
		t.Fatalf("paid events = %d, want 1", events)
	}
}
