package spa

import (
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

func validDesign() *Design {
	return &Design{
		Brand: "apple", Model: "Iphone 15 Pro", Layout: "3",
		Stickers: []DesignSticker{
			{Theme: "baking-pals", Code: "baking-pals-a"},
			{Theme: "picnic-day", Code: "picnic-day-b"},
			{Theme: "now-playing", Code: "now-playing-c"},
		},
		Background: "star-dots", Name: "  Kai  ", Font: "daydream",
	}
}

func TestExperienceCatalogLoads(t *testing.T) {
	c := Experience()
	if c.PriceIDR != 119000 || len(c.Layouts) != 2 || len(c.Themes) != 16 || len(c.Backgrounds) != 11 || len(c.Fonts) != 6 {
		t.Fatalf("unexpected catalog: price=%v layouts=%d themes=%d backgrounds=%d fonts=%d",
			c.PriceIDR, len(c.Layouts), len(c.Themes), len(c.Backgrounds), len(c.Fonts))
	}
	codes := map[string]bool{}
	for _, th := range c.Themes {
		if len(th.Stickers) != 4 {
			t.Errorf("theme %s has %d stickers", th.Code, len(th.Stickers))
		}
		for _, s := range th.Stickers {
			if codes[s.Code] {
				t.Errorf("duplicate sticker code %s", s.Code)
			}
			codes[s.Code] = true
		}
	}
	// Every image the catalog names ships with the web app.
	public := filepath.Join("..", "..", "..", "..", "frontend", "public")
	if _, err := os.Stat(public); err != nil {
		t.Skip("frontend/public not present")
	}
	var images []string
	for _, b := range c.Backgrounds {
		images = append(images, b.Image)
	}
	for _, th := range c.Themes {
		images = append(images, th.Cover)
		for _, s := range th.Stickers {
			images = append(images, s.Image)
		}
	}
	for _, f := range c.Fonts {
		images = append(images, f.Sample)
	}
	for _, img := range images {
		if _, err := os.Stat(filepath.Join(public, filepath.FromSlash(img))); err != nil {
			t.Errorf("missing image %s", img)
		}
	}
}

func TestNormalizeDesign(t *testing.T) {
	d, err := Experience().NormalizeDesign(validDesign())
	if err != nil {
		t.Fatal(err)
	}
	if d.BrandName != "Apple" || d.Model != "Iphone 15 Pro" || d.BackgroundName != "Star Dots" || d.BackgroundImage == "" {
		t.Fatalf("names not filled: %+v", d)
	}
	if d.Name != "Kai" || d.FontName != "Daydream" {
		t.Fatalf("name not normalized: %q %q", d.Name, d.FontName)
	}
	if d.Stickers[0].Name != "Baking Pals A" || d.Stickers[0].ThemeName != "Baking Pals" || d.Stickers[0].Image == "" {
		t.Fatalf("sticker not filled: %+v", d.Stickers[0])
	}
	want := "Iphone 15 Pro · Star Dots · 3 stiker: Baking Pals A, Picnic Day B, Now Playing C · Nama: Kai (Daydream)"
	if got := DesignSummary(d); got != want {
		t.Fatalf("summary = %q, want %q", got, want)
	}

	// Model matching ignores case and stores the catalog spelling.
	in := validDesign()
	in.Model = "iphone 15 pro"
	if d, err := Experience().NormalizeDesign(in); err != nil || d.Model != "Iphone 15 Pro" {
		t.Fatalf("model case: %v %+v", err, d)
	}

	// No name: font must be empty too, and the summary says so.
	in = validDesign()
	in.Name, in.Font = "", ""
	d, err = Experience().NormalizeDesign(in)
	if err != nil || d.Name != "" || d.Font != "" || !strings.HasSuffix(DesignSummary(d), "Tanpa nama") {
		t.Fatalf("no name: %v %+v", err, d)
	}

	// Layout 2 takes two stickers.
	in = validDesign()
	in.Layout, in.Stickers = "2", in.Stickers[:2]
	if _, err := Experience().NormalizeDesign(in); err != nil {
		t.Fatalf("layout 2: %v", err)
	}
}

func TestNormalizeDesignRejects(t *testing.T) {
	for name, mutate := range map[string]func(d *Design){
		"nil":                func(d *Design) {},
		"unknown brand":      func(d *Design) { d.Brand = "nokia" },
		"model of other":     func(d *Design) { d.Model = "Samsung S23" },
		"unknown layout":     func(d *Design) { d.Layout = "4" },
		"too few stickers":   func(d *Design) { d.Stickers = d.Stickers[:2] },
		"too many stickers":  func(d *Design) { d.Layout = "2" },
		"sticker of other":   func(d *Design) { d.Stickers[1].Code = "baking-pals-a" },
		"unknown theme":      func(d *Design) { d.Stickers[0].Theme = "nope" },
		"unknown background": func(d *Design) { d.Background = "plaid" },
		"name without font":  func(d *Design) { d.Font = "" },
		"font without name":  func(d *Design) { d.Name = "   " },
		"unknown font":       func(d *Design) { d.Font = "comic-sans" },
		"name too long":      func(d *Design) { d.Name = "Abcdefghijklm" },
		"control char":       func(d *Design) { d.Name = "Kai\x00" },
	} {
		t.Run(name, func(t *testing.T) {
			var in *Design
			if name != "nil" {
				in = validDesign()
				mutate(in)
			}
			_, err := Experience().NormalizeDesign(in)
			var he *httpx.Error
			if !errors.As(err, &he) || he.Status != 400 {
				t.Fatalf("want 400, got %v", err)
			}
		})
	}
}

func TestPublicBookDesignsBody(t *testing.T) {
	for _, c := range []struct {
		body  string
		valid bool
		n     int
	}{
		{`{"designs":[{"brand":"apple","stickers":[]},null]}`, true, 2},
		{`{"designs":["x"]}`, false, 1},
		{`{"designs":[{"stickers":"x"}]}`, false, 1},
		{`{}`, true, 0},
	} {
		f := body(httptest.NewRequest("POST", "/", strings.NewReader(c.body)))
		var got []*Design
		f.List("designs", opt, 5, func(list *validate.Form, i int, v any) { got = append(got, designValue(list, i, v)) })
		if f.Valid() != c.valid || len(got) != c.n {
			t.Fatalf("%s: valid=%v n=%d issues=%v", c.body, f.Valid(), len(got), f.Issues())
		}
	}
}
