package spa_test

import (
	"net/http"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Revisi R5: therapists book their days off; HRD sets per outlet the minimum
// female/male therapists working each day and the weekly limit. Requests
// are approved first come, first served, or refused when they would break
// the quota; booked days off make the therapist unavailable.
func TestDayOffBookingRespectsGenderQuotaAndWeeklyLimit(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}
	e := setup(t)
	admin := &e.admin
	me := e.therapist
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	branch := e.org.BranchID
	e.data(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true, "public_booking": true}, http.StatusOK)
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{"code": "OFF" + testutil.RandomHex(3), "name": "Massage",
		"variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, http.StatusCreated)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	ayu := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.employee("Ayu Libur", &me.UserID), "home_branch_id": branch, "gender": "female"}, http.StatusCreated)
	cici := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.employee("Cici Libur", nil), "home_branch_id": branch, "gender": "female"}, http.StatusCreated)
	e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.employee("Beni Libur", nil), "home_branch_id": branch, "gender": "male"}, http.StatusCreated)
	ayuID := ayu["id"].(string)

	// HRD: at least one woman and one man every day, two days off a week.
	q := e.data(admin, "PUT", "/api/spa/day-off-quotas/"+branch, map[string]any{"min_female": 1, "min_male": 1, "max_per_week": 2}, http.StatusOK)
	if q["min_female"] != float64(1) || q["max_per_week"] != float64(2) {
		t.Fatalf("quota = %v", q)
	}
	book := func(date string, status int) map[string]any {
		return e.call(&me, "POST", "/api/spa/me/day-offs", map[string]any{"date": date}, status)
	}
	// Week of Mon 12 Oct 2026 (today is Thu 8 Oct).
	first := e.data(&me, "POST", "/api/spa/me/day-offs", map[string]any{"date": "2026-10-12"}, http.StatusCreated)
	if first["status"] != "approved" || first["therapist_id"] != ayuID {
		t.Fatalf("first day off = %v", first)
	}
	book("2026-10-12", http.StatusConflict) // already booked
	book("2026-10-08", http.StatusConflict) // today: too late
	// Cici is already off on the 13th: Ayu would leave no woman at work.
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.day_off_requests (therapist_id, branch_id, off_date) VALUES ($1, $2, '2026-10-13')`, cici["id"], branch); err != nil {
		t.Fatal(err)
	}
	res := book("2026-10-13", http.StatusConflict)
	if !strings.Contains(res["error"].(string), "Kuota terapis wanita") {
		t.Fatalf("quota refusal = %v", res)
	}
	second := e.data(&me, "POST", "/api/spa/me/day-offs", map[string]any{"date": "2026-10-14"}, http.StatusCreated)
	res = book("2026-10-15", http.StatusConflict)
	if !strings.Contains(res["error"].(string), "maksimal 2") {
		t.Fatalf("weekly limit refusal = %v", res)
	}
	// Cancelling frees the week's slot.
	e.data(&me, "POST", "/api/spa/me/day-offs/"+second["id"].(string)+"/cancel", nil, http.StatusOK)
	third := e.data(&me, "POST", "/api/spa/me/day-offs", map[string]any{"date": "2026-10-15"}, http.StatusCreated)

	// A day with a booking assigned to Ayu cannot be taken off.
	e.data(admin, "POST", "/api/spa/bookings", map[string]any{
		"branch_id": branch, "booking_type": "reservation", "customer_name": "Tamu Senin", "therapist_id": ayuID,
		"scheduled_at": "2026-10-20T03:00:00Z", "items": []any{map[string]any{"variant_id": variant}},
	}, http.StatusCreated)
	res = book("2026-10-20", http.StatusConflict)
	if !strings.Contains(res["error"].(string), "booking") {
		t.Fatalf("booking refusal = %v", res)
	}

	// The day off makes Ayu unavailable: the board marks it, assigning is refused for public slots.
	board := e.data(admin, "GET", "/api/spa/board?branch_id="+branch+"&date=2026-10-12", nil, http.StatusOK)
	found := false
	for _, x := range board["therapists"].([]any) {
		m := x.(map[string]any)
		if m["therapist"].(map[string]any)["id"] == ayuID {
			found = m["day_off"] == true
		}
	}
	if !found {
		t.Fatal("board must show Ayu's booked day off")
	}

	// Therapist month view: own day, the week already full, a quota refusal and what is still bookable.
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.day_off_requests (therapist_id, branch_id, off_date) VALUES ($1, $2, '2026-10-27')`, cici["id"], branch); err != nil {
		t.Fatal(err)
	}
	month := e.data(&me, "GET", "/api/spa/me/day-offs?month=2026-10", nil, http.StatusOK)
	days := map[string]map[string]any{}
	for _, x := range month["days"].([]any) {
		m := x.(map[string]any)
		days[m["date"].(string)] = m
	}
	if len(days) != 31 || days["2026-10-12"]["mine"] != "requested" || days["2026-10-13"]["can_book"] != false ||
		!strings.Contains(days["2026-10-13"]["reason"].(string), "maksimal") || days["2026-10-22"]["can_book"] != true ||
		days["2026-10-27"]["can_book"] != false || !strings.Contains(days["2026-10-27"]["reason"].(string), "wanita") {
		t.Fatalf("month view: 12=%v 13=%v 22=%v 27=%v", days["2026-10-12"], days["2026-10-13"], days["2026-10-22"], days["2026-10-27"])
	}
	// HRD view lists every request (cancelled included) and can withdraw one.
	hrd := e.data(admin, "GET", "/api/spa/day-offs?branch_id="+branch+"&month=2026-10", nil, http.StatusOK)
	if reqs := hrd["requests"].([]any); len(reqs) != 5 {
		t.Fatalf("HRD requests = %d", len(reqs))
	}
	withdrawn := e.data(admin, "POST", "/api/spa/day-offs/"+third["id"].(string)+"/cancel", map[string]any{"reason": "Tamu ramai"}, http.StatusOK)
	if withdrawn["status"] != "cancelled" || withdrawn["cancel_reason"] != "Tamu ramai" {
		t.Fatalf("HRD cancel = %v", withdrawn)
	}
}
