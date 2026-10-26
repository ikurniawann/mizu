package spa

import (
	"context"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

// Completion reads one committed tariff while an admin's edit is still open.
// Keeping a shared rule lock here would block (and can deadlock multi-item
// completions against bulk edits in a different variant order).
func TestCommissionCompletionDuringTariffEdit(t *testing.T) {
	db := testutil.DB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	org := testutil.CreateOrg(t, nil)
	setup, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer setup.Rollback(context.Background())
	var employee, therapist, treatment, variant, booking, item string
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(setup.QueryRow(ctx, `INSERT INTO hris.employees(full_name,nip,email,phone,join_date) VALUES('Commission concurrency',$1,$2,'0812',CURRENT_DATE) RETURNING id::text`, "CC-"+testutil.RandomHex(4), testutil.RandomHex(5)+"@test.local").Scan(&employee))
	must(setup.QueryRow(ctx, `INSERT INTO spa.therapists(employee_id,home_branch_id) VALUES($1,$2) RETURNING id::text`, employee, org.BranchID).Scan(&therapist))
	must(setup.QueryRow(ctx, `INSERT INTO spa.treatments(code,name) VALUES($1,'Commission concurrency') RETURNING id::text`, "CC"+strings.ToUpper(testutil.RandomHex(4))).Scan(&treatment))
	must(setup.QueryRow(ctx, `INSERT INTO spa.treatment_variants(treatment_id,name,duration_min,price_idr) VALUES($1,'60',60,100000) RETURNING id::text`, treatment).Scan(&variant))
	_, err = setup.Exec(ctx, `INSERT INTO spa.commission_rules(variant_id,therapist_level,commission_type,value) VALUES($1,0,'fixed',10000)`, variant)
	must(err)
	must(setup.QueryRow(ctx, `INSERT INTO spa.bookings(booking_code,branch_id,warehouse_id,booking_type,customer_name,scheduled_at,ends_at,therapist_id,status)
 VALUES($1,$2,(SELECT id FROM configuration.warehouses WHERE branch_id=$2 LIMIT 1),'walk_in','Concurrent customer',now(),now()+interval '1 hour',$3,'in_treatment') RETURNING id::text`, "CC-"+testutil.RandomHex(5), org.BranchID, therapist).Scan(&booking))
	must(setup.QueryRow(ctx, `INSERT INTO spa.booking_items(booking_id,variant_id,treatment_name,variant_name,duration_min,price_idr,therapist_id,status)
 VALUES($1,$2,'Concurrent','60',60,100000,$3,'in_treatment') RETURNING id::text`, booking, variant, therapist).Scan(&item))
	must(setup.Commit(ctx))
	t.Cleanup(func() {
		for _, statement := range []struct{ sql, id string }{
			{`DELETE FROM spa.bookings WHERE id=$1`, booking},
			{`DELETE FROM spa.treatments WHERE id=$1`, treatment},
			{`DELETE FROM spa.therapists WHERE id=$1`, therapist},
			{`DELETE FROM hris.employees WHERE id=$1`, employee},
		} {
			if _, err := db.Exec(context.Background(), statement.sql, statement.id); err != nil {
				t.Error(err)
			}
		}
	})
	edit, err := db.Begin(ctx)
	must(err)
	defer edit.Rollback(context.Background())
	_, err = edit.Exec(ctx, `UPDATE spa.commission_rules SET value=20000 WHERE variant_id=$1`, variant)
	must(err)
	completion, err := db.Begin(ctx)
	must(err)
	defer completion.Rollback(context.Background())
	_, err = completion.Exec(ctx, `SET LOCAL statement_timeout='2s'`)
	must(err)
	svc := &Service{}
	must(svc.freezeCommission(ctx, completion, itemRow{ID: item, VariantID: variant, TherapistID: &therapist}))
	must(edit.Commit(ctx))
	must(completion.Commit(ctx))
	var amount float64
	var level int
	must(db.QueryRow(ctx, `SELECT commission_idr::float8,commission_level FROM spa.booking_items WHERE id=$1`, item).Scan(&amount, &level))
	if amount != 10000 || level != 0 {
		t.Fatalf("snapshot changed during edit: %v level %v", amount, level)
	}
}
