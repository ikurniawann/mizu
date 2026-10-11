package domain

import "testing"

func TestTrendPeriods(t *testing.T) {
	for _, tc := range []struct {
		from, to, interval string
		want               []string
	}{
		{"2024-02-28", "2024-03-01", "daily", []string{"2024-02-28", "2024-02-29", "2024-03-01"}},
		{"2026-01-15", "2026-02-10", "monthly", []string{"2026-01-01", "2026-02-01"}},
		{"2022-10-01", "2026-02-10", "yearly", []string{"2022-01-01", "2023-01-01", "2024-01-01", "2025-01-01", "2026-01-01"}},
	} {
		got, err := TrendPeriods(tc.from, tc.to, tc.interval)
		if err != nil || len(got) != len(tc.want) {
			t.Fatalf("%+v: got %v, %v", tc, got, err)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		}
	}
}
func TestTrendPeriodsRejectInvalidAndOversized(t *testing.T) {
	for _, tc := range [][3]string{
		{"2026-02-30", "2026-03-01", "daily"}, {"2026-10-03", "2026-10-01", "daily"},
		{"2026-01-01", "2026-01-02", "weekly"}, {"", "2026-01-02", "daily"},
		{"2020-01-01", "2026-01-01", "daily"}, {"1000-01-01", "2000-01-01", "yearly"},
	} {
		if _, err := TrendPeriods(tc[0], tc[1], tc[2]); err == nil {
			t.Fatalf("accepted %v", tc)
		}
	}
	got, err := TrendPeriods("1000-01-01", "1999-12-31", "yearly")
	if err != nil || len(got) != 1000 {
		t.Fatalf("1000 buckets: %d, %v", len(got), err)
	}
}
