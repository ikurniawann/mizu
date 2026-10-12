package domain

import (
	"testing"
	"time"
)

// 2026-10-12 is a Monday.
var now = time.Date(2026, 10, 12, 10, 0, 0, 0, WIB)

func TestDetectIntent(t *testing.T) {
	kw := []string{"admin", "cs", "manusia"}
	cases := map[string]Intent{
		"Ya":                  IntentYes,
		"oke kak":             IntentYes,
		"tidak":               IntentNo,
		"admin":               IntentAdmin,
		"mau ngobrol sama cs": IntentAdmin,
		"batal":               IntentRestart,
		"booking baru":        IntentRestart,
		"halo":                IntentGreeting,
		"mau booking dong":    IntentGreeting,
		"status":              IntentStatus,
		"menu":                IntentHelp,
		"besok jam 3 sore":    IntentNone,
		"":                    IntentNone,
	}
	for in, want := range cases {
		if got := DetectIntent(in, kw); got != want {
			t.Errorf("DetectIntent(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMenuNumbers(t *testing.T) {
	if got := MenuNumbers("2"); len(got) != 1 || got[0] != 2 {
		t.Fatalf("single = %v", got)
	}
	if got := MenuNumbers(" 1, 3 "); len(got) != 2 || got[1] != 3 {
		t.Fatalf("list = %v", got)
	}
	if MenuNumbers("jam 2") != nil || MenuNumbers("12 orang") != nil {
		t.Fatal("words are not menu numbers")
	}
}

func TestParsePeople(t *testing.T) {
	for in, want := range map[string]int{"2 orang": 2, "berdua": 2, "untuk 3 org ya": 3, "sendiri": 1, "besok": 0} {
		if got := ParsePeople(in); got != want {
			t.Errorf("ParsePeople(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestParseDate(t *testing.T) {
	for in, want := range map[string]string{
		"hari ini":                      "2026-10-12",
		"besok sore":                    "2026-10-13",
		"lusa":                          "2026-10-14",
		"sabtu":                         "2026-10-17",
		"senin":                         "2026-10-19", // said on Monday → next Monday
		"senin ini":                     "2026-10-12",
		"sabtu depan":                   "2026-10-24",
		"15 okt":                        "2026-10-15",
		"15/10":                         "2026-10-15",
		"3 januari":                     "2027-01-03", // already past this year
		"tanggal 20 oktober 2026 jam 3": "2026-10-20",
		"jam 3 sore":                    "",
	} {
		if got := ParseDate(in, now); got != want {
			t.Errorf("ParseDate(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseTime(t *testing.T) {
	for in, want := range map[string]string{
		"jam 3 sore":    "15:00",
		"15.30":         "15:30",
		"10:00":         "10:00",
		"pukul 7 malam": "19:00",
		"jam 11 siang":  "11:00",
		"jam 1 siang":   "13:00",
		"2 orang":       "",
		"besok":         "",
	} {
		if got := ParseTime(in); got != want {
			t.Errorf("ParseTime(%q) = %q, want %q", in, got, want)
		}
	}
	if ParsePeriod("besok sore ya") != "sore" || ParsePeriod("jam 10") != "" {
		t.Fatal("period")
	}
}

func TestParseGenderAndMatch(t *testing.T) {
	if ParseGender("terapis wanita ya") != "female" || ParseGender("cowok aja") != "male" || ParseGender("pilihkan saja") != "any" || ParseGender("sabtu") != "" {
		t.Fatal("gender")
	}
	labels := []string{"Balinese Massage · 60 menit", "Balinese Massage · 90 menit", "Refleksi Kaki · 60 menit", "Totok Wajah · 45 menit"}
	if MatchName("balinese 90", labels) != 1 {
		t.Fatal("balinese 90")
	}
	if MatchName("refleksi", labels) != 2 {
		t.Fatal("refleksi")
	}
	if MatchName("pijat punggung", labels) != -1 {
		t.Fatal("unknown must not match")
	}
}

func TestSessionNextStep(t *testing.T) {
	s := NewSession()
	if s.NextStep() != StepOutlet {
		t.Fatal("outlet first")
	}
	s.OutletID = "o"
	s.People = 2
	s.Persons = []Person{{VariantID: "a"}}
	if s.NextStep() != StepTreatment {
		t.Fatal("second guest's treatment")
	}
	s.Persons = append(s.Persons, Person{VariantID: "b"})
	s.Date, s.SlotISO = "2026-10-13", "2026-10-13T03:00:00Z"
	if s.NextStep() != StepName {
		t.Fatal("groups skip the therapist step")
	}
	s.People, s.Persons = 1, s.Persons[:1]
	if s.NextStep() != StepTherapist {
		t.Fatal("single guest picks a therapist")
	}
	s.SystemPick, s.Name = true, "Rina"
	if s.NextStep() != StepConfirm {
		t.Fatal("confirm")
	}
	s.Bookings = []BookingRef{{Code: "MZ"}}
	if s.NextStep() != StepPayment {
		t.Fatal("payment")
	}
	s.PayMethod = "outlet"
	if s.NextStep() != StepDone {
		t.Fatal("done")
	}
	if Rupiah(185000) != "Rp185.000" || Rupiah(1250000) != "Rp1.250.000" {
		t.Fatal("rupiah")
	}
}
