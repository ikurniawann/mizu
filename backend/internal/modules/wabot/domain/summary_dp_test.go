package domain

import (
	"strings"
	"testing"
)

func TestSummaryMentionsBookingFee(t *testing.T) {
	s := NewSession()
	s.Lang, s.Name, s.OutletName, s.Date, s.SlotISO = LangID, "Ilham", "Mizu 1.0", "2026-10-13", "2026-10-13T07:30:00Z"
	s.People, s.Persons = 1, []Person{{Label: "Balinese Massage · 60 menit", Price: 185000}}
	out := Summary(LangID, s, 100000)
	for _, want := range []string{"Total: *Rp 185.000*", "Booking fee (DP): *Rp 100.000*", "Sisa: *Rp 85.000*", "di outlet setelah treatment"} {
		if !strings.Contains(out, want) {
			t.Fatalf("summary lacks %q:\n%s", want, out)
		}
	}
	if strings.Contains(Summary(LangID, s, 0), "Booking fee") {
		t.Fatal("no DP line when the policy is off")
	}
	s.People, s.Persons = 2, append(s.Persons, Person{Label: "Reflexology · 45 menit", Price: 120000})
	out = Summary(LangEN, s, 100000)
	for _, want := range []string{"Booking fee (deposit): *Rp 200.000* (Rp 100.000 × 2 bookings)", "Balance: *Rp 105.000*"} {
		if !strings.Contains(out, want) {
			t.Fatalf("group summary lacks %q:\n%s", want, out)
		}
	}
}
