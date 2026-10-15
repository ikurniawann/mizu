package domain

import "testing"

func TestSplitLinesByBranch(t *testing.T) {
	pvj, kopo := "pvj", "kopo"
	sort := 10
	lines := []Line{
		{AccountID: "beban-gaji", Side: Debit, Amount: 1000.01, SortOrder: &sort},
		{AccountID: "utang-gaji", Side: Credit, Amount: 1000.01},
	}
	got := SplitLinesByBranch(lines, Debit, []BranchShare{
		{BranchID: &pvj, Amount: 3}, {BranchID: &kopo, Amount: 2}, {BranchID: nil, Amount: 0},
	})
	if len(got) != 3 {
		t.Fatalf("lines %+v", got)
	}
	if *got[0].BranchID != pvj || *got[1].BranchID != kopo || got[2].BranchID != nil || got[2].Side != Credit {
		t.Fatalf("branches %+v", got)
	}
	if got[0].Amount != 600.01 || got[1].Amount != 400 {
		t.Fatalf("amounts %v %v", got[0].Amount, got[1].Amount)
	}
	if got[0].SortOrder == nil || *got[0].SortOrder != 10 || got[0].AccountID != "beban-gaji" {
		t.Fatalf("line fields lost %+v", got[0])
	}
	if err := ValidateBalanced(got); err != nil {
		t.Fatalf("unbalanced: %v", err)
	}
	// No positive share: unchanged.
	if same := SplitLinesByBranch(lines, Debit, []BranchShare{{BranchID: &pvj}}); len(same) != 2 || same[0].BranchID != nil {
		t.Fatalf("unchanged %+v", same)
	}
	// The company-level share keeps its part without a branch.
	mixed := SplitLinesByBranch(lines[:1], Debit, []BranchShare{{BranchID: &pvj, Amount: 1}, {Amount: 1}})
	if len(mixed) != 2 || mixed[1].BranchID != nil || mixed[0].Amount != 500.01 || mixed[1].Amount != 500 {
		t.Fatalf("mixed %+v", mixed)
	}
}
