package domain

import (
	"testing"
	"time"
)

func TestTreatmentShift(t *testing.T) {
	at := func(clock string) time.Time {
		v, err := time.ParseInLocation("2006-01-02 15:04:05", "2026-10-08 "+clock, WIB)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	for _, tc := range []struct {
		start, end string
		allowed    bool
	}{
		{"09:00:00", "10:00:00", true},
		{"15:00:00", "17:00:00", true},
		{"15:30:00", "17:00:00", true},
		{"15:30:00", "17:00:01", false},
		{"15:30:00", "17:01:00", false},
		{"16:00:00", "16:30:00", false},
		{"16:30:00", "17:00:00", false},
		{"08:59:00", "09:30:00", false},
	} {
		t.Run(tc.start+"-"+tc.end, func(t *testing.T) {
			err := WithinTreatmentShift(Interval{Start: at(tc.start), End: at(tc.end)}, Interval{Start: at("09:00:00"), End: at("16:00:00")})
			if (err == nil) != tc.allowed {
				t.Fatalf("allowed=%v, error=%v", tc.allowed, err)
			}
		})
	}
}

func TestTreatmentShiftMidnight(t *testing.T) {
	at := func(value string) time.Time {
		v, err := time.Parse(time.RFC3339, value)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	shift := Interval{Start: at("2026-10-08T15:00:00+07:00"), End: at("2026-10-08T23:30:00+07:00")}
	visit := Interval{Start: at("2026-10-08T23:00:00+07:00"), End: at("2026-10-09T00:00:00+07:00")}
	if err := WithinTreatmentShift(visit, shift); err != nil {
		t.Fatal(err)
	}
	visit.End = visit.End.Add(time.Second)
	if err := WithinTreatmentShift(visit, shift); err == nil {
		t.Fatal("cross-day treatment accepted")
	}
	// A preceding day's overnight shift still covers treatment after midnight.
	shift = Interval{Start: at("2026-10-08T22:00:00+07:00"), End: at("2026-10-09T06:00:00+07:00")}
	visit = Interval{Start: at("2026-10-09T05:30:00+07:00"), End: at("2026-10-09T07:00:00+07:00")}
	if err := WithinTreatmentShift(visit, shift); err != nil {
		t.Fatal(err)
	}
}
