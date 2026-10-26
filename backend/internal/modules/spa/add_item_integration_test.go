package spa_test

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Revisi R4: treatments can be added while a booking runs or after it
// finished (until it is paid / sent to the cashier), by staff or by the
// booking's own therapist.
func TestAddTreatmentDuringAndAfterSession(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}
	e := setup(t)
	admin := &e.admin
	therapistUser := e.therapist
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	branch := e.org.BranchID
	e.data(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true, "public_booking": true}, http.StatusOK)
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{"code": "ADD" + testutil.RandomHex(3), "name": "Massage",
		"variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, http.StatusCreated)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	mine := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.scheduledEmployee("Terapis Tambah", &therapistUser.UserID), "home_branch_id": branch}, http.StatusCreated)
	other := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.scheduledEmployee("Terapis Lain", nil), "home_branch_id": branch}, http.StatusCreated)

	booking := e.data(admin, "POST", "/api/spa/bookings", map[string]any{
		"branch_id": branch, "booking_type": "walk_in", "customer_name": "Tamu Tambah", "therapist_id": mine["id"],
		"scheduled_at": "2026-10-08T03:00:00Z", "items": []any{map[string]any{"variant_id": variant}},
	}, http.StatusCreated)
	id := booking["id"].(string)
	path := "/api/spa/bookings/" + id

	// While the treatment runs, staff may add one: it follows the therapist, starts after the running one.
	started := e.data(admin, "POST", path+"/status", map[string]any{"action": "start"}, http.StatusOK)
	if started["status"] != "in_treatment" {
		t.Fatalf("status after start = %v", started["status"])
	}
	added := e.data(admin, "POST", path+"/items", map[string]any{"variant_id": variant}, http.StatusOK)
	if added["status"] != "in_treatment" || len(items(added)) != 2 || items(added)[1]["status"] != "assigned" {
		t.Fatalf("after staff add during session: status=%v items=%v", added["status"], items(added))
	}
	// The booking's therapist can add from the therapist app; another therapist cannot see it.
	catalog := e.list(&therapistUser, "/api/spa/me/catalog?branch_id="+branch)
	if len(catalog) == 0 {
		t.Fatal("therapist catalog is empty")
	}
	item := e.data(&therapistUser, "POST", "/api/spa/me/bookings/"+id+"/items", map[string]any{"variant_id": variant}, http.StatusOK)
	if item["booking_id"] != id || item["status"] != "assigned" || item["therapist_id"] != mine["id"] {
		t.Fatalf("therapist-added item = %v", item)
	}
	_ = other
	detail := e.data(admin, "GET", path, nil, http.StatusOK)
	if len(items(detail)) != 3 {
		t.Fatalf("items after both adds = %d", len(items(detail)))
	}
	// After every treatment finished (still unpaid) another one can be added; it reopens the booking.
	completed := e.data(admin, "POST", path+"/status", map[string]any{"action": "complete"}, http.StatusOK)
	if completed["status"] != "completed" {
		t.Fatalf("status after complete = %v", completed["status"])
	}
	reopened := e.data(admin, "POST", path+"/items", map[string]any{"variant_id": variant}, http.StatusOK)
	if reopened["status"] != "assigned" || len(items(reopened)) != 4 {
		t.Fatalf("after add post-session: status=%v items=%d", reopened["status"], len(items(reopened)))
	}
	// The new treatment runs like any other: start, then complete (finished ones are left alone).
	restarted := e.data(admin, "POST", path+"/status", map[string]any{"action": "start"}, http.StatusOK)
	if restarted["status"] != "in_treatment" {
		t.Fatalf("status after starting the added treatment = %v", restarted["status"])
	}
	e.data(admin, "POST", path+"/status", map[string]any{"action": "complete"}, http.StatusOK)
	// Sent to the cashier: no more additions.
	e.data(admin, "POST", path+"/checkout", map[string]any{"therapist_rating": 5}, http.StatusOK)
	e.call(admin, "POST", path+"/items", map[string]any{"variant_id": variant}, http.StatusConflict)
	e.call(&therapistUser, "POST", "/api/spa/me/bookings/"+id+"/items", map[string]any{"variant_id": variant}, http.StatusConflict)
}

// A therapist cannot add to someone else's booking.
func TestTherapistCannotAddToOthersBooking(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}
	e := setup(t)
	admin := &e.admin
	therapistUser := e.therapist
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	branch := e.org.BranchID
	e.data(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true, "public_booking": true}, http.StatusOK)
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{"code": "OTH" + testutil.RandomHex(3), "name": "Massage",
		"variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, http.StatusCreated)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.scheduledEmployee("Terapis Saya", &therapistUser.UserID), "home_branch_id": branch}, http.StatusCreated)
	other := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.scheduledEmployee("Terapis Lain", nil), "home_branch_id": branch}, http.StatusCreated)
	booking := e.data(admin, "POST", "/api/spa/bookings", map[string]any{
		"branch_id": branch, "booking_type": "walk_in", "customer_name": "Tamu Lain", "therapist_id": other["id"],
		"scheduled_at": "2026-10-08T03:00:00Z", "items": []any{map[string]any{"variant_id": variant}},
	}, http.StatusCreated)
	e.call(&therapistUser, "POST", "/api/spa/me/bookings/"+booking["id"].(string)+"/items", map[string]any{"variant_id": variant}, http.StatusNotFound)
}
