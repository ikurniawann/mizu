package spa_test

import (
	"fmt"
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func TestSpaReportsAggregationAndWIB(t *testing.T) {
	e := setup(t)
	branch := e.org.BranchID
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 ORDER BY is_default DESC LIMIT 1`, branch).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	treatment := e.data(&e.admin, "POST", "/api/spa/treatments", map[string]any{
		"code": "REPORT" + testutil.RandomHex(3), "name": "Report test",
		"variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 100}},
	}, http.StatusCreated)
	variant := treatment["variants"].([]any)[0].(map[string]any)["id"].(string)
	var first string
	for i, row := range [][2]string{
		{"2031-01-14T17:00:00Z", "completed"}, // Jan 15 midnight WIB (included).
		{"2031-01-15T02:20:00Z", "assigned"},
		{"2031-01-17T02:00:00Z", "in_treatment"},
		{"2031-01-16T17:00:00Z", "unassigned"},
		{"2031-01-15T02:00:00Z", "cancelled"},
		{"2031-01-15T02:00:00Z", "expired"},
		{"2031-01-14T16:59:59Z", "completed"}, // Before from in WIB.
		{"2031-01-17T17:00:00Z", "completed"}, // Day after to in WIB.
	} {
		var id string
		err := e.tx.QueryRow(e.ctx, `INSERT INTO spa.bookings
   (booking_code, company_id, branch_id, warehouse_id, booking_type, customer_name, scheduled_at, ends_at, status, payment_status)
   VALUES ($1,$2,$3,$4,'reservation','Report fixture',$5,$5::timestamptz + interval '60 minutes',$6,$7) RETURNING id::text`,
			fmt.Sprintf("REPORT-%s-%d", testutil.RandomHex(4), i), e.org.CompanyID, branch, warehouse, row[0], row[1], []string{"paid", "unpaid"}[i%2]).Scan(&id)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = id
		}
	}
	// Two treatments still count as one booking, at the booking header's hour.
	for i := 0; i < 2; i++ {
		if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.booking_items
   (booking_id,variant_id,treatment_name,variant_name,duration_min,price_idr)
   VALUES ($1,$2,'Report test','60 menit',60,100)`, first, variant); err != nil {
			t.Fatal(err)
		}
	}
	query := "?from=2031-01-15&to=2031-01-17&branch_id=" + branch
	rush := e.data(&e.admin, "GET", "/api/spa/reports/rush-hour"+query, nil, 200)
	if rush["total_bookings"] != float64(4) || rush["peak_bookings"] != float64(2) {
		t.Fatalf("rush = %v", rush)
	}
	hours := rush["hourly"].([]any)
	peaks := rush["peak_hours"].([]any)
	if len(hours) != 24 || len(peaks) != 2 || peaks[0] != float64(0) || peaks[1] != float64(9) {
		t.Fatalf("hours/peaks = %v", rush)
	}
	if hours[0].(map[string]any)["bookings"] != float64(2) || hours[9].(map[string]any)["bookings"] != float64(2) {
		t.Fatalf("WIB buckets = %v", hours)
	}
	for _, interval := range []string{"daily", "monthly", "yearly"} {
		trend := e.data(&e.admin, "GET", "/api/spa/reports/trend"+query+"&interval="+interval, nil, 200)
		if trend["total_bookings"] != rush["total_bookings"] {
			t.Fatalf("%s total = %v", interval, trend)
		}
		periods := trend["periods"].([]any)
		if interval == "daily" && (len(periods) != 3 || periods[1].(map[string]any)["bookings"] != float64(0)) {
			t.Fatalf("zero day = %v", periods)
		}
		if interval == "monthly" && periods[0].(map[string]any)["period"] != "2031-01-01" {
			t.Fatalf("partial month = %v", periods)
		}
	}
	empty := e.data(&e.admin, "GET", "/api/spa/reports/rush-hour?from=2032-01-01&to=2032-01-03&branch_id="+branch, nil, 200)
	if empty["total_bookings"] != float64(0) || len(empty["peak_hours"].([]any)) != 0 || len(empty["hourly"].([]any)) != 24 {
		t.Fatalf("empty = %v", empty)
	}
	e.call(nil, "GET", "/api/spa/reports/rush-hour"+query, nil, 401)
	e.call(&e.therapist, "GET", "/api/spa/reports/rush-hour"+query, nil, 403)
	e.call(&e.therapist, "GET", "/api/spa/reports/trend"+query+"&interval=daily", nil, 403)
	for _, suffix := range []string{"", "?from=2031-02-30&to=2031-03-01", "?from=2031-01-17&to=2031-01-15", "?from=2031-01-15&to=2031-01-17&branch_id=bad"} {
		e.call(&e.admin, "GET", "/api/spa/reports/rush-hour"+suffix, nil, 400)
	}
	e.call(&e.admin, "GET", "/api/spa/reports/trend"+query+"&interval=weekly", nil, 400)
	e.call(&e.admin, "GET", "/api/spa/reports/trend?from=2020-01-01&to=2031-01-01&interval=daily", nil, 400)
}

func TestSpaReportsScopeAndReadPermission(t *testing.T) {
	e := setup(t)
	other := testutil.CreateOrg(t, e.tx)
	for _, org := range []testutil.Org{e.org, other} {
		if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.bookings
		 (booking_code, company_id, branch_id, warehouse_id, booking_type, customer_name, scheduled_at, ends_at, status)
		 SELECT $1, $2, $3, id, 'reservation', 'Scope fixture', '2031-01-01T02:00:00Z', '2031-01-01T03:00:00Z', 'completed'
		 FROM configuration.warehouses WHERE branch_id = $3 ORDER BY is_default DESC LIMIT 1`,
			"REPORT-SCOPE-"+testutil.RandomHex(4), org.CompanyID, org.BranchID); err != nil {
			t.Fatal(err)
		}
	}
	for _, level := range []string{"branch", "company", "holding"} {
		if _, err := e.tx.Exec(e.ctx, `UPDATE configuration.users SET business_scope=$2,holding_id=$3,company_id=$4,branch_id=$5 WHERE id=$1`,
			e.admin.UserID, level, e.org.HoldingID, e.org.CompanyID, e.org.BranchID); err != nil {
			t.Fatal(err)
		}
		query := "?from=2031-01-01&to=2031-01-31&branch_id=" + other.BranchID
		e.call(&e.admin, "GET", "/api/spa/reports/rush-hour"+query, nil, 403)
		e.call(&e.admin, "GET", "/api/spa/reports/trend"+query+"&interval=daily", nil, 403)
		e.call(&e.admin, "GET", "/api/spa/reports/rating"+query, nil, 403)
		outlets := e.list(&e.admin, "/api/spa/outlets")
		for _, raw := range outlets {
			if raw.(map[string]any)["branch_id"] == other.BranchID {
				t.Fatalf("%s leaked outlet", level)
			}
		}
		for _, path := range []string{"rush-hour?from=2031-01-01&to=2031-01-31", "trend?from=2031-01-01&to=2031-01-31&interval=daily"} {
			report := e.data(&e.admin, "GET", "/api/spa/reports/"+path, nil, 200)
			if report["total_bookings"] != float64(1) {
				t.Fatalf("%s all outlets leaked bookings: %v", level, report)
			}
		}
	}
	// A holder of Trend alone can load its filter, but not Rush Hour.
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"spa.trend": {"read"}}})
	e.call(&reader, "GET", "/api/spa/outlets", nil, 200)
	e.call(&reader, "GET", "/api/spa/reports/trend?from=2031-01-01&to=2031-01-02&interval=daily", nil, 200)
	e.call(&reader, "GET", "/api/spa/reports/rush-hour?from=2031-01-01&to=2031-01-02", nil, 403)
	noRead := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"spa.trend": {"update"}}})
	e.call(&noRead, "GET", "/api/spa/reports/trend?from=2031-01-01&to=2031-01-02&interval=daily", nil, 403)
}

func TestSpaRatingReportGroupsRatedBookingsInWIB(t *testing.T) {
	e := setup(t)
	query := "?from=2031-01-15&to=2031-01-16&branch_id=" + e.org.BranchID
	firstEmployee := e.employee("Rating therapist A", nil)
	secondEmployee := e.employee("Rating therapist B", nil)
	therapists := []string{}
	for _, employee := range []string{firstEmployee, secondEmployee} {
		var id string
		if err := e.tx.QueryRow(e.ctx, `INSERT INTO spa.therapists (employee_id, home_branch_id) VALUES ($1,$2) RETURNING id::text`, employee, e.org.BranchID).Scan(&id); err != nil {
			t.Fatal(err)
		}
		therapists = append(therapists, id)
	}
	for i, row := range []struct {
		at        string
		rating    int
		therapist string
	}{
		{"2031-01-14T17:00:00Z", 5, therapists[0]},
		{"2031-01-15T02:00:00Z", 3, therapists[0]},
		{"2031-01-15T17:00:00Z", 4, therapists[1]},
		{"2031-01-16T17:00:00Z", 1, therapists[1]}, // After the range in WIB.
	} {
		if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.bookings
		 (booking_code, company_id, branch_id, warehouse_id, booking_type, customer_name, scheduled_at, ends_at, status, therapist_id, therapist_rating)
		 SELECT $1,$2,$3,id,'reservation','Rating customer',$4,$4::timestamptz + interval '60 minutes','completed',$5,$6
		 FROM configuration.warehouses WHERE branch_id=$3 ORDER BY is_default DESC LIMIT 1`,
			fmt.Sprintf("RATING-%s-%d", testutil.RandomHex(4), i), e.org.CompanyID, e.org.BranchID, row.at, row.therapist, row.rating); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.bookings
	 (booking_code, company_id, branch_id, warehouse_id, booking_type, customer_name, scheduled_at, ends_at, status, therapist_id)
	 SELECT $1,$2,$3,id,'reservation','Unrated customer','2031-01-15T03:00:00Z','2031-01-15T04:00:00Z','completed',$4
	 FROM configuration.warehouses WHERE branch_id=$3 ORDER BY is_default DESC LIMIT 1`,
		"RATING-UNRATED-"+testutil.RandomHex(4), e.org.CompanyID, e.org.BranchID, therapists[0]); err != nil {
		t.Fatal(err)
	}
	report := e.data(&e.admin, "GET", "/api/spa/reports/rating"+query, nil, 200)
	if report["total_ratings"] != float64(3) || report["average_rating"] != float64(4) {
		t.Fatalf("summary = %v", report)
	}
	bookings := report["bookings"].([]any)
	if len(bookings) != 3 {
		t.Fatalf("bookings = %v", bookings)
	}
	if _, exists := report["periods"]; exists {
		t.Fatalf("rating report still contains trend periods: %v", report)
	}
	staff := report["therapists"].([]any)
	if len(staff) != 2 || staff[0].(map[string]any)["total_ratings"] != float64(2) || staff[1].(map[string]any)["total_ratings"] != float64(1) {
		t.Fatalf("therapists = %v", staff)
	}
	e.call(&e.admin, "GET", "/api/spa/reports/rating?from=2031-01-16&to=2031-01-15", nil, 400)
	e.call(&e.therapist, "GET", "/api/spa/reports/rating"+query, nil, 403)
	e.call(nil, "GET", "/api/spa/reports/rating"+query, nil, 401)
}
