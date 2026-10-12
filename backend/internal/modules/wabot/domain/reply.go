package domain

import (
	"strconv"
	"strings"
)

// Reply templates (Indonesian, WhatsApp markdown: *bold*, _italic_). The
// bot never phrases prices, times or names itself; every value comes from
// the session, which comes from the spa service.

// Rupiah is "Rp185.000".
func Rupiah(v float64) string {
	n := int64(v + 0.5)
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return "Rp" + b.String()
}

// NumberedMenu renders options as "1. Label" lines.
func NumberedMenu(options []MenuOption) string {
	lines := make([]string, len(options))
	for i, o := range options {
		lines[i] = o.Key + ". " + o.Label
	}
	return strings.Join(lines, "\n")
}

func Greeting(botName, greeting string) string {
	if strings.TrimSpace(greeting) != "" {
		return greeting
	}
	return "Halo! Saya " + botName + ", asisten booking Mizu. Saya bantu pilih outlet, treatment, dan jamnya ya 🙏"
}

func AskOutlet(options []MenuOption) string {
	return "Mau datang ke outlet mana?\n" + NumberedMenu(options) + "\n\nBalas dengan *nomor* atau nama outletnya."
}

func AskPeople() string {
	return "Untuk berapa orang? Balas angkanya (maks. " + strconv.Itoa(MaxPeople) + " orang per booking)."
}

func AskTreatment(outlet string, people int, options []MenuOption) string {
	head := "Pilih treatment di *" + outlet + "*:\n" + NumberedMenu(options)
	if people > 1 {
		return head + "\n\nBalas *satu nomor* kalau semua orang sama, atau beberapa nomor dipisah koma sesuai urutan orang, mis. *1, 3*."
	}
	return head + "\n\nBalas dengan *nomor* treatmentnya."
}

func AskDate(options []MenuOption) string {
	return "Mau datang kapan?\n" + NumberedMenu(options) + "\n\nAtau tulis tanggalnya, mis. *Sabtu*, *15 Okt*, atau *besok sore*."
}

func AskTime(date string, options []MenuOption, requested string) string {
	head := "Jam yang masih tersedia pada *" + LongDate(date) + "*"
	if requested != "" {
		head = "Jam *" + requested + "* sudah penuh. Yang terdekat masih tersedia pada *" + LongDate(date) + "*"
	}
	return head + ":\n" + NumberedMenu(options) + "\n\nBalas dengan *nomor* jamnya."
}

// NoSlots offers what is left when the day is full: nearby days, another
// outlet the same day, and the waitlist (menu values carry the choice).
func NoSlots(date string, options []MenuOption, people int) string {
	msg := "Maaf, pada *" + LongDate(date) + "* jadwal sudah penuh"
	if people > 1 {
		msg += " untuk " + strconv.Itoa(people) + " orang sekaligus"
	}
	msg += " 🙏"
	if len(options) > 0 {
		msg += "\n\nYang bisa saya tawarkan:\n" + NumberedMenu(options) + "\n\nBalas *nomor* pilihannya, atau tulis tanggal lain."
	} else {
		msg += "\n\nCoba tulis tanggal lain ya, atau ketik *daftar tunggu* supaya saya kabari begitu ada jam kosong."
	}
	return msg
}

// AskTimeStaggered: no slot fits every guest at once, but guests can start
// one after another.
func AskTimeStaggered(date string, people int, options []MenuOption) string {
	return "Pada *" + LongDate(date) + "* tidak ada jam untuk " + strconv.Itoa(people) + " orang *sekaligus*, tapi bisa bergantian:\n" +
		NumberedMenu(options) + "\n\nBalas *nomor* pilihannya, atau tulis tanggal lain. Ketik *daftar tunggu* kalau ingin dikabari saat ada jam untuk semua sekaligus."
}

func WaitlistJoined(outlet, date string, people int, period string) string {
	when := LongDate(date)
	if period != "" {
		when += " (" + period + ")"
	}
	msg := "Siap, Anda masuk daftar tunggu *" + outlet + "* untuk *" + when + "*"
	if people > 1 {
		msg += ", " + strconv.Itoa(people) + " orang"
	}
	return msg + " ✅\n\nBegitu ada jam kosong saya kabari di chat ini. Sementara itu, tulis tanggal lain kalau mau coba hari lain, atau ketik *batal daftar tunggu* untuk membatalkan."
}

// WaitlistAvailable is what the watcher sends when a slot frees up.
func WaitlistAvailable(name, outlet, date string, clocks []string) string {
	greet := "Kabar baik"
	if strings.TrimSpace(name) != "" {
		greet += ", " + strings.TrimSpace(name)
	}
	return greet + "! Di *" + outlet + "* pada *" + LongDate(date) + "* sekarang ada jam kosong: " + strings.Join(clocks, ", ") +
		" WIB.\n\nBalas *ambil* untuk lanjut booking (pilihan treatment sudah saya simpan), atau *batal* kalau tidak jadi."
}

func WaitlistCancelled() string {
	return "Baik, daftar tunggunya saya batalkan. Ketik *booking* kapan saja kalau mau mencoba lagi 🙏"
}

func WaitlistNeedsDate() string {
	return "Untuk daftar tunggu, sebutkan dulu tanggalnya ya (mis. *Sabtu* atau *15 Okt*)."
}

func AskTherapist(options []MenuOption, pref string) string {
	head := "Terapis yang kosong di jam itu"
	switch pref {
	case "female":
		head += " (wanita)"
	case "male":
		head += " (pria)"
	}
	return head + ":\n" + NumberedMenu(options) + "\n\nBalas *nomor* terapis, atau *0* kalau mau dipilihkan oleh Mizu. Bisa juga tulis *wanita* / *pria*."
}

func AskName() string {
	return "Boleh tahu nama Anda untuk bookingnya?"
}

// Summary lists everything before the guest confirms.
func Summary(s *Session) string {
	var b strings.Builder
	b.WriteString("Berikut ringkasan bookingnya:\n")
	b.WriteString("• Outlet: *" + s.OutletName + "*\n")
	if s.Staggered() {
		b.WriteString("• Jadwal: *" + LongDate(s.Date) + "*, bergantian\n")
	} else {
		b.WriteString("• Jadwal: *" + LongDate(s.Date) + "*, jam *" + clockOfISO(s.SlotISO) + "* WIB\n")
	}
	if s.People > 1 {
		b.WriteString("• " + strconv.Itoa(s.People) + " orang:\n")
		for i, p := range s.Persons {
			line := "   " + strconv.Itoa(i+1) + ". " + p.Label + " — " + Rupiah(p.Price)
			if s.Staggered() {
				line += " (jam " + clockOfISO(s.SlotOf(i)) + ")"
			}
			b.WriteString(line + "\n")
		}
	} else if len(s.Persons) > 0 {
		b.WriteString("• Treatment: *" + s.Persons[0].Label + "* — " + Rupiah(s.Persons[0].Price) + "\n")
	}
	switch {
	case s.TherapistName != "":
		b.WriteString("• Terapis: *" + s.TherapistName + "*\n")
	case s.Pref == "female":
		b.WriteString("• Terapis: wanita (dipilihkan Mizu)\n")
	case s.Pref == "male":
		b.WriteString("• Terapis: pria (dipilihkan Mizu)\n")
	default:
		b.WriteString("• Terapis: dipilihkan oleh Mizu\n")
	}
	b.WriteString("• Atas nama: *" + s.Name + "*\n")
	b.WriteString("• Total: *" + Rupiah(s.TotalPrice()) + "*\n\n")
	b.WriteString("Sudah benar? Balas *ya* untuk membuat booking, atau *ubah* untuk mengulang.")
	return b.String()
}

func AskPayment(total float64, online bool) string {
	if !online {
		return "Booking tercatat ✅ Pembayaran *" + Rupiah(total) + "* dilakukan di outlet setelah treatment.\n\nBalas *1* untuk konfirmasi."
	}
	return "Mau bayar bagaimana? Total *" + Rupiah(total) + "*\n1. Bayar di outlet (setelah treatment)\n2. Bayar online sekarang (VA, QRIS, e-wallet, kartu)\n\nBalas *nomor* pilihannya."
}

func Confirmed(s *Session, botName string) string {
	var b strings.Builder
	if len(s.Bookings) == 1 {
		b.WriteString("Booking berhasil ✅\n\nKode booking: *" + s.Bookings[0].Code + "*\n")
	} else {
		b.WriteString("Booking berhasil ✅ Kode booking:\n")
		for _, bk := range s.Bookings {
			line := "• *" + bk.Code + "* — " + bk.Customer
			if s.Staggered() && bk.When != "" {
				line += ", jam " + bk.When
			}
			b.WriteString(line + "\n")
		}
	}
	if s.Staggered() {
		b.WriteString("Outlet: " + s.OutletName + "\nJadwal: " + LongDate(s.Date) + " (bergantian, lihat jam tiap tamu)\n")
	} else {
		b.WriteString("Outlet: " + s.OutletName + "\nJadwal: " + LongDate(s.Date) + ", " + clockOfISO(s.SlotISO) + " WIB\n")
	}
	if s.PayMethod == "online" {
		b.WriteString("\nSilakan bayar lewat link berikut (berlaku 2 jam):\n")
		for _, bk := range s.Bookings {
			if bk.PayURL != "" {
				b.WriteString(bk.PayURL + "\n")
			}
		}
		b.WriteString("\nSetelah lunas, balas *sudah bayar* dan saya cek ya.")
	} else {
		b.WriteString("\nPembayaran di outlet setelah treatment.")
	}
	b.WriteString("\n\nStatus & QR booking:\n")
	for _, bk := range s.Bookings {
		b.WriteString(bk.StatusURL + "\n")
	}
	b.WriteString("\nTunjukkan kode/QR ke resepsionis saat tiba. Jadwal bisa diubah sendiri sampai 1 jam sebelum kunjungan lewat link di atas.\nTerima kasih, sampai jumpa di Mizu 🌿")
	return b.String()
}

func PaymentSeen(paid bool, code string) string {
	if paid {
		return "Pembayaran untuk booking *" + code + "* sudah kami terima ✅ Sampai jumpa di Mizu!"
	}
	return "Pembayaran *" + code + "* belum terlihat di sistem. Kalau baru saja bayar, tunggu 1–2 menit lalu balas *sudah bayar* lagi, atau bayar di outlet saat datang."
}

func Done(botName string) string {
	return "Booking Anda sudah selesai. Ketik *booking* untuk booking baru, *status* untuk melihat booking terakhir, atau *admin* untuk bicara dengan tim Mizu."
}

func NotUnderstood(prompt string, misses int) string {
	if misses >= 2 {
		return "Maaf, saya masih belum paham 🙏 " + prompt + "\n\nKetik *admin* kalau mau dibantu tim Mizu langsung."
	}
	return "Maaf, saya belum paham. " + prompt
}

func Handover(botName string) string {
	return "Baik, saya sambungkan ke tim Mizu ya. Mohon tunggu sebentar, admin akan membalas di chat ini 🙏"
}

func TooManyPeople() string {
	return "Untuk lebih dari " + strconv.Itoa(MaxPeople) + " orang, tim Mizu bantu atur langsung ya. Ketik *admin* untuk dihubungkan, atau balas angka 1–" + strconv.Itoa(MaxPeople) + "."
}

func OutletChanged(name string) string { return "Oke, ganti ke *" + name + "*." }

func StatusOf(refs []BookingRef) string {
	if len(refs) == 0 {
		return "Belum ada booking di chat ini. Ketik *booking* untuk mulai."
	}
	var b strings.Builder
	b.WriteString("Booking terakhir Anda:\n")
	for _, r := range refs {
		b.WriteString("• *" + r.Code + "* — " + r.StatusURL + "\n")
	}
	return b.String()
}

func clockOfISO(iso string) string {
	t, err := parseISO(iso)
	if err != nil {
		return iso
	}
	return Clock(t)
}

/* ── customer notices (payment & reminders) ──────────────────────────── */

// PaidNotice confirms an online payment.
func PaidNotice(name, code, outlet, date, clock string, items []string, total float64, statusURL string) string {
	var b strings.Builder
	b.WriteString("Pembayaran diterima ✅")
	if strings.TrimSpace(name) != "" {
		b.WriteString(" Terima kasih, " + strings.TrimSpace(name) + "!")
	}
	b.WriteString("\n\nKode booking: *" + code + "*\nOutlet: " + outlet + "\nJadwal: " + LongDate(date) + ", " + clock + " WIB\n")
	if len(items) > 0 {
		b.WriteString("Treatment: " + strings.Join(items, ", ") + "\n")
	}
	b.WriteString("Total: *" + Rupiah(total) + "* (lunas)\n\nStatus & QR booking:\n" + statusURL + "\n\nTunjukkan kode/QR ke resepsionis saat tiba. Sampai jumpa di Mizu 🌿")
	return b.String()
}

// ReminderNotice is sent the day before (kind "h1") and about two hours
// before (kind "2h") a visit.
func ReminderNotice(kind, name, code, outlet, date, clock string, items []string, paid bool, statusURL string) string {
	var b strings.Builder
	switch kind {
	case "2h":
		b.WriteString("Pengingat: sekitar 2 jam lagi, jam *" + clock + "* WIB di *" + outlet + "*")
	default:
		b.WriteString("Pengingat: besok *" + LongDate(date) + "* jam *" + clock + "* WIB di *" + outlet + "*")
	}
	if strings.TrimSpace(name) != "" {
		b.WriteString(" — " + strings.TrimSpace(name))
	}
	b.WriteString(".\n")
	if len(items) > 0 {
		b.WriteString("Treatment: " + strings.Join(items, ", ") + "\n")
	}
	b.WriteString("Kode booking: *" + code + "*\n")
	if paid {
		b.WriteString("Pembayaran: lunas ✅\n")
	} else {
		b.WriteString("Pembayaran: di outlet setelah treatment\n")
	}
	b.WriteString("\nStatus, QR & ubah jadwal (sampai 1 jam sebelum):\n" + statusURL + "\n\nSampai jumpa di Mizu 🌿")
	return b.String()
}

/* ── FAQ answers (from system data only) ────────────────────────────── */

// AnswerAddress lists the outlets' addresses (one when chosen).
func AnswerAddress(outlets []OutletOpt, chosen string) string {
	var b strings.Builder
	for _, o := range outlets {
		if chosen != "" && o.ID != chosen {
			continue
		}
		b.WriteString("📍 *" + o.Name + "*")
		if o.Address != "" {
			b.WriteString(": " + o.Address)
			if o.City != "" {
				b.WriteString(", " + o.City)
			}
		} else {
			b.WriteString(": alamat belum tercantum, tanya *admin* ya")
		}
		b.WriteString(" (buka " + hhmm(o.OpenTime) + "–" + hhmm(o.CloseTime) + ")")
		if o.Address != "" {
			b.WriteString("\nMaps: https://www.google.com/maps/search/?api=1&query=" + mapsQuery(o))
		}
		if o.Phone != "" {
			b.WriteString("\nTelp: " + o.Phone)
		}
		b.WriteString("\n")
	}
	return strings.TrimSpace(b.String())
}

func mapsQuery(o OutletOpt) string {
	q := o.Name + " " + o.Address
	if o.City != "" {
		q += " " + o.City
	}
	return strings.ReplaceAll(strings.Join(strings.Fields(q), "+"), "&", "%26")
}

// AnswerHours lists opening hours.
func AnswerHours(outlets []OutletOpt, chosen string) string {
	var lines []string
	for _, o := range outlets {
		if chosen != "" && o.ID != chosen {
			continue
		}
		lines = append(lines, "🕒 *"+o.Name+"*: setiap hari "+hhmm(o.OpenTime)+"–"+hhmm(o.CloseTime)+" WIB")
	}
	return strings.Join(lines, "\n") + "\nBooking lewat chat ini bisa untuk 60 hari ke depan."
}

// AnswerPrices lists the catalog with prices (up to 15 rows).
func AnswerPrices(outlet string, catalog []VariantOpt) string {
	if len(catalog) == 0 {
		return "Daftar harga belum tersedia untuk outlet itu, tanya *admin* ya."
	}
	var b strings.Builder
	b.WriteString("Daftar harga *" + outlet + "*:\n")
	for i, v := range catalog {
		if i >= 15 {
			b.WriteString("… dan lainnya\n")
			break
		}
		b.WriteString("• " + v.Label() + " — " + Rupiah(v.Price) + "\n")
	}
	return strings.TrimSpace(b.String())
}

func AnswerPayment(online bool) string {
	if online {
		return "Pembayaran bisa *di outlet setelah treatment* (tunai/QRIS/kartu) atau *online sekarang* lewat link (VA, QRIS, e-wallet, kartu). Pilihannya ditawarkan setelah booking dibuat."
	}
	return "Pembayaran dilakukan *di outlet setelah treatment* (tunai/QRIS/kartu). Tidak perlu DP."
}

func AnswerReschedule() string {
	return "Jadwal bisa diubah atau dibatalkan sendiri lewat link status booking (ada di pesan konfirmasi) sampai *1 jam sebelum* kunjungan. Kalau sudah lewat batas itu, ketik *admin* dan tim Mizu bantu."
}

func AnswerUnknown() string {
	return "Untuk pertanyaan itu saya belum punya jawabannya 🙏 Ketik *admin* supaya tim Mizu membalas di chat ini, atau lanjutkan booking."
}

// ContinuePrompt prefixes the pending booking question after an answer.
func ContinuePrompt(prompt string) string { return "Lanjut booking — " + prompt }

func hhmm(clock string) string {
	if len(clock) >= 5 {
		return strings.Replace(clock[:5], ":", ".", 1)
	}
	return clock
}
