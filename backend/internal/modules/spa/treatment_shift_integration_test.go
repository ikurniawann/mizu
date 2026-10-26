package spa_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/platform/testutil"
)

// One therapist with a 09:00–16:00 shift and an otherwise empty outlet.
func treatmentShiftFixture(t *testing.T) (*env, string, string, map[int]string) {
	t.Helper()
	e := setup(t)
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	e.data(&e.admin, "PUT", "/api/spa/outlets/"+e.org.BranchID, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true, "public_booking": true}, 200)
	variants := []any{}
	for _, minutes := range []int{30, 60, 90, 91} {
		variants = append(variants, map[string]any{"name": fmt.Sprintf("%d menit", minutes), "duration_min": minutes, "price_idr": 200000})
	}
	tr := e.data(&e.admin, "POST", "/api/spa/treatments", map[string]any{"code": "EXT" + testutil.RandomHex(3), "name": "Massage", "variants": variants}, 201)
	ids := map[int]string{}
	for _, raw := range tr["variants"].([]any) {
		v := raw.(map[string]any)
		ids[int(v["duration_min"].(float64))] = v["id"].(string)
	}
	employee := e.employee("Extension therapist", nil)
	therapist := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": employee, "home_branch_id": e.org.BranchID, "gender": "female"}, 201)["id"].(string)
	var shift string
	if err := e.tx.QueryRow(e.ctx, `INSERT INTO hris.shifts(name,start_time,end_time) VALUES('Extension test','09:00','16:00') RETURNING id::text`).Scan(&shift); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.employee_shifts(employee_id,day_of_week,shift_id,effective_from) VALUES($1,4,$2,'2026-01-01')`, employee, shift); err != nil {
		t.Fatal(err)
	}
	return e, employee, therapist, ids
}

func TestBookingShiftExtension(t *testing.T) {
	e, _, therapist, variants := treatmentShiftFixture(t)
	for _, tc := range []struct {
		clock   string
		minutes []int
		want    int
	}{
		{"08:00", []int{60, 60}, 200}, // 15:00–17:00 WIB, sum of two treatments
		{"08:30", []int{90}, 200},
		{"08:30", []int{91}, 409},
		{"09:00", []int{30}, 409},
		{"09:30", []int{30}, 409},
	} {
		t.Run(fmt.Sprint(tc.clock, tc.minutes), func(t *testing.T) {
			e.t = t
			requests := []any{}
			for _, minutes := range tc.minutes {
				requests = append(requests, map[string]any{"variant_id": variants[minutes]})
			}
			b := e.data(&e.admin, "POST", "/api/spa/bookings", map[string]any{"branch_id": e.org.BranchID, "booking_type": "reservation", "customer_name": "Extension", "scheduled_at": "2026-10-08T" + tc.clock + ":00Z", "items": requests}, 201)
			path := "/api/spa/bookings/" + b["id"].(string)
			response := e.call(&e.admin, "PUT", path+"/therapist", map[string]any{"therapist_id": therapist}, tc.want)
			if tc.want == 409 {
				wantMessage := "selesai paling lambat 17:00 WIB"
				if tc.clock >= "09:00" {
					wantMessage = "dimulai sebelum 16:00 WIB"
				}
				if !strings.Contains(fmt.Sprint(response["error"]), wantMessage) {
					t.Fatalf("rejection must explain %q: %v", wantMessage, response)
				}
			}
			if tc.want == 200 {
				e.call(&e.admin, "POST", path+"/items", map[string]any{"variant_id": variants[30]}, 409)
				e.call(&e.admin, "PATCH", path, map[string]any{"scheduled_at": "2026-10-08T09:30:00Z"}, 409)
				got := e.data(&e.admin, "GET", path, nil, 200)
				if got["scheduled_at"] != "2026-10-08T"+tc.clock+":00.000Z" || len(items(got)) != len(tc.minutes) {
					t.Fatalf("failed update persisted: %v", got)
				}
			} else if got := e.data(&e.admin, "GET", path, nil, 200); got["therapist_id"] != nil {
				t.Fatal("rejected assignment persisted")
			}
			e.call(&e.admin, "POST", path+"/cancel", map[string]any{"reason": "Test cleanup"}, 200)
		})
	}
}

func TestPublicShiftExtension(t *testing.T) {
	e, _, therapist, variants := treatmentShiftFixture(t)
	for _, tc := range []struct {
		clock   string
		minutes int
		want    int
	}{
		{"08:30", 90, 1}, {"08:30", 91, 0}, {"09:00", 30, 0}, {"09:30", 30, 0},
	} {
		at := "2026-10-08T" + tc.clock + ":00Z"
		url := "/api/public/spa/outlets/" + e.org.BranchID + "/therapists?starts_at=" + at + "&variant_ids=" + variants[tc.minutes]
		if got := e.list(nil, url); len(got) != tc.want {
			t.Fatalf("%s %d min: therapists=%v", tc.clock, tc.minutes, got)
		}
		if tc.want == 0 {
			e.call(nil, "POST", "/api/public/spa/bookings", map[string]any{"branch_id": e.org.BranchID, "scheduled_at": at, "customer_name": "Public extension", "customer_phone": "081234567890", "variant_ids": []any{variants[tc.minutes]}, "payment_method": "outlet", "therapist_id": therapist}, http.StatusConflict)
		}
	}
	slots := e.list(nil, "/api/public/spa/outlets/"+e.org.BranchID+"/slots?date=2026-10-08&variant_ids="+variants[90])
	found := false
	for _, raw := range slots {
		slot := raw.(map[string]any)
		if slot["starts_at"] == "2026-10-08T08:30:00.000Z" {
			found = true
		}
		if slot["starts_at"] == "2026-10-08T09:00:00.000Z" {
			t.Fatalf("slot starts at shift end: %v", slot)
		}
	}
	if !found {
		t.Fatalf("15:30–17:00 slot missing: %v", slots)
	}
	// An unassigned booking reserves the sole available therapist too.
	e.data(nil, "POST", "/api/public/spa/bookings", map[string]any{"branch_id": e.org.BranchID, "scheduled_at": "2026-10-08T08:30:00Z", "customer_name": "Reserved", "customer_phone": "081234567891", "variant_ids": []any{variants[90]}, "payment_method": "outlet"}, 201)
	if got := e.list(nil, "/api/public/spa/outlets/"+e.org.BranchID+"/therapists?starts_at=2026-10-08T08:30:00Z&variant_ids="+variants[90]); len(got) != 0 {
		t.Fatalf("reserved capacity offered: %v", got)
	}
}

func TestArrivalQueueShiftExtension(t *testing.T) {
	e, employee, therapist, variants := treatmentShiftFixture(t)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.attendance(employee_id,date,clock_in,status) VALUES($1,'2026-10-08','2026-10-08T02:00:00Z','present')`, employee); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ hour, minute, want int }{{8, 30, 1}, {9, 0, 0}, {9, 30, 0}} {
		now := time.Date(2026, 10, 8, tc.hour, tc.minute, 0, 0, time.UTC)
		e.mux = testutil.Mux(spa.NewOn(testutil.Deps(t, func() time.Time { return now }), e.tx, app.SpaPorts()))
		q := e.data(&e.admin, "GET", "/api/spa/arrival-queue?branch_id="+e.org.BranchID+"&date=2026-10-08", nil, 200)
		if got := len(q["queue"].([]any)); got != tc.want {
			t.Fatalf("at %v: queue=%v", now, q)
		}
	}
	// At 15:30 the queue can assign treatment that finishes at 17:00.
	now := time.Date(2026, 10, 8, 8, 30, 0, 0, time.UTC)
	e.mux = testutil.Mux(spa.NewOn(testutil.Deps(t, func() time.Time { return now }), e.tx, app.SpaPorts()))
	b := e.data(&e.admin, "POST", "/api/spa/bookings", map[string]any{"branch_id": e.org.BranchID, "booking_type": "reservation", "customer_name": "Queue extension", "scheduled_at": "2026-10-08T08:30:00Z", "items": []any{map[string]any{"variant_id": variants[90]}}}, 201)
	path := "/api/spa/bookings/" + b["id"].(string)
	e.call(&e.admin, "POST", path+"/auto-assign", map[string]any{"therapist_id": therapist}, 200)
	now = now.Add(time.Hour)
	if got := e.data(&e.admin, "GET", path, nil, 200); got["therapist_id"] != therapist {
		t.Fatal("existing assignment removed after shift")
	}
	now = now.Add(-time.Hour)
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.attendance SET clock_out=$2 WHERE employee_id=$1 AND date='2026-10-08'`, employee, now); err != nil {
		t.Fatal(err)
	}
	q := e.data(&e.admin, "GET", "/api/spa/arrival-queue?branch_id="+e.org.BranchID+"&date=2026-10-08", nil, 200)
	if len(q["queue"].([]any)) != 0 {
		t.Fatal("clocked-out therapist remains eligible")
	}
}
