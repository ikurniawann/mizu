package domain

import (
	"cmp"
	"math"
	"slices"
)

// Store allocation of a payroll slip (multi-store payroll). An employee keeps
// one slip and one PPh 21/BPJS computation; its cost is split over the stores
// (configuration.branches) the employee worked at in the period, weighted by
// attendance:
//
//   - hours:   work hours per store (a day without hours counts the
//     employee's average hours of the days that have them)
//   - days:    days present per store, when no day has work hours
//   - primary: no attendance at all, 100% to the primary placement
//   - none:    no placement in the period, one "Tanpa toko" bucket (nil branch)
//
// Attendance without a store counts for the primary placement. Every money
// column is split in cents with the largest-remainder method, so the per-store
// amounts of a column add up to the slip's value exactly.

// Allocation bases.
const (
	BasisHours   = "hours"
	BasisDays    = "days"
	BasisPrimary = "primary"
	BasisNone    = "none"
)

// AllocationColumns are the payroll_details money columns split per store,
// in the order the allocation table stores them.
var AllocationColumns = []string{
	"base_salary", "fixed_allowance", "variable_allowance", "transport_allowance", "meal_allowance",
	"housing_allowance", "overtime_pay", "thr", "bonus", "other_earning", "gross_salary",
	"bpjs_tk_jht_deduction", "bpjs_tk_jp_deduction", "bpjs_kes_deduction", "tapera_deduction",
	"pph21_deduction", "unpaid_leave_deduction", "late_deduction", "loan_deduction", "other_deduction",
	"total_deductions", "net_salary",
	"bpjs_tk_jht_employer", "bpjs_tk_jp_employer", "bpjs_tk_jkk_employer", "bpjs_tk_jkm_employer",
	"bpjs_kes_employer", "tapera_employer",
}

// EmployerColumns are the employer contributions (beban perusahaan).
var EmployerColumns = []string{
	"bpjs_tk_jht_employer", "bpjs_tk_jp_employer", "bpjs_tk_jkk_employer", "bpjs_tk_jkm_employer",
	"bpjs_kes_employer", "tapera_employer",
}

// ResultAmounts maps a calculated slip to its allocation columns.
func ResultAmounts(r Result) map[string]float64 {
	return map[string]float64{
		"base_salary": r.BaseSalary, "fixed_allowance": r.FixedAllowance, "variable_allowance": r.VariableAllowance,
		"transport_allowance": r.TransportAllowance, "meal_allowance": r.MealAllowance,
		"housing_allowance": r.HousingAllowance, "overtime_pay": r.OvertimePay, "thr": r.Thr, "bonus": r.Bonus,
		"other_earning": r.OtherEarning, "gross_salary": r.GrossSalary,
		"bpjs_tk_jht_deduction": r.BpjsTkJhtDeduction, "bpjs_tk_jp_deduction": r.BpjsTkJpDeduction,
		"bpjs_kes_deduction": r.BpjsKesDeduction, "tapera_deduction": r.TaperaDeduction,
		"pph21_deduction": r.Pph21Deduction, "unpaid_leave_deduction": r.UnpaidLeaveDeduction,
		"late_deduction": r.LateDeduction, "loan_deduction": r.LoanDeduction, "other_deduction": r.OtherDeduction,
		"total_deductions": r.TotalDeductions, "net_salary": r.NetSalary,
		"bpjs_tk_jht_employer": r.BpjsTkJhtEmployer, "bpjs_tk_jp_employer": r.BpjsTkJpEmployer,
		"bpjs_tk_jkk_employer": r.BpjsTkJkkEmployer, "bpjs_tk_jkm_employer": r.BpjsTkJkmEmployer,
		"bpjs_kes_employer": r.BpjsKesEmployer, "tapera_employer": r.TaperaEmployer,
	}
}

// Placement is one hris.employee_placements row (dates YYYY-MM-DD, End nil
// while it runs).
type Placement struct {
	BranchID  string
	IsPrimary bool
	Start     string
	End       *string
}

// overlaps reports whether the placement runs on any day of [start, end].
func (p Placement) overlaps(start, end string) bool {
	return p.Start <= end && (p.End == nil || *p.End >= start)
}

// BranchDay is one attendance row of the period: its store (nil when not
// recorded) and work hours (nil without a clock-out).
type BranchDay struct {
	Date      string
	Status    string
	BranchID  *string
	WorkHours *float64
}

// PeriodPrimary is the store the period falls back to: the primary placement
// running in [start, end] (the latest one when it changed mid-period), else
// the earliest placement running then; nil without any.
func PeriodPrimary(placements []Placement, start, end string) *string {
	var primary, first *Placement
	for i := range placements {
		p := &placements[i]
		if !p.overlaps(start, end) {
			continue
		}
		if p.IsPrimary && (primary == nil || p.Start > primary.Start) {
			primary = p
		}
		if first == nil || p.Start < first.Start || (p.Start == first.Start && p.BranchID < first.BranchID) {
			first = p
		}
	}
	switch {
	case primary != nil:
		return &primary.BranchID
	case first != nil:
		return &first.BranchID
	}
	return nil
}

// AllocationShare is one store's part of a slip. BranchID nil is the
// "Tanpa toko" bucket. Amounts holds every AllocationColumns value.
type AllocationShare struct {
	BranchID *string
	Days     float64
	Hours    float64
	Ratio    float64
	Amounts  map[string]float64
}

// Employer is the share's employer contribution total.
func (s AllocationShare) Employer() float64 {
	cents := int64(0)
	for _, c := range EmployerColumns {
		cents += toCents(s.Amounts[c])
	}
	return fromCents(cents)
}

// SlipAllocation is a slip split over stores.
type SlipAllocation struct {
	Basis  string
	Shares []AllocationShare
	// Unassigned is true when part of the cost has no store (nil bucket).
	Unassigned bool
}

// countsAsWork is an attendance row that put the employee at a store.
func countsAsWork(status string) bool { return status != "absent" }

// AllocateSlip splits the slip amounts over the stores of the period
// [start, end] from its attendance days and placements.
func AllocateSlip(amounts map[string]float64, days []BranchDay, placements []Placement, start, end string) SlipAllocation {
	primary := PeriodPrimary(placements, start, end)
	type bucket struct {
		branch       *string
		days, hours  float64
		weight       float64
		missingHours int
	}
	var buckets []*bucket
	find := func(branch *string) *bucket {
		for _, b := range buckets {
			if sameBranch(b.branch, branch) {
				return b
			}
		}
		b := &bucket{branch: branch}
		buckets = append(buckets, b)
		return b
	}
	worked, withHours, totalHours := 0, 0, 0.0
	for _, d := range days {
		if !countsAsWork(d.Status) || d.Date < start || d.Date > end {
			continue
		}
		branch := d.BranchID
		if branch == nil || *branch == "" {
			branch = primary
		}
		b := find(branch)
		b.days++
		worked++
		if d.WorkHours != nil && *d.WorkHours > 0 {
			b.hours += *d.WorkHours
			totalHours += *d.WorkHours
			withHours++
		} else {
			b.missingHours++
		}
	}

	out := SlipAllocation{}
	switch {
	case worked == 0 && primary == nil:
		out.Basis = BasisNone
		buckets = []*bucket{{weight: 1}}
	case worked == 0:
		out.Basis = BasisPrimary
		buckets = []*bucket{{branch: primary, weight: 1}}
	case withHours == 0:
		out.Basis = BasisDays
		for _, b := range buckets {
			b.weight = b.days
		}
	default:
		out.Basis = BasisHours
		avg := totalHours / float64(withHours)
		for _, b := range buckets {
			b.weight = b.hours + avg*float64(b.missingHours)
		}
	}

	// Primary store first, then the larger shares; the "Tanpa toko" bucket last.
	slices.SortStableFunc(buckets, func(a, b *bucket) int {
		rank := func(x *bucket) int {
			switch {
			case x.branch == nil:
				return 2
			case primary != nil && *x.branch == *primary:
				return 0
			}
			return 1
		}
		if c := cmp.Compare(rank(a), rank(b)); c != 0 {
			return c
		}
		if c := cmp.Compare(b.weight, a.weight); c != 0 {
			return c
		}
		return cmp.Compare(deref(a.branch), deref(b.branch))
	})

	weights := make([]float64, len(buckets))
	for i, b := range buckets {
		weights[i] = b.weight
	}
	ratios := SplitUnits(1_000_000, weights)
	out.Shares = make([]AllocationShare, len(buckets))
	for i, b := range buckets {
		out.Shares[i] = AllocationShare{BranchID: b.branch, Days: b.days, Hours: round2(b.hours),
			Ratio: float64(ratios[i]) / 1_000_000, Amounts: map[string]float64{}}
		if b.branch == nil {
			out.Unassigned = true
		}
	}
	for _, col := range AllocationColumns {
		parts := SplitAmount(amounts[col], weights)
		for i := range out.Shares {
			out.Shares[i].Amounts[col] = parts[i]
		}
	}
	return out
}

// SplitAmount splits a rupiah amount (cents precision) proportionally to
// weights with the largest-remainder method: the parts add up to the amount
// exactly. Without a positive weight everything goes to the first part.
func SplitAmount(amount float64, weights []float64) []float64 {
	cents := toCents(amount)
	sign := int64(1)
	if cents < 0 {
		sign, cents = -1, -cents
	}
	units := SplitUnits(cents, weights)
	out := make([]float64, len(units))
	for i, u := range units {
		out[i] = fromCents(sign * u)
	}
	return out
}

// SplitUnits splits total (>= 0) integer units proportionally to weights,
// flooring each share and handing the leftover units to the largest
// fractional remainders (ties: earlier index). Negative weights count as 0;
// with no positive weight the first part takes everything.
func SplitUnits(total int64, weights []float64) []int64 {
	out := make([]int64, len(weights))
	if len(weights) == 0 {
		return out
	}
	sum := 0.0
	for _, w := range weights {
		if w > 0 {
			sum += w
		}
	}
	if sum <= 0 || total == 0 {
		out[0] = total
		return out
	}
	type rem struct {
		i    int
		frac float64
	}
	rems := make([]rem, len(weights))
	given := int64(0)
	for i, w := range weights {
		if w < 0 {
			w = 0
		}
		exact := float64(total) * w / sum
		floor := math.Floor(exact)
		out[i] = int64(floor)
		given += out[i]
		rems[i] = rem{i, exact - floor}
	}
	slices.SortStableFunc(rems, func(a, b rem) int { return cmp.Compare(b.frac, a.frac) })
	for k := 0; given < total; k = (k + 1) % len(rems) {
		out[rems[k].i]++
		given++
	}
	// Float noise can floor a share one unit high; take it back from the
	// smallest remainders so the parts still add up exactly.
	for k := len(rems) - 1; given > total; k = (k + len(rems) - 1) % len(rems) {
		if out[rems[k].i] > 0 {
			out[rems[k].i]--
			given--
		}
	}
	return out
}

func toCents(v float64) int64 { return int64(math.Round(v * 100)) }

func fromCents(c int64) float64 { return float64(c) / 100 }

func sameBranch(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// BranchCost is one store's part of a group of slips (a company of a paid
// run): the expense amounts the payroll journals split per store.
type BranchCost struct {
	BranchID        *string
	Gross           float64
	BpjsTkEmployer  float64
	BpjsKesEmployer float64
	TaperaEmployer  float64
}

// AllocationCost is one stored allocation row with the employee it belongs to.
type AllocationCost struct {
	EmployeeID string
	BranchCost
}

// SplitCostsByCompany groups allocation rows by each employee's company
// (companies maps employee id to company id, "" when unknown) and by store,
// summing in cents. Stores are ordered by branch id, the nil store last.
func SplitCostsByCompany(rows []AllocationCost, companies map[string]string) map[string][]BranchCost {
	type acc struct {
		branch                 *string
		gross, tk, kes, tapera int64
	}
	groups := map[string][]*acc{}
	for _, r := range rows {
		company := companies[r.EmployeeID]
		list := groups[company]
		var a *acc
		for _, x := range list {
			if sameBranch(x.branch, r.BranchID) {
				a = x
				break
			}
		}
		if a == nil {
			a = &acc{branch: r.BranchID}
			groups[company] = append(list, a)
		}
		a.gross += toCents(r.Gross)
		a.tk += toCents(r.BpjsTkEmployer)
		a.kes += toCents(r.BpjsKesEmployer)
		a.tapera += toCents(r.TaperaEmployer)
	}
	out := map[string][]BranchCost{}
	for company, list := range groups {
		slices.SortFunc(list, func(a, b *acc) int {
			switch {
			case a.branch == nil && b.branch == nil:
				return 0
			case a.branch == nil:
				return 1
			case b.branch == nil:
				return -1
			}
			return cmp.Compare(*a.branch, *b.branch)
		})
		costs := make([]BranchCost, len(list))
		for i, a := range list {
			costs[i] = BranchCost{BranchID: a.branch, Gross: fromCents(a.gross), BpjsTkEmployer: fromCents(a.tk),
				BpjsKesEmployer: fromCents(a.kes), TaperaEmployer: fromCents(a.tapera)}
		}
		out[company] = costs
	}
	return out
}
