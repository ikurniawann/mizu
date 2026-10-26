package spa_test

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func TestStaffBookingGroupCreatesSeparateVisitsAndOnePOSBill(t *testing.T) {
	e := setup(t)
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	e.call(&e.admin, "PUT", "/api/spa/outlets/"+e.org.BranchID, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true, "public_booking": true}, 200)
	tr := e.data(&e.admin, "POST", "/api/spa/treatments", map[string]any{"code": "GROUP" + testutil.RandomHex(3), "name": "Massage grup", "variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, 201)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	therapists := []string{}
	for _, name := range []string{"Terapis grup A", "Terapis grup B"} {
		th := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.scheduledEmployee(name, nil), "home_branch_id": e.org.BranchID}, 201)
		therapists = append(therapists, th["id"].(string))
	}
	member := func(name, therapist string) map[string]any {
		return map[string]any{
			"branch_id": e.org.BranchID, "booking_type": "reservation", "customer_name": name,
			"scheduled_at": "2026-10-08T03:00:00Z", "therapist_id": therapist,
			"items": []any{map[string]any{"variant_id": variant}},
		}
	}
	path := "/api/spa/booking-groups"
	e.call(&e.admin, "POST", path, map[string]any{"branch_id": e.org.BranchID, "payer_name": "Ayu", "payer_phone": "081234567890",
		"bookings": []any{member("Ayu", therapists[0]), member("Budi", therapists[0])}}, http.StatusConflict)
	var count int
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*) FROM spa.booking_groups`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("failed group was not rolled back: %d, %v", count, err)
	}
	group := e.data(&e.admin, "POST", path, map[string]any{"branch_id": e.org.BranchID, "payer_name": "Ayu", "payer_phone": "081234567890",
		"bookings": []any{member("Ayu", therapists[0]), member("Budi", therapists[1])}}, 201)
	id := group["id"].(string)
	bookings := group["bookings"].([]any)
	if len(bookings) != 2 {
		t.Fatalf("group = %v", group)
	}
	ratings := []any{}
	for i, raw := range bookings {
		b := raw.(map[string]any)
		bookingID := b["id"].(string)
		if b["group_id"] != id || b["therapist_id"] != therapists[i] {
			t.Fatalf("member %d = %v", i, b)
		}
		memberPath := "/api/spa/bookings/" + bookingID
		e.call(&e.admin, "POST", memberPath+"/checkout", map[string]any{"therapist_rating": 5}, http.StatusConflict)
		e.data(&e.admin, "POST", memberPath+"/status", map[string]any{"action": "start"}, 200)
		if i == 0 {
			e.call(&e.admin, "POST", path+"/"+id+"/checkout", map[string]any{"ratings": []any{}}, http.StatusConflict)
		}
		e.data(&e.admin, "POST", memberPath+"/status", map[string]any{"action": "complete"}, 200)
		ratings = append(ratings, map[string]any{"booking_id": bookingID, "therapist_rating": i + 4})
	}
	e.call(&e.admin, "POST", path+"/"+id+"/checkout", map[string]any{"ratings": ratings[:1]}, http.StatusBadRequest)
	co := e.data(&e.admin, "POST", path+"/"+id+"/checkout", map[string]any{"ratings": ratings}, 200)
	orderID := co["order_id"].(string)
	if orderID == "" {
		t.Fatalf("checkout = %v", co)
	}
	var total float64
	var lines int
	if err := e.tx.QueryRow(e.ctx, `SELECT total_amount::float8, (SELECT count(*) FROM pos.pos_order_items WHERE order_id = o.id) FROM pos.pos_orders o WHERE id = $1`, orderID).Scan(&total, &lines); err != nil {
		t.Fatal(err)
	}
	if total != 400000 || lines != 2 {
		t.Fatalf("POS total %.0f, lines %d", total, lines)
	}
	for i, raw := range bookings {
		b := e.data(&e.admin, "GET", "/api/spa/bookings/"+raw.(map[string]any)["id"].(string), nil, 200)
		if b["pos_order_id"] != orderID || b["therapist_rating"] != float64(i+4) {
			t.Fatalf("member payment = %v", b)
		}
	}
	again := e.data(&e.admin, "POST", path+"/"+id+"/checkout", map[string]any{"ratings": []any{}}, 200)
	if again["order_id"] != orderID {
		t.Fatalf("duplicate POS bill: %v", again)
	}
	if _, err := e.tx.Exec(e.ctx, `UPDATE pos.pos_orders SET payment_status = 'paid', status = 'completed' WHERE id = $1`, orderID); err != nil {
		t.Fatal(err)
	}
	settled := e.data(&e.admin, "GET", path+"/"+id, nil, 200)
	for _, raw := range settled["bookings"].([]any) {
		if raw.(map[string]any)["payment_status"] != "paid" {
			t.Fatalf("group did not refresh payment: %v", settled)
		}
	}
	for _, raw := range bookings {
		b := e.data(&e.admin, "GET", "/api/spa/bookings/"+raw.(map[string]any)["id"].(string), nil, 200)
		if b["payment_status"] != "paid" {
			t.Fatalf("shared POS payment did not settle member: %v", b)
		}
	}
}
