package spa_test

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func TestBookingAssignmentRejectsShiftAndGenderMismatch(t *testing.T) {
	e := setup(t)
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	e.call(&e.admin, "PUT", "/api/spa/outlets/"+e.org.BranchID, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true, "public_booking": true}, 200)
	tr := e.data(&e.admin, "POST", "/api/spa/treatments", map[string]any{"code": "SHIFT" + testutil.RandomHex(3), "name": "Massage", "variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, 201)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	employeeID := e.employee("Shift therapist", nil)
	therapist := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": employeeID, "home_branch_id": e.org.BranchID, "gender": "female"}, 201)
	therapistID := therapist["id"].(string)
	var shiftID string
	if err := e.tx.QueryRow(e.ctx, `INSERT INTO hris.shifts (name, start_time, end_time) VALUES ('Shift booking', '13:00', '17:00') RETURNING id::text`).Scan(&shiftID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.employee_shifts (employee_id, day_of_week, shift_id, effective_from) VALUES ($1, 4, $2, '2026-01-01')`, employeeID, shiftID); err != nil {
		t.Fatal(err)
	}
	booking := e.data(&e.admin, "POST", "/api/spa/bookings", map[string]any{
		"branch_id": e.org.BranchID, "booking_type": "reservation", "customer_name": "Shift visit",
		"scheduled_at": "2026-10-08T03:00:00Z", // 10:00 WIB
		"items":        []any{map[string]any{"variant_id": variant}, map[string]any{"variant_id": variant}},
	}, 201)
	path := "/api/spa/bookings/" + booking["id"].(string)
	assign := map[string]any{"therapist_id": therapistID}
	e.call(&e.admin, "PUT", path+"/therapist", assign, http.StatusConflict)
	if got := e.data(&e.admin, "GET", path, nil, 200); got["therapist_id"] != nil {
		t.Fatalf("failed assignment changed therapist: %v", got["therapist_id"])
	}
	e.data(&e.admin, "PATCH", path, map[string]any{"scheduled_at": "2026-10-08T06:00:00Z"}, 200) // 13:00–15:00 WIB
	e.data(&e.admin, "PUT", path+"/therapist", assign, 200)
	e.data(&e.admin, "PATCH", path, map[string]any{"scheduled_at": "2026-10-08T09:00:00Z"}, 200) // 16:00–18:00 WIB: finishes at shift +1h
	e.call(&e.admin, "PATCH", path, map[string]any{"scheduled_at": "2026-10-08T09:30:00Z"}, http.StatusConflict) // 16:30–18:30 WIB
	if got := e.data(&e.admin, "GET", path, nil, 200); got["scheduled_at"] != "2026-10-08T09:00:00.000Z" {
		t.Fatalf("failed reschedule changed booking: %v", got["scheduled_at"])
	}
	e.data(&e.admin, "PUT", path+"/therapist", map[string]any{"therapist_id": nil}, 200)
	e.data(&e.admin, "PATCH", path, map[string]any{"therapist_gender_pref": "male"}, 200)
	e.call(&e.admin, "PUT", path+"/therapist", assign, http.StatusConflict)
	if got := e.data(&e.admin, "GET", path, nil, 200); got["therapist_id"] != nil {
		t.Fatalf("gender mismatch changed therapist: %v", got["therapist_id"])
	}
	e.data(&e.admin, "PATCH", path, map[string]any{"therapist_gender_pref": "female"}, 200)
	e.data(&e.admin, "PUT", path+"/therapist", assign, 200)
	e.call(&e.admin, "PATCH", path, map[string]any{"therapist_gender_pref": "male"}, http.StatusConflict)
	if got := e.data(&e.admin, "GET", path, nil, 200); got["therapist_gender_pref"] != "female" {
		t.Fatalf("failed preference change persisted: %v", got["therapist_gender_pref"])
	}
}
