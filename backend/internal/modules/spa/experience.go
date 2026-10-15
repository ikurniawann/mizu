package spa

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

/* ── Paddy Experience: custom case design catalog ────────────────────── */

// experienceJSON is the design catalog (The Experience Room): phone brands
// and models, layouts, backgrounds (the case itself), sticker themes and
// name fonts. Images live under frontend/public/experience/.
//
//go:embed catalog/experience.json
var experienceJSON []byte

// ExperienceLayout is a sticker layout: how many sticker slots the case has.
type ExperienceLayout struct {
	Code  string `json:"code"`
	Name  string `json:"name"`
	Slots int    `json:"slots"`
}

// ExperienceBrand is a phone brand with its supported models.
type ExperienceBrand struct {
	Code   string   `json:"code"`
	Name   string   `json:"name"`
	Models []string `json:"models"`
}

// ExperienceImage is a named catalog image (a background or a sticker).
type ExperienceImage struct {
	Code  string `json:"code"`
	Name  string `json:"name"`
	Image string `json:"image"`
}

// ExperienceTheme is a sticker theme ("kategori gambar") with its stickers.
type ExperienceTheme struct {
	Code     string            `json:"code"`
	Name     string            `json:"name"`
	Cover    string            `json:"cover"`
	Stickers []ExperienceImage `json:"stickers"`
}

// ExperienceFont is a name font; Sample is an image of a name in that font.
type ExperienceFont struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	Sample string `json:"sample"`
}

// ExperienceCatalog is GET /api/public/spa/experience-catalog.
type ExperienceCatalog struct {
	PriceIDR      float64            `json:"price"`
	Layouts       []ExperienceLayout `json:"layouts"`
	Brands        []ExperienceBrand  `json:"brands"`
	Backgrounds   []ExperienceImage  `json:"backgrounds"`
	Themes        []ExperienceTheme  `json:"themes"`
	Fonts         []ExperienceFont   `json:"fonts"`
	NameMaxLength int                `json:"name_max_length"`
}

var experience = sync.OnceValue(func() *ExperienceCatalog {
	c, err := parseExperience(experienceJSON)
	if err != nil {
		panic("spa: experience catalog: " + err.Error())
	}
	return c
})

// Experience returns the embedded design catalog.
func Experience() *ExperienceCatalog { return experience() }

func parseExperience(raw []byte) (*ExperienceCatalog, error) {
	var c ExperienceCatalog
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	if len(c.Layouts) == 0 || len(c.Brands) == 0 || len(c.Backgrounds) == 0 || len(c.Themes) == 0 || len(c.Fonts) == 0 {
		return nil, fmt.Errorf("catalog is incomplete")
	}
	if c.NameMaxLength <= 0 {
		c.NameMaxLength = 12
	}
	return &c, nil
}

/* ── designs ─────────────────────────────────────────────────────────── */

// DesignSticker is one filled sticker slot.
type DesignSticker struct {
	Theme     string `json:"theme"`
	ThemeName string `json:"theme_name"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	Image     string `json:"image"`
}

// Design is the custom case design of a booking item. Clients send the
// codes (brand, model, layout, stickers[].theme/code, background, name,
// font); the server stores a normalized snapshot that also carries the
// display names and images, so later catalog edits keep history readable.
type Design struct {
	Brand           string          `json:"brand"`
	BrandName       string          `json:"brand_name"`
	Model           string          `json:"model"`
	Layout          string          `json:"layout"`
	LayoutName      string          `json:"layout_name"`
	Stickers        []DesignSticker `json:"stickers"`
	Background      string          `json:"background"`
	BackgroundName  string          `json:"background_name"`
	BackgroundImage string          `json:"background_image"`
	Name            string          `json:"name"`
	Font            string          `json:"font"`
	FontName        string          `json:"font_name"`
}

func designErr(msg string) error { return httpx.BadRequest("Desain case: " + msg) }

// NormalizeDesign validates a design against the catalog and returns the
// normalized snapshot.
func (c *ExperienceCatalog) NormalizeDesign(in *Design) (*Design, error) {
	if in == nil {
		return nil, designErr("wajib diisi")
	}
	out := &Design{Stickers: []DesignSticker{}}

	var brand *ExperienceBrand
	for i := range c.Brands {
		if c.Brands[i].Code == strings.TrimSpace(in.Brand) {
			brand = &c.Brands[i]
		}
	}
	if brand == nil {
		return nil, designErr("merk HP tidak dikenal")
	}
	out.Brand, out.BrandName = brand.Code, brand.Name
	model := strings.TrimSpace(in.Model)
	for _, m := range brand.Models {
		if strings.EqualFold(m, model) {
			out.Model = m
		}
	}
	if out.Model == "" {
		return nil, designErr("tipe HP tidak tersedia untuk " + brand.Name)
	}

	var layout *ExperienceLayout
	for i := range c.Layouts {
		if c.Layouts[i].Code == strings.TrimSpace(in.Layout) {
			layout = &c.Layouts[i]
		}
	}
	if layout == nil {
		return nil, designErr("layout tidak dikenal")
	}
	out.Layout, out.LayoutName = layout.Code, layout.Name
	if len(in.Stickers) != layout.Slots {
		return nil, designErr(fmt.Sprintf("%s butuh %d stiker", layout.Name, layout.Slots))
	}
	for i, s := range in.Stickers {
		theme := c.theme(strings.TrimSpace(s.Theme))
		if theme == nil {
			return nil, designErr(fmt.Sprintf("tema gambar %d tidak dikenal", i+1))
		}
		var sticker *ExperienceImage
		for j := range theme.Stickers {
			if theme.Stickers[j].Code == strings.TrimSpace(s.Code) {
				sticker = &theme.Stickers[j]
			}
		}
		if sticker == nil {
			return nil, designErr(fmt.Sprintf("stiker %d bukan bagian dari tema %s", i+1, theme.Name))
		}
		out.Stickers = append(out.Stickers, DesignSticker{Theme: theme.Code, ThemeName: theme.Name,
			Code: sticker.Code, Name: sticker.Name, Image: sticker.Image})
	}

	for _, b := range c.Backgrounds {
		if b.Code == strings.TrimSpace(in.Background) {
			out.Background, out.BackgroundName, out.BackgroundImage = b.Code, b.Name, b.Image
		}
	}
	if out.Background == "" {
		return nil, designErr("background tidak dikenal")
	}

	name := strings.Join(strings.Fields(in.Name), " ")
	font := strings.TrimSpace(in.Font)
	switch {
	case name == "" && font != "":
		return nil, designErr("isi nama atau hapus pilihan font")
	case name != "" && font == "":
		return nil, designErr("pilih font untuk nama")
	case validate.UTF16Len(name) > c.NameMaxLength:
		return nil, designErr(fmt.Sprintf("nama maksimal %d karakter", c.NameMaxLength))
	case strings.ContainsFunc(name, func(r rune) bool { return r < 0x20 || r == 0x7f }):
		return nil, designErr("nama mengandung karakter tidak valid")
	}
	if name != "" {
		for _, f := range c.Fonts {
			if f.Code == font {
				out.Font, out.FontName = f.Code, f.Name
			}
		}
		if out.Font == "" {
			return nil, designErr("font tidak dikenal")
		}
		out.Name = name
	}
	return out, nil
}

func (c *ExperienceCatalog) theme(code string) *ExperienceTheme {
	for i := range c.Themes {
		if c.Themes[i].Code == code {
			return &c.Themes[i]
		}
	}
	return nil
}

// DesignSummary is the one-line text of a design for the POS order line
// and the booking history, e.g. "Iphone 15 Pro · Black Sky · 3 stiker:
// Baking Pals A, Picnic Day B, Now Playing C · Nama: Kai (Daydream)".
func DesignSummary(d *Design) string {
	if d == nil {
		return ""
	}
	names := make([]string, len(d.Stickers))
	for i, s := range d.Stickers {
		names[i] = s.Name
	}
	parts := []string{d.Model, d.BackgroundName, fmt.Sprintf("%d stiker: %s", len(d.Stickers), strings.Join(names, ", "))}
	if d.Name != "" {
		parts = append(parts, "Nama: "+d.Name+" ("+d.FontName+")")
	} else {
		parts = append(parts, "Tanpa nama")
	}
	return strings.Join(parts, " · ")
}

// designFromBody reads an optional design object at key: (nil, false) when
// the key is absent, (nil, true) for an explicit null. The shape is checked
// here; NormalizeDesign checks it against the catalog.
func designFromBody(f *validate.Form, key string) (*Design, bool) {
	raw, sent := f.Fields()[key]
	if !sent || raw == nil {
		return nil, sent
	}
	return designValue(f, key, raw), true
}

// designValue decodes one design object, recording an issue at key on f
// when it is not one.
func designValue(f *validate.Form, key any, raw any) *Design {
	if raw == nil {
		return nil
	}
	if _, isObject := raw.(map[string]any); !isObject {
		f.Fail(key, "invalid_type", "Desain harus berupa objek")
		return nil
	}
	buf, err := json.Marshal(raw)
	var d Design
	if err == nil {
		err = json.Unmarshal(buf, &d)
	}
	if err != nil {
		f.Fail(key, "invalid_type", "Desain tidak valid")
		return nil
	}
	if len(d.Stickers) > 10 {
		f.Fail(key, "too_big", "Terlalu banyak stiker")
		return nil
	}
	return &d
}
