package payroll

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	payrollevents "nuhabit/backend/internal/contracts/payroll"
	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/database"
)

// Store allocation of payroll slips (multi-store payroll): hris.
// payroll_detail_allocations belongs to this module. It is written with the
// slip when a draft run is calculated (and dropped with it on recalculation:
// FK ON DELETE CASCADE), so it is as immutable as the slip once the run
// leaves draft. Store names come from configuration.branches.

// allocationTableColumn is the allocation table's name of a slip column.
func allocationTableColumn(col string) string {
	switch col {
	case "gross_salary":
		return "gross_amount"
	case "total_deductions":
		return "deductions_amount"
	case "net_salary":
		return "net_amount"
	}
	return col
}

// slipAmounts reads the money columns of a stored payroll_details row (the
// values as numeric(12,2) stored them).
func slipAmounts(detail *obj) map[string]float64 {
	out := make(map[string]float64, len(domain.AllocationColumns))
	for _, c := range domain.AllocationColumns {
		out[c] = domain.OrZero(detail.Get(c))
	}
	// The store share of all earnings (labour cost): taxable gross plus the
	// non-taxable earnings, so gross = net + deductions per store too.
	out["gross_salary"] += out["other_earning_nontax"]
	return out
}

// branchDays turns the period attendance into the allocation input.
func branchDays(rows []domain.AttendanceRow) []domain.BranchDay {
	out := make([]domain.BranchDay, len(rows))
	for i, a := range rows {
		out[i] = domain.BranchDay{Date: a.Date, Status: a.Status, BranchID: a.BranchID, WorkHours: a.WorkHours}
	}
	return out
}

// insertAllocations stores a slip's store shares.
func insertAllocations(ctx context.Context, q database.Querier, runID, detailID, employeeID string, a domain.SlipAllocation) error {
	cols := []string{"payroll_detail_id", "payroll_run_id", "employee_id", "branch_id", "basis", "days", "hours", "ratio"}
	for _, c := range domain.AllocationColumns {
		cols = append(cols, allocationTableColumn(c))
	}
	cols = append(cols, "employer_contribution_amount", "sort_order")
	marks := make([]string, len(cols))
	for i := range cols {
		marks[i] = fmt.Sprintf("$%d", i+1)
	}
	sql := `INSERT INTO hris.payroll_detail_allocations (` + strings.Join(cols, ", ") + `) VALUES (` + strings.Join(marks, ", ") + `)`
	for i, share := range a.Shares {
		args := []any{detailID, runID, employeeID, share.BranchID, a.Basis,
			numParam(share.Days), numParam(share.Hours), numParam(share.Ratio)}
		for _, c := range domain.AllocationColumns {
			args = append(args, numParam(share.Amounts[c]))
		}
		args = append(args, numParam(share.Employer()), i)
		if _, err := q.Exec(ctx, sql, args...); err != nil {
			return err
		}
	}
	return nil
}

// allocationWarning flags a slip whose cost (or part of it) has no store.
type allocationWarning struct {
	EmployeeID string `json:"employee_id"`
	FullName   string `json:"full_name"`
	Reason     string `json:"reason"`
}

func warningFor(e EmployeeBrief, a domain.SlipAllocation) *allocationWarning {
	if !a.Unassigned {
		return nil
	}
	reason := "Belum ada penempatan toko — biaya masuk \"Tanpa toko\""
	if a.Basis != domain.BasisNone && len(a.Shares) > 1 {
		reason = "Sebagian absensi tanpa toko dan tanpa penempatan utama — sebagian biaya masuk \"Tanpa toko\""
	}
	return &allocationWarning{EmployeeID: e.ID, FullName: e.FullName, Reason: reason}
}

// detailAllocationsJSON is the allocations embed of the payroll_details
// row aliased alias (store order as calculated).
func detailAllocationsJSON(alias string) string {
	return `COALESCE((SELECT json_agg(x ORDER BY x.sort_order) FROM (
       SELECT a.branch_id, b.code AS branch_code, b.name AS branch_name, a.basis, a.ratio, a.days, a.hours,
              a.gross_amount, a.deductions_amount, a.net_amount, a.employer_contribution_amount, a.sort_order
         FROM hris.payroll_detail_allocations a
         LEFT JOIN configuration.branches b ON b.id = a.branch_id
        WHERE a.payroll_detail_id = ` + alias + `.id) x), '[]'::json)`
}

// runAllocationSummary is the per-store total of a run and the slips with
// cost outside any store, for the run page.
func (s *service) runAllocationSummary(ctx context.Context, runID string) (*obj, error) {
	stores, err := queryObjs(ctx, s.db, `SELECT a.branch_id, b.code AS branch_code, b.name AS branch_name,
		count(DISTINCT a.employee_id)::int AS employee_count, sum(a.ratio) AS fte,
		sum(a.gross_amount) AS gross_amount, sum(a.employer_contribution_amount) AS employer_contribution_amount,
		sum(a.gross_amount + a.employer_contribution_amount) AS labor_cost
		FROM hris.payroll_detail_allocations a
		LEFT JOIN configuration.branches b ON b.id = a.branch_id
		WHERE a.payroll_run_id = $1
		GROUP BY a.branch_id, b.code, b.name
		ORDER BY (a.branch_id IS NULL), b.name`, runID)
	if err != nil {
		return nil, opaque(err)
	}
	unassigned, err := queryObjs(ctx, s.db, `SELECT a.employee_id, sum(a.gross_amount) AS gross_amount
		FROM hris.payroll_detail_allocations a
		WHERE a.payroll_run_id = $1 AND a.branch_id IS NULL
		GROUP BY a.employee_id`, runID)
	if err != nil {
		return nil, opaque(err)
	}
	if err := s.stitch(ctx, s.db, unassigned, embed{"employee", "employee_id", personFields}); err != nil {
		return nil, err
	}
	var allocated int
	if err := s.db.QueryRow(ctx, `SELECT count(DISTINCT payroll_detail_id)::int FROM hris.payroll_detail_allocations
		WHERE payroll_run_id = $1`, runID).Scan(&allocated); err != nil {
		return nil, err
	}
	return object("stores", stores, "unassigned", unassigned, "allocated_slips", allocated), nil
}

// branchCosts reads a run's allocation rows for the journal split.
func branchCosts(ctx context.Context, q database.Querier, runID string) ([]domain.AllocationCost, error) {
	rows, err := q.Query(ctx, `SELECT employee_id::text, branch_id::text, gross_amount::float8,
		(bpjs_tk_jht_employer + bpjs_tk_jp_employer + bpjs_tk_jkk_employer + bpjs_tk_jkm_employer)::float8,
		bpjs_kes_employer::float8, tapera_employer::float8
		FROM hris.payroll_detail_allocations WHERE payroll_run_id = $1 ORDER BY payroll_detail_id, sort_order`, runID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.AllocationCost, error) {
		var c domain.AllocationCost
		return c, r.Scan(&c.EmployeeID, &c.BranchID, &c.Gross, &c.BpjsTkEmployer, &c.BpjsKesEmployer, &c.TaperaEmployer)
	})
}

// runBranches converts a company's store costs to the event payload.
func runBranches(costs []domain.BranchCost) []payrollevents.RunBranch {
	if len(costs) == 0 {
		return nil
	}
	out := make([]payrollevents.RunBranch, len(costs))
	for i, c := range costs {
		out[i] = payrollevents.RunBranch{BranchID: c.BranchID, TotalGross: c.Gross, TotalBpjsTkEmployer: c.BpjsTkEmployer,
			TotalBpjsKesEmployer: c.BpjsKesEmployer, TotalTaperaEmployer: c.TaperaEmployer}
	}
	return out
}
