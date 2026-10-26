package domain

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestRosterDailyGenderAndUniqueEmployees(t *testing.T) {
	in := GenerationInput{Month: "2026-11", BranchID: "a", MinFemale: 2, MaxOff: 7, Shifts: []string{"am", "pm"}, Cells: []RosterCell{
		{EmployeeID: "one", Date: "2026-11-02", Gender: "female", BranchID: "a", ShiftID: "am", Kind: "work"},
		{EmployeeID: "two", Date: "2026-11-02", Gender: "female", BranchID: "a", ShiftID: "pm", Kind: "work"},
	}}
	if v := ValidateRoster(in); len(v) != 0 {
		t.Fatalf("different shifts satisfy daily total: %v", v)
	}
	in.Cells[1].EmployeeID = "one"
	if v := ValidateRoster(in); len(v) == 0 {
		t.Fatal("duplicate employee counted twice")
	}
}
func TestGenerateRosterWeeklyRestAndLockedCells(t *testing.T) {
	in := GenerationInput{Month: "2026-11", BranchID: "a", MinFemale: 1, MinOff: 1, MaxOff: 2, Shifts: []string{"am", "pm"}}
	for _, emp := range []string{"one", "two", "three"} {
		for day := 2; day <= 8; day++ {
			in.Cells = append(in.Cells, RosterCell{EmployeeID: emp, Date: "2026-11-0" + string(rune('0'+day)), Gender: "female", BranchID: "a", Kind: "unscheduled"})
		}
	}
	in.Cells[0].Kind = "off"
	in.Cells[0].Locked = true
	out := GenerateMonthlyRoster(in)
	if out.Status != "valid" {
		t.Fatalf("generation: %s %v", out.Status, out.Violations)
	}
	if out.Cells[0].Kind != "off" {
		t.Fatal("changed locked off")
	}
	for _, emp := range []string{"one", "two", "three"} {
		off := 0
		for _, c := range out.Cells {
			if c.EmployeeID == emp && c.Kind == "off" {
				off++
			}
		}
		if off < 1 || off > 2 {
			t.Fatalf("%s off=%d", emp, off)
		}
	}
}
func TestRosterRejectsMissingWeekBoundary(t *testing.T) {
	in := GenerationInput{Month: "2026-11", BranchID: "a", MinOff: 1, MaxOff: 2, Cells: []RosterCell{{EmployeeID: "one", Date: "2026-11-01", BranchID: "a", Kind: "off"}}}
	if v := ValidateRoster(in); len(v) == 0 {
		t.Fatal("missing week context counted as rest")
	}
}

func TestQuotaBranchCountsOnlyOneOutlet(t *testing.T) {
	work := shiftForTest("2026-11-02T09:00:00+07:00", "2026-11-02T18:00:00+07:00")
	for _, tc := range []struct{ from, want string }{{"2026-11-02T12:00:00+07:00", "away"}, {"2026-11-02T15:00:00+07:00", "home"}} {
		away := shiftForTest(tc.from, "2026-11-02T18:00:00+07:00")
		if got := QuotaBranch("home", work, map[string][]Interval{"away": {away}}); got != tc.want {
			t.Fatalf("%s -> %s", tc.from, got)
		}
	}
}
func shiftForTest(a, b string) Interval {
	start, _ := time.Parse(time.RFC3339, a)
	end, _ := time.Parse(time.RFC3339, b)
	return Interval{Start: start, End: end}
}

func TestRosterRejectsOvernightOverlapInPreview(t *testing.T) {
	in := GenerationInput{Month: "2026-11", BranchID: "a", MaxOff: 7, ShiftMinutes: map[string][2]int{"night": {1320, 360}, "morning": {300, 780}}, Cells: []RosterCell{
		{EmployeeID: "one", Date: "2026-11-02", BranchID: "a", Kind: "work", ShiftID: "night"},
		{EmployeeID: "one", Date: "2026-11-03", BranchID: "a", Kind: "work", ShiftID: "morning"},
	}}
	found := false
	for _, v := range ValidateRoster(in) {
		if v.Code == "overlap" {
			found = true
		}
	}
	if !found {
		t.Fatal("overnight overlap accepted")
	}
}

func BenchmarkGenerateMonthlyRoster(b *testing.B) {
	in := GenerationInput{Month: "2026-11", BranchID: "a", MinFemale: 5, MinMale: 3, MinOff: 1, MaxOff: 2, Shifts: []string{"am", "pm"}}
	first, _, _ := DayBounds("2026-10-26")
	for emp := 0; emp < 30; emp++ {
		for day := 0; day < 42; day++ {
			date := WIBDate(first.AddDate(0, 0, day))
			c := RosterCell{EmployeeID: fmt.Sprint(emp), Date: date, BranchID: "a", Gender: "female", Kind: "work", ShiftID: "am", Locked: !strings.HasPrefix(date, "2026-11-")}
			if emp > 16 {
				c.Gender = "male"
			}
			if day%7 == emp%7 && c.Locked {
				c.Kind = "off"
				c.ShiftID = ""
			}
			in.Cells = append(in.Cells, c)
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		out := GenerateMonthlyRoster(in)
		if out.Status != "valid" {
			b.Fatal(out.Status, out.Violations)
		}
	}
}

func TestRosterPreservesAssistedOutletWeeklyRest(t *testing.T) {
	in := GenerationInput{Month: "2026-11", BranchID: "home", MaxOff: 2, Shifts: []string{"am"}, WeekRules: map[string][2]int{"one:2026-11-02": {2, 2}}}
	for d := 2; d <= 8; d++ {
		in.Cells = append(in.Cells, RosterCell{EmployeeID: "one", Date: fmt.Sprintf("2026-11-%02d", d), BranchID: "home", Kind: "work", ShiftID: "am"})
	}
	if v := ValidateRoster(in); len(v) == 0 {
		t.Fatal("destination minimum rest was ignored")
	}
	out := GenerateMonthlyRoster(in)
	if out.Status != "valid" {
		t.Fatal(out.Status, out.Violations)
	}
	off := 0
	for _, c := range out.Cells {
		if c.Kind == "off" {
			off++
		}
	}
	if off != 2 {
		t.Fatalf("destination rest: %d, want 2", off)
	}
}

func TestRosterSearchStatusAndDeterminism(t *testing.T) {
	in := GenerationInput{Month: "2027-01", BranchID: "a", MinMale: 1, MinOff: 1, MaxOff: 2, Shifts: []string{"am"}}
	first, _, _ := DayBounds("2026-12-28")
	for d := 0; d < 7; d++ {
		date := WIBDate(first.AddDate(0, 0, d))
		c := RosterCell{EmployeeID: "one", Date: date, BranchID: "a", Gender: "male", Kind: "work", ShiftID: "am", Locked: !strings.HasPrefix(date, "2027-01")}
		if d == 0 {
			c.Kind = "off"
			c.ShiftID = ""
		}
		in.Cells = append(in.Cells, c)
	}
	a, b := GenerateMonthlyRoster(in), GenerateMonthlyRoster(in)
	if a.Status != "valid" || !reflect.DeepEqual(a, b) {
		t.Fatalf("year boundary or determinism: %v / %v", a, b)
	}
	// Unknown gender never fills the male requirement, and a bounded search
	// failing to find a candidate does not prove infeasibility.
	for i := range in.Cells {
		in.Cells[i].Gender = ""
	}
	if out := GenerateMonthlyRoster(in); out.Status != "search_limit" || len(out.Violations) == 0 {
		t.Fatal(out)
	}
	in.Shifts = nil
	if out := GenerateMonthlyRoster(in); out.Status != "infeasible" {
		t.Fatal(out)
	}
	in.MinOff, in.MaxOff = 3, 2
	if violations := ValidateRoster(in); len(violations) == 0 || violations[0].Code != "rules" {
		t.Fatal(violations)
	}
}
