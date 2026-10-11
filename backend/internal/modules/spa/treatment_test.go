package spa

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTreatmentPriceLimits(t *testing.T) {
	for _, c := range []struct {
		price string
		valid bool
	}{
		{"0", true}, {"999999999999", true},
		{"1000000000000", false}, {"-1", false}, {"1.5", false}, {`"100"`, false},
	} {
		t.Run(c.price, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/", strings.NewReader(fmt.Sprintf(
				`{"code":"BAL","name":"Balinese","variants":[{"name":"60 menit","duration_min":60,"price_idr":%s}]}`, c.price)))
			f := body(r)
			treatmentFields(f, false)
			if f.Valid() != c.valid {
				t.Fatalf("valid = %v, want %v: %v", f.Valid(), c.valid, f.Issues())
			}
		})
	}
}
