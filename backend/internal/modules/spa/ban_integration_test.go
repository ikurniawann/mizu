package spa_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Banned members (revisi R8): online booking answers "jam sudah penuh"
// without revealing the ban; staff can ban/unban from the customer page.
func TestBannedMemberSeesSlotsAsFull(t *testing.T) {
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
		"code": fmt.Sprintf("BN%s", testutil.RandomHex(2)), "name": "Reflexology",
		"variants": []any{map[string]any{"name": "45 menit", "duration_min": 45, "price_idr": 150000}},
	}, http.StatusCreated)
	v45 := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	emp := e.employee("Terapis Ban", nil)
	e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": branch, "gender": "female"}, http.StatusCreated)

	phone := "0813 5555 6666"
	book := func(at string, status int) map[string]any {
		return e.call(nil, "POST", "/api/public/spa/bookings", map[string]any{"branch_id": branch, "scheduled_at": at, "customer_name": "Nakal",
			"customer_phone": phone, "variant_ids": []any{v45}}, status)
	}
	book("2026-10-09T05:00:00.000Z", http.StatusCreated)
	var id string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM pos.pos_customers WHERE phone = '081355556666'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	// Ban needs a reason; the profile then carries banned_at/reason and the list flags it.
	e.call(admin, "POST", "/api/spa/customer-directory/"+id+"/ban", map[string]any{"banned": true}, http.StatusBadRequest)
	p := e.data(admin, "POST", "/api/spa/customer-directory/"+id+"/ban", map[string]any{"banned": true, "reason": "Sering tidak datang"}, http.StatusOK)
	if p["banned_at"] == nil || p["banned_reason"] != "Sering tidak datang" {
		t.Fatalf("banned profile = %v", p)
	}
	flagged := false
	for _, it := range e.list(admin, "/api/spa/customer-directory?q=Nakal") {
		if m, ok := it.(map[string]any); ok && m["id"] == id && m["banned"] == true {
			flagged = true
		}
	}
	if !flagged {
		t.Fatal("customer directory must flag the banned member")
	}
	detail := e.data(admin, "GET", "/api/spa/customer-directory/"+id, nil, http.StatusOK)
	if c, _ := detail["customer"].(map[string]any); c["banned_at"] == nil {
		t.Fatalf("detail after ban = %v", detail["customer"])
	}
	// A free slot now looks full to the banned member, and only to them.
	res := book("2026-10-09T07:00:00.000Z", http.StatusConflict)
	if !strings.Contains(fmt.Sprint(res), "sudah penuh") || strings.Contains(strings.ToLower(fmt.Sprint(res)), "blokir") {
		t.Fatalf("banned booking error = %v", res)
	}
	e.call(nil, "POST", "/api/public/spa/bookings", map[string]any{"branch_id": branch, "scheduled_at": "2026-10-09T07:00:00.000Z", "customer_name": "Lain",
		"customer_phone": "0813 7777 8888", "variant_ids": []any{v45}}, http.StatusCreated)
	// Unban restores online booking.
	e.data(admin, "POST", "/api/spa/customer-directory/"+id+"/ban", map[string]any{"banned": false}, http.StatusOK)
	book("2026-10-09T09:00:00.000Z", http.StatusCreated)
}
