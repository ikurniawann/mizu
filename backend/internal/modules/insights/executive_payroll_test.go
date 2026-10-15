package insights

import (
	"context"
	"testing"
)

// payrollTerakhir covers the whole newest period: with one run per entity the
// total is the sum of the runs, not the net of a single entity.
func TestPayrollLastSumsEntityRuns(t *testing.T) {
	h := newTxHarness(t)
	ctx := context.Background()
	var holding, c1, c2 string
	if err := h.tx.QueryRow(ctx, `INSERT INTO configuration.holdings (name, code) VALUES ('PL Holding', 'PLH-'||substr(md5(random()::text),1,6)) RETURNING id::text`).Scan(&holding); err != nil {
		t.Fatal(err)
	}
	for i, dst := range []*string{&c1, &c2} {
		if err := h.tx.QueryRow(ctx, `INSERT INTO configuration.companies (holding_id, name, code) VALUES ($1, $2, $3) RETURNING id::text`,
			holding, "PL Co "+string(rune('A'+i)), "PL"+string(rune('A'+i))).Scan(dst); err != nil {
			t.Fatal(err)
		}
	}
	// A far-future period so it is the newest whatever the database holds.
	h.exec(`INSERT INTO hris.payroll_runs (run_name, period_month, period_year, status, total_net, company_id, created_at, paid_at)
		VALUES ('Run A', 12, 2099, 'paid', 1000000, $1, now() - interval '1 hour', now() - interval '1 hour'),
		       ('Run B', 12, 2099, 'paid', 2500000.50, $2, now(), now())`, c1, c2)

	got, err := h.svc.payrollLast(ctx)
	if err != nil || got == nil {
		t.Fatalf("payrollLast = %v, %v", got, err)
	}
	if got.Periode != "Des 2099" || got.TotalNet != 3500000.50 {
		t.Fatalf("payrollLast = %+v, want Des 2099 summing both entity runs", got)
	}
}
