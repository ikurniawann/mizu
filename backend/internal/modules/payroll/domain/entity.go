package domain

import "slices"

// EntityOf is the company an employee is placed under at the end of a
// period: the company of the primary placement running on its last day
// (end), else of the latest-starting primary placement, else of the
// latest-starting placement. Placements whose store has no company are
// ignored; "" when none is left. Ties keep the first in input order.
func EntityOf(placements []Placement, branchCompany map[string]string, end string) string {
	onEnd := func(p Placement) bool { return p.Start <= end && (p.End == nil || *p.End >= end) }
	rules := []func(Placement) bool{
		func(p Placement) bool { return p.IsPrimary && onEnd(p) },
		func(p Placement) bool { return p.IsPrimary },
		func(Placement) bool { return true },
	}
	for _, ok := range rules {
		best := -1
		for i, p := range placements {
			if branchCompany[p.BranchID] == "" || !ok(p) {
				continue
			}
			if best < 0 || p.Start > placements[best].Start {
				best = i
			}
		}
		if best >= 0 {
			return branchCompany[placements[best].BranchID]
		}
	}
	return ""
}

// EntitySalary is one entity's active salary of an employee.
type EntitySalary struct {
	CompanyID string
	Base      float64
}

// PrimaryEntity is the entity that carries an employee's once-per-period
// items when several entities pay them: the placement's entity when it pays
// the employee, else the one paying the highest base salary (ties: lowest
// company id); "" without salaries.
func PrimaryEntity(placementEntity string, salaries []EntitySalary) string {
	if placementEntity != "" && slices.ContainsFunc(salaries, func(s EntitySalary) bool { return s.CompanyID == placementEntity }) {
		return placementEntity
	}
	best := ""
	bestBase := 0.0
	for _, s := range salaries {
		if best == "" || s.Base > bestBase || (s.Base == bestBase && s.CompanyID < best) {
			best, bestBase = s.CompanyID, s.Base
		}
	}
	return best
}

// ScopeToCompany keeps what one entity's slip is allocated over: the
// attendance days at that entity's stores or without a store, and the
// placements at its stores.
func ScopeToCompany(days []BranchDay, placements []Placement, branchCompany map[string]string, company string) ([]BranchDay, []Placement) {
	outDays := make([]BranchDay, 0, len(days))
	for _, d := range days {
		if d.BranchID == nil || branchCompany[*d.BranchID] == company {
			outDays = append(outDays, d)
		}
	}
	outPlacements := make([]Placement, 0, len(placements))
	for _, p := range placements {
		if branchCompany[p.BranchID] == company {
			outPlacements = append(outPlacements, p)
		}
	}
	return outDays, outPlacements
}
