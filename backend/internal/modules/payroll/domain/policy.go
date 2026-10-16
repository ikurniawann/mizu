package domain

// MultiEntityPolicy decides, for an employee paid by several entities
// (EPIC-054), which slip carries the items that must not repeat on every
// slip of the period.
//
// Only PolicyPrimaryEntity is implemented. Options awaiting HR's decision
// (K5/K6, docs/epics/EPIC-054-payroll-multi-entitas.md), NOT implemented:
//   - "proportional": loan installment and late deduction split by each
//     entity's share of the total base salary;
//   - "per_entity": loans recorded per entity (needs hris.loans.company_id);
//   - overtime paid by the entity owning the store where it was worked.
//
// Attendance items proportional to the base salary (prorate, unpaid leave,
// overtime, THR) stay on every slip under every policy: computed from each
// entity's base they add up to the amount on the total.
type MultiEntityPolicy string

// PolicyPrimaryEntity keeps the loan installment and the late deduction on
// the primary entity's slip only.
const PolicyPrimaryEntity MultiEntityPolicy = "primary_entity"

// ApplyMultiEntityPolicy adjusts one entity's input; isPrimary says whether
// that entity is the employee's primary one (PrimaryEntity).
func ApplyMultiEntityPolicy(in Input, isPrimary bool, p MultiEntityPolicy) Input {
	if isPrimary {
		return in
	}
	switch p {
	case PolicyPrimaryEntity:
		in.LoanDeduction = 0
		in.LoanBreakdown = nil
		in.ClearLate()
	}
	return in
}
