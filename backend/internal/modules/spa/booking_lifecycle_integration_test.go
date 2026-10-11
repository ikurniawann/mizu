package spa_test

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func TestBookingLifecycleChangesAllTreatmentsTogether(t *testing.T) {
	e := setup(t)
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	e.call(&e.admin, "PUT", "/api/spa/outlets/"+e.org.BranchID, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true, "public_booking": true}, 200)
	tr := e.data(&e.admin, "POST", "/api/spa/treatments", map[string]any{"code": "LIFE" + testutil.RandomHex(3), "name": "Massage", "variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, 201)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	therapist := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.employee("Lifecycle therapist", nil), "home_branch_id": e.org.BranchID}, 201)
	booking := e.data(&e.admin, "POST", "/api/spa/bookings", map[string]any{
		"branch_id": e.org.BranchID, "booking_type": "reservation", "customer_name": "Lifecycle visit",
		"scheduled_at": "2026-10-08T03:00:00Z", "items": []any{map[string]any{"variant_id": variant}, map[string]any{"variant_id": variant}},
	}, 201)
	path := "/api/spa/bookings/" + booking["id"].(string)
	e.call(&e.admin, "POST", path+"/status", map[string]any{"action": "start"}, http.StatusConflict)
	e.data(&e.admin, "PUT", path+"/therapist", map[string]any{"therapist_id": therapist["id"]}, 200)
	e.call(&e.admin, "POST", path+"/status", map[string]any{"action": "complete"}, http.StatusConflict)
	started := e.data(&e.admin, "POST", path+"/status", map[string]any{"action": "start"}, 200)
	if started["status"] != "in_treatment" {
		t.Fatalf("booking status after start = %v", started["status"])
	}
	for _, item := range items(started) {
		if item["status"] != "in_treatment" || item["started_at"] == nil {
			t.Fatalf("treatment not started with booking: %v", item)
		}
	}
	e.call(&e.admin, "POST", path+"/status", map[string]any{"action": "start"}, http.StatusConflict)
	e.call(&e.admin, "PATCH", path, map[string]any{"scheduled_at": "2026-10-08T04:00:00Z"}, http.StatusConflict)
	e.call(&e.admin, "POST", path+"/cancel", map[string]any{"reason": "coba"}, http.StatusConflict)
	e.call(&e.admin, "POST", path+"/items", map[string]any{"variant_id": variant}, http.StatusConflict)
	e.call(&e.admin, "PATCH", path+"/items/"+items(started)[0]["id"].(string), map[string]any{"action": "cancel"}, http.StatusConflict)
	completed := e.data(&e.admin, "POST", path+"/status", map[string]any{"action": "complete"}, 200)
	if completed["status"] != "completed" {
		t.Fatalf("booking status after complete = %v", completed["status"])
	}
	for _, item := range items(completed) {
		if item["status"] != "completed" || item["completed_at"] == nil {
			t.Fatalf("treatment not completed with booking: %v", item)
		}
	}
	e.call(&e.admin, "POST", path+"/status", map[string]any{"action": "complete"}, http.StatusConflict)
}
