package domain

import (
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// WIB is the outlets' time zone (no DST).
var WIB = time.FixedZone("WIB", 7*3600)

// Intent is what a short reply plainly means, before any AI reading.
type Intent string

const (
	IntentNone     Intent = ""
	IntentAdmin    Intent = "admin"   // wants a human
	IntentRestart  Intent = "restart" // new booking / cancel the draft
	IntentYes      Intent = "yes"
	IntentNo       Intent = "no"
	IntentStatus   Intent = "status" // asks about an existing booking
	IntentGreeting Intent = "greeting"
	IntentHelp     Intent = "help"
	IntentBack     Intent = "back"     // one step back
	IntentOutlet   Intent = "outlet"   // wants another outlet
	IntentWaitlist Intent = "waitlist" // wants to be told when a slot frees up
)

// Normalize lower-cases and squeezes whitespace.
func Normalize(text string) string {
	// "/status" and "!menu": people type bot commands with a prefix.
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimLeft(strings.TrimSpace(text), "/!."))), " ")
}

var (
	yesWords      = []string{"ya", "iya", "yes", "ok", "oke", "okay", "betul", "benar", "setuju", "sip", "siap", "boleh", "lanjut", "gas", "y", "yup", "yoi", "bener", "ambil", "mau", "jadi", "yeah", "yep", "sure", "correct", "confirm", "take it", "go ahead", "right"}
	noWords       = []string{"tidak", "ga", "gak", "nggak", "enggak", "engga", "no", "jangan", "batal", "bukan", "n", "tdk", "nope", "nah", "wrong", "change"}
	restartWords  = []string{"batal", "batalkan", "ulang", "mulai ulang", "mulai lagi", "booking baru", "reset", "dari awal", "ganti semua", "start over", "restart", "new booking", "cancel", "start again"}
	statusWords   = []string{"status", "cek booking", "booking saya", "kode booking", "qr", "my booking", "booking code", "check booking"}
	greetingWords = []string{"halo", "hallo", "hai", "hi", "hello", "selamat pagi", "selamat siang", "selamat sore", "selamat malam", "assalamualaikum", "permisi", "min", "kak", "mau booking", "booking", "mau pesan", "pesan tempat", "reservasi", "hey", "good morning", "good afternoon", "good evening", "i want to book", "book", "reservation", "i'd like to book"}
	helpWords     = []string{"menu", "bantuan", "help", "pilihan", "options"}
	backWords     = []string{"kembali", "balik", "back", "mundur", "sebelumnya", "go back", "previous", "undo", "salah pilih"}
	outletWords   = []string{"ganti outlet", "outlet lain", "pindah outlet", "cek outlet lain", "outlet satunya", "other outlet", "change outlet", "another outlet", "other branch", "switch outlet"}
	waitlistWords = []string{"daftar tunggu", "waiting list", "waitlist", "masuk daftar tunggu", "kabari", "kabarin", "tunggu saja", "daftar tunggu saja", "notify me", "let me know", "put me on the list"}
)

// newBookingWords start another booking once one is finished.
var newBookingWords = []string{"booking", "book", "mau booking", "booking lagi", "pesan lagi", "reservasi", "reservation", "pesan tempat", "mau pesan", "i want to book", "i'd like to book", "another booking"}

// WantsNewBooking: a short reply asking for (another) booking.
func WantsNewBooking(text string) bool {
	// "Booking!", "booking ya." — punctuation does not change the ask.
	n := Normalize(strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '\'' {
			return r
		}
		return ' '
	}, text))
	if n == "" || len(strings.Fields(n)) > 8 {
		return false
	}
	padded := " " + n + " "
	if strings.Contains(text, "?") {
		return false // "booking saya jam berapa?" asks about the one made
	}
	for _, w := range []string{"batal", "cancel", "ubah", "ganti", "reschedule", "status", "refund", "pindah", "booking saya", "booking aku", "bookingku", "bookingan", "my booking", "tadi", "gimana", "bagaimana", "kapan", "berapa"} {
		if strings.Contains(padded, " "+w) {
			return false
		}
	}
	for _, w := range newBookingWords {
		if strings.Contains(padded, " "+w+" ") {
			return true
		}
	}
	return false
}

// DetectIntent reads a whole short reply; handoverKeywords come from settings.
func DetectIntent(text string, handoverKeywords []string) Intent {
	n := Normalize(strings.Trim(text, " .!?,"))
	if n == "" {
		return IntentNone
	}
	for _, k := range handoverKeywords {
		k = Normalize(k)
		if k != "" && (n == k || strings.HasPrefix(n, k+" ") || strings.Contains(n, "sama "+k) || strings.Contains(n, "dengan "+k) || strings.Contains(n, "ke "+k)) {
			return IntentAdmin
		}
	}
	for _, w := range backWords {
		if n == w || strings.HasPrefix(n, w+" ") {
			return IntentBack
		}
	}
	for _, w := range restartWords {
		if n == w || strings.HasPrefix(n, w+" ") {
			return IntentRestart
		}
	}
	for _, w := range statusWords {
		if n == w || strings.HasPrefix(n, w+" ") {
			return IntentStatus
		}
	}
	for _, w := range outletWords {
		if n == w || strings.HasPrefix(n, w+" ") || strings.HasSuffix(n, " "+w) {
			return IntentOutlet
		}
	}
	for _, w := range waitlistWords {
		if n == w || strings.HasPrefix(n, w+" ") || strings.HasSuffix(n, " "+w) {
			return IntentWaitlist
		}
	}
	for _, w := range helpWords {
		if n == w {
			return IntentHelp
		}
	}
	if isWord(n, yesWords) {
		return IntentYes
	}
	if isWord(n, noWords) {
		return IntentNo
	}
	// Short messages carry a command anywhere: "halo coba ulang ya",
	// "bisa kembali?", "status booking saya dong".
	if len(strings.Fields(n)) <= 6 {
		for _, w := range backWords {
			if containsPhrase(n, w) {
				return IntentBack
			}
		}
		for _, w := range restartWords {
			if containsPhrase(n, w) {
				return IntentRestart
			}
		}
		for _, w := range statusWords {
			if containsPhrase(n, w) {
				return IntentStatus
			}
		}
		for _, k := range handoverKeywords {
			if k = Normalize(k); k != "" && containsPhrase(n, k) {
				return IntentAdmin
			}
		}
	}
	for _, w := range greetingWords {
		if n == w || strings.HasPrefix(n, w+" ") || strings.HasPrefix(n, w+",") {
			return IntentGreeting
		}
	}
	return IntentNone
}

// containsPhrase: phrase as whole words inside n.
func containsPhrase(n, phrase string) bool {
	return strings.Contains(" "+n+" ", " "+phrase+" ")
}

func isWord(n string, words []string) bool {
	for _, w := range words {
		if n == w || n == w+" dong" || n == w+" kak" || n == w+" min" {
			return true
		}
	}
	return false
}

var numberList = regexp.MustCompile(`^\s*(\d{1,2})(\s*[,/ ]\s*\d{1,2})*\s*$`)

// menuPrefix strips "pilih 8", "nomor 8", "no. 8", "yang 8", "opsi 8", "8 ya",
// "8 saja", "8 aja", "8 dong" down to the numbers.
var menuPrefix = regexp.MustCompile(`^(?:saya\s+|i\s+|i'll\s+|i'd\s+like\s+)?(?:pilih|pilihan|nomor|nomer|no\.?|yang|opsi|ambil|mau|yg|option|number|pick|choose|take|select|go with)\s+(?:nomor\s+|no\.?\s+|yang\s+|number\s+|option\s+)?`)
var menuSuffix = regexp.MustCompile(`\s+(?:ya|yaa|saja|aja|dong|deh|kak|min|pls|please|tolong|thanks|thank you)+\s*$`)

// MenuNumbers reads "2" or "1, 3" (several guests) as menu keys; nil when
// the reply is not just numbers.
func MenuNumbers(text string) []int {
	text = Normalize(text)
	text = menuSuffix.ReplaceAllString(menuPrefix.ReplaceAllString(text, ""), "")
	if !numberList.MatchString(text) {
		return nil
	}
	var out []int
	for _, f := range strings.FieldsFunc(text, func(r rune) bool { return r == ',' || r == '/' || unicode.IsSpace(r) }) {
		n, err := strconv.Atoi(f)
		if err != nil {
			return nil
		}
		out = append(out, n)
	}
	return out
}

var peopleWords = map[string]int{"sendiri": 1, "satu": 1, "seorang": 1, "berdua": 2, "dua": 2, "bertiga": 3, "tiga": 3, "berempat": 4, "empat": 4,
	"just me": 1, "myself": 1, "alone": 1, "one person": 1, "two of us": 2, "two people": 2, "for two": 2, "couple": 2, "me and my wife": 2, "me and my husband": 2, "me and my friend": 2, "my wife and i": 2, "my husband and i": 2, "three of us": 3, "three people": 3, "for three": 3, "four of us": 4, "four people": 4}

var peopleDigits = regexp.MustCompile(`\b(\d{1,2})\s*(orang|org|pax|people|persons|person|guests|pp)\b`)

// ParsePeople reads "2 orang", "berdua", "untuk 3 org"; 0 when absent.
func ParsePeople(text string) int {
	n := Normalize(text)
	if m := peopleDigits.FindStringSubmatch(n); m != nil {
		v, _ := strconv.Atoi(m[1])
		return v
	}
	for w, v := range peopleWords {
		if strings.Contains(" "+n+" ", " "+w+" ") {
			return v
		}
	}
	return 0
}

// ParseGender reads a therapist gender preference; "" when none.
func ParseGender(text string) string {
	n := " " + Normalize(text) + " "
	switch {
	case strings.Contains(n, " wanita") || strings.Contains(n, " perempuan") || strings.Contains(n, " cewek") || strings.Contains(n, " female") || strings.Contains(n, " lady ") || strings.Contains(n, " woman") || strings.Contains(n, " girl"):
		return "female"
	case strings.Contains(n, " pria") || strings.Contains(n, " laki") || strings.Contains(n, " cowok") || strings.Contains(n, " male") || strings.Contains(n, " man ") || strings.Contains(n, " guy"):
		return "male"
	case strings.Contains(n, " bebas") || strings.Contains(n, " siapa saja") || strings.Contains(n, " terserah") || strings.Contains(n, " pilihkan") || strings.Contains(n, " anyone") || strings.Contains(n, " whoever") || strings.Contains(n, " you choose") || strings.Contains(n, " no preference") || strings.Contains(n, " any therapist"):
		return "any"
	}
	return ""
}

var monthNames = map[string]int{
	"jan": 1, "januari": 1, "feb": 2, "februari": 2, "mar": 3, "maret": 3, "apr": 4, "april": 4, "mei": 5, "may": 5,
	"jun": 6, "juni": 6, "jul": 7, "juli": 7, "agu": 8, "agt": 8, "agustus": 8, "aug": 8, "sep": 9, "sept": 9, "september": 9,
	"okt": 10, "oktober": 10, "oct": 10, "nov": 11, "november": 11, "des": 12, "desember": 12, "dec": 12,
	"january": 1, "february": 2, "march": 3, "june": 6, "july": 7, "august": 8, "october": 10, "december": 12,
}

var weekdays = map[string]time.Weekday{
	"minggu": time.Sunday, "ahad": time.Sunday, "senin": time.Monday, "selasa": time.Tuesday, "rabu": time.Wednesday,
	"kamis": time.Thursday, "jumat": time.Friday, "jum'at": time.Friday, "sabtu": time.Saturday,
	"sunday": time.Sunday, "monday": time.Monday, "tuesday": time.Tuesday, "wednesday": time.Wednesday,
	"thursday": time.Thursday, "friday": time.Friday, "saturday": time.Saturday,
	"sun": time.Sunday, "mon": time.Monday, "tue": time.Tuesday, "tues": time.Tuesday, "wed": time.Wednesday, "thu": time.Thursday, "thurs": time.Thursday, "fri": time.Friday, "sat": time.Saturday,
}

var (
	dateNumeric = regexp.MustCompile(`\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b`)
	dateNamed   = regexp.MustCompile(`\b(\d{1,2})\s+([a-z']+)(?:\s+(\d{4}))?\b`)
	dateNamedEN = regexp.MustCompile(`\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b`)
)

// ParseDate reads "hari ini", "besok", "lusa", a weekday ("sabtu", "sabtu
// depan"), "15 okt", "15/10" relative to now (WIB). "" when absent.
func ParseDate(text string, now time.Time) string {
	n := Normalize(text)
	today := now.In(WIB)
	day := func(d time.Time) string { return d.Format("2006-01-02") }
	switch {
	case strings.Contains(n, "hari ini") || strings.Contains(n, "sekarang") || containsWord(n, "today") || containsWord(n, "tonight"):
		return day(today)
	case strings.Contains(n, "lusa") || strings.Contains(n, "day after tomorrow"):
		return day(today.AddDate(0, 0, 2))
	case strings.Contains(n, "besok") || containsWord(n, "tomorrow") || containsWord(n, "tmrw"):
		return day(today.AddDate(0, 0, 1))
	}
	// "Oct 15" / "October 15th" (English order).
	if m := dateNamedEN.FindStringSubmatch(n); m != nil {
		if mo, ok := monthNames[m[1]]; ok {
			d, _ := strconv.Atoi(m[2])
			if t, ok := validDate(today.Year(), mo, d); ok {
				if t.Before(today.AddDate(0, 0, -1)) {
					t = t.AddDate(1, 0, 0)
				}
				return day(t)
			}
		}
	}
	if m := dateNumeric.FindStringSubmatch(n); m != nil {
		d, _ := strconv.Atoi(m[1])
		mo, _ := strconv.Atoi(m[2])
		y := today.Year()
		if m[3] != "" {
			y, _ = strconv.Atoi(m[3])
			if y < 100 {
				y += 2000
			}
		}
		if t, ok := validDate(y, mo, d); ok {
			return day(t)
		}
	}
	if m := dateNamed.FindStringSubmatch(n); m != nil {
		if mo, ok := monthNames[m[2]]; ok {
			d, _ := strconv.Atoi(m[1])
			y := today.Year()
			if m[3] != "" {
				y, _ = strconv.Atoi(m[3])
			}
			if t, ok := validDate(y, mo, d); ok {
				if m[3] == "" && t.Before(today.AddDate(0, 0, -1)) {
					t = t.AddDate(1, 0, 0)
				}
				return day(t)
			}
		}
	}
	for word, wd := range weekdays {
		if strings.Contains(" "+n+" ", " "+word+" ") || strings.Contains(n, "hari "+word) {
			ahead := (int(wd) - int(today.Weekday()) + 7) % 7
			if ahead == 0 && !strings.Contains(n, "ini") {
				ahead = 7 // "sabtu" said on a Saturday means next week unless "sabtu ini"
			}
			if (strings.Contains(n, word+" depan") || strings.Contains(n, "next "+word)) && ahead < 7 {
				ahead += 7
			}
			return day(today.AddDate(0, 0, ahead))
		}
	}
	return ""
}

func validDate(y, mo, d int) (time.Time, bool) {
	if mo < 1 || mo > 12 || d < 1 || d > 31 {
		return time.Time{}, false
	}
	t := time.Date(y, time.Month(mo), d, 0, 0, 0, 0, WIB)
	return t, t.Day() == d
}

var clockRe = regexp.MustCompile(`\b(?:jam|pukul|pkl|at|around)?\s*(\d{1,2})(?:[.:](\d{2}))?\s*(pagi|siang|sore|malam|am|pm|a\.m\.|p\.m\.|o'clock)?\b`)

// ParseTime reads "jam 3 sore", "15.30", "10:00", "pukul 7 malam" as
// "HH:MM"; "" when absent. A bare number is a time only after "jam"/"pukul".
func ParseTime(text string) string {
	n := Normalize(text)
	for _, m := range clockRe.FindAllStringSubmatch(n, -1) {
		full := m[0]
		explicit := strings.HasPrefix(full, "jam") || strings.HasPrefix(full, "pukul") || strings.HasPrefix(full, "pkl") || strings.HasPrefix(full, "at ") || strings.HasPrefix(full, "around ") || m[2] != "" || m[3] != ""
		if !explicit {
			continue
		}
		h, _ := strconv.Atoi(m[1])
		mi := 0
		if m[2] != "" {
			mi, _ = strconv.Atoi(m[2])
		}
		switch strings.ReplaceAll(m[3], ".", "") {
		case "sore", "malam", "pm":
			if h < 12 {
				h += 12
			}
		case "siang":
			if h < 11 {
				h += 12
			}
		case "", "o'clock":
			// "jam 3" at a spa open by day means 15.00; "jam 9" stays morning.
			if h >= 1 && h <= 7 {
				h += 12
			}
		}
		if h > 23 || mi > 59 {
			continue
		}
		return pad2(h) + ":" + pad2(mi)
	}
	return ""
}

// ParsePeriod reads pagi/siang/sore/malam; "" when absent.
func ParsePeriod(text string) string {
	n := " " + Normalize(text) + " "
	for _, p := range []string{"pagi", "siang", "sore", "malam"} {
		if strings.Contains(n, " "+p+" ") || strings.Contains(n, " "+p+",") {
			return p
		}
	}
	for en, p := range map[string]string{"morning": "pagi", "noon": "siang", "midday": "siang", "afternoon": "sore", "evening": "malam", "night": "malam", "tonight": "malam"} {
		if containsWord(n, en) {
			return p
		}
	}
	return ""
}

// PeriodOf is the period a WIB clock minute falls in.
func PeriodOf(minute int) string {
	switch {
	case minute < 12*60:
		return "pagi"
	case minute < 15*60:
		return "siang"
	case minute < 18*60:
		return "sore"
	}
	return "malam"
}

func pad2(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

// Clock is "15.30" for an instant in WIB (Indonesian style).
func Clock(t time.Time) string { return t.In(WIB).Format("15.04") }

// ClockMinute is minutes since midnight WIB.
func ClockMinute(t time.Time) int {
	l := t.In(WIB)
	return l.Hour()*60 + l.Minute()
}

/* ── language ────────────────────────────────────────────────────────── */

// L is the conversation language: "id" (default) or "en".
type L string

const (
	LangID L = "id"
	LangEN L = "en"
)

var englishMarkers = []string{"hello", "hi", "hey", "good morning", "good afternoon", "good evening", "i want", "i'd like", "i would like", "book", "booking please", "please", "english", "can i", "could i", "do you", "what", "how much", "where", "when", "tomorrow", "today", "massage please", "thanks", "thank you", "reservation", "appointment"}
var indonesianMarkers = []string{"halo", "hai", "selamat", "mau", "saya", "bisa", "booking", "pesan", "besok", "hari ini", "jam", "orang", "berapa", "dimana", "di mana", "indonesia", "kak", "min", "dong", "ya", "nggak", "ga"}

// ExplicitLang reads a stated choice ("english", "bahasa indonesia").
func ExplicitLang(text string) L {
	n := " " + Normalize(strings.Trim(text, " .!?,")) + " "
	if strings.Contains(n, "english") || strings.Contains(n, "inggris") {
		return LangEN
	}
	if strings.Contains(n, "indonesia") || strings.Contains(n, "bahasa") {
		return LangID
	}
	return ""
}

// DetectLang reads the language of a message: "en" when it carries English
// markers and no Indonesian ones, "id" for the reverse, "" when unclear.
// "english"/"inggris" and "indonesia" are explicit choices.
func DetectLang(text string) L {
	if l := ExplicitLang(text); l != "" {
		return l
	}
	n := " " + Normalize(strings.Trim(text, " .!?,")) + " "
	en, id := 0, 0
	for _, m := range englishMarkers {
		if strings.Contains(n, " "+m+" ") {
			en++
		}
	}
	for _, m := range indonesianMarkers {
		if strings.Contains(n, " "+m+" ") {
			id++
		}
	}
	switch {
	case en > 0 && id == 0:
		return LangEN
	case id > 0 && en == 0:
		return LangID
	case en > id:
		return LangEN
	case id > en:
		return LangID
	}
	return ""
}

// MatchName finds the option whose label contains every word of the query
// (case-insensitive), preferring the shortest label; -1 when none or when
// the query is ambiguous between unrelated labels.
func MatchName(query string, labels []string) int {
	q := Normalize(query)
	if len(q) < 3 {
		return -1
	}
	words := strings.Fields(q)
	shared := sharedWords(labels)
	distinctive := false
	for _, w := range words {
		if !shared[w] && !genericWords[w] {
			distinctive = true
			break
		}
	}
	best, bestLen := -1, 1<<30
	for i, l := range labels {
		ll := Normalize(l)
		ok := distinctive // "mizu" alone must not pick the first outlet
		for _, w := range words {
			if !strings.Contains(ll, w) {
				ok = false
				break
			}
		}
		if ok && len(ll) < bestLen {
			best, bestLen = i, len(ll)
		}
	}
	if best >= 0 {
		return best
	}
	// Fallback: score each label by the query words it contains, ignoring
	// generic words ("massage", "pijat", "menit"); "thai massage 60 menit"
	// → "Thai Massage · 60 menit" (thai + 60) over "· 90 menit" (thai).
	bestScore := 0
	for i, l := range labels {
		ll := Normalize(l)
		score := 0
		for _, w := range words {
			if genericWords[w] || shared[w] || (len(w) < 4 && !hasDigit(w)) {
				continue
			}
			if containsWord(ll, w) {
				score++
			}
		}
		if score > bestScore || (score == bestScore && score > 0 && len(ll) < bestLen) {
			best, bestScore, bestLen = i, score, len(ll)
		}
	}
	return best
}

// genericWords carry no choice on their own.
var genericWords = map[string]bool{"massage": true, "pijat": true, "menit": true, "jam": true, "treatment": true, "paket": true, "mizu": true, "outlet": true, "spa": true, "yang": true, "mau": true, "saja": true, "aja": true}

// hasDigit: "1.0", "60", "90" are distinctive even when short.
func hasDigit(w string) bool {
	for _, r := range w {
		if r >= '0' && r <= '9' {
			return true
		}
	}
	return false
}

// sharedWords are words every label contains ("mizu", "massage").
func sharedWords(labels []string) map[string]bool {
	count := map[string]int{}
	for _, l := range labels {
		seen := map[string]bool{}
		for _, w := range strings.Fields(Normalize(l)) {
			if !seen[w] {
				seen[w] = true
				count[w]++
			}
		}
	}
	out := map[string]bool{}
	for w, n := range count {
		if len(labels) > 1 && n == len(labels) {
			out[w] = true
		}
	}
	return out
}

func containsWord(text, w string) bool {
	if strings.ContainsAny(w, ".-/") { // "1.0": whole-token match on whitespace
		for _, t := range strings.Fields(text) {
			if strings.Trim(t, ".,!?") == w {
				return true
			}
		}
		return false
	}
	for _, t := range strings.FieldsFunc(text, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if t == w {
			return true
		}
	}
	return false
}

/* ── cues: what the message actually talks about (guards for AI output) ── */

var dateCues = []string{"hari ini", "sekarang", "besok", "lusa", "senin", "selasa", "rabu", "kamis", "jumat", "jum'at", "sabtu", "minggu", "ahad", "tanggal", "tgl", "minggu depan", "pekan", "weekend", "akhir pekan",
	"today", "tomorrow", "tmrw", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "next week", "this week", "date"}
var peopleCues = []string{"orang", "org", "pax", "sendiri", "berdua", "bertiga", "berempat", "istri", "suami", "pasangan", "teman", "temen", "anak", "ibu", "ayah", "keluarga", "kami", "kita", "rombongan",
	"people", "persons", "person", "guests", "wife", "husband", "partner", "friend", "friends", "myself", "alone", "couple", "family", "kids", "mom", "dad", "us"}
var timeCues = []string{"jam", "pukul", "pagi", "siang", "sore", "malam", "pkl", "am", "pm", "morning", "afternoon", "evening", "night", "noon", "o'clock"}

// MentionsDate reports a date cue (a day name, relative day, "tanggal",
// a month name or a numeric date) in text.
func MentionsDate(text string) bool {
	n := Normalize(text)
	for _, c := range dateCues {
		if containsWord(n, c) || strings.Contains(n, c) {
			return true
		}
	}
	for m := range monthNames {
		if containsWord(n, m) {
			return true
		}
	}
	return dateCueNumeric.MatchString(n)
}

var dateCueNumeric = regexp.MustCompile(`\b\d{1,2}[/-]\d{1,2}\b`)

// MentionsPeople reports a party-size cue (a count word, "orang", a companion).
func MentionsPeople(text string) bool {
	n := Normalize(text)
	for _, c := range peopleCues {
		if containsWord(n, c) {
			return true
		}
	}
	return peopleDigits.MatchString(n)
}

// MentionsTime reports a clock/period cue ("sorean", "pagian" count).
func MentionsTime(text string) bool {
	for _, w := range strings.FieldsFunc(Normalize(text), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		for _, c := range timeCues {
			if strings.HasPrefix(w, c) {
				return true
			}
		}
	}
	return false
}

// FreeForm is a sentence worth asking the AI about even when the local
// parser read part of it: five or more words and not a bare menu answer.
func FreeForm(text string) bool {
	return len(strings.Fields(Normalize(text))) >= 5 && MenuNumbers(text) == nil
}

// parseISO reads the API's ISO instant ("2026-10-13T03:00:00.000Z").
func parseISO(iso string) (time.Time, error) { return time.Parse(time.RFC3339Nano, iso) }

// ParseISO is parseISO for other packages.
func ParseISO(iso string) (time.Time, error) { return parseISO(iso) }

// StripWords removes the words of name from text (case-insensitive), so a
// matched outlet name cannot also match a treatment.
func StripWords(text, name string) string {
	drop := map[string]bool{}
	for _, w := range strings.Fields(Normalize(name)) {
		drop[w] = true
	}
	var keep []string
	for _, w := range strings.Fields(Normalize(text)) {
		if !drop[strings.Trim(w, ".,!?")] {
			keep = append(keep, w)
		}
	}
	return strings.Join(keep, " ")
}

/* ── questions (FAQ) ─────────────────────────────────────────────────── */

// QuestionKind is what a customer asks about instead of booking.
type QuestionKind string

const (
	QuestionNone       QuestionKind = ""
	QuestionAddress    QuestionKind = "address"
	QuestionHours      QuestionKind = "hours"
	QuestionPrice      QuestionKind = "price"
	QuestionPayment    QuestionKind = "payment"
	QuestionReschedule QuestionKind = "reschedule"
	QuestionOther      QuestionKind = "other"
)

var (
	addressWords    = []string{"alamat", "lokasi", "dimana", "di mana", "letak", "maps", "map", "arah", "jalan apa", "daerah mana", "deket mana", "dekat mana", "address", "location", "where is", "where are", "where's", "directions", "how to get"}
	hoursWords      = []string{"jam buka", "buka jam", "jam tutup", "tutup jam", "jam operasional", "jam berapa buka", "buka sampai", "masih buka", "buka hari", "buka tiap", "opening hours", "open until", "what time do you open", "what time do you close", "are you open", "still open", "closing time", "open on"}
	priceWords      = []string{"harga", "berapa harga", "tarif", "biaya", "price", "pricelist", "daftar harga", "berapaan", "harganya", "promo", "diskon", "how much", "cost", "rates", "discount", "prices"}
	paymentWords    = []string{"cara bayar", "bayar pakai", "bayar pake", "bisa bayar", "pembayaran", "qris", "transfer", "kartu kredit", "debit", "bayar dulu", "dp dulu", "bayar di tempat", "cash", "payment", "pay by", "pay with", "credit card", "can i pay", "deposit", "pay later", "pay now"}
	rescheduleWords = []string{"ubah jadwal", "ganti jadwal", "reschedule", "batalin", "batalkan booking", "cancel", "pindah jam", "geser jam", "telat", "terlambat", "refund", "change my booking", "move my booking", "running late", "cancellation"}
	questionWords   = []string{"apa", "apakah", "bagaimana", "gimana", "berapa", "kapan", "kenapa", "mengapa", "bisa", "boleh", "ada", "siapa", "yang mana", "punya", "what", "is", "are", "can", "could", "do", "does", "how", "when", "why", "which", "any", "where", "who"}
)

// DetectQuestion classifies an information question. Booking-shaped
// messages are not questions: "bisa besok jam 3?" asks for a slot, which the
// caller checks with its extraction before trusting QuestionOther.
func DetectQuestion(text string) QuestionKind {
	n := Normalize(strings.TrimRight(strings.TrimSpace(text), "?!. "))
	if n == "" {
		return QuestionNone
	}
	has := func(words []string) bool {
		for _, w := range words {
			if strings.Contains(n, w) {
				return true
			}
		}
		return false
	}
	switch {
	case has(addressWords):
		return QuestionAddress
	case has(hoursWords):
		return QuestionHours
	case has(paymentWords):
		return QuestionPayment
	case has(rescheduleWords):
		return QuestionReschedule
	case has(priceWords):
		return QuestionPrice
	}
	if strings.Contains(text, "?") {
		return QuestionOther
	}
	first := strings.Fields(n)
	for _, w := range questionWords {
		if first[0] == w || (len(first) > 1 && first[1] == w && (first[0] == "kak" || first[0] == "min" || first[0] == "halo")) {
			return QuestionOther
		}
	}
	return QuestionNone
}
