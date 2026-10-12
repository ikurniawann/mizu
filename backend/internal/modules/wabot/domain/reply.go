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

func NoSlotsToday(date string, alternatives []MenuOption, outletAlt string) string {
	msg := "Maaf, pada *" + LongDate(date) + "* jadwal sudah penuh 🙏"
	if len(alternatives) > 0 {
		msg += "\n\nHari terdekat yang masih tersedia:\n" + NumberedMenu(alternatives) + "\n\nBalas *nomor* harinya, atau tulis tanggal lain."
	} else {
		msg += "\n\nCoba tulis tanggal lain ya."
	}
	if outletAlt != "" {
		msg += "\n\nAtau ketik *ganti outlet* untuk cek " + outletAlt + " di hari yang sama."
	}
	return msg
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
	b.WriteString("• Jadwal: *" + LongDate(s.Date) + "*, jam *" + clockOfISO(s.SlotISO) + "* WIB\n")
	if s.People > 1 {
		b.WriteString("• " + strconv.Itoa(s.People) + " orang:\n")
		for i, p := range s.Persons {
			b.WriteString("   " + strconv.Itoa(i+1) + ". " + p.Label + " — " + Rupiah(p.Price) + "\n")
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
			b.WriteString("• *" + bk.Code + "* — " + bk.Customer + "\n")
		}
	}
	b.WriteString("Outlet: " + s.OutletName + "\nJadwal: " + LongDate(s.Date) + ", " + clockOfISO(s.SlotISO) + " WIB\n")
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
