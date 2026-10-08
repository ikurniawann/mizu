package domain

import "math"

// Commission types.
const (
	CommissionPercent = "percent"
	CommissionFixed   = "fixed"
)

// CommissionTypes lists the commission types.
var CommissionTypes = []string{CommissionPercent, CommissionFixed}

// CommissionRule is one active spa.commission_rules row. Empty TreatmentID
// and VariantID make a default rule; empty BranchID applies to every outlet.
type CommissionRule struct {
	ID          string
	TreatmentID string
	VariantID   string
	BranchID    string
	Type        string
	Value       float64
}

// ruleRank orders matching rules: lower is more specific. -1 = no match.
func ruleRank(r CommissionRule, treatmentID, variantID, branchID string) int {
	if r.BranchID != "" && r.BranchID != branchID {
		return -1
	}
	branchRank := 0
	if r.BranchID == "" {
		branchRank = 1
	}
	switch {
	case r.VariantID != "":
		if r.VariantID != variantID {
			return -1
		}
		return 0 + branchRank
	case r.TreatmentID != "":
		if r.TreatmentID != treatmentID {
			return -1
		}
		return 2 + branchRank
	}
	return 4 + branchRank
}

// ResolveCommission picks the most specific rule for a treatment variant at
// an outlet: variant+outlet, variant, treatment+outlet, treatment,
// default+outlet, default. ok is false when no rule matches.
func ResolveCommission(rules []CommissionRule, treatmentID, variantID, branchID string) (CommissionRule, bool) {
	best, bestRank := CommissionRule{}, math.MaxInt
	for _, r := range rules {
		if rank := ruleRank(r, treatmentID, variantID, branchID); rank >= 0 && rank < bestRank {
			best, bestRank = r, rank
		}
	}
	return best, bestRank != math.MaxInt
}

// CommissionAmount is the commission of one treatment at price, rounded to
// whole rupiah.
func CommissionAmount(r CommissionRule, price float64) float64 {
	switch r.Type {
	case CommissionPercent:
		return math.Round(price * r.Value / 100)
	case CommissionFixed:
		return math.Round(r.Value)
	}
	return 0
}
