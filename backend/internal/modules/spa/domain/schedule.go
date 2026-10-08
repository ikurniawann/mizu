package domain

import (
	"crypto/rand"
	"fmt"
	"strings"
	"time"
)

// WIB is Asia/Jakarta. Outlet hours and report periods are WIB.
var WIB = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}()

// Interval is a therapist's occupation of [Start, End) — End includes the
// clean-up buffer.
type Interval struct {
	Start, End time.Time
}

// ItemInterval is the occupation of an item: start to end plus buffer.
func ItemInterval(start time.Time, durationMin, bufferMin int) Interval {
	return Interval{Start: start, End: start.Add(time.Duration(durationMin+bufferMin) * time.Minute)}
}

// Overlaps reports whether two half-open intervals share time.
func (a Interval) Overlaps(b Interval) bool { return a.Start.Before(b.End) && b.Start.Before(a.End) }

// ClockMinutes parses "HH:MM" or "HH:MM:SS" into minutes after midnight.
func ClockMinutes(s string) (int, bool) {
	var h, m, sec int
	parts := strings.Split(s, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, false
	}
	if _, err := fmt.Sscanf(parts[0]+" "+parts[1], "%d %d", &h, &m); err != nil {
		return 0, false
	}
	if len(parts) == 3 {
		if _, err := fmt.Sscanf(parts[2], "%d", &sec); err != nil {
			return 0, false
		}
	}
	if h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 59 {
		return 0, false
	}
	return h*60 + m, true
}

// HHMM formats "HH:MM:SS"/"HH:MM" as "HH:MM".
func HHMM(s string) string {
	if n, ok := ClockMinutes(s); ok {
		return fmt.Sprintf("%02d:%02d", n/60, n%60)
	}
	return s
}

// WithinHours checks that [start, start+duration) falls inside the outlet's
// opening hours on the WIB day of start.
func WithinHours(start time.Time, durationMin int, openTime, closeTime string) error {
	open, ok1 := ClockMinutes(openTime)
	closeAt, ok2 := ClockMinutes(closeTime)
	if !ok1 || !ok2 {
		return nil
	}
	local := start.In(WIB)
	startMin := local.Hour()*60 + local.Minute()
	if startMin < open || startMin+durationMin > closeAt {
		return rule("Jadwal di luar jam operasional outlet (%s–%s WIB)", HHMM(openTime), HHMM(closeTime))
	}
	return nil
}

// DayBounds returns the UTC instants of WIB midnight starting date and the
// next midnight, for a "YYYY-MM-DD" date.
func DayBounds(date string) (time.Time, time.Time, bool) {
	d, err := time.ParseInLocation("2006-01-02", date, WIB)
	if err != nil {
		return time.Time{}, time.Time{}, false
	}
	return d, d.AddDate(0, 0, 1), true
}

// RangeBounds is DayBounds over [from, to] inclusive.
func RangeBounds(from, to string) (time.Time, time.Time, bool) {
	start, _, ok1 := DayBounds(from)
	_, end, ok2 := DayBounds(to)
	if !ok1 || !ok2 || !end.After(start) {
		return time.Time{}, time.Time{}, false
	}
	return start, end, true
}

// MonthBounds is the WIB month "YYYY-MM" as [first day, next month).
func MonthBounds(month string) (time.Time, time.Time, bool) {
	m, err := time.ParseInLocation("2006-01", month, WIB)
	if err != nil {
		return time.Time{}, time.Time{}, false
	}
	return m, m.AddDate(0, 1, 0), true
}

// WIBDate is the WIB calendar date of t.
func WIBDate(t time.Time) string { return t.In(WIB).Format("2006-01-02") }

// Weekday is ISO weekday (Monday=1 … Sunday=7) of the WIB date.
func Weekday(t time.Time) int {
	wd := int(t.In(WIB).Weekday())
	if wd == 0 {
		return 7
	}
	return wd
}

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// BookingCode is "MZ-YYMMDD-XXXX" with the WIB date of at.
func BookingCode(at time.Time) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
	}
	return "MZ-" + at.In(WIB).Format("060102") + "-" + string(b)
}
