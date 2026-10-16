package payroll

import "testing"

func TestParseAmountID(t *testing.T) {
	cases := map[string]float64{
		"25.000": 25_000, "1.500.000": 1_500_000, "1.500.000,50": 1_500_000.5, "250000.50": 250_000.5,
		"250000": 250_000, "Rp 75.000": 75_000, "12,5": 12.5, "0": 0,
	}
	for raw, want := range cases {
		if got, ok := ParseAmountID(raw); !ok || got != want {
			t.Errorf("ParseAmountID(%q) = %v %v, want %v", raw, got, ok, want)
		}
	}
	for _, bad := range []string{"", "abc", "-5", "1.2.3,4,5"} {
		if _, ok := ParseAmountID(bad); ok {
			t.Errorf("ParseAmountID(%q) should fail", bad)
		}
	}
}
