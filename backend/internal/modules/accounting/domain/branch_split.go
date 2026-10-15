package domain

import (
	"cmp"
	"math"
	"slices"
)

// BranchShare is one store's (cost center's) weight in a journal line split.
// BranchID nil keeps that part at company level.
type BranchShare struct {
	BranchID *string
	Amount   float64
}

// SplitLinesByBranch replaces every line on side with one line per store,
// splitting its amount in cents proportionally to the shares' amounts
// (largest remainder, so the parts add up to the line exactly; zero parts are
// dropped). Lines on the other side, and every line when no share is
// positive, are returned unchanged. Used for the expense side of payroll
// journals (beban gaji, BPJS/Tapera pemberi kerja) per store.
func SplitLinesByBranch(lines []Line, side string, shares []BranchShare) []Line {
	weights := make([]float64, len(shares))
	positive := false
	for i, s := range shares {
		if s.Amount > 0 {
			weights[i] = s.Amount
			positive = true
		}
	}
	if !positive {
		return lines
	}
	out := make([]Line, 0, len(lines)+len(shares))
	for _, l := range lines {
		if l.Side != side {
			out = append(out, l)
			continue
		}
		parts := splitCents(int64(math.Round(l.Amount*100)), weights)
		for i, cents := range parts {
			if cents <= 0 {
				continue
			}
			part := l
			part.Amount = float64(cents) / 100
			part.BranchID = shares[i].BranchID
			out = append(out, part)
		}
	}
	return out
}

// splitCents is the largest-remainder split of total cents by weights
// (ties: earlier index).
func splitCents(total int64, weights []float64) []int64 {
	out := make([]int64, len(weights))
	sum := 0.0
	for _, w := range weights {
		sum += w
	}
	if total <= 0 || sum <= 0 {
		if len(out) > 0 {
			out[0] = total
		}
		return out
	}
	type rem struct {
		i    int
		frac float64
	}
	rems := make([]rem, len(weights))
	given := int64(0)
	for i, w := range weights {
		exact := float64(total) * w / sum
		floor := math.Floor(exact)
		out[i] = int64(floor)
		given += out[i]
		rems[i] = rem{i, exact - floor}
	}
	slices.SortStableFunc(rems, func(a, b rem) int { return cmp.Compare(b.frac, a.frac) })
	for k := 0; given < total; k = (k + 1) % len(rems) {
		if weights[rems[k].i] > 0 {
			out[rems[k].i]++
			given++
		}
	}
	for k := len(rems) - 1; given > total; k = (k + len(rems) - 1) % len(rems) {
		if out[rems[k].i] > 0 {
			out[rems[k].i]--
			given--
		}
	}
	return out
}
