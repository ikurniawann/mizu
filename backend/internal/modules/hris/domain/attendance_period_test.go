package domain

import (
	"testing"
	"time"
)

func TestComputePeriodCalendarMonth(t *testing.T) {
	s := PeriodSettings{CutoffDay: 0, ClosingOffsetDays: 3}
	for _, c := range []struct {
		y, m                int
		start, end, closing string
	}{
		{2026, 10, "2026-10-01", "2026-10-31", "2026-11-03"},
		{2026, 2, "2026-02-01", "2026-02-28", "2026-03-03"},
		{2028, 2, "2028-02-01", "2028-02-29", "2028-03-03"}, // leap year
		{2026, 12, "2026-12-01", "2026-12-31", "2027-01-03"},
	} {
		p := ComputePeriod(s, c.y, c.m)
		if p.Start != c.start || p.End != c.end || p.Closing != c.closing {
			t.Errorf("%d-%02d = %+v, want %s..%s closing %s", c.y, c.m, p, c.start, c.end, c.closing)
		}
	}
}

func TestComputePeriodCutoff(t *testing.T) {
	s := PeriodSettings{CutoffDay: 20, ClosingOffsetDays: 3}
	for _, c := range []struct {
		y, m                int
		start, end, closing string
	}{
		{2026, 10, "2026-09-21", "2026-10-20", "2026-10-23"},
		{2027, 1, "2026-12-21", "2027-01-20", "2027-01-23"}, // across the year boundary
		{2026, 3, "2026-02-21", "2026-03-20", "2026-03-23"}, // February start
		{2026, 2, "2026-01-21", "2026-02-20", "2026-02-23"},
	} {
		p := ComputePeriod(s, c.y, c.m)
		if p.Start != c.start || p.End != c.end || p.Closing != c.closing {
			t.Errorf("%d-%02d = %+v, want %s..%s closing %s", c.y, c.m, p, c.start, c.end, c.closing)
		}
	}
	// Cut-off 28 keeps every February whole.
	p := ComputePeriod(PeriodSettings{CutoffDay: 28}, 2026, 3)
	if p.Start != "2026-03-01" || p.End != "2026-03-28" {
		t.Errorf("cut-off 28 March = %+v", p)
	}
	p = ComputePeriod(PeriodSettings{CutoffDay: 28}, 2026, 2)
	if p.Start != "2026-01-29" || p.End != "2026-02-28" {
		t.Errorf("cut-off 28 Feb = %+v", p)
	}
}

func TestNormalizeCutoff(t *testing.T) {
	for in, want := range map[int]int{0: 0, 1: 1, 20: 20, 28: 28, 29: 0, 30: 0, 31: 0} {
		got, ok := NormalizeCutoff(in)
		if !ok || got != want {
			t.Errorf("NormalizeCutoff(%d) = %d,%v want %d", in, got, ok, want)
		}
	}
	for _, bad := range []int{-1, 32} {
		if _, ok := NormalizeCutoff(bad); ok {
			t.Errorf("NormalizeCutoff(%d) accepted", bad)
		}
	}
	// 31 behaves as the end of the month (calendar periods).
	p := ComputePeriod(PeriodSettings{CutoffDay: 31, ClosingOffsetDays: 0}, 2026, 2)
	if p.Start != "2026-02-01" || p.End != "2026-02-28" || p.Closing != "2026-02-28" {
		t.Errorf("cut-off 31 Feb = %+v", p)
	}
}

func TestPeriodKeyFor(t *testing.T) {
	cut := PeriodSettings{CutoffDay: 20}
	for date, want := range map[string][2]int{
		"2026-10-20": {2026, 10},
		"2026-10-21": {2026, 11},
		"2026-12-21": {2027, 1},
		"2026-01-05": {2026, 1},
	} {
		y, m := PeriodKeyFor(cut, date)
		if y != want[0] || m != want[1] {
			t.Errorf("PeriodKeyFor(%s) = %d-%d want %v", date, y, m, want)
		}
	}
	if y, m := PeriodKeyFor(PeriodSettings{}, "2026-12-31"); y != 2026 || m != 12 {
		t.Errorf("calendar 2026-12-31 = %d-%d", y, m)
	}
}

func TestResolvePeriodAfterCutoffChange(t *testing.T) {
	// August closed as a calendar month, then cut-off moved to 20:
	// September starts the day after August's frozen end.
	s := PeriodSettings{CutoffDay: 20, ClosingOffsetDays: 3}
	p := ResolvePeriod(s, 2026, 9, &Neighbour{Start: "2026-08-01", End: "2026-08-31"}, nil)
	if p.Start != "2026-09-01" || p.End != "2026-09-20" || p.Closing != "2026-09-23" {
		t.Errorf("after calendar close = %+v", p)
	}
	// September closed with cut-off 20, then back to calendar months:
	// October covers the gap from 21 Sep.
	p = ResolvePeriod(PeriodSettings{ClosingOffsetDays: 3}, 2026, 10, &Neighbour{Start: "2026-08-21", End: "2026-09-20"}, nil)
	if p.Start != "2026-09-21" || p.End != "2026-10-31" {
		t.Errorf("after cut-off close = %+v", p)
	}
	// A frozen next period clamps the end.
	p = ResolvePeriod(PeriodSettings{ClosingOffsetDays: 3}, 2026, 9, nil, &Neighbour{Start: "2026-09-21", End: "2026-10-20"})
	if p.Start != "2026-09-01" || p.End != "2026-09-20" || p.Closing != "2026-09-23" {
		t.Errorf("before frozen = %+v", p)
	}
}

func TestPeriodLockAndLabels(t *testing.T) {
	if PeriodLocked("2026-10-23", "2026-10-23") || !PeriodLocked("2026-10-23", "2026-10-24") {
		t.Error("closing date itself must stay open, the day after is locked")
	}
	if DaysUntil("2026-10-15", "2026-10-23") != 8 || DaysUntil("2026-10-15", "2026-10-14") != -1 {
		t.Error("DaysUntil")
	}
	for in, want := range map[[2]string]string{
		{"2026-09-21", "2026-10-20"}: "21 Sep – 20 Okt 2026",
		{"2026-10-01", "2026-10-31"}: "1–31 Okt 2026",
		{"2026-12-21", "2027-01-20"}: "21 Des 2026 – 20 Jan 2027",
		{"2026-08-01", "2026-08-01"}: "1 Agu 2026",
	} {
		if got := PeriodRangeLabel(in[0], in[1]); got != want {
			t.Errorf("PeriodRangeLabel(%v) = %q want %q", in, got, want)
		}
	}
}

func TestClockAt(t *testing.T) {
	in, ok := ClockAt("2026-10-05", "08:30")
	if !ok || !in.Equal(time.Date(2026, 10, 5, 1, 30, 0, 0, time.UTC)) {
		t.Fatalf("ClockAt = %v %v", in, ok)
	}
	out, _ := ClockOutAt("2026-10-05", "17:00", &in)
	if !out.Equal(time.Date(2026, 10, 5, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("same-day clock-out = %v", out)
	}
	night, _ := ClockAt("2026-10-05", "22:00")
	out, _ = ClockOutAt("2026-10-05", "06:00", &night)
	if !out.Equal(time.Date(2026, 10, 5, 23, 0, 0, 0, time.UTC)) { // 06:00 WIB next day
		t.Errorf("overnight clock-out = %v", out)
	}
	if _, ok := ClockAt("2026-10-05", "24:00"); ok {
		t.Error("24:00 accepted")
	}
	if ClockWIBText(out) != "06:00" {
		t.Errorf("ClockWIBText = %s", ClockWIBText(out))
	}
}
