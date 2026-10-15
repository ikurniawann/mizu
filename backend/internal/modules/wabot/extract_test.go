package wabot

import (
	"testing"

	"nuhabit/backend/internal/modules/wabot/domain"
)

func TestSanitizeAIDropsUnmentionedFields(t *testing.T) {
	text := "Halo kak, saya mau pijat buat saya sama istri, sabtu ini sorean, di yang signature ya"
	x := sanitizeAI(text, Extraction{Outlet: "Paddy Signature", People: 2, Date: "2026-10-17", Period: "sore", Time: "15:00"})
	if x.Outlet != "Paddy Signature" || x.People != 2 || x.Date == "" || x.Period != "sore" {
		t.Fatalf("mentioned fields must survive: %+v", x)
	}
	y := sanitizeAI("yang thai massage 60 menit aja dua-duanya", Extraction{Outlet: "Paddy 1.0", People: 2, Date: "2026-10-13", Treatments: []string{"Thai Massage · 60 menit"}})
	if y.Outlet != "" || y.Date != "" || len(y.Treatments) != 1 {
		t.Fatalf("guessed outlet/date must be dropped, treatments kept: %+v", y)
	}
	if y.People != 0 {
		t.Fatalf("'dua-duanya' is not a party-size cue the guard knows; AI people must be dropped: %+v", y)
	}
}

func TestMergeExtractionFillsGapsOnly(t *testing.T) {
	local := Extraction{Date: "2026-10-17"}
	ai := Extraction{Outlet: "Paddy Signature", People: 2, Date: "2026-10-18", Period: "sore"}
	m := mergeExtraction(local, ai)
	if m.Date != "2026-10-17" || m.Outlet != "Paddy Signature" || m.People != 2 || m.Period != "sore" {
		t.Fatalf("merge: %+v", m)
	}
}

func TestMatchNameDistinctiveWord(t *testing.T) {
	labels := []string{"Paddy 1.0", "Paddy Signature"}
	if i := domain.MatchName("di yang signature ya", labels); i != 1 {
		t.Fatalf("signature → %d", i)
	}
	if i := domain.MatchName("paddy", labels); i != -1 {
		t.Fatalf("shared word must not match: %d", i)
	}
	if !domain.FreeForm("saya mau pijat buat saya sama istri") || domain.FreeForm("2") || domain.FreeForm("besok sore") {
		t.Fatal("FreeForm")
	}
	if !domain.MentionsPeople("saya sama istri") || domain.MentionsPeople("thai massage") || !domain.MentionsDate("sabtu ini") || domain.MentionsDate("thai massage 60 menit") {
		t.Fatal("cues")
	}
}

func TestStripWords(t *testing.T) {
	if got := domain.StripWords("mau pijat di yang Signature ya", "Paddy Signature"); got != "mau pijat di yang ya" {
		t.Fatalf("StripWords = %q", got)
	}
	labels := []string{"Paddy Signature Ritual · 150 menit", "Thai Massage · 60 menit"}
	if i := domain.MatchName(domain.StripWords("di yang signature ya", "Paddy Signature"), labels); i != -1 {
		t.Fatalf("outlet word must not pick the Signature Ritual treatment: %d", i)
	}
}

func TestMatchNameWithNumberedOutlet(t *testing.T) {
	labels := []string{"Paddy 1.0", "Paddy Signature"}
	if i := domain.MatchName("Kalau alamat paddy 1.0 itu dimana?", labels); i != 0 {
		t.Fatalf("paddy 1.0 → %d", i)
	}
	if i := domain.MatchName("alamat signature dimana", labels); i != 1 {
		t.Fatalf("signature → %d", i)
	}
	if !(Extraction{GenderPref: "male"}).useful() || (Extraction{GenderPref: "male"}).bookingShaped() {
		t.Fatal("a bare gender preference is useful but not booking-shaped")
	}
}
