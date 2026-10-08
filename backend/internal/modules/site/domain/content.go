// Package domain holds the public site's content model: the shape of each
// site.content key, its defaults and its validation. No database or HTTP.
package domain

import (
	"maps"
	"slices"
	"strings"

	"nuhabit/backend/internal/platform/validate"
)

// Kind is the type of one content field.
type Kind int

const (
	// Text is a short single-line string.
	Text Kind = iota
	// Long is a paragraph or markdown body.
	Long
	// URL is an absolute http(s) URL or a site-relative path.
	URL
	// Strings is a list of short strings.
	Strings
	// Object is a nested object with Fields.
	Object
	// Objects is a list of objects with Fields.
	Objects
)

// Field describes one key of a content object.
type Field struct {
	Name   string
	Kind   Kind
	Fields []Field // Object and Objects
}

const (
	textMax    = 300
	longMax    = 50000
	urlMax     = 1000
	listMax    = 40
	stringsMax = 60
)

func text(name string) Field  { return Field{Name: name, Kind: Text} }
func long(name string) Field  { return Field{Name: name, Kind: Long} }
func link(name string) Field  { return Field{Name: name, Kind: URL} }
func lines(name string) Field { return Field{Name: name, Kind: Strings} }
func object(name string, fields ...Field) Field {
	return Field{Name: name, Kind: Object, Fields: fields}
}
func objects(name string, fields ...Field) Field {
	return Field{Name: name, Kind: Objects, Fields: fields}
}

// Schemas is the shape of every content key, in the order the editor
// shows the fields.
var Schemas = map[string][]Field{
	"home": {
		object("hero", text("kicker"), text("title"), long("subtitle"), link("video_url"), link("image_url"), text("cta_label")),
		objects("partners", text("name"), link("logo_url")),
		objects("pillars", text("code"), text("title"), long("text")),
		object("mission", long("quote"), text("author")),
		objects("reel", link("image_url"), text("caption")),
		objects("stories", text("name"), text("role"), long("quote"), text("outcome"), link("image_url")),
	},
	"training": {
		object("intro", text("title"), long("text")),
		objects("class_types", text("name"), text("duration"), long("text")),
		object("block", text("title"), long("text"), objects("phases", text("name"), text("weeks"), long("text"))),
		object("laws", text("title"), lines("items")),
	},
	"space": {
		text("title"),
		long("intro"),
		objects("sections", text("title"), long("text"), link("image_url")),
	},
	"brand": {
		text("title"),
		long("intro"),
		long("story_md"),
		objects("values", text("title"), long("text")),
		link("image_url"),
	},
	"social": {
		link("instagram"), link("tiktok"), link("youtube"), text("whatsapp"), text("email"),
	},
	"legal_privacy": {text("title"), long("body_md")},
	"legal_terms":   {text("title"), long("body_md")},
	"analytics":     {text("gtm_id"), text("meta_pixel_id")},
}

// Keys lists the content keys in a stable order.
func Keys() []string { return slices.Sorted(maps.Keys(Schemas)) }

// IsKey reports whether key is a content key.
func IsKey(key string) bool {
	_, ok := Schemas[key]
	return ok
}

// Defaults is what the public site renders before staff edit a key.
var Defaults = map[string]map[string]any{
	"home": {
		"hero": map[string]any{
			"kicker":    "Family Massage & Reflexology · Bandung",
			"title":     "Rest. Relax. Rejuvenate.",
			"subtitle":  "Tempat yang tenang untuk berhenti sejenak. Pijat, refleksi dan perawatan tubuh di dua outlet Mizu di Bandung, sendiri, berdua atau bersama keluarga.",
			"video_url": "",
			"image_url": "",
			"cta_label": "Booking Sekarang",
		},
		"partners": []any{},
		"pillars": []any{
			map[string]any{"code": "REST", "title": "Istirahat sejenak", "text": "Lepaskan lelah setelah seharian beraktivitas. Ruangan yang tenang dan cahaya yang hangat membantu tubuh benar-benar berhenti sejenak."},
			map[string]any{"code": "RELAX", "title": "Rileks sesuai kebutuhan", "text": "Dari Balinese yang lembut sampai deep tissue untuk otot yang tegang. Sampaikan tekanan yang kamu suka, terapis akan menyesuaikan."},
			map[string]any{"code": "REJUVENATE", "title": "Pulang lebih segar", "text": "Refleksi kaki, lulur dan totok wajah untuk pulang dengan badan yang lebih ringan dan pikiran yang lebih jernih."},
		},
		"mission": map[string]any{
			"quote":  "Mizu hadir sebagai tempat untuk beristirahat sejenak, sendiri, berdua atau bersama keluarga. Datang dengan lelah, pulang dengan tubuh yang lebih ringan.",
			"author": "Tim Mizu",
		},
		"reel":    []any{},
		"stories": []any{},
	},
	// The "training" key carries the treatment guide shown on /treatments
	// and the home page; its field names predate the spa and stay for the editor.
	"training": {
		"intro": map[string]any{
			"title": "Treatment untuk setiap kebutuhan.",
			"text":  "Dari pijat tradisional Jawa sampai hot stone therapy, setiap treatment dikerjakan dengan tempo yang pelan dan tekanan yang bisa kamu atur bersama terapis.",
		},
		"class_types": []any{
			map[string]any{"name": "Butuh rileks total", "duration": "Balinese · Aromatherapy", "text": "Gerakan panjang yang mengalir dan minyak beraroma lembut untuk menenangkan badan dan pikiran."},
			map[string]any{"name": "Otot terasa kaku", "duration": "Deep Tissue · Shiatsu · Thai", "text": "Tekanan yang lebih dalam dan peregangan untuk punggung, bahu dan kaki yang tegang."},
			map[string]any{"name": "Kaki lelah seharian", "duration": "Refleksi Kaki", "text": "Walked all day? Pijatan pada titik-titik refleksi di telapak kaki untuk melepas penat setelah banyak berjalan."},
			map[string]any{"name": "Rasa tradisional", "duration": "Pijat Tradisional Jawa · Lulur", "text": "Pengalaman wellness tradisional Indonesia: pijat warisan nusantara dan lulur untuk kulit yang terasa lebih halus."},
		},
		"block": map[string]any{
			"title": "Alur kunjungan",
			"text":  "Dari booking sampai treatment selesai, semuanya dibuat sederhana.",
			"phases": []any{
				map[string]any{"name": "Booking online", "weeks": "Langkah 1", "text": "Pilih outlet, treatment dan jam di halaman booking, lalu simpan kode booking-mu."},
				map[string]any{"name": "Datang lebih awal", "weeks": "Langkah 2", "text": "Datanglah sekitar 10 menit sebelum jadwal agar sempat berganti pakaian dan bersantai."},
				map[string]any{"name": "Ngobrol dengan terapis", "weeks": "Langkah 3", "text": "Sampaikan area yang ingin difokuskan, tekanan yang nyaman dan kondisi kesehatanmu."},
				map[string]any{"name": "Treatment & pembayaran", "weeks": "Langkah 4", "text": "Nikmati treatment-nya. Pembayaran dilakukan langsung di outlet."},
			},
		},
		"laws": map[string]any{
			"title": "Sebelum treatment",
			"items": []any{
				"Beri tahu terapis jika sedang hamil, baru menjalani operasi atau punya kondisi kesehatan tertentu.",
				"Sampaikan bila tekanan terasa terlalu kuat atau kurang. Terapis akan menyesuaikan.",
				"Hindari makan berat tepat sebelum treatment.",
				"Simpan barang berharga dan heningkan ponsel agar suasana tetap tenang.",
				"Berhalangan hadir? Kabari outlet sedini mungkin agar jadwalnya bisa diberikan ke tamu lain.",
			},
		},
	},
	"space": {
		"title": "Ruang yang tenang di tengah kota.",
		"intro": "Cahaya hangat, aroma yang lembut dan ruangan yang tertata rapi. Setiap sudut Mizu dibuat agar kamu bisa memperlambat langkah.",
		"sections": []any{
			map[string]any{"title": "Ruang treatment", "text": "Ruangan yang bersih dan nyaman dengan tempat tidur pijat, handuk bersih dan pencahayaan redup.", "image_url": ""},
			map[string]any{"title": "Ruang refleksi", "text": "Kursi refleksi yang empuk berlatar dinding batu, pas untuk melepas lelah kaki setelah seharian berjalan.", "image_url": ""},
			map[string]any{"title": "Couple & keluarga", "text": "Treatment berdua atau bersama keluarga dalam satu ruangan, untuk me-time yang lebih hangat bersama orang terdekat.", "image_url": ""},
			map[string]any{"title": "Ruang ganti", "text": "Tempat berganti pakaian dan menyimpan barang sebelum dan sesudah treatment. Fasilitas dapat berbeda di tiap outlet.", "image_url": ""},
		},
	},
	"brand": {
		"title":    "Tentang Mizu",
		"intro":    "Mizu Family Massage & Reflexology: magical places to rest, relax and rejuvenate di Bandung.",
		"story_md": "Mizu berawal dari keinginan sederhana: menghadirkan tempat pijat dan refleksi yang tenang, bersih dan ramah untuk seluruh keluarga.\n\nKami memadukan teknik pijat nusantara seperti pijat tradisional Jawa, Balinese, lulur dan totok wajah dengan teknik dari Asia seperti Thai dan Shiatsu. Semuanya disajikan dengan tempo yang pelan, agar setiap kunjungan terasa seperti jeda yang kamu butuhkan.\n\nKini Mizu hadir di dua outlet di Bandung: **Mizu 1.0** di Jl. Westhoff No. 1 dan **Mizu Signature** di Jl. Riau No. 142.",
		"values": []any{
			map[string]any{"title": "Tenang", "text": "Suasana yang hening dan tempo yang pelan, dari pintu masuk sampai treatment selesai."},
			map[string]any{"title": "Hangat", "text": "Untuk sendiri, berdua atau bersama keluarga. Semua tamu disambut dengan ramah."},
			map[string]any{"title": "Terawat", "text": "Ruangan dan handuk yang bersih, dan terapis yang mendengarkan kebutuhanmu."},
		},
		"image_url": "",
	},
	"social": {
		"instagram": "https://instagram.com/mizufamily.id",
		"tiktok":    "",
		"youtube":   "",
		"whatsapp":  "",
		"email":     "",
	},
	"legal_privacy": {
		"title":   "Kebijakan Privasi",
		"body_md": "Mizu Family Massage & Reflexology menyimpan data yang kamu berikan saat melakukan booking atau menghubungi kami: nama, nomor telepon, catatan untuk terapis dan riwayat kunjungan.\n\nData tersebut kami gunakan untuk mengatur jadwal treatment, menghubungimu terkait booking dan meningkatkan layanan. Kami tidak menjual data pribadimu kepada pihak lain.\n\nCatatan kesehatan yang kamu sampaikan hanya dipakai agar terapis dapat memberikan treatment yang aman dan nyaman.\n\nKamu dapat meminta salinan atau penghapusan datamu melalui kontak yang tercantum di situs ini.",
	},
	"legal_terms": {
		"title":   "Syarat & Ketentuan",
		"body_md": "## Booking\n\nBooking online di situs ini adalah reservasi jadwal treatment di outlet pilihanmu. Simpan kode booking dan tunjukkan saat tiba di outlet.\n\n## Kedatangan & perubahan jadwal\n\nMohon datang sekitar 10 menit sebelum jadwal. Jika datang terlambat, durasi treatment mungkin perlu disesuaikan agar tidak mengganggu jadwal tamu berikutnya. Bila berhalangan hadir atau ingin mengubah jadwal, mohon kabari outlet sedini mungkin.\n\n## Kondisi kesehatan\n\nBeri tahu terapis sebelum treatment jika kamu sedang hamil, baru menjalani operasi, memiliki tekanan darah tinggi, cedera, masalah kulit atau kondisi kesehatan lain. Terapis dapat menyesuaikan atau menyarankan treatment lain demi kenyamanan dan keamananmu. Treatment di Mizu ditujukan untuk relaksasi dan bukan pengganti perawatan medis.\n\n## Harga & pembayaran\n\nHarga di situs adalah harga treatment di outlet terpilih dan dapat berubah sewaktu-waktu. Pembayaran dilakukan langsung di outlet.\n\n## Promo\n\nPromo berlaku sesuai ketentuan yang diumumkan untuk setiap promo.",
	},
	"analytics": {
		"gtm_id":        "",
		"meta_pixel_id": "",
	},
}

// Default is a fresh copy of the key's defaults (nil for an unknown key).
func Default(key string) map[string]any {
	d, ok := Defaults[key]
	if !ok {
		return nil
	}
	return cloneMap(d)
}

// Merge overlays the stored value on the key's defaults: maps merge key
// by key at every depth, scalars and lists from stored win.
func Merge(key string, stored map[string]any) map[string]any {
	return mergeMaps(Default(key), stored)
}

func mergeMaps(base, over map[string]any) map[string]any {
	if base == nil {
		base = map[string]any{}
	}
	for k, v := range over {
		bm, bok := base[k].(map[string]any)
		vm, vok := v.(map[string]any)
		if bok && vok {
			base[k] = mergeMaps(bm, vm)
			continue
		}
		base[k] = v
	}
	return base
}

func cloneMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		switch x := v.(type) {
		case map[string]any:
			out[k] = cloneMap(x)
		case []any:
			out[k] = cloneList(x)
		default:
			out[k] = v
		}
	}
	return out
}

func cloneList(l []any) []any {
	out := make([]any, len(l))
	for i, v := range l {
		if m, ok := v.(map[string]any); ok {
			out[i] = cloneMap(m)
		} else {
			out[i] = v
		}
	}
	return out
}

// ValidURL accepts an empty value, an absolute http(s) URL or a
// site-relative path.
func ValidURL(s string) bool {
	if s == "" || strings.HasPrefix(s, "/") {
		return !strings.HasPrefix(s, "//")
	}
	return (strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")) && validate.ValidURL(s)
}

var urlCheck = func(s string) (string, string, bool) { return "invalid_format", "URL tidak valid", ValidURL(s) }

// Validate reads the body of one content key from f, recording issues on
// it, and returns the cleaned value: strings trimmed, unknown keys dropped,
// absent fields omitted so Merge fills them from the defaults.
func Validate(key string, f *validate.Form) map[string]any {
	return validateObject(f, Schemas[key])
}

func validateObject(f *validate.Form, fields []Field) map[string]any {
	out := make(map[string]any, len(fields))
	opt := validate.Rule{Optional: true, Nullable: true}
	for _, fd := range fields {
		switch fd.Kind {
		case Text, Long, URL:
			o := validate.StrOpts{Trim: true, Max: textMax}
			switch fd.Kind {
			case Long:
				o.Max = longMax
			case URL:
				o.Max, o.Check = urlMax, urlCheck
			}
			if s := f.Str(fd.Name, opt, o); s != nil {
				out[fd.Name] = *s
			}
		case Strings:
			list := f.Strings(fd.Name, opt, stringsMax, validate.StrOpts{Trim: true, Max: textMax})
			if list == nil {
				continue
			}
			items := make([]any, 0, len(list))
			for _, s := range list {
				if s != "" {
					items = append(items, s)
				}
			}
			out[fd.Name] = items
		case Object:
			if raw, sent := f.Fields()[fd.Name]; sent && raw != nil {
				out[fd.Name] = validateObject(f.Child(fd.Name), fd.Fields)
			}
		case Objects:
			items := []any{}
			if f.List(fd.Name, opt, listMax, func(sub *validate.Form, i int, v any) {
				items = append(items, validateObject(sub.Item(i, v), fd.Fields))
			}) != nil {
				out[fd.Name] = items
			}
		}
	}
	return out
}
