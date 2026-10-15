package domain

import (
	"fmt"
	"regexp"
	"time"
)

// Attendance periods (closing absensi): a period is named after the month
// it ends in (the payroll month). With cut-off day 0 it is the calendar
// month; with cut-off N (1–28) the period of month M runs from day N+1 of
// M-1 through day N of M. The closing date is the period end plus the
// closing offset; after it the period is locked.

// MaxCutoffDay is the last cut-off day every month has; 29–31 mean "end of
// month" (0).
const MaxCutoffDay = 28

// PeriodSettings is hris.attendance_settings.
type PeriodSettings struct {
	CutoffDay         int
	ClosingOffsetDays int
}

// NormalizeCutoff maps an input cut-off day to the stored one: 0 and 29–31
// are the end of the month (0), 1–28 stay.
func NormalizeCutoff(day int) (int, bool) {
	switch {
	case day == 0 || (day > MaxCutoffDay && day <= 31):
		return 0, true
	case day >= 1 && day <= MaxCutoffDay:
		return day, true
	}
	return 0, false
}

// PeriodRange is one period's inclusive dates and closing date
// ("YYYY-MM-DD").
type PeriodRange struct {
	Year, Month int
	Start, End  string
	Closing     string
}

func dateOf(y, m, d int) time.Time { return time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC) }

// ShiftMonth returns year/month moved by delta months.
func ShiftMonth(year, month, delta int) (int, int) {
	t := dateOf(year, month, 1).AddDate(0, delta, 0)
	return t.Year(), int(t.Month())
}

// ComputePeriod is the period of year/month under the settings alone.
func ComputePeriod(s PeriodSettings, year, month int) PeriodRange {
	cut, _ := NormalizeCutoff(s.CutoffDay)
	var start, end time.Time
	if cut == 0 {
		start = dateOf(year, month, 1)
		end = dateOf(year, month+1, 0)
	} else {
		end = dateOf(year, month, cut)
		py, pm := ShiftMonth(year, month, -1)
		start = dateOf(py, pm, cut+1)
	}
	return PeriodRange{Year: year, Month: month, Start: start.Format(DateLayout), End: end.Format(DateLayout),
		Closing: end.AddDate(0, 0, max(0, s.ClosingOffsetDays)).Format(DateLayout)}
}

// PeriodKeyFor is the month whose settings-derived period contains date.
func PeriodKeyFor(s PeriodSettings, date string) (int, int) {
	t, _ := time.Parse(DateLayout, date)
	cut, _ := NormalizeCutoff(s.CutoffDay)
	if cut != 0 && t.Day() > cut {
		return ShiftMonth(t.Year(), int(t.Month()), 1)
	}
	return t.Year(), int(t.Month())
}

// Neighbour is a frozen (once closed) adjacent period's dates.
type Neighbour struct{ Start, End string }

// ResolvePeriod is ComputePeriod adjusted to the frozen neighbours: a period
// right after a frozen one starts the day after it ends, one right before a
// frozen one ends the day before it starts, so periods never overlap or
// leave a gap when the cut-off changes after a closing.
func ResolvePeriod(s PeriodSettings, year, month int, prev, next *Neighbour) PeriodRange {
	p := ComputePeriod(s, year, month)
	if prev != nil {
		p.Start = AddDaysISO(prev.End, 1)
	}
	if next != nil {
		if e := AddDaysISO(next.Start, -1); e < p.End {
			p.End = e
		}
	}
	if p.End < p.Start {
		p.End = p.Start
	}
	p.Closing = AddDaysISO(p.End, max(0, s.ClosingOffsetDays))
	return p
}

// PeriodLocked reports whether a period with this closing date is past it
// on today (both "YYYY-MM-DD"): the closing date itself is still open.
func PeriodLocked(closing, today string) bool { return today > closing }

// DaysUntil is the whole days from today to date (negative when past).
func DaysUntil(today, date string) int {
	a, okA := ParseDate(today)
	b, okB := ParseDate(date)
	if !okA || !okB {
		return 0
	}
	return int(b.Sub(a).Hours() / 24)
}

var monthShortID = [12]string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}

// MonthNameID is the full Indonesian month name (1–12).
func MonthNameID(month int) string {
	if month < 1 || month > 12 {
		return ""
	}
	return monthNamesLong[month-1]
}

// ShortDateID is "21 Okt 2026" ("" for an unreadable date).
func ShortDateID(date string) string {
	t, ok := ParseDate(date)
	if !ok {
		return ""
	}
	return fmt.Sprintf("%d %s %d", t.Day(), monthShortID[t.Month()-1], t.Year())
}

// PeriodRangeLabel is "1–31 Okt 2026", "21 Sep – 20 Okt 2026" or
// "21 Des 2025 – 20 Jan 2026".
func PeriodRangeLabel(start, end string) string {
	s, okS := ParseDate(start)
	e, okE := ParseDate(end)
	if !okS || !okE {
		return start + " – " + end
	}
	switch {
	case s.Year() != e.Year():
		return ShortDateID(start) + " – " + ShortDateID(end)
	case s.Month() != e.Month():
		return fmt.Sprintf("%d %s – %s", s.Day(), monthShortID[s.Month()-1], ShortDateID(end))
	case s.Day() == e.Day():
		return ShortDateID(end)
	}
	return fmt.Sprintf("%d–%s", s.Day(), ShortDateID(end))
}

// clockRe is a wall-clock "HH:MM" (24h).
var clockRe = regexp.MustCompile(`^([01]\d|2[0-3]):([0-5]\d)$`)

// ValidClock reports a "HH:MM" wall-clock time.
func ValidClock(hhmm string) bool { return clockRe.MatchString(hhmm) }

// ClockAt is the instant of "HH:MM" WIB on date.
func ClockAt(date, hhmm string) (time.Time, bool) {
	if _, ok := ParseDate(date); !ok || !ValidClock(hhmm) {
		return time.Time{}, false
	}
	return wibDateTime(date, hhmm, 0), true
}

// ClockOutAt is "HH:MM" WIB on date, or on the next day when it is not
// after clockIn (an overnight shift).
func ClockOutAt(date, hhmm string, clockIn *time.Time) (time.Time, bool) {
	t, ok := ClockAt(date, hhmm)
	if !ok {
		return t, false
	}
	if clockIn != nil && !t.After(*clockIn) {
		t = t.AddDate(0, 0, 1)
	}
	return t, true
}

// ClockWIBText is the "HH:MM" WIB wall clock of an instant.
func ClockWIBText(t time.Time) string { return t.UTC().Add(WIBOffset).Format("15:04") }
