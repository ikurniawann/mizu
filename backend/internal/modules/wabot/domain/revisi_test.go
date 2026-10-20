package domain

import (
	"testing"
	"time"
)

func TestParseNominal(t *testing.T) {
	for in, want := range map[string]float64{
		"250000": 250000, "Rp 250.000": 250000, "rp250.000": 250000, "250rb": 250000, "250 ribu": 250000, "350k": 350000,
		"1 juta": 1000000, "1,5jt": 1500000, "1.5 juta": 1500000, "mau yang 500rb aja": 500000, "Rp 1.250.000": 1250000,
		"2": 0, "abc": 0, "": 0, "jam 3": 0,
	} {
		if got := ParseNominal(in); got != want {
			t.Errorf("ParseNominal(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestAllGuests(t *testing.T) {
	for in, want := range map[string]bool{"2 semua": true, "thai massage dua-duanya": true, "1 all": true, "both of us": true, "sama semua ya": true,
		"2": false, "thai massage": false, "semangat": false} {
		if got := ParseAllGuests(in); got != want {
			t.Errorf("ParseAllGuests(%q) = %v", in, got)
		}
	}
	if got := MenuNumbers(StripAllGuests("2 semua")); len(got) != 1 || got[0] != 2 {
		t.Errorf("2 semua → %v", got)
	}
	if got := MenuNumbers(StripAllGuests("all 3")); len(got) != 1 || got[0] != 3 {
		t.Errorf("all 3 → %v", got)
	}
}

func TestDetectCompare(t *testing.T) {
	outlets := []string{"Mizu 1.0", "Mizu Signature"}
	for in, want := range map[string]bool{
		"bedanya mizu 1.0 dan mizu signature apa?": true, "apa perbedaan outletnya": true, "lebih bagus signature atau 1.0?": true,
		"what's the difference between the outlets": true, "signature itu apa": true,
		"kami bertiga treatment beda beda": false, "beda harga ga?": false, "halo": false,
	} {
		if got := DetectCompare(in, outlets); got != want {
			t.Errorf("DetectCompare(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestWantsGift(t *testing.T) {
	for in, want := range map[string]bool{"mau beli gift voucher": true, "gift card ada?": true, "voucher hadiah buat istri": true, "mau beli voucher": true,
		"pakai voucher diskon bisa?": false, "booking besok": false} {
		if got := WantsGift(in); got != want {
			t.Errorf("WantsGift(%q) = %v", in, got)
		}
	}
}

func TestAdminHours(t *testing.T) {
	h := AdminHours{Start: 10, End: 22}
	at := func(hour int) time.Time { return time.Date(2026, 10, 20, hour, 30, 0, 0, WIB) }
	if h.Open(at(9)) || !h.Open(at(10)) || !h.Open(at(21)) || h.Open(at(22)) {
		t.Fatal("10–22 window wrong")
	}
	night := AdminHours{Start: 20, End: 2}
	if !night.Open(at(23)) || !night.Open(at(1)) || night.Open(at(12)) {
		t.Fatal("overnight window wrong")
	}
	if h.Label() != "10.00–22.00" {
		t.Fatal(h.Label())
	}
}

func TestGiftDraft(t *testing.T) {
	g := &GiftDraft{Presets: []float64{100000, 200000}, AllowCustom: true, MinIDR: 50000, MaxIDR: 10000000}
	if !g.Allowed(100000) || !g.Allowed(350000) || g.Allowed(40000) || g.Allowed(350500) {
		t.Fatal("Allowed")
	}
	g.AllowCustom = false
	if g.Allowed(350000) || !g.Allowed(200000) {
		t.Fatal("presets only")
	}
	if g.Next() != GiftStepOutlet || g.Active() != true {
		t.Fatal("start")
	}
	g.OutletID, g.Nominal, g.ForSelf = "o", 100000, true
	if g.Next() != GiftStepConfirm || !g.Back(false) || g.Next() != GiftStepRecipient {
		t.Fatal("back from confirm")
	}
	g.ForSelf, g.Token = true, "tok"
	if !g.AwaitingPayment() || g.Active() {
		t.Fatal("pay step")
	}
}

func TestGroupSessionBackPopsLastGuest(t *testing.T) {
	s := &Session{Lang: LangID, Name: "A", OutletID: "o", People: 2, Persons: []Person{{Label: "a"}, {Label: "b"}}}
	if s.NextStep() != StepDate || !s.Back() || len(s.Persons) != 1 || s.NextStep() != StepTreatment {
		t.Fatalf("back: %+v", s.Persons)
	}
}
