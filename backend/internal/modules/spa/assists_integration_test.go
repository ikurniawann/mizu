package spa_test

import (
	"context"
	"net/http/httptest"
	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/platform/testutil"
	"testing"
	"time"
)

func TestAssistPreservesClockInAndChecksDailyQuota(t *testing.T) {
	e := setup(t)
	other := testutil.CreateOrg(t, e.tx)
	for _, b := range []string{e.org.BranchID, other.BranchID} {
		var wh string
		e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, b).Scan(&wh)
		e.data(&e.admin, "PUT", "/api/spa/outlets/"+b, map[string]any{"warehouse_id": wh, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true}, 200)
	}
	emp := e.employee("Move Therapist", nil)
	th := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": e.org.BranchID, "gender": "female"}, 201)
	var shift string
	e.tx.QueryRow(e.ctx, `INSERT INTO hris.shifts(name,start_time,end_time) VALUES('Move','09:00','18:00') RETURNING id::text`).Scan(&shift)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.employee_shifts(employee_id,day_of_week,shift_id,effective_from) SELECT $1,d,$2,'2026-10-01' FROM generate_series(1,7) d`, emp, shift); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.attendance(employee_id,date,clock_in,status) VALUES($1,'2026-10-08','2026-10-08 08:55+07','present')`, emp); err != nil {
		t.Fatal(err)
	}
	e.data(&e.admin, "PUT", "/api/spa/day-off-quotas/"+e.org.BranchID, map[string]any{"min_female": 1, "min_male": 0, "max_per_week": 2}, 200)
	req := map[string]any{"therapist_id": th["id"], "branch_id": other.BranchID, "start_date": "2026-10-08", "end_date": "2026-10-08", "starts_at": "2026-10-08T09:00:00+07:00", "ends_at": "2026-10-08T18:00:00+07:00"}
	e.call(&e.admin, "POST", "/api/spa/assists", req, 409)
	e.data(&e.admin, "PUT", "/api/spa/day-off-quotas/"+e.org.BranchID, map[string]any{"min_female": 0, "min_male": 0, "max_per_week": 2}, 200)
	a := e.data(&e.admin, "POST", "/api/spa/assists", req, 201)
	e.call(&e.admin, "POST", "/api/spa/assists", req, 409)
	queue := e.data(&e.admin, "GET", "/api/spa/arrival-queue?branch_id="+other.BranchID+"&date=2026-10-08", nil, 200)
	if len(queue["queue"].([]any)) != 1 {
		t.Fatalf("destination queue=%v", queue)
	}
	source := e.data(&e.admin, "GET", "/api/spa/arrival-queue?branch_id="+e.org.BranchID+"&date=2026-10-08", nil, 200)
	if len(source["queue"].([]any)) != 0 {
		t.Fatal("still present at source")
	}
	var n int
	e.tx.QueryRow(e.ctx, `SELECT count(*) FROM hris.attendance WHERE employee_id=$1 AND clock_in='2026-10-08 08:55+07'`, emp).Scan(&n)
	if n != 1 {
		t.Fatal("clock in changed")
	}
	e.call(&e.admin, "DELETE", "/api/spa/assists/"+a["id"].(string), nil, 200)
	// The clock advances between request validation and persistence. Omitting
	// starts_at means "now", while the selected end time must remain intact.
	now := fixedNow
	e.mux = testutil.Mux(spa.NewOn(testutil.Deps(t, func() time.Time {
		now = now.Add(time.Millisecond)
		return now
	}), e.tx, app.SpaPorts()))
	delete(req, "starts_at")
	immediate := e.data(&e.admin, "POST", "/api/spa/assists", req, 201)
	ends, err := time.Parse(time.RFC3339, immediate["ends_at"].(string))
	if err != nil || ends.In(time.FixedZone("WIB", 7*3600)).Hour() != 18 {
		t.Fatalf("immediate end changed: %v", immediate)
	}
}

func TestAssistPreviewDoesNotWriteAndFutureTransferWaitsForClockIn(t *testing.T) {
	e := setup(t)
	other := testutil.CreateOrg(t, e.tx)
	for _, b := range []string{e.org.BranchID, other.BranchID} {
		var wh string
		e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, b).Scan(&wh)
		e.data(&e.admin, "PUT", "/api/spa/outlets/"+b, map[string]any{"warehouse_id": wh, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true}, 200)
	}
	emp := e.employee("Future transfer", nil)
	th := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": e.org.BranchID, "gender": "female"}, 201)
	scheduleTestTherapists(e)
	req := map[string]any{"therapist_id": th["id"], "branch_id": other.BranchID, "start_date": "2026-10-08", "end_date": "2026-10-08", "starts_at": "2026-10-08T09:00:00+07:00", "ends_at": "2026-10-08T22:00:00+07:00"}
	out := e.data(&e.admin, "POST", "/api/spa/assists/preview", req, 200)
	if len(out["impact"].([]any)) != 2 {
		t.Fatalf("impact=%v", out)
	}
	var n int
	e.tx.QueryRow(e.ctx, `SELECT count(*) FROM spa.therapist_assists WHERE therapist_id=$1`, th["id"]).Scan(&n)
	if n != 0 {
		t.Fatal("preview persisted")
	}
	e.data(&e.admin, "POST", "/api/spa/assists", req, 201)
	queue := e.data(&e.admin, "GET", "/api/spa/arrival-queue?branch_id="+other.BranchID+"&date=2026-10-08", nil, 200)
	if len(queue["queue"].([]any)) != 0 || len(queue["absent"].([]any)) != 1 {
		t.Fatalf("not clocked in=%v", queue)
	}
}

func TestBookingRequiresWorkSchedule(t *testing.T) {
	e := setup(t)
	var wh string
	e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, e.org.BranchID).Scan(&wh)
	e.data(&e.admin, "PUT", "/api/spa/outlets/"+e.org.BranchID, map[string]any{"warehouse_id": wh, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true}, 200)
	emp := e.employee("Unscheduled", nil)
	th := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": e.org.BranchID, "gender": "female"}, 201)
	tr := e.data(&e.admin, "POST", "/api/spa/treatments", map[string]any{"code": "SCH" + testutil.RandomHex(3), "name": "Schedule test", "variants": []any{map[string]any{"name": "60 minutes", "duration_min": 60, "price_idr": 100000}}}, 201)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"]
	req := map[string]any{"branch_id": e.org.BranchID, "booking_type": "walk_in", "customer_name": "Guest", "therapist_id": th["id"], "scheduled_at": "2026-10-08T10:00:00+07:00", "items": []any{map[string]any{"variant_id": variant}}}
	e.call(&e.admin, "POST", "/api/spa/bookings", req, 409)
	scheduleTestTherapists(e)
	booking := e.data(&e.admin, "POST", "/api/spa/bookings", req, 201)
	e.data(&e.admin, "POST", "/api/spa/bookings/"+booking["id"].(string)+"/status", map[string]any{"action": "start"}, 200)
	// An overdue running treatment remains a blocker even after its scheduled end.
	other := testutil.CreateOrg(t, e.tx)
	e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, other.BranchID).Scan(&wh)
	e.data(&e.admin, "PUT", "/api/spa/outlets/"+other.BranchID, map[string]any{"warehouse_id": wh, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true}, 200)
	e.call(&e.admin, "POST", "/api/spa/assists", map[string]any{"therapist_id": th["id"], "branch_id": other.BranchID, "start_date": "2026-10-08", "end_date": "2026-10-08", "starts_at": "2026-10-08T15:00:00+07:00", "ends_at": "2026-10-08T18:00:00+07:00"}, 409)
}

func TestAssistChecksEveryISOWeek(t *testing.T) {
	e := setup(t)
	other := testutil.CreateOrg(t, e.tx)
	for _, b := range []string{e.org.BranchID, other.BranchID} {
		var wh string
		e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, b).Scan(&wh)
		e.data(&e.admin, "PUT", "/api/spa/outlets/"+b, map[string]any{"warehouse_id": wh, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true}, 200)
	}
	emp := e.scheduledEmployee("Two weeks", nil)
	th := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": e.org.BranchID, "gender": "female"}, 201)
	e.data(&e.admin, "PUT", "/api/spa/day-off-quotas/"+other.BranchID, map[string]any{"min_female": 0, "min_male": 0, "min_per_week": 1, "max_per_week": 2}, 200)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.employee_shift_dates(employee_id,work_date) VALUES($1,'2026-10-10')`, emp); err != nil {
		t.Fatal(err)
	}
	req := map[string]any{"therapist_id": th["id"], "branch_id": other.BranchID, "start_date": "2026-10-11", "end_date": "2026-10-13", "starts_at": "2026-10-11T09:00:00+07:00", "ends_at": "2026-10-13T18:00:00+07:00"}
	e.call(&e.admin, "POST", "/api/spa/assists", req, 409)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.employee_shift_dates(employee_id,work_date) VALUES($1,'2026-10-17')`, emp); err != nil {
		t.Fatal(err)
	}
	e.data(&e.admin, "POST", "/api/spa/assists", req, 201)
}

func TestAssistCancellationWaitsForAssignmentLock(t *testing.T) {
	e := setup(t)
	other := testutil.CreateOrg(t, e.tx)
	for _, b := range []string{e.org.BranchID, other.BranchID} {
		var wh string
		e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, b).Scan(&wh)
		e.data(&e.admin, "PUT", "/api/spa/outlets/"+b, map[string]any{"warehouse_id": wh, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true}, 200)
	}
	emp := e.scheduledEmployee("Concurrent transfer", nil)
	th := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": e.org.BranchID, "gender": "female"}, 201)
	var assist string
	if err := e.tx.QueryRow(e.ctx, `INSERT INTO spa.therapist_assists(therapist_id,branch_id,start_date,end_date) VALUES($1,$2,'2026-10-09','2026-10-09') RETURNING id::text`, th["id"], other.BranchID).Scan(&assist); err != nil {
		t.Fatal(err)
	}
	blocker, err := testutil.DB(t).Begin(e.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(e.ctx)
	if _, err = blocker.Exec(e.ctx, `SELECT pg_advisory_xact_lock(hashtext('spa-therapist:' || $1))`, th["id"]); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	ctx, cancel := context.WithTimeout(e.ctx, 5*time.Second)
	defer cancel()
	go func() {
		req := testutil.AsStaff(testutil.Request("DELETE", "/api/spa/assists/"+assist, nil), e.admin).WithContext(ctx)
		rec := httptest.NewRecorder()
		e.mux.ServeHTTP(rec, req)
		done <- rec
	}()
	select {
	case rec := <-done:
		t.Fatalf("cancellation bypassed assignment lock: %d %s", rec.Code, rec.Body.String())
	case <-time.After(150 * time.Millisecond):
	}
	if err = blocker.Commit(e.ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case rec := <-done:
		if rec.Code != 200 {
			t.Fatalf("cancel after release: %d %s", rec.Code, rec.Body.String())
		}
	case <-ctx.Done():
		t.Fatal("cancellation did not finish after assignment lock released")
	}
}

func TestOvernightAssistUsesPriorWorkDateAndAttendance(t *testing.T) {
	e := setup(t)
	other := testutil.CreateOrg(t, e.tx)
	for _, b := range []string{e.org.BranchID, other.BranchID} {
		var wh string
		e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, b).Scan(&wh)
		e.data(&e.admin, "PUT", "/api/spa/outlets/"+b, map[string]any{"warehouse_id": wh, "open_time": "00:00", "close_time": "23:59", "slot_minutes": 30, "is_active": true}, 200)
	}
	emp := e.employee("Night transfer", nil)
	th := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": e.org.BranchID, "gender": "female"}, 201)
	var shift string
	if err := e.tx.QueryRow(e.ctx, `INSERT INTO hris.shifts(name,start_time,end_time) VALUES('Night','22:00','06:00') RETURNING id::text`).Scan(&shift); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.employee_shift_dates(employee_id,work_date,shift_id) VALUES($1,'2026-10-08',$2),($1,'2026-10-09',NULL)`, emp, shift); err != nil {
		t.Fatal(err)
	}
	e.data(&e.admin, "PUT", "/api/spa/day-off-quotas/"+e.org.BranchID, map[string]any{"min_female": 1, "min_male": 0, "max_per_week": 2}, 200)
	req := map[string]any{"therapist_id": th["id"], "branch_id": other.BranchID, "start_date": "2026-10-09", "end_date": "2026-10-09", "starts_at": "2026-10-09T00:00:00+07:00", "ends_at": "2026-10-09T06:00:00+07:00"}
	e.call(&e.admin, "POST", "/api/spa/assists", req, 409)
	e.data(&e.admin, "PUT", "/api/spa/day-off-quotas/"+e.org.BranchID, map[string]any{"min_female": 0, "min_male": 0, "max_per_week": 2}, 200)
	a := e.data(&e.admin, "POST", "/api/spa/assists", req, 201)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO hris.attendance(employee_id,date,clock_in,status) VALUES($1,'2026-10-08','2026-10-08 21:55+07','present')`, emp); err != nil {
		t.Fatal(err)
	}
	now, _ := time.Parse(time.RFC3339, "2026-10-09T02:00:00+07:00")
	e.mux = testutil.Mux(spa.NewOn(testutil.Deps(t, func() time.Time { return now }), e.tx, app.SpaPorts()))
	queue := e.data(&e.admin, "GET", "/api/spa/arrival-queue?branch_id="+other.BranchID+"&date=2026-10-09", nil, 200)
	if len(queue["queue"].([]any)) != 1 {
		t.Fatalf("overnight arrival missing: %v", queue)
	}
	available := e.list(&e.admin, "/api/spa/availability?branch_id="+other.BranchID+"&starts_at=2026-10-08T19:30:00Z&ends_at=2026-10-08T20:30:00Z")
	if len(available) != 1 {
		t.Fatalf("overnight availability=%v", available)
	}
	entry := available[0].(map[string]any)
	if entry["available"] != true || entry["day_off"] != false || entry["shift"] == nil {
		t.Fatalf("overnight availability displays wrong work date: %v", entry)
	}
	tr := e.data(&e.admin, "POST", "/api/spa/treatments", map[string]any{"code": "NIGHT" + testutil.RandomHex(3), "name": "Night", "variants": []any{map[string]any{"name": "60 minutes", "duration_min": 60, "price_idr": 100000}}}, 201)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"]
	e.data(&e.admin, "POST", "/api/spa/bookings", map[string]any{"branch_id": other.BranchID, "booking_type": "walk_in", "customer_name": "Night guest", "therapist_id": th["id"], "scheduled_at": "2026-10-09T02:30:00+07:00", "items": []any{map[string]any{"variant_id": variant}}}, 201)
	e.call(&e.admin, "DELETE", "/api/spa/assists/"+a["id"].(string), nil, 409)
}
