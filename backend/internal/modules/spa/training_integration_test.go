package spa_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/platform/testutil"
)

func TestTrainingRulesConcurrentWithReactivation(t *testing.T) {
	ctx := context.Background()
	db := testutil.DB(t)
	org := testutil.CreateOrg(t, nil)
	admin := trainingAdmin(t)
	deps := testutil.Deps(t, nil)
	e := &env{t: t, ctx: ctx, admin: admin, org: org, mux: testutil.Mux(spa.NewOn(deps, db, app.SpaPorts()))}
	var employee, therapist, training string
	if err := db.QueryRow(ctx, `INSERT INTO hris.employees(full_name,nip,email,phone,join_date) VALUES('Concurrent training',$1,$2,'0812',CURRENT_DATE) RETURNING id::text`, "TR-"+testutil.RandomHex(4), testutil.RandomHex(4)+"@test.local").Scan(&employee); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM spa.therapist_level_history WHERE therapist_id IN(SELECT id FROM spa.therapists WHERE employee_id=$1)`,
			`DELETE FROM spa.training_participants WHERE therapist_id IN(SELECT id FROM spa.therapists WHERE employee_id=$1)`,
			`DELETE FROM spa.therapists WHERE employee_id=$1`,
			`DELETE FROM hris.employees WHERE id=$1`,
		} {
			if _, err := db.Exec(ctx, sql, employee); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
		if training != "" {
			if _, err := db.Exec(ctx, `DELETE FROM spa.trainings WHERE id=$1`, training); err != nil {
				t.Errorf("cleanup training: %v", err)
			}
		}
	})
	if err := db.QueryRow(ctx, `INSERT INTO spa.therapists(employee_id,home_branch_id) VALUES($1,$2) RETURNING id::text`, employee, org.BranchID).Scan(&therapist); err != nil {
		t.Fatal(err)
	}
	training = e.data(&admin, "POST", "/api/spa/trainings", map[string]any{"name": "Concurrent", "topic_code": therapist, "period": "2026", "training_date": "2026-10-26", "trainer_name": "Trainer"}, 201)["id"].(string)
	if _, err := db.Exec(ctx, `INSERT INTO spa.training_participants(training_id,therapist_id,employment_cycle,status) VALUES($1,$2,1,'passed')`, training, therapist); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `UPDATE hris.employees SET is_active=false WHERE id=$1`, employee); err != nil {
		t.Fatal(err)
	}
	activation, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer activation.Rollback(ctx)
	if _, err = activation.Exec(ctx, `UPDATE hris.employees SET is_active=true WHERE id=$1`, employee); err != nil {
		t.Fatal(err)
	}
	rulesTx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rulesTx.Rollback(ctx)
	svc := spa.NewService(rulesTx, app.SpaPorts(), deps)
	result := make(chan error, 1)
	go func() {
		result <- svc.SaveLevelRequirements(ctx, admin.UserID, spa.LevelRequirements{Level1: []string{training}, Level2: []string{}})
	}()
	var early bool
	select {
	case err = <-result:
		early = true
	case <-time.After(150 * time.Millisecond):
	}
	if commitErr := activation.Commit(ctx); commitErr != nil {
		t.Fatal(commitErr)
	}
	if !early {
		select {
		case err = <-result:
		case <-time.After(5 * time.Second):
			t.Fatal("rule update blocked after activation committed")
		}
	}
	if err != nil {
		t.Fatal(err)
	}
	var level int
	if err = rulesTx.QueryRow(ctx, `SELECT level FROM spa.therapists WHERE id=$1`, therapist).Scan(&level); err != nil {
		t.Fatal(err)
	}
	if level != 1 {
		t.Fatalf("concurrent reactivation missed new requirements: level=%d, rule save returned before activation=%v", level, early)
	}
}

func trainingAdmin(t *testing.T) testutil.Staff {
	return testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"spa.training": {"read", "create", "update"}}})
}

func TestTrainingApprovalLevelsAndRehire(t *testing.T) {
	admin := trainingAdmin(t)
	e := setup(t)
	employee := e.employee("Training Sari", &e.therapist.UserID)
	therapist := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": employee, "home_branch_id": e.org.BranchID}, 201)
	tid := therapist["id"].(string)
	newTraining := func(period string) string {
		return e.data(&admin, "POST", "/api/spa/trainings", map[string]any{"name": "Teknik Dasar", "topic_code": "DASAR-" + tid, "period": period, "training_date": "2026-10-26", "trainer_name": "Trainer A", "notes": "Penilaian di luar aplikasi"}, 201)["id"].(string)
	}
	first, second := newTraining("2026-A"), newTraining("2026-B")
	enroll := func(training string) string {
		rows := e.call(&admin, "POST", "/api/spa/trainings/"+training+"/participants", map[string]any{"therapist_ids": []string{tid}}, 201)["data"].([]any)
		return rows[0].(map[string]any)["id"].(string)
	}
	state := func(id, status string, code int) {
		e.call(&admin, "POST", "/api/spa/training-participants/"+id+"/status", map[string]any{"status": status, "notes": "Hasil trainer diverifikasi"}, code)
	}
	level := func(want float64) {
		me := e.data(&e.therapist, "GET", "/api/spa/me/trainings", nil, 200)
		if got := me["therapist"].(map[string]any)["level"]; got != want {
			t.Fatalf("level=%v want=%v", got, want)
		}
	}
	rules := func(one, two []string) {
		e.call(&admin, "PUT", "/api/spa/level-requirements", map[string]any{"level_1": one, "level_2": two}, 200)
	}
	rules([]string{first}, []string{second})
	p1 := enroll(first)
	level(0)
	state(p1, "pending", 200)
	level(0)
	e.call(&admin, "POST", "/api/spa/trainings/"+first+"/participants", map[string]any{"therapist_ids": []string{tid}}, 409)
	state(p1, "passed", 200)
	level(1)
	state(p1, "passed", 200) // retry is idempotent
	state(p1, "failed", 409)
	e.call(&admin, "POST", "/api/spa/trainings/"+first+"/participants", map[string]any{"therapist_ids": []string{tid}}, 409)
	candidates := e.list(&admin, "/api/spa/trainings/"+second+"/candidates")
	found := false
	for _, raw := range candidates {
		c := raw.(map[string]any)
		if c["therapist_id"] == tid {
			found = true
			if c["can_enroll"] != true || len(c["similar_passes"].([]any)) != 1 {
				t.Fatalf("candidate: %#v", c)
			}
		}
	}
	if !found {
		t.Fatal("candidate missing")
	}
	p2 := enroll(second)
	state(p2, "failed", 200)
	p2 = enroll(second)
	state(p2, "passed", 200)
	level(2)
	// Nonactive is independent from employment status and preserves level.
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.employees SET is_active=false WHERE id=$1`, employee); err != nil {
		t.Fatal(err)
	}
	level(2)
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.employees SET is_active=true WHERE id=$1`, employee); err != nil {
		t.Fatal(err)
	}
	level(2)
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.employees SET employment_status='resigned' WHERE id=$1`, employee); err != nil {
		t.Fatal(err)
	}
	var active bool
	if err := e.tx.QueryRow(e.ctx, `SELECT is_active FROM hris.employees WHERE id=$1`, employee).Scan(&active); err != nil || active {
		t.Fatalf("resigned active=%v err=%v", active, err)
	}
	e.call(&e.admin, "PATCH", "/api/spa/therapists/"+tid, map[string]any{"is_active": true}, 409)
	// Changing status and activation separately must still reset once.
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.employees SET employment_status='contract' WHERE id=$1`, employee); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.employees SET is_active=true WHERE id=$1`, employee); err != nil {
		t.Fatal(err)
	}
	level(0)
	rules([]string{first}, []string{second})
	level(0) // old approvals never count toward this employment cycle
	third := newTraining("2027-A")
	rules([]string{third}, []string{})
	p3 := enroll(third)
	state(p3, "passed", 200)
	level(1)
	rules([]string{}, []string{})
	level(1) // editing requirements never demotes
}

func TestTrainingPermissionsAndOwnHistory(t *testing.T) {
	admin := trainingAdmin(t)
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"spa.training": {"read"}}})
	e := setup(t)
	e.call(nil, "GET", "/api/spa/trainings", nil, http.StatusUnauthorized)
	e.call(&e.therapist, "GET", "/api/spa/trainings", nil, http.StatusForbidden)
	e.call(&reader, "POST", "/api/spa/trainings", map[string]any{}, http.StatusForbidden)
	e.call(&reader, "PUT", "/api/spa/level-requirements", map[string]any{"level_1": []string{}, "level_2": []string{}}, http.StatusForbidden)
	e.call(&admin, "POST", "/api/spa/trainings", map[string]any{"name": " ", "period": "2026", "topic_code": "A", "training_date": "2026-02-30", "trainer_name": "A"}, 400)
	e.call(&admin, "PUT", "/api/spa/level-requirements", map[string]any{"level_1": []string{"00000000-0000-0000-0000-000000000001"}, "level_2": []string{}}, 400)
	own := e.employee("Own", &e.therapist.UserID)
	e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": own, "home_branch_id": e.org.BranchID}, 201)
	other := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.employee("Other", nil), "home_branch_id": e.org.BranchID}, 201)["id"].(string)
	tr := e.data(&admin, "POST", "/api/spa/trainings", map[string]any{"name": "Private", "topic_code": "T-" + other, "period": "2026", "training_date": "2026-10-26", "trainer_name": "A"}, 201)["id"].(string)
	e.call(&admin, "POST", "/api/spa/trainings/"+tr+"/participants", map[string]any{"therapist_ids": []string{other}}, 201)
	my := e.data(&e.therapist, "GET", "/api/spa/me/trainings?therapist_id="+other, nil, 200)
	if len(my["participations"].([]any)) != 0 {
		t.Fatalf("leaked history: %#v", my)
	}
	e.call(&reader, "POST", "/api/spa/training-participants/"+other+"/status", map[string]any{"status": "passed"}, 403)
}

func TestTrainingRequirementsWaitForAllAndApplyOnReactivation(t *testing.T) {
	admin := trainingAdmin(t)
	e := setup(t)
	employee := e.employee("Reactivation", &e.therapist.UserID)
	tid := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": employee, "home_branch_id": e.org.BranchID}, 201)["id"].(string)
	ids := []string{}
	for _, name := range []string{"Dasar", "Pelayanan"} {
		tr := e.data(&admin, "POST", "/api/spa/trainings", map[string]any{"name": name, "topic_code": name + tid, "period": "2026", "training_date": "2026-10-26", "trainer_name": "Trainer"}, 201)["id"].(string)
		ids = append(ids, tr)
	}
	rule := map[string]any{"level_1": ids, "level_2": []string{}}
	e.call(&admin, "PUT", "/api/spa/level-requirements", rule, 200)
	enroll := func(tr string) string {
		return e.call(&admin, "POST", "/api/spa/trainings/"+tr+"/participants", map[string]any{"therapist_ids": []string{tid}}, 201)["data"].([]any)[0].(map[string]any)["id"].(string)
	}
	approve := func(id string) {
		e.call(&admin, "POST", "/api/spa/training-participants/"+id+"/status", map[string]any{"status": "passed", "notes": "Verified"}, 200)
	}
	level := func(want float64) {
		me := e.data(&e.therapist, "GET", "/api/spa/me/trainings", nil, 200)
		if me["therapist"].(map[string]any)["level"] != want {
			t.Fatalf("expected level %v: %#v", want, me)
		}
	}
	approve(enroll(ids[0]))
	level(0)
	// Empty requirements never promote, even with passed training.
	e.call(&admin, "PUT", "/api/spa/level-requirements", map[string]any{"level_1": []string{}, "level_2": []string{}}, 200)
	approve(enroll(ids[1]))
	level(0)
	// A rule configured while temporarily inactive is evaluated on reactivation.
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.employees SET is_active=false WHERE id=$1`, employee); err != nil {
		t.Fatal(err)
	}
	e.call(&admin, "PUT", "/api/spa/level-requirements", rule, 200)
	level(0)
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.employees SET is_active=true WHERE id=$1`, employee); err != nil {
		t.Fatal(err)
	}
	level(1)
	// Pending participation from before resign cannot be approved after rehire.
	tr := e.data(&admin, "POST", "/api/spa/trainings", map[string]any{"name": "Lanjutan", "topic_code": tid, "period": "2026", "training_date": "2026-10-26", "trainer_name": "Trainer"}, 201)["id"].(string)
	p := enroll(tr)
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.employees SET employment_status='resigned' WHERE id=$1`, employee); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `UPDATE hris.employees SET employment_status='contract',is_active=true WHERE id=$1`, employee); err != nil {
		t.Fatal(err)
	}
	level(0)
	e.call(&admin, "POST", "/api/spa/training-participants/"+p+"/status", map[string]any{"status": "passed", "notes": "Late approval"}, 409)
}
