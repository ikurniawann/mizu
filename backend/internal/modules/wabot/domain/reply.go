package domain

import (
	"strconv"
	"strings"
	"time"
)

// Reply templates in Indonesian and English (WhatsApp markdown: *bold*).
// The bot never phrases prices, times or names itself; every value comes
// from the session, which comes from the spa service. Each template takes
// the conversation language l first.

// t picks the text for l.
func t(l L, id, en string) string {
	if l == LangEN {
		return en
	}
	return id
}

// Rupiah is "Rp 185.000".
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
	return "Rp " + b.String()
}

// NumberedMenu renders options as "1. Label" lines.
func NumberedMenu(options []MenuOption) string {
	lines := make([]string, len(options))
	for i, o := range options {
		lines[i] = o.Key + ". " + o.Label
	}
	return strings.Join(lines, "\n")
}

var indoDays = []string{"Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"}
var indoMonths = []string{"", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
var enDays = []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}
var enMonths = []string{"", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

// LongDate is "Sabtu, 17 Okt 2026" / "Saturday, 17 Oct 2026" for YYYY-MM-DD.
func LongDate(l L, date string) string {
	d, err := time.ParseInLocation("2006-01-02", date, WIB)
	if err != nil {
		return date
	}
	if l == LangEN {
		return enDays[d.Weekday()] + ", " + strconv.Itoa(d.Day()) + " " + enMonths[d.Month()] + " " + strconv.Itoa(d.Year())
	}
	return indoDays[d.Weekday()] + ", " + strconv.Itoa(d.Day()) + " " + indoMonths[d.Month()] + " " + strconv.Itoa(d.Year())
}

// PeriodLabel names a period (pagi/siang/sore/malam) in l.
func PeriodLabel(l L, period string) string {
	if l == LangEN {
		switch period {
		case "pagi":
			return "morning"
		case "siang":
			return "midday"
		case "sore":
			return "afternoon"
		case "malam":
			return "evening"
		}
	}
	return period
}

/* ── menu labels the engine builds ───────────────────────────────────── */

func LangMenu() []MenuOption {
	return []MenuOption{{Key: "1", Label: "Bahasa Indonesia", Value: "id"}, {Key: "2", Label: "English", Value: "en"}}
}

func DayLabels(l L) [3]string {
	if l == LangEN {
		return [3]string{"Today", "Tomorrow", "Day after tomorrow"}
	}
	return [3]string{"Hari ini", "Besok", "Lusa"}
}

func PeopleLabel(l L, n int) string {
	if l == LangEN {
		if n == 1 {
			return "1 person"
		}
		return strconv.Itoa(n) + " people"
	}
	return strconv.Itoa(n) + " orang"
}

func SystemPickLabel(l L) string { return t(l, "Pilihkan oleh Mizu", "Let Mizu choose") }

func ConfirmLabels(l L) (yes, change string) {
	return t(l, "Ya, buat booking", "Yes, book it"), t(l, "Ubah", "Change")
}

func PaymentLabels(l L) (outlet, online string) {
	return t(l, "Bayar di outlet", "Pay at the outlet"), t(l, "Bayar online", "Pay online")
}

func SlotsAvailableLabel(l L, date string, n int) string {
	return LongDate(l, date) + " (" + strconv.Itoa(n) + t(l, " jam tersedia)", " times available)")
}

func OtherOutletLabel(l L, name string, n int) string {
	return name + t(l, ", hari yang sama (", ", same day (") + strconv.Itoa(n) + t(l, " jam tersedia)", " times available)")
}

func WaitlistOptionLabel(l L, date string) string {
	return t(l, "Masuk daftar tunggu ", "Join the waitlist for ") + LongDate(l, date) + t(l, " — saya kabari begitu ada jam kosong", " — I'll message you when a time frees up")
}

func StaggerLabel(l L, first string, firsts int, second string, seconds int) string {
	return first + " (" + PeopleLabel(l, firsts) + ") & " + second + " (" + PeopleLabel(l, seconds) + ")"
}

func GenderSuffix(l L, gender string) string {
	switch gender {
	case "female":
		return t(l, " (wanita)", " (female)")
	case "male":
		return t(l, " (pria)", " (male)")
	}
	return ""
}

/* ── admin hours & bot note ──────────────────────────────────────────── */

// AdminHours are the hours a live admin answers chats (crm settings
// cs_business_hours_start/end, whole hours WIB).
type AdminHours struct{ Start, End int }

// Label is "10.00–22.00".
func (h AdminHours) Label() string { return pad2(h.Start) + ".00–" + pad2(h.End) + ".00" }

// Open reports whether a live admin works at at.
func (h AdminHours) Open(at time.Time) bool {
	hr := at.In(WIB).Hour()
	if h.Start <= h.End {
		return hr >= h.Start && hr < h.End
	}
	return hr >= h.Start || hr < h.End // overnight shift
}

// BotNote tells the guest a bot is answering (some took it for a live admin)
// and when a live admin is around.
func BotNote(l L, h AdminHours) string {
	return t(l, "🤖 _Pesan ini dibalas otomatis oleh asisten virtual (bot), bukan admin. Butuh admin? Ketik *admin* — admin live tersedia jam "+h.Label()+" WIB._",
		"🤖 _This is an automated reply from a virtual assistant (bot), not a live admin. Need an admin? Type *admin* — live admins are available "+h.Label()+" WIB._")
}

/* ── conversation ────────────────────────────────────────────────────── */

// AskLang is the first message: a bilingual welcome and the language menu.
func AskLang(botName string) string {
	return "Halo! Selamat datang di Mizu 🌿 / Hello! Welcome to Mizu 🌿\n" +
		"🤖 _Ini balasan otomatis (bot), bukan admin / This is an automated reply (bot), not a live admin._\n\n" +
		"Pilih bahasa / choose a language:\n" + NumberedMenu(LangMenu()) + "\n\nBalas *1* atau *2* / reply *1* or *2*."
}

// Greeting opens the booking; the bot note always follows a custom greeting.
func Greeting(l L, botName, greeting string, h AdminHours) string {
	text := t(l, "Halo! Saya "+botName+", asisten booking Mizu. Saya bantu pilih outlet, treatment, dan jamnya ya 🙏",
		"Hi! I'm "+botName+", Mizu's booking assistant. I'll help you pick an outlet, a treatment and a time 🙏")
	if l == LangID && strings.TrimSpace(greeting) != "" {
		text = strings.TrimSpace(greeting)
	}
	return text + t(l, "\n🎁 Mau beli gift voucher? Ketik *gift voucher*.", "\n🎁 Want a gift voucher? Type *gift voucher*.") + "\n\n" + BotNote(l, h)
}

// AskName opens the booking: the profile name is offered as option 1.
func AskName(l L, profileName string) string {
	if strings.TrimSpace(profileName) != "" {
		return t(l, "Boleh tahu nama Anda untuk bookingnya?\n1. Pakai nama *"+profileName+"*\n\nAtau tulis nama lain.",
			"May I have your name for the booking?\n1. Use *"+profileName+"*\n\nOr type another name.")
	}
	return t(l, "Boleh tahu nama Anda untuk bookingnya?", "May I have your name for the booking?")
}

// OutletLabel is "Mizu 1.0 (buka 10.00–22.00, last order 20.30)".
func OutletLabel(l L, o OutletOpt) string {
	label := o.Name + " (" + t(l, "buka ", "open ") + hhmm(o.OpenTime) + "–" + hhmm(o.CloseTime)
	if o.LastOrder != "" {
		label += ", last order " + hhmm(o.LastOrder)
	}
	return label + ")"
}

// AskOutlet lists the outlets with what sets each apart.
func AskOutlet(l L, options []MenuOption, outlets []OutletOpt) string {
	msg := t(l, "Mau datang ke outlet mana?\n", "Which outlet would you like to visit?\n") + NumberedMenu(options)
	described := 0
	for _, o := range outlets {
		if d := strings.TrimSpace(o.Description); d != "" {
			if described == 0 {
				msg += "\n"
			}
			msg += "\n• *" + o.Name + "*: " + d
			described++
		}
	}
	msg += t(l, "\n\nBalas dengan *nomor* atau nama outletnya.", "\n\nReply with the *number* or the outlet name.")
	if len(outlets) > 1 {
		msg += t(l, " Bingung pilih? Ketik *bedanya apa* untuk perbandingan outlet.", " Not sure? Type *what's the difference* to compare the outlets.")
	}
	return msg
}

func AskPeople(l L) string {
	return t(l, "Untuk berapa orang? Balas angkanya (rombongan bisa sampai "+strconv.Itoa(MaxPeople)+" orang per booking).",
		"For how many people? Reply with a number (groups up to "+strconv.Itoa(MaxPeople)+" people per booking).")
}

// GuestLabel is "Tamu 2" / "Guest 2".
func GuestLabel(l L, i int) string { return t(l, "Tamu ", "Guest ") + strconv.Itoa(i) }

// SameAsLabel is the treatment-menu choice that copies the previous guest's.
func SameAsLabel(l L, guest int, treatment string) string {
	return t(l, "Sama dengan ", "Same as ") + GuestLabel(l, guest) + " (" + treatment + ")"
}

// AskTreatment asks one guest at a time: guest is the guest being asked
// (1-based) and chosen the labels already picked for the guests before.
func AskTreatment(l L, outlet string, people, guest int, chosen []string, options []MenuOption) string {
	if people <= 1 {
		return t(l, "Pilih treatment di *"+outlet+"*:\n", "Choose a treatment at *"+outlet+"*:\n") + NumberedMenu(options) +
			t(l, "\n\nBalas dengan *nomor* treatmentnya.", "\n\nReply with the treatment *number*.")
	}
	var b strings.Builder
	for i, c := range chosen {
		b.WriteString("✅ " + GuestLabel(l, i+1) + ": " + c + "\n")
	}
	if len(chosen) > 0 {
		b.WriteString("\n")
	}
	b.WriteString(t(l, "Treatment untuk *"+GuestLabel(l, guest)+"* (dari "+strconv.Itoa(people)+" orang) di *"+outlet+"*:\n",
		"Treatment for *"+GuestLabel(l, guest)+"* (of "+strconv.Itoa(people)+") at *"+outlet+"*:\n"))
	b.WriteString(NumberedMenu(options))
	if guest == 1 {
		b.WriteString(t(l, "\n\nBalas *nomor* treatmentnya. Tiap tamu boleh beda treatment — saya tanyakan satu per satu. Kalau semua tamu sama, tambahkan *semua*, mis. *2 semua*.",
			"\n\nReply with the treatment *number*. Each guest may choose differently — I'll ask one by one. If everyone takes the same, add *all*, e.g. *2 all*."))
	} else {
		b.WriteString(t(l, "\n\nBalas *nomor* treatmentnya, atau *0* kalau sama dengan "+GuestLabel(l, guest-1)+".",
			"\n\nReply with the treatment *number*, or *0* if it's the same as "+GuestLabel(l, guest-1)+"."))
	}
	return b.String()
}

func AskDate(l L, options []MenuOption) string {
	return t(l, "Mau datang kapan?\n", "When would you like to come?\n") + NumberedMenu(options) +
		t(l, "\n\nAtau tulis tanggalnya, mis. *Sabtu*, *15 Okt*, atau *besok sore*.", "\n\nOr type a date, e.g. *Saturday*, *Oct 15*, or *tomorrow afternoon*.")
}

// SlotLabel is "14.00 (siang) — terapis kosong: 2 wanita, 1 pria".
func SlotLabel(l L, clock, period string, female, male int) string {
	label := clock + " (" + period + ")"
	if female == 0 && male == 0 {
		return label
	}
	var parts []string
	if female > 0 {
		parts = append(parts, strconv.Itoa(female)+t(l, " wanita", " female"))
	}
	if male > 0 {
		parts = append(parts, strconv.Itoa(male)+t(l, " pria", " male"))
	}
	return label + t(l, " — terapis kosong: ", " — free therapists: ") + strings.Join(parts, ", ")
}

// LastOrderNote is the outlet's last-order line.
func LastOrderNote(l L, o OutletOpt) string {
	if o.LastOrder != "" {
		return t(l, "Last order di "+o.Name+": jam *"+hhmm(o.LastOrder)+"* WIB.", "Last order at "+o.Name+": *"+hhmm(o.LastOrder)+"* WIB.")
	}
	if o.CloseTime != "" {
		return t(l, "Last order: treatment harus selesai sebelum jam tutup *"+hhmm(o.CloseTime)+"* WIB.",
			"Last order: treatments must end before closing at *"+hhmm(o.CloseTime)+"* WIB.")
	}
	return ""
}

// AskTime lists the free starts with the free therapists per gender.
func AskTime(l L, date string, options []MenuOption, requested, lastOrder string) string {
	head := t(l, "Jam yang masih tersedia pada *"+LongDate(l, date)+"*", "Times still available on *"+LongDate(l, date)+"*")
	if requested != "" {
		head = t(l, "Jam *"+requested+"* sudah penuh. Yang terdekat masih tersedia pada *"+LongDate(l, date)+"*",
			"*"+requested+"* is fully booked. The nearest times still available on *"+LongDate(l, date)+"*")
	}
	msg := head + ":\n" + NumberedMenu(options)
	if lastOrder != "" {
		msg += "\n\n" + lastOrder
	}
	return msg + t(l, "\n\nBalas dengan *nomor* jamnya. Mau terapis wanita/pria saja? Tulis *wanita* / *pria*.",
		"\n\nReply with the *number* of the time. Prefer a female/male therapist? Type *female* / *male*.")
}

// NoSlots offers what is left when the day is full: nearby days, another
// outlet the same day, and the waitlist (menu values carry the choice).
// NoSlotsClosed is the "full" answer without alternatives or waitlist (banned member).
func NoSlotsClosed(l L, date string, people int) string {
	msg := t(l, "Maaf, pada *"+LongDate(l, date)+"* jadwal sudah penuh", "Sorry, *"+LongDate(l, date)+"* is fully booked")
	if people > 1 {
		msg += t(l, " untuk "+strconv.Itoa(people)+" orang sekaligus", " for "+strconv.Itoa(people)+" people at once")
	}
	return msg + t(l, " 🙏 Coba tulis tanggal lain ya.", " 🙏 Please try another date.")
}

func NoSlots(l L, date string, options []MenuOption, people int) string {
	msg := t(l, "Maaf, pada *"+LongDate(l, date)+"* jadwal sudah penuh", "Sorry, *"+LongDate(l, date)+"* is fully booked")
	if people > 1 {
		msg += t(l, " untuk "+strconv.Itoa(people)+" orang sekaligus", " for "+strconv.Itoa(people)+" people at once")
	}
	msg += " 🙏"
	if len(options) > 0 {
		msg += t(l, "\n\nYang bisa saya tawarkan:\n", "\n\nWhat I can offer:\n") + NumberedMenu(options) +
			t(l, "\n\nBalas *nomor* pilihannya, atau tulis tanggal lain.", "\n\nReply with the *number*, or type another date.")
	} else {
		msg += t(l, "\n\nCoba tulis tanggal lain ya, atau ketik *daftar tunggu* supaya saya kabari begitu ada jam kosong.",
			"\n\nPlease try another date, or type *waitlist* and I'll message you when a time frees up.")
	}
	return msg
}

// AskTimeStaggered: no slot fits every guest at once, but guests can start
// one after another.
func AskTimeStaggered(l L, date string, people int, options []MenuOption) string {
	return t(l, "Pada *"+LongDate(l, date)+"* tidak ada jam untuk "+strconv.Itoa(people)+" orang *sekaligus*, tapi bisa bergantian:\n",
		"On *"+LongDate(l, date)+"* there is no time for "+strconv.Itoa(people)+" people *at once*, but you can take turns:\n") +
		NumberedMenu(options) + t(l, "\n\nBalas *nomor* pilihannya, atau tulis tanggal lain. Ketik *daftar tunggu* kalau ingin dikabari saat ada jam untuk semua sekaligus.",
		"\n\nReply with the *number*, or type another date. Type *waitlist* to be told when a time for everyone at once frees up.")
}

func WaitlistJoined(l L, outlet, date string, people int, period string) string {
	when := LongDate(l, date)
	if period != "" {
		when += " (" + PeriodLabel(l, period) + ")"
	}
	msg := t(l, "Siap, Anda masuk daftar tunggu *"+outlet+"* untuk *"+when+"*", "Done, you're on the waitlist at *"+outlet+"* for *"+when+"*")
	if people > 1 {
		msg += ", " + PeopleLabel(l, people)
	}
	return msg + t(l, " ✅\n\nBegitu ada jam kosong saya kabari di chat ini. Sementara itu, tulis tanggal lain kalau mau coba hari lain, atau ketik *batal daftar tunggu* untuk membatalkan.",
		" ✅\n\nI'll message you here as soon as a time frees up. Meanwhile, type another date to try a different day, or *cancel waitlist* to leave it.")
}

// WaitlistAvailable is what the watcher sends when a slot frees up.
func WaitlistAvailable(l L, name, outlet, date string, clocks []string) string {
	greet := t(l, "Kabar baik", "Good news")
	if strings.TrimSpace(name) != "" {
		greet += ", " + strings.TrimSpace(name)
	}
	return greet + t(l, "! Di *"+outlet+"* pada *"+LongDate(l, date)+"* sekarang ada jam kosong: ", "! At *"+outlet+"* on *"+LongDate(l, date)+"* these times are now free: ") +
		strings.Join(clocks, ", ") + t(l, " WIB.\n\nBalas *ambil* untuk lanjut booking (pilihan treatment sudah saya simpan), atau *batal* kalau tidak jadi.",
		" WIB.\n\nReply *take it* to continue booking (your treatment choice is saved), or *cancel* if you no longer need it.")
}

func WaitlistCancelled(l L) string {
	return t(l, "Baik, daftar tunggunya saya batalkan. Ketik *booking* kapan saja kalau mau mencoba lagi 🙏",
		"Alright, I've removed you from the waitlist. Type *book* any time to try again 🙏")
}

func WaitlistNeedsDate(l L) string {
	return t(l, "Untuk daftar tunggu, sebutkan dulu tanggalnya ya (mis. *Sabtu* atau *15 Okt*).",
		"For the waitlist, please tell me the date first (e.g. *Saturday* or *Oct 15*).")
}

func AskTherapist(l L, options []MenuOption, pref string) string {
	head := t(l, "Terapis yang kosong di jam itu", "Therapists free at that time") + GenderSuffix(l, pref)
	return head + ":\n" + NumberedMenu(options) + t(l, "\n\nBalas *nomor* terapis, atau *0* kalau mau dipilihkan oleh Mizu. Bisa juga tulis *wanita* / *pria*.",
		"\n\nReply with the therapist's *number*, or *0* to let Mizu choose. You can also type *female* / *male*.")
}

// NoRoomLabel is the "no particular room" choice.
func NoRoomLabel(l L) string { return t(l, "Tanpa room khusus", "No particular room") }

// RoomLabel is "VIP 1 · 2 orang · Rp 100.000" (or "gratis").
func RoomLabel(l L, name string, capacity int, price float64) string {
	label := name + " · " + strconv.Itoa(capacity) + t(l, " orang", " people")
	if price > 0 {
		return label + " · " + Rupiah(price)
	}
	return label + t(l, " · gratis", " · free")
}

// AskRoom offers the rooms free for the chosen time.
func AskRoom(l L, options []MenuOption, people int) string {
	head := t(l, "Mau pakai room tertentu? Room yang masih kosong di jam itu", "Would you like a particular room? Rooms free at that time")
	if people > 1 {
		head += t(l, " (muat "+strconv.Itoa(people)+" orang)", " (for "+strconv.Itoa(people)+" people)")
	}
	return head + ":\n" + NumberedMenu(options) + t(l, "\n\nBalas *nomor* room, atau *0* kalau tidak perlu room khusus. Harga room ditambahkan ke total.",
		"\n\nReply with the room's *number*, or *0* if you don't need a particular room. The room price is added to the total.")
}

// Summary lists everything before the guest confirms. depositEach is the
// booking fee (DP) per booking that online bookings must pay; 0 = no DP.
func Summary(l L, s *Session, depositEach float64) string {
	var b strings.Builder
	b.WriteString(t(l, "Berikut ringkasan bookingnya:\n", "Here's your booking summary:\n"))
	b.WriteString("• Outlet: *" + s.OutletName + "*\n")
	if s.Staggered() {
		b.WriteString(t(l, "• Jadwal: *"+LongDate(l, s.Date)+"*, bergantian\n", "• Schedule: *"+LongDate(l, s.Date)+"*, in turns\n"))
	} else {
		b.WriteString(t(l, "• Jadwal: *"+LongDate(l, s.Date)+"*, jam *"+clockOfISO(s.SlotISO)+"* WIB\n", "• Schedule: *"+LongDate(l, s.Date)+"* at *"+clockOfISO(s.SlotISO)+"* WIB\n"))
	}
	if s.People > 1 {
		b.WriteString("• " + PeopleLabel(l, s.People) + ":\n")
		for i, p := range s.Persons {
			line := "   " + strconv.Itoa(i+1) + ". " + p.Label + " — " + Rupiah(p.Price)
			if s.Staggered() {
				line += t(l, " (jam "+clockOfISO(s.SlotOf(i))+")", " (at "+clockOfISO(s.SlotOf(i))+")")
			}
			b.WriteString(line + "\n")
		}
	} else if len(s.Persons) > 0 {
		b.WriteString("• Treatment: *" + s.Persons[0].Label + "* — " + Rupiah(s.Persons[0].Price) + "\n")
	}
	switch {
	case s.TherapistName != "":
		b.WriteString(t(l, "• Terapis: *", "• Therapist: *") + s.TherapistName + "*\n")
	case s.Pref == "female":
		b.WriteString(t(l, "• Terapis: wanita (dipilihkan Mizu)\n", "• Therapist: female (chosen by Mizu)\n"))
	case s.Pref == "male":
		b.WriteString(t(l, "• Terapis: pria (dipilihkan Mizu)\n", "• Therapist: male (chosen by Mizu)\n"))
	default:
		b.WriteString(t(l, "• Terapis: dipilihkan oleh Mizu\n", "• Therapist: chosen by Mizu\n"))
	}
	if s.RoomID != "" {
		price := t(l, "gratis", "free")
		if s.RoomPrice > 0 {
			price = Rupiah(s.RoomPrice)
		}
		b.WriteString("• Room: *" + s.RoomName + "* — " + price + "\n")
	}
	b.WriteString(t(l, "• Atas nama: *", "• Name: *") + s.Name + "*\n")
	b.WriteString("• Total: *" + Rupiah(s.TotalPrice()) + "*\n")
	if depositEach > 0 {
		n := len(s.Persons)
		if n < 1 {
			n = 1
		}
		dp := depositEach * float64(n)
		if dp > s.TotalPrice() {
			dp = s.TotalPrice()
		}
		remaining := s.TotalPrice() - dp
		per := ""
		if n > 1 {
			per = t(l, " ("+Rupiah(depositEach)+" × "+strconv.Itoa(n)+" booking)", " ("+Rupiah(depositEach)+" × "+strconv.Itoa(n)+" bookings)")
		}
		b.WriteString(t(l, "• Booking fee (DP): *"+Rupiah(dp)+"*"+per+" — dibayar online lewat link setelah konfirmasi, untuk mengunci jadwal\n",
			"• Booking fee (deposit): *"+Rupiah(dp)+"*"+per+" — paid online via a link after you confirm, to secure the slot\n"))
		b.WriteString(t(l, "• Sisa: *"+Rupiah(remaining)+"* dibayar di outlet setelah treatment\n", "• Balance: *"+Rupiah(remaining)+"* paid at the outlet after the treatment\n"))
	}
	b.WriteString("\n")
	b.WriteString(t(l, "Sudah benar? Balas *ya* untuk membuat booking, atau *ubah* untuk mengulang.", "Is this correct? Reply *yes* to book, or *change* to start over."))
	return b.String()
}

func AskPayment(l L, total float64, online bool) string {
	if !online {
		return t(l, "Booking tercatat ✅ Pembayaran *"+Rupiah(total)+"* dilakukan di outlet setelah treatment.\n\nBalas *1* untuk konfirmasi.",
			"Booking noted ✅ Payment of *"+Rupiah(total)+"* is made at the outlet after the treatment.\n\nReply *1* to confirm.")
	}
	return t(l, "Mau bayar bagaimana? Total *"+Rupiah(total)+"*\n1. Bayar di outlet (setelah treatment)\n2. Bayar online sekarang (VA, QRIS, e-wallet, kartu)\n\nBalas *nomor* pilihannya.",
		"How would you like to pay? Total *"+Rupiah(total)+"*\n1. At the outlet (after the treatment)\n2. Online now (bank transfer, QRIS, e-wallet, card)\n\nReply with the *number*.")
}

func Confirmed(l L, s *Session, botName string) string {
	var b strings.Builder
	if len(s.Bookings) == 1 {
		b.WriteString(t(l, "Booking berhasil ✅\n\nKode booking: *", "Booking confirmed ✅\n\nBooking code: *") + s.Bookings[0].Code + "*\n")
	} else {
		b.WriteString(t(l, "Booking berhasil ✅ Kode booking:\n", "Booking confirmed ✅ Booking codes:\n"))
		for _, bk := range s.Bookings {
			line := "• *" + bk.Code + "* — " + bk.Customer
			if s.Staggered() && bk.When != "" {
				line += t(l, ", jam ", ", at ") + bk.When
			}
			b.WriteString(line + "\n")
		}
	}
	if s.Staggered() {
		b.WriteString("Outlet: " + s.OutletName + t(l, "\nJadwal: "+LongDate(l, s.Date)+" (bergantian, lihat jam tiap tamu)\n", "\nSchedule: "+LongDate(l, s.Date)+" (in turns, see each guest's time)\n"))
	} else {
		b.WriteString("Outlet: " + s.OutletName + t(l, "\nJadwal: ", "\nSchedule: ") + LongDate(l, s.Date) + ", " + clockOfISO(s.SlotISO) + " WIB\n")
	}
	if s.PayMethod == "deposit" {
		until := ""
		for _, bk := range s.Bookings {
			if bk.DepositUntil != "" {
				until = bk.DepositUntil
				break
			}
		}
		b.WriteString(t(l, "\n⚠️ Jadwal dikunci setelah DP *"+Rupiah(s.DepositTotal())+"* dibayar", "\n⚠️ Your slot is secured once the deposit of *"+Rupiah(s.DepositTotal())+"* is paid"))
		if until != "" {
			b.WriteString(t(l, " (sebelum jam *"+until+"* WIB)", " (by *"+until+"* WIB)"))
		}
		b.WriteString(t(l, ". Link DP:\n", "). Deposit link:\n"))
		for _, bk := range s.Bookings {
			if bk.DepositURL != "" {
				b.WriteString(bk.DepositURL + "\n")
			}
		}
		remaining := s.TotalPrice() - s.DepositTotal()
		if remaining < 0 {
			remaining = 0
		}
		b.WriteString(t(l, "Sisa *"+Rupiah(remaining)+"* dibayar di outlet setelah treatment. Setelah DP terbayar, balas *sudah bayar* dan saya cek ya.",
			"The remaining *"+Rupiah(remaining)+"* is paid at the outlet after the treatment. Once the deposit is paid, reply *paid* and I'll check."))
	} else if s.PayMethod == "online" {
		b.WriteString(t(l, "\nSilakan bayar lewat link berikut (berlaku 2 jam):\n", "\nPlease pay through this link (valid for 2 hours):\n"))
		for _, bk := range s.Bookings {
			if bk.PayURL != "" {
				b.WriteString(bk.PayURL + "\n")
			}
		}
		b.WriteString(t(l, "\nSetelah lunas, balas *sudah bayar* dan saya cek ya.", "\nOnce paid, reply *paid* and I'll check."))
	} else {
		b.WriteString(t(l, "\nPembayaran di outlet setelah treatment.", "\nPayment at the outlet after the treatment."))
	}
	b.WriteString(t(l, "\n\nStatus & QR booking:\n", "\n\nBooking status & QR:\n"))
	for _, bk := range s.Bookings {
		b.WriteString(bk.StatusURL + "\n")
	}
	b.WriteString(t(l, "\nTunjukkan kode/QR ke resepsionis saat tiba. Jadwal bisa diubah sendiri sampai 1 jam sebelum kunjungan lewat link di atas.\nTerima kasih, sampai jumpa di Mizu 🌿",
		"\nShow the code/QR at the reception when you arrive. You can reschedule yourself up to 1 hour before the visit through the link above.\nThank you, see you at Mizu 🌿"))
	return b.String()
}

// DepositSeen answers "sudah bayar" for a DP booking.
func DepositSeen(l L, paid bool, code string, remaining float64) string {
	if paid {
		return t(l, "DP untuk booking *"+code+"* sudah kami terima ✅ Jadwal terkunci. Sisa *"+Rupiah(remaining)+"* dibayar di outlet. Sampai jumpa di Mizu!",
			"Deposit for booking *"+code+"* received ✅ Your slot is secured. The remaining *"+Rupiah(remaining)+"* is paid at the outlet. See you at Mizu!")
	}
	return t(l, "DP *"+code+"* belum terlihat di sistem. Kalau baru saja bayar, tunggu 1–2 menit lalu balas *sudah bayar* lagi. Link DP ada di pesan konfirmasi.",
		"The deposit for *"+code+"* hasn't shown up yet. If you just paid, wait 1–2 minutes and reply *paid* again. The deposit link is in the confirmation message.")
}

// DepositPaidNotice / DepositExpiredNotice are sent by the outbox subscriber.
func DepositPaidNotice(l L, name, code, outlet, date, clock string, deposit, remaining float64, statusURL string) string {
	greet := t(l, "DP diterima ✅", "Deposit received ✅")
	if strings.TrimSpace(name) != "" {
		greet += t(l, " Terima kasih, ", " Thank you, ") + strings.TrimSpace(name) + "!"
	}
	return greet + t(l, "\n\nBooking *"+code+"* di "+outlet+" pada "+LongDate(l, date)+", "+clock+" WIB sudah terkunci.\nDP: "+Rupiah(deposit)+" · Sisa di outlet: *"+Rupiah(remaining)+"*\n\nStatus & QR booking:\n"+statusURL+"\n\nSampai jumpa di Mizu 🌿",
		"\n\nBooking *"+code+"* at "+outlet+" on "+LongDate(l, date)+", "+clock+" WIB is secured.\nDeposit: "+Rupiah(deposit)+" · Remaining at the outlet: *"+Rupiah(remaining)+"*\n\nBooking status & QR:\n"+statusURL+"\n\nSee you at Mizu 🌿")
}

// DepositReminderNotice nudges the guest shortly before the DP hold ends.
func DepositReminderNotice(l L, name, code, outlet, date, clock string, deposit float64, until, url string) string {
	greet := t(l, "Pengingat DP ⏳", "Deposit reminder ⏳")
	if strings.TrimSpace(name) != "" {
		greet += " " + strings.TrimSpace(name) + ","
	}
	b := strings.Builder{}
	b.WriteString(greet + t(l, " booking *"+code+"* di "+outlet+" ("+LongDate(l, date)+", "+clock+" WIB) masih menunggu DP *"+Rupiah(deposit)+"*",
		" booking *"+code+"* at "+outlet+" ("+LongDate(l, date)+", "+clock+" WIB) is still waiting for the deposit of *"+Rupiah(deposit)+"*"))
	if until != "" {
		b.WriteString(t(l, ". Jadwal ditahan sampai jam *"+until+"* WIB", ". The slot is held until *"+until+"* WIB"))
	}
	b.WriteString(t(l, "; lewat itu booking dibatalkan otomatis dan jamnya dilepas.", "; after that the booking is cancelled automatically and the slot released."))
	if url != "" {
		b.WriteString(t(l, "\n\nLink DP:\n", "\n\nDeposit link:\n") + url)
	}
	b.WriteString(t(l, "\n\nSetelah bayar, balas *sudah bayar* ya 🙏", "\n\nOnce paid, reply *paid* 🙏"))
	return b.String()
}

// QRCaption goes with the booking QR picture sent after payment.
func QRCaption(l L, code, outlet, date, clock string) string {
	return t(l, "QR booking *"+code+"* — "+outlet+", "+LongDate(l, date)+" "+clock+" WIB. Tunjukkan QR ini ke resepsionis saat tiba 🌿",
		"Booking QR *"+code+"* — "+outlet+", "+LongDate(l, date)+" "+clock+" WIB. Show this QR at the reception when you arrive 🌿")
}

func DepositExpiredNotice(l L, name, code, outlet, date, clock string) string {
	greet := t(l, "Mohon maaf", "Sorry")
	if strings.TrimSpace(name) != "" {
		greet += ", " + strings.TrimSpace(name)
	}
	return greet + t(l, " — booking *"+code+"* di "+outlet+" ("+LongDate(l, date)+", "+clock+" WIB) dibatalkan karena DP belum dibayar dalam batas waktu. Jadwalnya dilepas untuk tamu lain.\n\nKetik *booking* untuk membuat booking baru 🙏",
		" — booking *"+code+"* at "+outlet+" ("+LongDate(l, date)+", "+clock+" WIB) was cancelled because the deposit wasn't paid in time. The slot has been released.\n\nType *book* to make a new booking 🙏")
}

func PaymentSeen(l L, paid bool, code string) string {
	if paid {
		return t(l, "Pembayaran untuk booking *"+code+"* sudah kami terima ✅ Sampai jumpa di Mizu!", "Payment for booking *"+code+"* received ✅ See you at Mizu!")
	}
	return t(l, "Pembayaran *"+code+"* belum terlihat di sistem. Kalau baru saja bayar, tunggu 1–2 menit lalu balas *sudah bayar* lagi, atau bayar di outlet saat datang.",
		"Payment for *"+code+"* hasn't shown up yet. If you just paid, wait 1–2 minutes and reply *paid* again, or pay at the outlet when you arrive.")
}

func Done(l L, botName string, h AdminHours) string {
	return t(l, "Booking Anda sudah selesai. Ketik *booking* untuk booking baru, *status* untuk melihat booking terakhir, *gift voucher* untuk membeli voucher hadiah, atau *admin* untuk bicara dengan tim Mizu (admin live jam "+h.Label()+" WIB).",
		"Your booking is complete. Type *book* for a new booking, *status* to see your latest booking, *gift voucher* to buy a gift voucher, or *admin* to talk to the Mizu team (live admins "+h.Label()+" WIB).")
}

func NotUnderstood(l L, prompt string, misses int, h AdminHours) string {
	if misses >= 2 {
		return t(l, "Maaf, saya masih belum paham 🙏 ", "Sorry, I still didn't get that 🙏 ") + prompt +
			t(l, "\n\nKetik *admin* kalau mau dibantu tim Mizu langsung (admin live jam "+h.Label()+" WIB).",
				"\n\nType *admin* to get help from the Mizu team directly (live admins "+h.Label()+" WIB).")
	}
	return t(l, "Maaf, saya belum paham. ", "Sorry, I didn't get that. ") + prompt
}

// Handover passes the chat to the team; outside admin hours the guest is
// told an admin replies at the next working hours.
func Handover(l L, botName string, h AdminHours, at time.Time) string {
	if !h.Open(at) {
		return t(l, "Baik, pesan Anda sudah saya teruskan ke admin Mizu 🙏 Saat ini di luar jam kerja admin (*"+h.Label()+" WIB*), jadi admin akan membalas di chat ini pada jam kerja berikutnya.",
			"Sure, I've passed your message to the Mizu admins 🙏 It's outside admin hours right now (*"+h.Label()+" WIB*), so an admin will reply in this chat during the next working hours.")
	}
	return t(l, "Baik, saya sambungkan ke admin Mizu ya. Mohon tunggu sebentar, admin akan membalas di chat ini 🙏 (admin live tersedia jam "+h.Label()+" WIB)",
		"Sure, I'm connecting you to a Mizu admin. Please hold on, an admin will reply in this chat 🙏 (live admins are available "+h.Label()+" WIB)")
}

func TooManyPeople(l L, h AdminHours) string {
	return t(l, "Untuk rombongan lebih dari "+strconv.Itoa(MaxPeople)+" orang, admin Mizu bantu atur langsung ya. Ketik *admin* untuk dihubungkan (admin live jam "+h.Label()+" WIB), atau balas angka 1–"+strconv.Itoa(MaxPeople)+".",
		"For groups of more than "+strconv.Itoa(MaxPeople)+" people a Mizu admin will arrange it for you. Type *admin* to be connected (live admins "+h.Label()+" WIB), or reply with a number 1–"+strconv.Itoa(MaxPeople)+".")
}

func StatusOf(l L, refs []BookingRef) string {
	if len(refs) == 0 {
		return t(l, "Belum ada booking di chat ini. Ketik *booking* untuk mulai.", "No booking in this chat yet. Type *book* to start.")
	}
	var b strings.Builder
	b.WriteString(t(l, "Booking terakhir Anda:\n", "Your latest booking:\n"))
	for _, r := range refs {
		b.WriteString("• *" + r.Code + "* — " + r.StatusURL + "\n")
	}
	return b.String()
}

func clockOfISO(iso string) string {
	tm, err := parseISO(iso)
	if err != nil {
		return iso
	}
	return Clock(tm)
}

/* ── customer notices (payment & reminders) ──────────────────────────── */

// PaidNotice confirms an online payment.
func PaidNotice(l L, name, code, outlet, date, clock string, items []string, total float64, statusURL string) string {
	var b strings.Builder
	b.WriteString(t(l, "Pembayaran diterima ✅", "Payment received ✅"))
	if strings.TrimSpace(name) != "" {
		b.WriteString(t(l, " Terima kasih, ", " Thank you, ") + strings.TrimSpace(name) + "!")
	}
	b.WriteString(t(l, "\n\nKode booking: *", "\n\nBooking code: *") + code + "*\nOutlet: " + outlet + t(l, "\nJadwal: ", "\nSchedule: ") + LongDate(l, date) + ", " + clock + " WIB\n")
	if len(items) > 0 {
		b.WriteString("Treatment: " + strings.Join(items, ", ") + "\n")
	}
	b.WriteString("Total: *" + Rupiah(total) + "*" + t(l, " (lunas)\n\nStatus & QR booking:\n", " (paid)\n\nBooking status & QR:\n") + statusURL +
		t(l, "\n\nTunjukkan kode/QR ke resepsionis saat tiba. Sampai jumpa di Mizu 🌿", "\n\nShow the code/QR at the reception when you arrive. See you at Mizu 🌿"))
	return b.String()
}

// ReminderNotice is sent the day before (kind "h1") and about two hours
// before (kind "2h") a visit.
func ReminderNotice(l L, kind, name, code, outlet, date, clock string, items []string, paid bool, statusURL string) string {
	var b strings.Builder
	switch kind {
	case "2h":
		b.WriteString(t(l, "Pengingat: sekitar 2 jam lagi, jam *"+clock+"* WIB di *"+outlet+"*", "Reminder: in about 2 hours, at *"+clock+"* WIB at *"+outlet+"*"))
	default:
		b.WriteString(t(l, "Pengingat: besok *"+LongDate(l, date)+"* jam *"+clock+"* WIB di *"+outlet+"*", "Reminder: tomorrow, *"+LongDate(l, date)+"* at *"+clock+"* WIB at *"+outlet+"*"))
	}
	if strings.TrimSpace(name) != "" {
		b.WriteString(" — " + strings.TrimSpace(name))
	}
	b.WriteString(".\n")
	if len(items) > 0 {
		b.WriteString("Treatment: " + strings.Join(items, ", ") + "\n")
	}
	b.WriteString(t(l, "Kode booking: *", "Booking code: *") + code + "*\n")
	if paid {
		b.WriteString(t(l, "Pembayaran: lunas ✅\n", "Payment: paid ✅\n"))
	} else {
		b.WriteString(t(l, "Pembayaran: di outlet setelah treatment\n", "Payment: at the outlet after the treatment\n"))
	}
	b.WriteString(t(l, "\nStatus, QR & ubah jadwal (sampai 1 jam sebelum):\n", "\nStatus, QR & reschedule (up to 1 hour before):\n") + statusURL + t(l, "\n\nSampai jumpa di Mizu 🌿", "\n\nSee you at Mizu 🌿"))
	return b.String()
}

/* ── FAQ answers (from system data only) ────────────────────────────── */

// AnswerAddress lists the outlets' addresses (one when chosen).
func AnswerAddress(l L, outlets []OutletOpt, chosen string) string {
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
			b.WriteString(t(l, ": alamat belum tercantum, tanya *admin* ya", ": address not listed yet, please ask *admin*"))
		}
		b.WriteString(t(l, " (buka ", " (open ") + hhmm(o.OpenTime) + "–" + hhmm(o.CloseTime) + ")")
		if o.Address != "" {
			b.WriteString("\nMaps: https://www.google.com/maps/search/?api=1&query=" + mapsQuery(o))
		}
		if o.Phone != "" {
			b.WriteString(t(l, "\nTelp: ", "\nPhone: ") + o.Phone)
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
func AnswerHours(l L, outlets []OutletOpt, chosen string) string {
	var lines []string
	for _, o := range outlets {
		if chosen != "" && o.ID != chosen {
			continue
		}
		line := "🕒 *" + o.Name + "*: " + t(l, "setiap hari ", "daily ") + hhmm(o.OpenTime) + "–" + hhmm(o.CloseTime) + " WIB"
		if o.LastOrder != "" {
			line += ", last order " + hhmm(o.LastOrder)
		} else {
			line += t(l, " (treatment terakhir selesai sebelum "+hhmm(o.CloseTime)+")", " (the last treatment ends before "+hhmm(o.CloseTime)+")")
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n") + t(l, "\nBooking lewat chat ini bisa untuk 60 hari ke depan.", "\nYou can book through this chat up to 60 days ahead.")
}

// AnswerPrices lists the catalog with prices (up to 15 rows).
func AnswerPrices(l L, outlet string, catalog []VariantOpt) string {
	if len(catalog) == 0 {
		return t(l, "Daftar harga belum tersedia untuk outlet itu, tanya *admin* ya.", "No price list for that outlet yet, please ask *admin*.")
	}
	var b strings.Builder
	b.WriteString(t(l, "Daftar harga *", "Price list *") + outlet + "*:\n")
	for i, v := range catalog {
		if i >= 15 {
			b.WriteString(t(l, "… dan lainnya\n", "… and more\n"))
			break
		}
		b.WriteString("• " + v.Label() + " — " + Rupiah(v.Price) + "\n")
	}
	return strings.TrimSpace(b.String())
}

func AnswerPayment(l L, online bool) string {
	if online {
		return t(l, "Pembayaran bisa *di outlet setelah treatment* (tunai/QRIS/kartu) atau *online sekarang* lewat link (VA, QRIS, e-wallet, kartu). Pilihannya ditawarkan setelah booking dibuat.",
			"You can pay *at the outlet after the treatment* (cash/QRIS/card) or *online now* through a link (bank transfer, QRIS, e-wallet, card). You'll be asked after the booking is made.")
	}
	return t(l, "Pembayaran dilakukan *di outlet setelah treatment* (tunai/QRIS/kartu). Tidak perlu DP.",
		"Payment is made *at the outlet after the treatment* (cash/QRIS/card). No deposit needed.")
}

func AnswerReschedule(l L) string {
	return t(l, "Jadwal bisa diubah atau dibatalkan sendiri lewat link status booking (ada di pesan konfirmasi) sampai *1 jam sebelum* kunjungan. Kalau sudah lewat batas itu, ketik *admin* dan tim Mizu bantu.",
		"You can reschedule or cancel yourself through the booking status link (in the confirmation message) up to *1 hour before* the visit. Past that, type *admin* and the Mizu team will help.")
}

func AnswerUnknown(l L, h AdminHours) string {
	return t(l, "Untuk pertanyaan itu saya belum punya jawabannya 🙏 Ketik *admin* supaya tim Mizu membalas di chat ini (admin live jam "+h.Label()+" WIB), atau lanjutkan booking.",
		"I don't have an answer for that yet 🙏 Type *admin* so the Mizu team can reply in this chat (live admins "+h.Label()+" WIB), or continue booking.")
}

// AnswerCompare explains how the outlets differ: each outlet's own
// description, address and hours, then the price differences and the
// treatments only one outlet offers (catalogs by outlet id).
func AnswerCompare(l L, outlets []OutletOpt, catalogs map[string][]VariantOpt) string {
	var b strings.Builder
	if len(outlets) < 2 {
		b.WriteString(t(l, "Saat ini booking online tersedia di:\n", "Online booking is currently available at:\n"))
	} else {
		b.WriteString(t(l, "Perbedaan outlet Mizu:\n", "How the Mizu outlets differ:\n"))
	}
	for _, o := range outlets {
		b.WriteString("\n*" + o.Name + "*\n")
		if d := strings.TrimSpace(o.Description); d != "" {
			b.WriteString(d + "\n")
		}
		if o.Address != "" {
			b.WriteString("📍 " + o.Address)
			if o.City != "" {
				b.WriteString(", " + o.City)
			}
			b.WriteString("\n")
		}
		b.WriteString("🕒 " + hhmm(o.OpenTime) + "–" + hhmm(o.CloseTime) + " WIB")
		if o.LastOrder != "" {
			b.WriteString(", last order " + hhmm(o.LastOrder))
		}
		b.WriteString("\n")
	}
	if len(outlets) >= 2 {
		// Price per label per outlet, in catalog order.
		var order []string
		price := map[string]map[string]float64{}
		for _, o := range outlets {
			for _, v := range catalogs[o.ID] {
				label := v.Label()
				if price[label] == nil {
					price[label] = map[string]float64{}
					order = append(order, label)
				}
				price[label][o.ID] = v.Price
			}
		}
		var diffs, only []string
		for _, label := range order {
			if len(price[label]) < len(outlets) {
				var at []string
				for _, o := range outlets {
					if _, ok := price[label][o.ID]; ok {
						at = append(at, o.Name)
					}
				}
				only = append(only, "• "+label+t(l, " — hanya di ", " — only at ")+strings.Join(at, ", "))
				continue
			}
			same := true
			var parts []string
			for _, o := range outlets {
				p := price[label][o.ID]
				parts = append(parts, o.Name+" "+Rupiah(p))
				same = same && p == price[label][outlets[0].ID]
			}
			if !same {
				diffs = append(diffs, "• "+label+": "+strings.Join(parts, " · "))
			}
		}
		if len(diffs) > 8 {
			diffs = append(diffs[:8], t(l, "• … dan lainnya", "• … and more"))
		}
		if len(only) > 6 {
			only = append(only[:6], t(l, "• … dan lainnya", "• … and more"))
		}
		if len(diffs) > 0 {
			b.WriteString(t(l, "\nHarga yang berbeda:\n", "\nPrices that differ:\n") + strings.Join(diffs, "\n") + "\n")
		} else {
			b.WriteString(t(l, "\nHarga treatment yang ada di semua outlet sama.\n", "\nTreatments offered at every outlet cost the same.\n"))
		}
		if len(only) > 0 {
			b.WriteString(t(l, "\nTreatment khusus:\n", "\nOutlet-only treatments:\n") + strings.Join(only, "\n") + "\n")
		}
	}
	return strings.TrimSpace(b.String())
}

// ContinuePrompt prefixes the pending booking question after an answer.
func ContinuePrompt(l L, prompt string) string {
	return t(l, "Lanjut booking — ", "Back to your booking — ") + prompt
}

func hhmm(clock string) string {
	if len(clock) >= 5 {
		return strings.Replace(clock[:5], ":", ".", 1)
	}
	return clock
}

func BackOK(l L) string { return t(l, "Oke, kembali satu langkah.", "Okay, one step back.") }
func BackNone(l L) string {
	return t(l, "Tidak ada langkah untuk dikembalikan. Ketik *ulang* untuk mulai dari awal, atau *status* untuk booking terakhir.",
		"There's nothing to go back to. Type *restart* to start over, or *status* for your latest booking.")
}
