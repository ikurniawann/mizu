package spa_test

import (
	"net/http"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// fixedNow is 2026-10-08 09:00 WIB.
func TestPublicRescheduleByBookingCode(t *testing.T) {
	e := setup(t)
	admin := &e.admin
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	branch := e.org.BranchID
	e.data(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{
		"warehouse_id": warehouse, "open_time": "08:00", "close_time": "21:00", "slot_minutes": 30,
	}, http.StatusOK)
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{
		"code": "RS" + testutil.RandomHex(2), "name": "Refleksi",
		"variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 150000}},
	}, http.StatusCreated)
	v60 := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	for _, name := range []string{"Sari Terapis", "Rina Terapis"} {
		e.data(admin, "POST", "/api/spa/therapists", map[string]any{
			"employee_id": e.employee(name, nil), "home_branch_id": branch, "gender": "female",
		}, http.StatusCreated)
	}
	book := func(at, phone string) map[string]any {
		return e.data(nil, "POST", "/api/public/spa/bookings", map[string]any{"branch_id": branch, "scheduled_at": at,
			"customer_name": "Dina", "customer_phone": phone, "variant_ids": []any{v60}}, http.StatusCreated)
	}
	find := func(code, phone string, status int) map[string]any {
		return e.call(nil, "POST", "/api/public/spa/bookings/find", map[string]any{"booking_code": code, "phone": phone}, status)
	}
	change := func(token, grant, action, at string, status int) map[string]any {
		body := map[string]any{"grant": grant, "action": action}
		if at != "" {
			body["scheduled_at"] = at
		}
		return e.call(nil, "POST", "/api/public/spa/bookings/"+token+"/change", body, status)
	}

	// Visit at 11:00 WIB (2 hours ahead).
	b := book("2026-10-08T04:00:00.000Z", "0813 5555 0001")
	code, token := b["booking_code"].(string), b["access_token"].(string)
	if b["can_reschedule"] != true || b["can_manage"] != false {
		t.Fatalf("2h ahead: reschedule allowed, self-cancel not: %v", b)
	}

	// The code alone, or a different number, is not enough; a messy code is.
	out := find(code, "0813 9999 0000", http.StatusNotFound)
	if msg, _ := out["error"].(string); !strings.Contains(msg, "tidak cocok") {
		t.Fatalf("mismatch message = %v", out)
	}
	messy := strings.ToLower(strings.ReplaceAll(code, "-", " "))
	found := find(messy, "+62 813-5555-0001", http.StatusOK)["data"].(map[string]any)
	if found["access_token"] != token || found["grant"] == "" {
		t.Fatalf("lookup = %v", found)
	}
	grant := found["grant"].(string)

	// Too close to now, then a valid move; the grant works once.
	change(token, grant, "reschedule", "2026-10-08T02:30:00.000Z", http.StatusBadRequest) // 09:30 = only 30 min from now
	moved := change(token, grant, "reschedule", "2026-10-08T07:00:00.000Z", http.StatusOK)["data"].(map[string]any)
	if moved["scheduled_at"] != "2026-10-08T07:00:00.000Z" {
		t.Fatalf("moved = %v", moved)
	}
	change(token, grant, "reschedule", "2026-10-08T08:00:00.000Z", http.StatusForbidden)

	// Cancelling still needs a day's notice.
	grant = find(code, "081355550001", http.StatusOK)["data"].(map[string]any)["grant"].(string)
	change(token, grant, "cancel", "", http.StatusConflict)

	// Paid online: still movable (the payment follows the booking).
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.bookings SET payment_status = 'paid', payment_method = 'online' WHERE public_token = $1::uuid`, token); err != nil {
		t.Fatal(err)
	}
	grant = find(code, "081355550001", http.StatusOK)["data"].(map[string]any)["grant"].(string)
	paid := change(token, grant, "reschedule", "2026-10-08T09:00:00.000Z", http.StatusOK)["data"].(map[string]any)
	if paid["payment_status"] != "paid" || paid["scheduled_at"] != "2026-10-08T09:00:00.000Z" {
		t.Fatalf("paid booking after move = %v", paid)
	}

	// Within the last hour: no more changes.
	soon := book("2026-10-08T02:30:00.000Z", "0813 5555 0002")
	if soon["can_reschedule"] != false {
		t.Fatalf("30 min ahead must not be reschedulable: %v", soon)
	}
	g := find(soon["booking_code"].(string), "081355550002", http.StatusOK)["data"].(map[string]any)["grant"].(string)
	late := change(soon["access_token"].(string), g, "reschedule", "2026-10-08T06:00:00.000Z", http.StatusConflict)
	if msg, _ := late["error"].(string); !strings.Contains(msg, "1 jam") {
		t.Fatalf("late reschedule message = %v", late)
	}
}
