package spa_test

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Revisi R6/R9: rooms with a price per outlet; a booking holds one room for
// its window, the price is billed at checkout, and the room board reports
// each room's state with the running treatment.
func TestRoomsHoldBookingsAndShowOnBoard(t *testing.T) {
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
	e.data(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true, "public_booking": true}, http.StatusOK)
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{"code": "ROOM" + testutil.RandomHex(3), "name": "Massage",
		"variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, http.StatusCreated)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	therapist := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.employee("Terapis Room", nil), "home_branch_id": branch}, http.StatusCreated)

	// Master rooms: name unique per outlet, price per room.
	vip := e.data(admin, "POST", "/api/spa/rooms", map[string]any{"branch_id": branch, "name": "VIP 1", "capacity": 2, "price_idr": 50000}, http.StatusCreated)
	e.data(admin, "POST", "/api/spa/rooms", map[string]any{"branch_id": branch, "name": "Reguler 1", "price_idr": 0}, http.StatusCreated)
	e.call(admin, "POST", "/api/spa/rooms", map[string]any{"branch_id": branch, "name": "VIP 1"}, http.StatusConflict)
	e.call(admin, "POST", "/api/spa/rooms", map[string]any{"branch_id": branch, "name": "  "}, http.StatusBadRequest)
	vipID := vip["id"].(string)
	e.data(admin, "PUT", "/api/spa/rooms/"+vipID, map[string]any{"name": "VIP 1", "capacity": 2, "price_idr": 75000, "is_active": true}, http.StatusOK)
	rooms := e.list(admin, "/api/spa/rooms?branch_id="+branch)
	if len(rooms) != 2 {
		t.Fatalf("rooms = %v", rooms)
	}

	// A booking takes the room at creation; the total includes the room price.
	booking := e.data(admin, "POST", "/api/spa/bookings", map[string]any{
		"branch_id": branch, "booking_type": "walk_in", "customer_name": "Tamu VIP", "therapist_id": therapist["id"], "room_id": vipID,
		"scheduled_at": "2026-10-08T03:00:00Z", "items": []any{map[string]any{"variant_id": variant}},
	}, http.StatusCreated)
	if booking["room_name"] != "VIP 1" || booking["room_price_idr"] != float64(75000) || booking["total_idr"] != float64(275000) {
		t.Fatalf("booking with room = room %v price %v total %v", booking["room_name"], booking["room_price_idr"], booking["total_idr"])
	}
	id := booking["id"].(string)
	// The same room cannot be double-booked in an overlapping window, but is free afterwards.
	e.call(admin, "POST", "/api/spa/bookings", map[string]any{
		"branch_id": branch, "booking_type": "walk_in", "customer_name": "Tamu Lain", "room_id": vipID,
		"scheduled_at": "2026-10-08T03:30:00Z", "items": []any{map[string]any{"variant_id": variant}},
	}, http.StatusConflict)
	later := e.data(admin, "POST", "/api/spa/bookings", map[string]any{
		"branch_id": branch, "booking_type": "walk_in", "customer_name": "Tamu Sore", "room_id": vipID,
		"scheduled_at": "2026-10-08T05:00:00Z", "items": []any{map[string]any{"variant_id": variant}},
	}, http.StatusCreated)
	// Moving the later booking onto the first one's window is refused because of the room.
	e.call(admin, "PATCH", "/api/spa/bookings/"+later["id"].(string), map[string]any{"scheduled_at": "2026-10-08T03:30:00Z"}, http.StatusConflict)
	// Release and re-assign from the booking page.
	released := e.data(admin, "PUT", "/api/spa/bookings/"+id+"/room", map[string]any{"room_id": nil}, http.StatusOK)
	if released["room_id"] != nil || released["total_idr"] != float64(200000) {
		t.Fatalf("released = %v / %v", released["room_id"], released["total_idr"])
	}
	e.data(admin, "PUT", "/api/spa/bookings/"+id+"/room", map[string]any{"room_id": vipID}, http.StatusOK)

	// Room board: the started booking occupies the room with its timer data.
	e.data(admin, "POST", "/api/spa/bookings/"+id+"/status", map[string]any{"action": "start"}, http.StatusOK)
	board := e.data(admin, "GET", "/api/spa/room-board?branch_id="+branch, nil, http.StatusOK)
	entries, _ := board["rooms"].([]any)
	if len(entries) != 2 {
		t.Fatalf("board rooms = %v", board["rooms"])
	}
	var vipEntry map[string]any
	for _, x := range entries {
		m := x.(map[string]any)
		if m["id"] == vipID {
			vipEntry = m
		}
	}
	if vipEntry["state"] != "occupied" {
		t.Fatalf("VIP state = %v (%v)", vipEntry["state"], vipEntry)
	}
	cur, _ := vipEntry["current"].(map[string]any)
	if cur["booking_id"] != id || cur["started_at"] == nil || cur["duration_min"] != float64(60) || cur["therapist_name"] != "Terapis Room" {
		t.Fatalf("occupant = %v", cur)
	}
	if nxt, _ := vipEntry["next"].(map[string]any); nxt["booking_id"] != later["id"] {
		t.Fatalf("next occupant = %v", vipEntry["next"])
	}
	// Checkout bills the room as its own POS line.
	e.data(admin, "POST", "/api/spa/bookings/"+id+"/status", map[string]any{"action": "complete"}, http.StatusOK)
	co := e.data(admin, "POST", "/api/spa/bookings/"+id+"/checkout", map[string]any{"therapist_rating": 5}, http.StatusOK)
	var lines int
	var total float64
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*), COALESCE(sum(oi.unit_price * oi.quantity), 0)::float8 FROM pos.pos_order_items oi WHERE oi.order_id = $1`, co["order_id"]).Scan(&lines, &total); err != nil {
		t.Fatal(err)
	}
	if lines != 2 || total != 275000 {
		t.Fatalf("POS lines = %d, total = %v", lines, total)
	}
	// After checkout the room can no longer change.
	e.call(admin, "PUT", "/api/spa/bookings/"+id+"/room", map[string]any{"room_id": nil}, http.StatusConflict)
}
