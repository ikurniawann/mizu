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
	IntentOutlet   Intent = "outlet"   // wants another outlet
	IntentWaitlist Intent = "waitlist" // wants to be told when a slot frees up
)

// Normalize lower-cases and squeezes whitespace.
func Normalize(text string) string {
	// "/status" and "!menu": people type bot commands with a prefix.
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimLeft(strings.TrimSpace(text), "/!."))), " ")
}

var (
	yesWords      = []string{"ya", "iya", "yes", "ok", "oke", "okay", "betul", "benar", "setuju", "sip", "siap", "boleh", "lanjut", "gas", "y", "yup", "yoi", "bener", "ambil", "mau", "jadi"}
	noWords       = []string{"tidak", "ga", "gak", "nggak", "enggak", "engga", "no", "jangan", "batal", "bukan", "n", "tdk"}
	restartWords  = []string{"batal", "batalkan", "ulang", "mulai ulang", "mulai lagi", "booking baru", "reset", "dari awal", "ganti semua"}
	statusWords   = []string{"status", "cek booking", "booking saya", "kode booking", "qr"}
	greetingWords = []string{"halo", "hallo", "hai", "hi", "hello", "selamat pagi", "selamat siang", "selamat sore", "selamat malam", "assalamualaikum", "permisi", "min", "kak", "mau booking", "booking", "mau pesan", "pesan tempat", "reservasi"}
	helpWords     = []string{"menu", "bantuan", "help", "pilihan"}
	outletWords   = []string{"ganti outlet", "outlet lain", "pindah outlet", "cek outlet lain", "outlet satunya"}
	waitlistWords = []string{"daftar tunggu", "waiting list", "waitlist", "masuk daftar tunggu", "kabari", "kabarin", "tunggu saja", "daftar tunggu saja"}
)

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
	for _, w := range greetingWords {
		if n == w || strings.HasPrefix(n, w+" ") || strings.HasPrefix(n, w+",") {
			return IntentGreeting
		}
	}
	return IntentNone
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
var menuPrefix = regexp.MustCompile(`^(?:saya\s+)?(?:pilih|pilihan|nomor|nomer|no\.?|yang|opsi|ambil|mau|yg)\s+(?:nomor\s+|no\.?\s+|yang\s+)?`)
var menuSuffix = regexp.MustCompile(`\s+(?:ya|yaa|saja|aja|dong|deh|kak|min|pls|please|tolong)+\s*$`)

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

var peopleWords = map[string]int{"sendiri": 1, "satu": 1, "seorang": 1, "berdua": 2, "dua": 2, "bertiga": 3, "tiga": 3, "berempat": 4, "empat": 4}

var peopleDigits = regexp.MustCompile(`\b(\d{1,2})\s*(orang|org|pax|people)\b`)

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
	case strings.Contains(n, " wanita") || strings.Contains(n, " perempuan") || strings.Contains(n, " cewek") || strings.Contains(n, " female"):
		return "female"
	case strings.Contains(n, " pria") || strings.Contains(n, " laki") || strings.Contains(n, " cowok") || strings.Contains(n, " male"):
		return "male"
	case strings.Contains(n, " bebas") || strings.Contains(n, " siapa saja") || strings.Contains(n, " terserah") || strings.Contains(n, " pilihkan"):
		return "any"
	}
	return ""
}

var monthNames = map[string]int{
	"jan": 1, "januari": 1, "feb": 2, "februari": 2, "mar": 3, "maret": 3, "apr": 4, "april": 4, "mei": 5, "may": 5,
	"jun": 6, "juni": 6, "jul": 7, "juli": 7, "agu": 8, "agt": 8, "agustus": 8, "aug": 8, "sep": 9, "sept": 9, "september": 9,
	"okt": 10, "oktober": 10, "oct": 10, "nov": 11, "november": 11, "des": 12, "desember": 12, "dec": 12,
}

var weekdays = map[string]time.Weekday{
	"minggu": time.Sunday, "ahad": time.Sunday, "senin": time.Monday, "selasa": time.Tuesday, "rabu": time.Wednesday,
	"kamis": time.Thursday, "jumat": time.Friday, "jum'at": time.Friday, "sabtu": time.Saturday,
}

var (
	dateNumeric = regexp.MustCompile(`\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b`)
	dateNamed   = regexp.MustCompile(`\b(\d{1,2})\s+([a-z']+)(?:\s+(\d{4}))?\b`)
)

// ParseDate reads "hari ini", "besok", "lusa", a weekday ("sabtu", "sabtu
// depan"), "15 okt", "15/10" relative to now (WIB). "" when absent.
func ParseDate(text string, now time.Time) string {
	n := Normalize(text)
	today := now.In(WIB)
	day := func(d time.Time) string { return d.Format("2006-01-02") }
	switch {
	case strings.Contains(n, "hari ini") || strings.Contains(n, "sekarang"):
		return day(today)
	case strings.Contains(n, "lusa"):
		return day(today.AddDate(0, 0, 2))
	case strings.Contains(n, "besok"):
		return day(today.AddDate(0, 0, 1))
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
			if strings.Contains(n, word+" depan") && ahead < 7 {
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

var clockRe = regexp.MustCompile(`\b(?:jam|pukul|pkl)?\s*(\d{1,2})(?:[.:](\d{2}))?\s*(pagi|siang|sore|malam|am|pm)?\b`)

// ParseTime reads "jam 3 sore", "15.30", "10:00", "pukul 7 malam" as
// "HH:MM"; "" when absent. A bare number is a time only after "jam"/"pukul".
func ParseTime(text string) string {
	n := Normalize(text)
	for _, m := range clockRe.FindAllStringSubmatch(n, -1) {
		full := m[0]
		explicit := strings.HasPrefix(full, "jam") || strings.HasPrefix(full, "pukul") || strings.HasPrefix(full, "pkl") || m[2] != "" || m[3] != ""
		if !explicit {
			continue
		}
		h, _ := strconv.Atoi(m[1])
		mi := 0
		if m[2] != "" {
			mi, _ = strconv.Atoi(m[2])
		}
		switch m[3] {
		case "sore", "malam", "pm":
			if h < 12 {
				h += 12
			}
		case "siang":
			if h < 11 {
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

var indoDays = []string{"Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"}
var indoMonths = []string{"", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}

// LongDate is "Sabtu, 17 Okt 2026" for a YYYY-MM-DD date.
func LongDate(date string) string {
	t, err := time.ParseInLocation("2006-01-02", date, WIB)
	if err != nil {
		return date
	}
	return indoDays[t.Weekday()] + ", " + strconv.Itoa(t.Day()) + " " + indoMonths[t.Month()] + " " + strconv.Itoa(t.Year())
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
			if genericWords[w] || shared[w] || (len(w) < 4 && !isDigits(w)) {
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

func isDigits(w string) bool {
	for _, r := range w {
		if r < '0' || r > '9' {
			return false
		}
	}
	return w != ""
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
	for _, t := range strings.FieldsFunc(text, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if t == w {
			return true
		}
	}
	return false
}

/* ── cues: what the message actually talks about (guards for AI output) ── */

var dateCues = []string{"hari ini", "sekarang", "besok", "lusa", "senin", "selasa", "rabu", "kamis", "jumat", "jum'at", "sabtu", "minggu", "ahad", "tanggal", "tgl", "minggu depan", "pekan", "weekend", "akhir pekan"}
var peopleCues = []string{"orang", "org", "pax", "sendiri", "berdua", "bertiga", "berempat", "istri", "suami", "pasangan", "teman", "temen", "anak", "ibu", "ayah", "keluarga", "kami", "kita", "rombongan"}
var timeCues = []string{"jam", "pukul", "pagi", "siang", "sore", "malam", "pkl"}

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
