package spa_test

import (
	"net/http"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

// Revisi R3: when the guest picks no therapist, the booking goes to the
// therapist who clocked in first; each assignment moves that therapist to
// the back of the queue (fair rotation); therapists who have not clocked in
// never receive a booking.
func TestArrivalQueueAssignsInClockInOrderWithRotation(t *testing.T) {
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
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{"code": "QUE" + testutil.RandomHex(3), "name": "Massage",
		"variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, http.StatusCreated)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	mk := func(name, gender string) (therapistID, employeeID string) {
		employeeID = e.employee(name, nil)
		th := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": employeeID, "home_branch_id": branch, "gender": gender}, http.StatusCreated)
		return th["id"].(string), employeeID
	}
	ayuID, ayuEmp := mk("Ayu Antri", "female")
	beniID, beniEmp := mk("Beni Antri", "male")
	_, _ = mk("Cici Absen", "female") // eligible but never clocks in
	clockIn := func(employeeID string, at time.Time) {
		if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.attendance (employee_id, date, clock_in, status) VALUES ($1, $2::date, $3, 'present')`,
			employeeID, "2026-10-08", at); err != nil {
			t.Fatal(err)
		}
	}
	clockIn(beniEmp, time.Date(2026, 10, 8, 1, 30, 0, 0, time.UTC)) // 08:30 WIB — first in
	clockIn(ayuEmp, time.Date(2026, 10, 8, 1, 45, 0, 0, time.UTC))  // 08:45 WIB

	queue := e.data(admin, "GET", "/api/spa/arrival-queue?branch_id="+branch+"&date=2026-10-08", nil, http.StatusOK)
	q, _ := queue["queue"].([]any)
	absent, _ := queue["absent"].([]any)
	if len(q) != 2 || len(absent) != 1 || q[0].(map[string]any)["id"] != beniID || q[1].(map[string]any)["id"] != ayuID {
		t.Fatalf("queue = %v / absent = %v", q, absent)
	}

	book := func(name, pref string, at string) string {
		b := e.data(admin, "POST", "/api/spa/bookings", map[string]any{
			"branch_id": branch, "booking_type": "reservation", "customer_name": name, "therapist_gender_pref": pref,
			"scheduled_at": at, "items": []any{map[string]any{"variant_id": variant}},
		}, http.StatusCreated)
		return b["id"].(string)
	}
	b1 := book("Tamu 1", "any", "2026-10-08T03:00:00Z")
	b2 := book("Tamu 2", "any", "2026-10-08T03:00:00Z")
	b3 := book("Tamu 3", "any", "2026-10-08T05:00:00Z")
	b4 := book("Tamu 4", "female", "2026-10-08T07:00:00Z")

	res := e.data(admin, "POST", "/api/spa/auto-assign", map[string]any{"branch_id": branch, "date": "2026-10-08"}, http.StatusOK)
	assigned, _ := res["assigned"].([]any)
	got := map[string]string{}
	for _, a := range assigned {
		m := a.(map[string]any)
		got[m["booking_id"].(string)] = m["therapist_id"].(string)
	}
	// Beni arrived first → Tamu 1; Ayu → Tamu 2 (Beni busy at that hour anyway);
	// Tamu 3: Beni was assigned before Ayu, so Beni is next again; Tamu 4 wants a woman → Ayu.
	want := map[string]string{b1: beniID, b2: ayuID, b3: beniID, b4: ayuID}
	for id, therapist := range want {
		if got[id] != therapist {
			t.Fatalf("booking %s → %s, want %s (all: %v, skipped: %v)", id, got[id], therapist, got, res["skipped"])
		}
	}
	if skipped, _ := res["skipped"].([]any); len(skipped) != 0 {
		t.Fatalf("skipped = %v", skipped)
	}
	// Rotation is visible in the queue: Ayu (assigned last) is now at the back.
	queue = e.data(admin, "GET", "/api/spa/arrival-queue?branch_id="+branch+"&date=2026-10-08", nil, http.StatusOK)
	q, _ = queue["queue"].([]any)
	if q[0].(map[string]any)["id"] != beniID || q[0].(map[string]any)["assigned_today"] != float64(2) {
		t.Fatalf("queue after rotation = %v", q)
	}
	// Nothing left to assign; a male-only request with Beni busy is reported, not forced.
	book("Tamu 5", "male", "2026-10-08T05:00:00Z") // Beni already has Tamu 3 at 12:00 WIB
	res = e.data(admin, "POST", "/api/spa/auto-assign", map[string]any{"branch_id": branch, "date": "2026-10-08"}, http.StatusOK)
	if a, _ := res["assigned"].([]any); len(a) != 0 {
		t.Fatalf("unexpected assignment: %v", a)
	}
	if sk, _ := res["skipped"].([]any); len(sk) != 1 {
		t.Fatalf("skipped = %v", sk)
	}
}
