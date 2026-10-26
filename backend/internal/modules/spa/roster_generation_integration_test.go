package spa_test

import (
	"net/http"
	"nuhabit/backend/internal/platform/testutil"
	"testing"
)

func TestMonthlyRosterPreviewAndAtomicApply(t *testing.T) {
	e := setup(t)
	b := e.org.BranchID
	var wh, shift string
	e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, b).Scan(&wh)
	e.data(&e.admin, "PUT", "/api/spa/outlets/"+b, map[string]any{"warehouse_id": wh, "open_time": "09:00", "close_time": "22:00", "is_active": true, "slot_minutes": 30}, 200)
	if err := e.tx.QueryRow(e.ctx, `INSERT INTO hris.shifts(name,start_time,end_time) VALUES ('Generated','09:00','17:00') RETURNING id::text`).Scan(&shift); err != nil {
		t.Fatal(err)
	}
	emp := e.employee("Monthly Therapist", nil)
	e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": b, "gender": "female"}, 201)
	e.data(&e.admin, "PUT", "/api/spa/day-off-quotas/"+b, map[string]any{"min_female": 1, "min_male": 0, "max_per_week": 2}, 200)
	req := map[string]any{"branch_id": b, "month": "2026-11", "shift_ids": []string{shift}}
	preview := e.data(&e.admin, "POST", "/api/spa/rosters/preview", req, http.StatusOK)
	if preview["status"] != "valid" {
		t.Fatalf("preview=%v", preview)
	}
	var n int
	e.tx.QueryRow(e.ctx, `SELECT count(*) FROM hris.employee_shift_dates WHERE employee_id=$1`, emp).Scan(&n)
	if n != 0 {
		t.Fatal("preview wrote data")
	}
	req["cells"] = preview["cells"]
	req["revision"] = preview["revision"]
	for _, raw := range preview["cells"].([]any) {
		cell := raw.(map[string]any)
		if cell["date"] != "2026-11-02" {
			continue
		}
		cell["kind"], cell["shift_id"] = "off", ""
		e.call(&e.admin, "POST", "/api/spa/rosters/apply", req, 409)
		e.tx.QueryRow(e.ctx, `SELECT count(*) FROM hris.employee_shift_dates WHERE employee_id=$1`, emp).Scan(&n)
		if n != 0 {
			t.Fatal("invalid apply partially persisted")
		}
		cell["kind"], cell["shift_id"] = "work", shift
	}
	e.data(&e.admin, "POST", "/api/spa/rosters/apply", req, 200)
	e.tx.QueryRow(e.ctx, `SELECT count(*) FROM hris.employee_shift_dates WHERE employee_id=$1`, emp).Scan(&n)
	if n != 30 {
		t.Fatalf("daily rows=%d", n)
	}
	e.call(&e.admin, "POST", "/api/spa/rosters/apply", req, 409)
}

func TestMonthlyRosterCannotRewriteAssistingEmployees(t *testing.T) {
	e := setup(t)
	other := testutil.CreateOrg(t, e.tx)
	var wh, shift string
	e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, e.org.BranchID).Scan(&wh)
	e.data(&e.admin, "PUT", "/api/spa/outlets/"+e.org.BranchID, map[string]any{"warehouse_id": wh, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true}, 200)
	emp := e.scheduledEmployee("Incoming", nil)
	th := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": other.BranchID, "gender": "female"}, 201)
	e.tx.QueryRow(e.ctx, `SELECT shift_id::text FROM hris.employee_shifts WHERE employee_id=$1 LIMIT 1`, emp).Scan(&shift)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.therapist_assists(therapist_id,branch_id,start_date,end_date) VALUES($1,$2,'2026-11-02','2026-11-02')`, th["id"], e.org.BranchID); err != nil {
		t.Fatal(err)
	}
	req := map[string]any{"branch_id": e.org.BranchID, "month": "2026-11", "shift_ids": []string{shift}, "replace_existing": true}
	preview := e.data(&e.admin, "POST", "/api/spa/rosters/preview", req, 200)
	cells := preview["cells"].([]any)
	for _, raw := range cells {
		cell := raw.(map[string]any)
		if cell["date"] == "2026-11-03" {
			if cell["locked"] != true {
				t.Fatal("foreign employee editable outside assistance date")
			}
			cell["kind"], cell["shift_id"], cell["locked"] = "off", "", false
		}
	}
	req["revision"], req["cells"] = preview["revision"], cells
	e.call(&e.admin, "POST", "/api/spa/rosters/apply", req, 409)
	var n int
	e.tx.QueryRow(e.ctx, `SELECT count(*) FROM hris.employee_shift_dates WHERE employee_id=$1`, emp).Scan(&n)
	if n != 0 {
		t.Fatal("foreign roster was changed")
	}
}
