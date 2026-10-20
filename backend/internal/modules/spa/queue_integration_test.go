package spa_test

import (
	"net/http"
	"strings"
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

func TestAutoAssignSingleBooking(t *testing.T) {
	e := setup(t)
	admin := &e.admin
	branch := e.org.BranchID
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 LIMIT 1`, branch).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	e.data(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true}, http.StatusOK)
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{"code": "SNG" + testutil.RandomHex(3), "name": "Massage",
		"variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, http.StatusCreated)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	mk := func(name, gender string, at *time.Time) string {
		emp := e.employee(name, nil)
		th := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": branch, "gender": gender}, http.StatusCreated)
		if at != nil {
			if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.attendance (employee_id, date, clock_in, status) VALUES ($1, '2026-10-08', $2, 'present')`, emp, *at); err != nil {
				t.Fatal(err)
			}
		}
		return th["id"].(string)
	}
	early := time.Date(2026, 10, 8, 1, 30, 0, 0, time.UTC)
	late := early.Add(15 * time.Minute)
	first := mk("A First", "male", &early)
	second := mk("B Second", "female", &late)
	_ = mk("C Absent", "female", nil)
	book := func(name, pref, at string) string {
		b := e.data(admin, "POST", "/api/spa/bookings", map[string]any{
			"branch_id": branch, "booking_type": "reservation", "customer_name": name, "therapist_gender_pref": pref,
			"scheduled_at": at, "items": []any{map[string]any{"variant_id": variant}},
		}, http.StatusCreated)
		return b["id"].(string)
	}
	b1 := book("Tamu 1", "any", "2026-10-08T03:00:00Z")
	b2 := book("Tamu 2", "any", "2026-10-08T05:00:00Z")
	wrong := e.call(admin, "POST", "/api/spa/bookings/"+b1+"/auto-assign", map[string]any{"therapist_id": second}, http.StatusConflict)
	if msg, _ := wrong["error"].(string); !strings.Contains(msg, "A First") {
		t.Fatalf("wrong-target rejection must name priority therapist: %v", wrong)
	}
	still := e.data(admin, "GET", "/api/spa/bookings/"+b1, nil, http.StatusOK)
	if still["therapist_id"] != nil {
		t.Fatalf("wrong-target drop changed booking: %v", still["therapist_id"])
	}
	e.call(admin, "POST", "/api/spa/bookings/"+b1+"/auto-assign", nil, http.StatusBadRequest)
	assigned := e.data(admin, "POST", "/api/spa/bookings/"+b1+"/auto-assign", map[string]any{"therapist_id": first}, http.StatusOK)
	if assigned["therapist_id"] != first {
		t.Fatalf("first single assignment = %v, want %s", assigned, first)
	}
	other := e.data(admin, "GET", "/api/spa/bookings/"+b2, nil, http.StatusOK)
	if other["therapist_id"] != nil {
		t.Fatalf("single assignment changed other booking: %v", other["therapist_id"])
	}
	e.call(admin, "POST", "/api/spa/bookings/"+b1+"/auto-assign", map[string]any{"therapist_id": first}, http.StatusConflict)
	busyFirst := book("Tamu Prioritas Berikutnya", "any", "2026-10-08T03:00:00Z")
	assigned = e.data(admin, "POST", "/api/spa/bookings/"+busyFirst+"/auto-assign", map[string]any{"therapist_id": second}, http.StatusOK)
	if assigned["therapist_id"] != second {
		t.Fatalf("busy first therapist should allow next eligible therapist: %v", assigned)
	}
	b3 := book("Tamu Manual", "any", "2026-10-08T07:00:00Z")
	e.data(admin, "PUT", "/api/spa/bookings/"+b3+"/therapist", map[string]any{"therapist_id": second}, http.StatusOK)
	assigned = e.data(admin, "POST", "/api/spa/bookings/"+b2+"/auto-assign", map[string]any{"therapist_id": first}, http.StatusOK)
	if assigned["therapist_id"] != first {
		t.Fatalf("after manual assignment, picked %v, want %s", assigned["therapist_id"], first)
	}
	noMatch := book("Tamu Tanpa Kandidat", "female", "2026-10-08T07:00:00Z")
	e.call(admin, "POST", "/api/spa/bookings/"+noMatch+"/auto-assign", map[string]any{"therapist_id": second}, http.StatusConflict)
	still = e.data(admin, "GET", "/api/spa/bookings/"+noMatch, nil, http.StatusOK)
	if still["therapist_id"] != nil {
		t.Fatalf("booking without free candidate was assigned: %v", still["therapist_id"])
	}
	noCheckIn := book("Tamu Besok", "any", "2026-10-09T03:00:00Z")
	e.call(admin, "POST", "/api/spa/bookings/"+noCheckIn+"/auto-assign", map[string]any{"therapist_id": first}, http.StatusConflict)
	still = e.data(admin, "GET", "/api/spa/bookings/"+noCheckIn, nil, http.StatusOK)
	if still["therapist_id"] != nil {
		t.Fatalf("booking without checked-in therapist was assigned: %v", still["therapist_id"])
	}
}
