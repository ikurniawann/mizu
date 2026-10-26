package spa_test

import (
	"net/http"
	"os"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func TestOneTherapistPerBooking(t *testing.T) {
	e := setup(t)
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	e.call(&e.admin, "PUT", "/api/spa/outlets/"+e.org.BranchID, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true, "public_booking": true}, 200)
	tr := e.data(&e.admin, "POST", "/api/spa/treatments", map[string]any{"code": "ONE" + testutil.RandomHex(3), "name": "Massage", "variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, 201)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	therapist := func(name string) string {
		th := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.scheduledEmployee(name, nil), "home_branch_id": e.org.BranchID}, 201)
		return th["id"].(string)
	}
	a, b := therapist("First therapist"), therapist("Second therapist")
	makeBooking := func(at, who string, count int) map[string]any {
		treatments := []any{}
		for range count {
			treatments = append(treatments, map[string]any{"variant_id": variant})
		}
		return map[string]any{"branch_id": e.org.BranchID, "booking_type": "reservation", "customer_name": "Visit", "scheduled_at": at, "therapist_id": who, "items": treatments}
	}
	request := makeBooking("2026-10-08T03:00:00Z", a, 2)
	booking := e.data(&e.admin, "POST", "/api/spa/bookings", request, 201)
	id := booking["id"].(string)
	path := "/api/spa/bookings/" + id
	assertTherapist := func(booking map[string]any, expected any) {
		t.Helper()
		if booking["therapist_id"] != expected {
			t.Fatalf("header therapist = %v, want %v", booking["therapist_id"], expected)
		}
		for _, item := range items(booking) {
			if item["therapist_id"] != expected {
				t.Fatalf("treatment therapist = %v, want %v", item["therapist_id"], expected)
			}
		}
	}
	assertTherapist(booking, a)
	// Database clients cannot bypass the booking owner either.
	savepoint, err := e.tx.Begin(e.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := savepoint.Exec(e.ctx, `UPDATE spa.booking_items SET therapist_id=$2 WHERE booking_id=$1`, id, b); err == nil {
		t.Fatal("independent item assignment accepted")
	}
	if err := savepoint.Rollback(e.ctx); err != nil {
		t.Fatal(err)
	}
	e.call(&e.admin, "PUT", path+"/therapist", map[string]any{}, http.StatusBadRequest)
	if booking["scheduled_at"] != "2026-10-08T03:00:00.000Z" || booking["ends_at"] != "2026-10-08T05:00:00.000Z" {
		t.Fatalf("booking window must sum treatment durations: %v–%v", booking["scheduled_at"], booking["ends_at"])
	}
	if _, exists := items(booking)[0]["starts_at"]; exists {
		t.Fatal("treatment must not own a scheduled start")
	}

	// One board card covers both treatments and their entire time range.
	board := e.data(&e.admin, "GET", "/api/spa/board?branch_id="+e.org.BranchID+"&date=2026-10-08", nil, 200)
	cards := 0
	for _, raw := range board["therapists"].([]any) {
		for _, card := range raw.(map[string]any)["items"].([]any) {
			row := card.(map[string]any)
			if row["booking_id"] == id {
				cards++
				if row["treatment_count"] != float64(2) || row["duration_min"] != float64(120) {
					t.Fatalf("card = %v", row)
				}
			}
		}
	}
	if cards != 1 {
		t.Fatalf("got %d cards", cards)
	}

	booking = e.data(&e.admin, "PUT", path+"/therapist", map[string]any{"therapist_id": nil}, 200)
	assertTherapist(booking, nil)
	booking = e.data(&e.admin, "PUT", path+"/therapist", map[string]any{"therapist_id": b}, 200)
	assertTherapist(booking, b)
	// Old clients cannot independently reassign just one treatment.
	booking = e.data(&e.admin, "PATCH", path+"/items/"+items(booking)[0]["id"].(string), map[string]any{"action": "assign", "therapist_id": a}, 200)
	assertTherapist(booking, a)

	// B is free for the first treatment but busy during the second.
	e.data(&e.admin, "POST", "/api/spa/bookings", makeBooking("2026-10-08T04:30:00Z", b, 1), 201)
	e.call(&e.admin, "PUT", path+"/therapist", map[string]any{"therapist_id": b}, http.StatusConflict)
	assertTherapist(e.data(&e.admin, "GET", path, nil, 200), a)
	availability := e.list(&e.admin, "/api/spa/availability?branch_id="+e.org.BranchID+"&booking_id="+id+"&starts_at=2026-10-08T03:00:00Z&ends_at=2026-10-08T04:00:00Z")
	for _, raw := range availability {
		row := raw.(map[string]any)
		who := row["therapist"].(map[string]any)["id"]
		if (who == a && row["available"] != true) || (who == b && row["available"] != false) {
			t.Fatalf("availability = %v", row)
		}
	}

	// New treatments inherit A, and failed extensions leave no partial item.
	booking = e.data(&e.admin, "POST", path+"/items", map[string]any{"variant_id": variant}, 200)
	assertTherapist(booking, a)
	if len(items(booking)) != 3 {
		t.Fatal("missing added treatment")
	}
	if booking["ends_at"] != "2026-10-08T06:00:00.000Z" {
		t.Fatalf("added treatment did not extend booking: %v", booking["ends_at"])
	}
	e.data(&e.admin, "POST", "/api/spa/bookings", makeBooking("2026-10-08T06:30:00Z", a, 1), 201)
	e.call(&e.admin, "POST", path+"/items", map[string]any{"variant_id": variant}, http.StatusConflict)
	if got := e.data(&e.admin, "GET", path, nil, 200); len(items(got)) != 3 {
		t.Fatal("failed extension committed an item")
	}

	booking = e.data(&e.admin, "PATCH", path+"/items/"+items(booking)[2]["id"].(string), map[string]any{"action": "cancel"}, 200)
	if booking["ends_at"] != "2026-10-08T05:00:00.000Z" {
		t.Fatalf("removed treatment did not shorten booking: %v", booking["ends_at"])
	}
	booking = e.data(&e.admin, "PATCH", path, map[string]any{"scheduled_at": "2026-10-08T03:30:00Z"}, 200)
	if booking["scheduled_at"] != "2026-10-08T03:30:00.000Z" || booking["ends_at"] != "2026-10-08T05:30:00.000Z" {
		t.Fatalf("rescheduled booking window = %v–%v", booking["scheduled_at"], booking["ends_at"])
	}
	e.call(&e.admin, "PATCH", path, map[string]any{"scheduled_at": "2026-10-08T06:00:00Z"}, http.StatusConflict)
	if got := e.data(&e.admin, "GET", path, nil, 200); got["scheduled_at"] != booking["scheduled_at"] || got["ends_at"] != booking["ends_at"] {
		t.Fatalf("failed reschedule changed booking window: %v–%v", got["scheduled_at"], got["ends_at"])
	}

	firstID := items(booking)[0]["id"].(string)
	e.call(&e.admin, "PATCH", path+"/items/"+firstID, map[string]any{"action": "start"}, 200)
	e.call(&e.admin, "PATCH", path+"/items/"+items(booking)[1]["id"].(string), map[string]any{"action": "start"}, http.StatusConflict)
	e.call(&e.admin, "PUT", path+"/therapist", map[string]any{"therapist_id": nil}, http.StatusConflict)
	e.call(&e.admin, "PUT", path+"/therapist", map[string]any{"therapist_id": b}, http.StatusConflict)
	e.call(&e.admin, "PATCH", path+"/items/"+firstID, map[string]any{"action": "complete"}, 200)
	e.call(&e.admin, "PUT", path+"/therapist", map[string]any{"therapist_id": b}, http.StatusConflict)
	savepoint, err = e.tx.Begin(e.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := savepoint.Exec(e.ctx, `UPDATE spa.bookings SET therapist_id=$2 WHERE id=$1`, id, b); err == nil {
		t.Fatal("database allowed reassignment after completion")
	}
	if err := savepoint.Rollback(e.ctx); err != nil {
		t.Fatal(err)
	}

	mixed := makeBooking("2026-10-08T08:00:00Z", a, 1)
	mixed["items"] = []any{map[string]any{"variant_id": variant, "therapist_id": b}}
	e.call(&e.admin, "POST", "/api/spa/bookings", mixed, http.StatusBadRequest)

	// Public capacity must find the SAME therapist for the whole visit, not
	// one free person per treatment in otherwise fragmented availability.
	e.data(&e.admin, "POST", "/api/spa/bookings", makeBooking("2026-10-09T04:00:00Z", a, 1), 201)
	e.data(&e.admin, "POST", "/api/spa/bookings", makeBooking("2026-10-09T03:00:00Z", b, 1), 201)
	e.call(nil, "POST", "/api/public/spa/bookings", map[string]any{
		"branch_id": e.org.BranchID, "customer_name": "Public visit", "customer_phone": "081234567890",
		"scheduled_at": "2026-10-09T03:00:00Z", "variant_ids": []string{variant, variant},
	}, http.StatusConflict)

	e.call(&e.admin, "POST", path+"/checkout", map[string]any{"therapist_rating": 5}, http.StatusConflict)
	e.data(&e.admin, "PATCH", path+"/items/"+items(booking)[1]["id"].(string), map[string]any{"action": "complete"}, 200)
	e.call(&e.admin, "POST", path+"/checkout", map[string]any{}, http.StatusBadRequest)
	e.call(&e.admin, "POST", path+"/checkout", map[string]any{"therapist_rating": 0}, http.StatusBadRequest)
	checkedOut := e.data(&e.admin, "POST", path+"/checkout", map[string]any{"therapist_rating": 5}, 200)
	if checkedOut["booking"].(map[string]any)["therapist_rating"] != float64(5) {
		t.Fatalf("therapist rating not returned with booking: %v", checkedOut["booking"])
	}
	var storedRating int
	var ratedTherapist string
	if err := e.tx.QueryRow(e.ctx, `SELECT therapist_rating, therapist_id::text FROM spa.bookings WHERE id=$1`, id).Scan(&storedRating, &ratedTherapist); err != nil || storedRating != 5 || ratedTherapist != a {
		t.Fatalf("stored therapist rating = %d for %s, err=%v", storedRating, ratedTherapist, err)
	}
	e.data(&e.admin, "POST", path+"/checkout", map[string]any{}, 200)
	e.call(&e.admin, "POST", path+"/checkout", map[string]any{"therapist_rating": 2}, http.StatusConflict)

	// Simulate a legacy mixed assignment inside a savepoint. The migration
	// must refuse it before changing schema or choosing an arbitrary owner.
	savepoint, err = e.tx.Begin(e.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := savepoint.Exec(e.ctx, `ALTER TABLE spa.booking_items DISABLE TRIGGER spa_items_inherit_therapist`); err != nil {
		t.Fatal(err)
	}
	if _, err := savepoint.Exec(e.ctx, `UPDATE spa.bookings SET status='assigned' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := savepoint.Exec(e.ctx, `UPDATE spa.booking_items SET therapist_id=$2 WHERE id=$1`, firstID, b); err != nil {
		t.Fatal(err)
	}
	if _, err := savepoint.Exec(e.ctx, `ALTER TABLE spa.booking_items ENABLE TRIGGER spa_items_inherit_therapist`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../../database/migrations/deltas/20261011100000_spa_booking_therapist.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := savepoint.Exec(e.ctx, string(migration)); err == nil || !strings.Contains(err.Error(), "Resolve mixed/partial therapist assignments") {
		t.Fatalf("migration must reject mixed assignments: %v", err)
	}
	if err := savepoint.Rollback(e.ctx); err != nil {
		t.Fatal(err)
	}
}
