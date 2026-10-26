package domain

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type RosterCell struct {
	EmployeeID string `json:"employee_id"`
	Name       string `json:"name"`
	Date       string `json:"date"`
	BranchID   string `json:"branch_id"`
	Gender     string `json:"gender"`
	ShiftID    string `json:"shift_id"`
	Kind       string `json:"kind"`
	Locked     bool   `json:"locked"`
	Reason     string `json:"reason,omitempty"`
}
type GenerationInput struct {
	WeekRules    map[string][2]int `json:"week_rules,omitempty"`
	ShiftMinutes map[string][2]int `json:"shift_minutes"`
	Month        string            `json:"month"`
	BranchID     string            `json:"branch_id"`
	MinFemale    int               `json:"min_female"`
	MinMale      int               `json:"min_male"`
	MinOff       int               `json:"min_per_week"`
	MaxOff       int               `json:"max_per_week"`
	Shifts       []string          `json:"shift_ids"`
	Cells        []RosterCell      `json:"cells"`
}
type RosterViolation struct {
	Code       string `json:"code"`
	Date       string `json:"date"`
	EmployeeID string `json:"employee_id,omitempty"`
	Message    string `json:"message"`
}
type GenerationResult struct {
	Status     string            `json:"status"`
	Cells      []RosterCell      `json:"cells"`
	Violations []RosterViolation `json:"violations"`
	Score      int               `json:"score"`
}

func rosterWeek(date string) string {
	d, _, ok := DayBounds(date)
	if !ok {
		return ""
	}
	return WIBDate(d.AddDate(0, 0, 1-Weekday(d)))
}
func ValidateRoster(in GenerationInput) []RosterViolation {
	out := []RosterViolation{}
	add := func(code, date, emp, msg string) { out = append(out, RosterViolation{code, date, emp, msg}) }
	if in.MinOff < 0 || in.MaxOff > 7 || in.MinOff > in.MaxOff || in.MinFemale < 0 || in.MinMale < 0 {
		add("rules", "", "", "Syarat jadwal tidak valid")
		return out
	}
	seen := map[string]bool{}
	dates := map[string][2]int{}
	weeks := map[string][]RosterCell{}
	targetWeeks := map[string]bool{}
	for _, c := range in.Cells {
		key := c.EmployeeID + ":" + c.Date
		if seen[key] {
			add("duplicate", c.Date, c.EmployeeID, "Karyawan dihitung lebih dari sekali")
			continue
		}
		seen[key] = true
		_, _, ok := DayBounds(c.Date)
		if !ok {
			add("date", c.Date, c.EmployeeID, "Tanggal tidak valid")
			continue
		}
		if c.Kind != "work" && c.Kind != "off" && c.Kind != "leave" && c.Kind != "unscheduled" {
			add("kind", c.Date, c.EmployeeID, "Jenis jadwal tidak valid")
		}
		wk := c.EmployeeID + ":" + rosterWeek(c.Date)
		weeks[wk] = append(weeks[wk], c)
		if !strings.HasPrefix(c.Date, in.Month+"-") {
			continue
		}
		targetWeeks[wk] = true
		n := dates[c.Date]
		if c.BranchID == in.BranchID && c.Kind == "work" && c.ShiftID != "" {
			if c.Gender == "female" {
				n[0]++
			}
			if c.Gender == "male" {
				n[1]++
			}
		}
		dates[c.Date] = n
		if c.Kind == "unscheduled" {
			add("unscheduled", c.Date, c.EmployeeID, "Jadwal belum diatur")
		}
		if c.Kind == "work" && c.ShiftID == "" {
			add("shift", c.Date, c.EmployeeID, "Shift kerja wajib diisi")
		}
	}
	ds := make([]string, 0, len(dates))
	for d := range dates {
		ds = append(ds, d)
	}
	sort.Strings(ds)
	for _, d := range ds {
		n := dates[d]
		if n[0] < in.MinFemale {
			add("female", d, "", fmt.Sprintf("%s: perempuan %d, minimal %d", d, n[0], in.MinFemale))
		}
		if n[1] < in.MinMale {
			add("male", d, "", fmt.Sprintf("%s: laki-laki %d, minimal %d", d, n[1], in.MinMale))
		}
	}
	keys := make([]string, 0, len(targetWeeks))
	for k := range targetWeeks {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		cells := weeks[k]
		off := 0
		missing := len(cells) != 7
		for _, c := range cells {
			if c.Kind == "off" {
				off++
			}
			if c.Kind == "unscheduled" {
				missing = true
			}
		}
		c := cells[0]
		minOff, maxOff := in.MinOff, in.MaxOff
		if rule, ok := in.WeekRules[k]; ok {
			minOff, maxOff = rule[0], rule[1]
		}
		if minOff > 0 && missing {
			add("week_context", rosterWeek(c.Date), c.EmployeeID, "Lengkapi jadwal Senin–Minggu termasuk tanggal di luar bulan ini")
		} else if off < minOff || off > maxOff {
			add("weekly_off", rosterWeek(c.Date), c.EmployeeID, fmt.Sprintf("%s: libur %d, wajib %d–%d per minggu", c.Name, off, minOff, maxOff))
		}
	}
	// Compare actual windows, including the contextual dates outside this month.
	windows := map[string][]struct {
		date string
		iv   Interval
	}{}
	for _, c := range in.Cells {
		minutes, ok := in.ShiftMinutes[c.ShiftID]
		if c.Kind != "work" || !ok {
			continue
		}
		d, _, _ := DayBounds(c.Date)
		end := minutes[1]
		if end <= minutes[0] {
			end += 1440
		}
		iv := Interval{Start: d.Add(time.Duration(minutes[0]) * time.Minute), End: d.Add(time.Duration(end) * time.Minute)}
		for _, prior := range windows[c.EmployeeID] {
			if iv.Overlaps(prior.iv) {
				add("overlap", c.Date, c.EmployeeID, "Shift bertumpang tindih dengan "+prior.date)
			}
		}
		windows[c.EmployeeID] = append(windows[c.EmployeeID], struct {
			date string
			iv   Interval
		}{c.Date, iv})
	}
	return out
}

// GenerateMonthlyRoster uses bounded deterministic attempts. It never claims a
// global optimum, nor that failure of this heuristic proves infeasibility.
func GenerateMonthlyRoster(in GenerationInput) GenerationResult {
	best := GenerationResult{Status: "search_limit", Cells: append([]RosterCell{}, in.Cells...), Violations: ValidateRoster(in)}
	if len(in.Shifts) == 0 {
		best.Status = "infeasible"
		best.Violations = append(best.Violations, RosterViolation{Code: "shifts", Message: "Pilih minimal satu shift aktif"})
		return best
	}
	for attempt := 0; attempt < 64; attempt++ {
		cur := in
		cur.Cells = append([]RosterCell{}, in.Cells...)
		employeeIndex := map[string]int{}
		for i := range cur.Cells {
			c := &cur.Cells[i]
			if _, ok := employeeIndex[c.EmployeeID]; !ok {
				employeeIndex[c.EmployeeID] = len(employeeIndex)
			}
			if !c.Locked && strings.HasPrefix(c.Date, in.Month+"-") {
				c.Kind = "work"
				c.ShiftID = in.Shifts[(employeeIndex[c.EmployeeID]+attempt)%len(in.Shifts)]
			}
		}
		groups := map[string][]int{}
		for i, c := range cur.Cells {
			groups[c.EmployeeID+":"+rosterWeek(c.Date)] = append(groups[c.EmployeeID+":"+rosterWeek(c.Date)], i)
		}
		keys := make([]string, 0, len(groups))
		for k := range groups {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for ki := range keys {
			key := keys[(ki+attempt)%len(keys)]
			indices := groups[key]
			off := 0
			for _, i := range indices {
				if cur.Cells[i].Kind == "off" {
					off++
				}
			}
			minOff := in.MinOff
			if rule, ok := in.WeekRules[key]; ok {
				minOff = rule[0]
			}
			for off < minOff {
				pick, bestSpare := -1, -1
				for j := range indices {
					i := indices[(j+attempt)%len(indices)]
					c := cur.Cells[i]
					if c.Locked || !strings.HasPrefix(c.Date, in.Month+"-") || c.Kind != "work" {
						continue
					}
					count := 0
					for _, o := range cur.Cells {
						if o.Date == c.Date && o.BranchID == c.BranchID && o.Kind == "work" && o.Gender == c.Gender {
							count++
						}
					}
					min := 0
					if c.BranchID == in.BranchID {
						if c.Gender == "female" {
							min = in.MinFemale
						}
						if c.Gender == "male" {
							min = in.MinMale
						}
					}
					if count-1 >= min && count-min > bestSpare {
						pick, bestSpare = i, count-min
					}
				}
				if pick < 0 {
					break
				}
				cur.Cells[pick].Kind = "off"
				cur.Cells[pick].ShiftID = ""
				off++
			}
		}
		v := ValidateRoster(cur)
		score := rosterScore(cur.Cells)
		if len(v) == 0 && (best.Status != "valid" || score < best.Score) {
			best = GenerationResult{Status: "valid", Cells: cur.Cells, Violations: v, Score: score}
		} else if best.Status != "valid" && (attempt == 0 || len(v) < len(best.Violations)) {
			best.Cells, best.Violations = cur.Cells, v
		}
	}
	return best
}
func rosterScore(cells []RosterCell) int {
	counts := map[string]int{}
	for _, c := range cells {
		if _, ok := counts[c.EmployeeID]; !ok {
			counts[c.EmployeeID] = 0
		}
		if c.Kind == "work" {
			counts[c.EmployeeID]++
		}
	}
	lo, hi := int(^uint(0)>>1), 0
	for _, n := range counts {
		if n < lo {
			lo = n
		}
		if n > hi {
			hi = n
		}
	}
	if len(counts) == 0 {
		return 0
	}
	return hi - lo
}

// QuotaBranch attributes one day's headcount to one outlet by working duration.
// Ties prefer home, then lexical outlet ID for deterministic results.
func QuotaBranch(home string, shift Interval, assists map[string][]Interval) string {
	minutes := map[string]time.Duration{home: shift.End.Sub(shift.Start)}
	for branch, ivs := range assists {
		for _, iv := range ivs {
			start, end := iv.Start, iv.End
			if start.Before(shift.Start) {
				start = shift.Start
			}
			if end.After(shift.End) {
				end = shift.End
			}
			if end.After(start) {
				d := end.Sub(start)
				minutes[branch] += d
				minutes[home] -= d
			}
		}
	}
	best := home
	for b, d := range minutes {
		if d > minutes[best] || d == minutes[best] && best != home && b < best {
			best = b
		}
	}
	return best
}
