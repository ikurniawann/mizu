package domain

import "testing"

func TestApplyMultiEntityPolicy(t *testing.T) {
	in := Input{BaseSalary: 1_000_000, LoanDeduction: 100_000,
		LoanBreakdown: []LoanInstallmentDetail{{}}, LateDays: 2, LateMinutes: 30, UnpaidLeaveDays: 1, OvertimeHours: 3}

	if got := ApplyMultiEntityPolicy(in, true, PolicyPrimaryEntity); got.LoanDeduction != 100_000 || got.LateDays != 2 ||
		got.LateMinutes != 30 || len(got.LoanBreakdown) != 1 {
		t.Fatalf("primary slip changed: %+v", got)
	}
	got := ApplyMultiEntityPolicy(in, false, PolicyPrimaryEntity)
	if got.LoanDeduction != 0 || got.LoanBreakdown != nil || got.LateDays != 0 || got.LateMinutes != 0 {
		t.Fatalf("secondary slip keeps once-per-period items: %+v", got)
	}
	// Attendance items proportional to the base stay on every slip (K6 default).
	if got.UnpaidLeaveDays != 1 || got.OvertimeHours != 3 || got.BaseSalary != 1_000_000 {
		t.Fatalf("secondary slip lost proportional items: %+v", got)
	}
}
