package spa

import "testing"

func TestPublicName(t *testing.T) {
	for full, want := range map[string]string{
		"Ayu Lestari":        "Ayu L.",
		"Ni Made Wulan Sari": "Ni S.",
		"Euis":               "Euis",
		"  ":                 "Terapis",
		"Çağla Özdemir":      "Çağla Ö.",
	} {
		if got := publicName(full); got != want {
			t.Errorf("publicName(%q) = %q, want %q", full, got, want)
		}
	}
}
