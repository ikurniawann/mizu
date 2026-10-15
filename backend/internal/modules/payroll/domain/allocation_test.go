package domain

import (
	"math"
	"math/rand/v2"
	"testing"
)

const (
	pvj  = "branch-pvj"
	kopo = "branch-kopo"
	hq   = "branch-hq"
)

func sampleAmounts() map[string]float64 {
	return map[string]float64{
		"base_salary": 4_500_000, "fixed_allowance": 300_000, "meal_allowance": 250_000, "overtime_pay": 87_250.5,
		"gross_salary": 5_137_250.5, "bpjs_tk_jht_deduction": 90_000, "bpjs_tk_jp_deduction": 45_000,
		"bpjs_kes_deduction": 45_000, "pph21_deduction": 25_686.25, "total_deductions": 205_686.25,
		"net_salary": 4_931_564.25, "bpjs_tk_jht_employer": 166_500, "bpjs_tk_jp_employer": 90_000,
		"bpjs_tk_jkk_employer": 10_800, "bpjs_tk_jkm_employer": 13_500, "bpjs_kes_employer": 180_000,
	}
}

// sumsExact checks every column adds up to the slip value to the cent.
func sumsExact(t *testing.T, a SlipAllocation, amounts map[string]float64) {
	t.Helper()
	ratio := 0.0
	for _, s := range a.Shares {
		ratio += s.Ratio
	}
	if math.Abs(ratio-1) > 1e-9 {
		t.Fatalf("ratios sum %v", ratio)
	}
	for _, col := range AllocationColumns {
		var cents int64
		for _, s := range a.Shares {
			cents += toCents(s.Amounts[col])
		}
		if cents != toCents(amounts[col]) {
			t.Fatalf("%s: shares sum %d cents, slip %d", col, cents, toCents(amounts[col]))
		}
	}
}

func TestAllocateSlipByHours(t *testing.T) {
	placements := []Placement{
		{BranchID: pvj, IsPrimary: true, Start: "2026-01-01"},
		{BranchID: kopo, Start: "2026-09-01", End: ptr("2026-09-30")},
	}
	days := []BranchDay{
		{Date: "2026-09-01", Status: "present", BranchID: ptr(pvj), WorkHours: ptr(8.0)},
		{Date: "2026-09-02", Status: "late", BranchID: ptr(pvj), WorkHours: ptr(7.5)},
		{Date: "2026-09-03", Status: "present", BranchID: ptr(kopo), WorkHours: ptr(9.0)},
		{Date: "2026-09-04", Status: "present", BranchID: nil, WorkHours: ptr(6.5)}, // no store: primary
		{Date: "2026-09-05", Status: "absent", BranchID: ptr(kopo), WorkHours: ptr(8.0)},
		{Date: "2026-09-06", Status: "present", BranchID: ptr(kopo)},                      // no clock-out: average hours
		{Date: "2026-10-01", Status: "present", BranchID: ptr(kopo), WorkHours: ptr(8.0)}, // outside period
	}
	amounts := sampleAmounts()
	a := AllocateSlip(amounts, days, placements, "2026-09-01", "2026-09-30")
	if a.Basis != BasisHours || a.Unassigned || len(a.Shares) != 2 {
		t.Fatalf("allocation %+v", a)
	}
	// pvj 8+7.5+6.5 = 22h over 3 days; kopo 9h + avg (31/4 = 7.75) = 16.75 weight, 2 days.
	p, k := a.Shares[0], a.Shares[1]
	if *p.BranchID != pvj || *k.BranchID != kopo {
		t.Fatalf("order %v %v", *p.BranchID, *k.BranchID)
	}
	if p.Days != 3 || p.Hours != 22 || k.Days != 2 || k.Hours != 9 {
		t.Fatalf("days/hours %+v %+v", p, k)
	}
	if math.Abs(p.Ratio-22/38.75) > 1e-6 || math.Abs(k.Ratio-16.75/38.75) > 1e-6 {
		t.Fatalf("ratios %v %v", p.Ratio, k.Ratio)
	}
	sumsExact(t, a, amounts)
	if got := p.Employer() + k.Employer(); math.Abs(got-460_800) > 1e-6 {
		t.Fatalf("employer %v", got)
	}
}

func TestAllocateSlipByDaysWithoutHours(t *testing.T) {
	placements := []Placement{{BranchID: pvj, IsPrimary: true, Start: "2026-01-01"}, {BranchID: kopo, Start: "2026-01-01"}}
	days := []BranchDay{
		{Date: "2026-09-01", Status: "present", BranchID: ptr(pvj)},
		{Date: "2026-09-02", Status: "present", BranchID: ptr(kopo)},
		{Date: "2026-09-03", Status: "present", BranchID: ptr(kopo)},
	}
	amounts := map[string]float64{"gross_salary": 100, "net_salary": 100}
	a := AllocateSlip(amounts, days, placements, "2026-09-01", "2026-09-30")
	if a.Basis != BasisDays || len(a.Shares) != 2 {
		t.Fatalf("allocation %+v", a)
	}
	// 1/3 vs 2/3 of 100.00: 33.33 + 66.67 (the larger remainder gets the cent).
	if a.Shares[0].Amounts["gross_salary"] != 33.33 || a.Shares[1].Amounts["gross_salary"] != 66.67 {
		t.Fatalf("split %+v", a.Shares)
	}
	sumsExact(t, a, amounts)
}

func TestAllocateSlipFallbacks(t *testing.T) {
	amounts := sampleAmounts()
	// No attendance: 100% to the primary placement.
	a := AllocateSlip(amounts, nil, []Placement{{BranchID: kopo, Start: "2026-01-01"}, {BranchID: pvj, IsPrimary: true, Start: "2026-02-01"}}, "2026-09-01", "2026-09-30")
	if a.Basis != BasisPrimary || len(a.Shares) != 1 || *a.Shares[0].BranchID != pvj || a.Shares[0].Ratio != 1 {
		t.Fatalf("primary %+v", a)
	}
	sumsExact(t, a, amounts)

	// No primary flag: the earliest running placement is the fallback.
	a = AllocateSlip(amounts, nil, []Placement{{BranchID: kopo, Start: "2026-03-01"}, {BranchID: pvj, Start: "2026-02-01"}}, "2026-09-01", "2026-09-30")
	if *a.Shares[0].BranchID != pvj {
		t.Fatalf("fallback %+v", a.Shares[0])
	}

	// A placement that ended before the period does not count.
	a = AllocateSlip(amounts, nil, []Placement{{BranchID: pvj, IsPrimary: true, Start: "2026-01-01", End: ptr("2026-08-31")}}, "2026-09-01", "2026-09-30")
	if a.Basis != BasisNone || !a.Unassigned || len(a.Shares) != 1 || a.Shares[0].BranchID != nil {
		t.Fatalf("none %+v", a)
	}
	sumsExact(t, a, amounts)

	// Attendance without any placement: everything in the "Tanpa toko" bucket.
	days := []BranchDay{{Date: "2026-09-01", Status: "present", WorkHours: ptr(8.0)}}
	a = AllocateSlip(amounts, days, nil, "2026-09-01", "2026-09-30")
	if a.Basis != BasisHours || !a.Unassigned || len(a.Shares) != 1 || a.Shares[0].BranchID != nil {
		t.Fatalf("no placement %+v", a)
	}

	// A store recorded on attendance but no placement: that store plus the
	// unassigned days.
	days = []BranchDay{
		{Date: "2026-09-01", Status: "present", BranchID: ptr(hq), WorkHours: ptr(8.0)},
		{Date: "2026-09-02", Status: "present", WorkHours: ptr(8.0)},
	}
	a = AllocateSlip(amounts, days, nil, "2026-09-01", "2026-09-30")
	if len(a.Shares) != 2 || *a.Shares[0].BranchID != hq || a.Shares[1].BranchID != nil || !a.Unassigned {
		t.Fatalf("mixed %+v", a)
	}
	sumsExact(t, a, amounts)
}

func TestSplitUnitsLargestRemainder(t *testing.T) {
	cases := []struct {
		total   int64
		weights []float64
		want    []int64
	}{
		{100, []float64{1, 1, 1}, []int64{34, 33, 33}},
		{10, []float64{2, 1}, []int64{7, 3}},
		{1, []float64{1, 1}, []int64{1, 0}},
		{500, []float64{0, 0}, []int64{500, 0}},
		{500, []float64{-1, 3}, []int64{0, 500}},
		{0, []float64{1, 2}, []int64{0, 0}},
	}
	for _, c := range cases {
		got := SplitUnits(c.total, c.weights)
		for i := range got {
			if got[i] != c.want[i] {
				t.Fatalf("SplitUnits(%d, %v) = %v, want %v", c.total, c.weights, got, c.want)
			}
		}
	}
	if got := SplitAmount(-10.01, []float64{1, 1}); got[0] != -5.01 || got[1] != -5 {
		t.Fatalf("negative %v", got)
	}
}

// Property: random slips and weights always sum to the cent.
func TestSplitAmountSumsExactly(t *testing.T) {
	r := rand.New(rand.NewPCG(7, 11))
	for range 2000 {
		n := 1 + r.IntN(5)
		weights := make([]float64, n)
		for i := range weights {
			weights[i] = r.Float64() * 200
		}
		amount := float64(r.Int64N(5_000_000_000)) / 100
		var cents int64
		for _, p := range SplitAmount(amount, weights) {
			cents += toCents(p)
		}
		if cents != toCents(amount) {
			t.Fatalf("SplitAmount(%v, %v) sums to %d cents", amount, weights, cents)
		}
	}
}

func TestSplitCostsByCompany(t *testing.T) {
	rows := []AllocationCost{
		{EmployeeID: "e1", BranchCost: BranchCost{BranchID: ptr(pvj), Gross: 100.10, BpjsTkEmployer: 5, BpjsKesEmployer: 4}},
		{EmployeeID: "e1", BranchCost: BranchCost{BranchID: ptr(kopo), Gross: 50.05, BpjsTkEmployer: 2.5}},
		{EmployeeID: "e2", BranchCost: BranchCost{BranchID: ptr(pvj), Gross: 0.2, TaperaEmployer: 1}},
		{EmployeeID: "e3", BranchCost: BranchCost{Gross: 9}},
	}
	got := SplitCostsByCompany(rows, map[string]string{"e1": "c1", "e2": "c1"})
	c1 := got["c1"]
	if len(c1) != 2 || *c1[0].BranchID != kopo || *c1[1].BranchID != pvj {
		t.Fatalf("c1 %+v", c1)
	}
	if c1[1].Gross != 100.3 || c1[1].BpjsTkEmployer != 5 || c1[1].TaperaEmployer != 1 || c1[0].Gross != 50.05 {
		t.Fatalf("c1 sums %+v", c1)
	}
	if none := got[""]; len(none) != 1 || none[0].BranchID != nil || none[0].Gross != 9 {
		t.Fatalf("unknown company %+v", none)
	}
}

func TestPercentID(t *testing.T) {
	for in, want := range map[float64]string{0.625: "62,5%", 1: "100,0%", 0: "0,0%", 0.333333: "33,3%"} {
		if got := PercentID(in); got != want {
			t.Fatalf("PercentID(%v) = %q, want %q", in, got, want)
		}
	}
}
