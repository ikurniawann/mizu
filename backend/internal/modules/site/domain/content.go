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
			"kicker":    "Customized Phone Cases & Adorable Goods · Bandung",
			"title":     "Make it yours. Make it Paddy.",
			"subtitle":  "Case HP, Paddy Pods, tas, dan aksesoris lucu dari Bandung sejak 2016. Datang ke Paddy Experience di toko kami untuk custom case, personalisasi nama, dan workshop charm, sendiri, berdua, atau bareng teman.",
			"video_url": "",
			"image_url": "",
			"cta_label": "Booking Paddy Experience",
		},
		"partners": []any{},
		"pillars": []any{
			map[string]any{"code": "CUSTOMIZE", "title": "Desain sesukamu", "text": "Foto, nama, inisial, atau ilustrasi favorit dicetak di case pilihanmu. Desainer Paddy bantu atur tata letaknya langsung di Experience Room."},
			map[string]any{"code": "CREATE", "title": "Bikin sendiri", "text": "Workshop Charm & Beads Strap dan Tote Bag Painting Class: semua bahan disediakan, kamu tinggal berkreasi dan bawa pulang hasilnya."},
			map[string]any{"code": "CARE", "title": "Gadget tetap kece", "text": "Pasang tempered glass dan skin, setting Paddy Watch, sampai gift wrapping premium untuk kado spesial."},
		},
		"mission": map[string]any{
			"quote":  "Paddy hadir untuk bikin barang sehari-hari jadi lebih personal dan menyenangkan. Dari case HP sampai tote bag, semuanya bisa jadi cerita kamu.",
			"author": "Tim Paddy",
		},
		"reel":    []any{},
		"stories": []any{},
	},
	// The "training" key carries the service guide shown on /treatments
	// and the home page; its field names predate the studio and stay for the editor.
	"training": {
		"intro": map[string]any{
			"title": "Layanan Paddy Experience untuk setiap ide.",
			"text":  "Dari custom case dan personalisasi nama sampai workshop charm strap, semua dikerjakan bareng crew experience Paddy langsung di toko.",
		},
		"class_types": []any{
			map[string]any{"name": "Mau case yang beda", "duration": "Custom Case Design · Sticker Deco Case", "text": "Desain case dengan foto, ilustrasi, atau stiker pilihanmu, lalu dicetak dan dirapikan di workshop Paddy."},
			map[string]any{"name": "Biar ada namanya", "duration": "Personalisasi Nama & Inisial · Pods Engraving · Bag Patch", "text": "Tambah nama, inisial, atau tanggal spesial di case, Paddy Pods, tas, dan pouch."},
			map[string]any{"name": "Pengen bikin sendiri", "duration": "Charm & Beads Strap Workshop · Tote Bag Painting Class", "text": "Workshop seru untuk sendiri, berdua, atau rombongan. Bahan lengkap, crew experience siap memandu."},
			map[string]any{"name": "Gadget care & kado", "duration": "Tempered Glass & Skin · Watch Setting · Gift Wrapping", "text": "Pemasangan pelindung layar, setting Paddy Watch, dan bungkus kado premium dengan gift box Paddy."},
		},
		"block": map[string]any{
			"title": "Alur kunjungan",
			"text":  "Dari booking sampai hasil karyamu jadi, semuanya dibuat sederhana.",
			"phases": []any{
				map[string]any{"name": "Booking online", "weeks": "Langkah 1", "text": "Pilih toko, layanan, dan jam di halaman booking, lalu simpan kode booking-mu."},
				map[string]any{"name": "Siapkan ide", "weeks": "Langkah 2", "text": "Bawa HP-mu dan siapkan foto, nama, atau referensi desain yang kamu mau."},
				map[string]any{"name": "Ngobrol dengan crew", "weeks": "Langkah 3", "text": "Crew experience bantu pilih model case, warna, font, dan tata letak sampai pas."},
				map[string]any{"name": "Jadi & pembayaran", "weeks": "Langkah 4", "text": "Hasilnya bisa langsung dibawa pulang. Pembayaran dilakukan langsung di kasir toko."},
			},
		},
		"laws": map[string]any{
			"title": "Sebelum datang",
			"items": []any{
				"Pastikan tipe HP-mu tersedia untuk model case yang dipilih; tanya crew kalau ragu.",
				"Siapkan file foto atau desain beresolusi baik supaya hasil cetak tajam.",
				"Datang sekitar 10 menit sebelum jadwal, apalagi untuk kelas workshop.",
				"Hasil custom dibuat sesuai pesanan, jadi cek ulang ejaan nama dan desain sebelum dicetak.",
				"Berhalangan hadir? Kabari toko sedini mungkin agar jadwalnya bisa diberikan ke tamu lain.",
			},
		},
	},
	"space": {
		"title": "Studio kecil yang penuh warna.",
		"intro": "Rak case warna-warni, meja workshop, dan sudut foto yang lucu. Setiap toko Paddy dibuat supaya kamu betah berkreasi.",
		"sections": []any{
			map[string]any{"title": "Display produk", "text": "Koleksi Paddy Cases, Catalogue Case, Paddy Pods, tas, Paddy Watch, dan adorable goods lain yang bisa dicoba langsung.", "image_url": ""},
			map[string]any{"title": "Meja Paddy Experience", "text": "Tempat custom case, personalisasi nama, dan pemasangan tempered glass bareng crew experience.", "image_url": ""},
			map[string]any{"title": "Workshop corner", "text": "Meja panjang untuk kelas charm strap dan tote bag painting, cocok untuk berdua atau rombongan teman.", "image_url": ""},
			map[string]any{"title": "Gift wrapping", "text": "Sudut bungkus kado dengan gift box, pita, dan kartu ucapan Paddy. Fasilitas dapat berbeda di tiap toko.", "image_url": ""},
		},
	},
	"brand": {
		"title":    "Tentang Paddy",
		"intro":    "Paddy: customized phone cases & adorable goods dari Bandung sejak 2016.",
		"story_md": "Paddy berawal di Bandung pada 2016 dengan nama **Paddycases**: case HP yang bisa dicustom sesuai selera pemiliknya.\n\nSekarang Paddy tumbuh jadi brand *adorable goods*: Paddy Cases dan Catalogue Case hasil kolaborasi ilustrator lokal, Paddy Pods, pop socket, tas, Paddy Watch, apparel rajut, sampai parfum. Di Paddy Experience, kamu bisa custom case, menambahkan nama, atau ikut workshop langsung di toko.\n\nTemukan Paddy di **Paddy Store PVJ** (Paris Van Java Mall, Bandung), **Paddy Store Kopo**, dan online di paddy.id.",
		"values": []any{
			map[string]any{"title": "Personal", "text": "Setiap produk bisa jadi milikmu banget, dari nama sampai desain."},
			map[string]any{"title": "Playful", "text": "Warna, motif, dan karakter yang bikin hari-hari lebih menyenangkan."},
			map[string]any{"title": "Lokal", "text": "Dibuat di Bandung, berkolaborasi dengan ilustrator dan pengrajin lokal."},
		},
		"image_url": "",
	},
	"social": {
		"instagram": "https://www.instagram.com/paddy.id/",
		"tiktok":    "",
		"youtube":   "",
		"whatsapp":  "",
		"email":     "",
	},
	"legal_privacy": {
		"title":   "Kebijakan Privasi",
		"body_md": "Paddy menyimpan data yang kamu berikan saat berbelanja, melakukan booking Paddy Experience, atau menghubungi kami: nama, nomor telepon, alamat pengiriman, catatan desain, dan riwayat transaksi.\n\nData tersebut kami gunakan untuk memproses pesanan dan booking, menghubungimu terkait pesanan, dan meningkatkan layanan. Kami tidak menjual data pribadimu kepada pihak lain.\n\nFoto atau desain yang kamu kirim untuk produk custom hanya dipakai untuk membuat pesananmu.\n\nKamu dapat meminta salinan atau penghapusan datamu melalui kontak yang tercantum di situs ini.",
	},
	"legal_terms": {
		"title":   "Syarat & Ketentuan",
		"body_md": "## Booking Paddy Experience\n\nBooking online di situs ini adalah reservasi jadwal layanan Paddy Experience di toko pilihanmu. Simpan kode booking dan tunjukkan saat tiba di toko.\n\n## Kedatangan & perubahan jadwal\n\nMohon datang sekitar 10 menit sebelum jadwal. Jika datang terlambat, durasi layanan mungkin perlu disesuaikan agar tidak mengganggu jadwal tamu berikutnya. Bila berhalangan hadir atau ingin mengubah jadwal, mohon kabari toko sedini mungkin.\n\n## Produk custom\n\nProduk custom dibuat sesuai desain yang kamu setujui. Periksa kembali ejaan, warna, dan tipe HP sebelum dicetak; produk custom tidak dapat ditukar kecuali terdapat cacat produksi.\n\n## Harga & pembayaran\n\nHarga di situs adalah harga di toko terpilih dan dapat berubah sewaktu-waktu. Pembayaran layanan experience dilakukan langsung di kasir toko.\n\n## Promo\n\nPromo berlaku sesuai ketentuan yang diumumkan untuk setiap promo.",
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
