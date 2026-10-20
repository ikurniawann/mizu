package domain

import (
	"regexp"
	"strconv"
	"strings"
)

// Gift voucher bought in the chat (revisi bot): outlet → nominal →
// recipient → confirm → payment link; the code arrives once paid.

// Gift steps (also the menu steps of their menus).
const (
	GiftStepOutlet    = "gift_outlet"
	GiftStepNominal   = "gift_nominal"
	GiftStepRecipient = "gift_recipient"
	GiftStepConfirm   = "gift_confirm"
	GiftStepPay       = "gift_pay"
	GiftStepDone      = "gift_done"
)

// GiftDraft is the gift voucher being bought in this conversation, with the
// options the shop offered when it started.
type GiftDraft struct {
	OutletID     string    `json:"outlet_id,omitempty"`
	OutletName   string    `json:"outlet_name,omitempty"`
	Nominal      float64   `json:"nominal,omitempty"`
	Recipient    string    `json:"recipient,omitempty"`
	ForSelf      bool      `json:"for_self,omitempty"`
	Presets      []float64 `json:"presets,omitempty"`
	AllowCustom  bool      `json:"allow_custom,omitempty"`
	MinIDR       float64   `json:"min_idr,omitempty"`
	MaxIDR       float64   `json:"max_idr,omitempty"`
	ExpiryMonths *int      `json:"expiry_months,omitempty"`
	Token        string    `json:"token,omitempty"`
	PayURL       string    `json:"pay_url,omitempty"`
	PayUntil     string    `json:"pay_until,omitempty"` // "17.30"
	Code         string    `json:"code,omitempty"`
}

// Next is the gift step still missing data.
func (g *GiftDraft) Next() string {
	switch {
	case g.OutletID == "":
		return GiftStepOutlet
	case g.Nominal == 0:
		return GiftStepNominal
	case g.Recipient == "" && !g.ForSelf:
		return GiftStepRecipient
	case g.Token == "":
		return GiftStepConfirm
	case g.Code == "":
		return GiftStepPay
	}
	return GiftStepDone
}

// Active: the guest is still filling the gift in (before the payment link).
func (g *GiftDraft) Active() bool {
	if g == nil {
		return false
	}
	switch g.Next() {
	case GiftStepOutlet, GiftStepNominal, GiftStepRecipient, GiftStepConfirm:
		return true
	}
	return false
}

// AwaitingPayment: a link was sent and no code has come back yet.
func (g *GiftDraft) AwaitingPayment() bool { return g != nil && g.Next() == GiftStepPay }

// Back forgets the latest gift answer; false when there is none to forget.
func (g *GiftDraft) Back(singleOutlet bool) bool {
	switch g.Next() {
	case GiftStepNominal:
		if singleOutlet {
			return false
		}
		g.OutletID, g.OutletName = "", ""
	case GiftStepRecipient:
		g.Nominal = 0
	case GiftStepConfirm:
		g.Recipient, g.ForSelf = "", false
	default:
		return false
	}
	return true
}

// Allowed checks a nominal against the shop's options.
func (g *GiftDraft) Allowed(n float64) bool {
	for _, p := range g.Presets {
		if p == n {
			return true
		}
	}
	return g.AllowCustom && n >= g.MinIDR && n <= g.MaxIDR && n == float64(int64(n)) && int64(n)%1000 == 0
}

var (
	nominalRe   = regexp.MustCompile(`(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta|m)?\b`)
	thousandsRe = regexp.MustCompile(`^\d{1,3}([.,]\d{3})+$`)
)

// ParseNominal reads "250000", "Rp 250.000", "250rb", "250 ribu", "1 juta",
// "1,5jt" as rupiah; 0 when none. A bare number below 1000 is not money
// ("2" is a menu choice).
func ParseNominal(text string) float64 {
	n := Normalize(text)
	for _, m := range nominalRe.FindAllStringSubmatch(n, -1) {
		raw, unit := m[1], m[2]
		var v float64
		if thousandsRe.MatchString(raw) && unit != "jt" && unit != "juta" && unit != "m" {
			v, _ = strconv.ParseFloat(strings.NewReplacer(".", "", ",", "").Replace(raw), 64)
		} else {
			v, _ = strconv.ParseFloat(strings.Replace(raw, ",", ".", 1), 64)
		}
		switch unit {
		case "rb", "ribu", "k":
			v *= 1000
		case "jt", "juta", "m":
			v *= 1_000_000
		}
		if v >= 1000 {
			return float64(int64(v + 0.5))
		}
	}
	return 0
}

/* ── replies ─────────────────────────────────────────────────────────── */

func GiftUnavailable(l L, h AdminHours) string {
	return t(l, "Maaf, gift voucher belum bisa dibeli lewat chat ini 🙏 Gift voucher bisa dibeli langsung di kasir outlet, atau ketik *admin* untuk dibantu (admin live jam "+h.Label()+" WIB).",
		"Sorry, gift vouchers can't be bought in this chat yet 🙏 You can buy one at the outlet's cashier, or type *admin* for help (live admins "+h.Label()+" WIB).")
}

func GiftAskOutlet(l L, options []MenuOption) string {
	return t(l, "🎁 *Gift voucher Mizu* — mau dipakai di outlet mana?\n", "🎁 *Mizu gift voucher* — which outlet will it be used at?\n") + NumberedMenu(options) +
		t(l, "\n\nGift voucher hanya berlaku di outlet yang dipilih. Balas *nomor*-nya, atau *batal* untuk membatalkan.",
			"\n\nThe voucher is valid only at the chosen outlet. Reply with the *number*, or *cancel* to stop.")
}

func GiftAskNominal(l L, outlet string, options []MenuOption, g *GiftDraft) string {
	msg := t(l, "🎁 Pilih nominal gift voucher untuk *"+outlet+"*:\n", "🎁 Choose the gift voucher amount for *"+outlet+"*:\n") + NumberedMenu(options)
	if g.AllowCustom {
		return msg + t(l, "\n\nBalas *nomor*-nya, atau tulis nominal lain (mis. *350rb*; "+Rupiah(g.MinIDR)+"–"+Rupiah(g.MaxIDR)+", kelipatan Rp 1.000).",
			"\n\nReply with the *number*, or type another amount (e.g. *350k*; "+Rupiah(g.MinIDR)+"–"+Rupiah(g.MaxIDR)+", in thousands).")
	}
	return msg + t(l, "\n\nBalas *nomor*-nya.", "\n\nReply with the *number*.")
}

// GiftConfirmLabels are the confirm-menu choices.
func GiftConfirmLabels(l L) (yes, cancel string) {
	return t(l, "Ya, minta link pembayaran", "Yes, send the payment link"), t(l, "Batal", "Cancel")
}

func GiftNominalRejected(l L, n float64) string {
	return t(l, "Nominal "+Rupiah(n)+" tidak tersedia.", "An amount of "+Rupiah(n)+" isn't available.")
}

func GiftAskRecipient(l L) string {
	return t(l, "Gift voucher ini untuk siapa? Tulis *nama penerima*, atau balas *0* kalau untuk diri sendiri.",
		"Who is the gift voucher for? Type the *recipient's name*, or reply *0* if it's for yourself.")
}

// GiftValidity is "12 bulan sejak terbit" / "tanpa batas waktu".
func GiftValidity(l L, months *int) string {
	if months == nil || *months <= 0 {
		return t(l, "tanpa batas waktu", "no expiry")
	}
	return t(l, strconv.Itoa(*months)+" bulan sejak terbit", strconv.Itoa(*months)+" months from issue")
}

func GiftSummary(l L, g *GiftDraft, buyer string) string {
	recipient := g.Recipient
	if g.ForSelf || recipient == "" {
		recipient = t(l, "diri sendiri", "yourself")
	}
	return t(l, "Ringkasan gift voucher:\n", "Gift voucher summary:\n") +
		"• Outlet: *" + g.OutletName + "*" + t(l, " (hanya berlaku di outlet ini)\n", " (valid at this outlet only)\n") +
		t(l, "• Nominal: *", "• Amount: *") + Rupiah(g.Nominal) + "*\n" +
		t(l, "• Untuk: *", "• For: *") + recipient + "*\n" +
		t(l, "• Masa berlaku: ", "• Validity: ") + GiftValidity(l, g.ExpiryMonths) + "\n" +
		t(l, "• Pembeli: *", "• Buyer: *") + buyer + "*\n\n" +
		t(l, "Sudah benar? Balas *ya* untuk mendapatkan link pembayaran, atau *batal*.", "Is this correct? Reply *yes* to get the payment link, or *cancel*.")
}

func GiftPayLink(l L, g *GiftDraft) string {
	msg := t(l, "Silakan bayar gift voucher *"+Rupiah(g.Nominal)+"* lewat link berikut", "Please pay the *"+Rupiah(g.Nominal)+"* gift voucher through this link")
	if g.PayUntil != "" {
		msg += t(l, " (berlaku sampai jam *"+g.PayUntil+"* WIB)", " (valid until *"+g.PayUntil+"* WIB)")
	}
	return msg + ":\n" + g.PayURL + t(l, "\n\nBegitu pembayaran diterima, *kode gift voucher* langsung saya kirim di chat ini. Setelah bayar, balas *sudah bayar* untuk cek. Ketik *booking* kalau mau sekalian booking treatment.",
		"\n\nAs soon as the payment arrives I'll send the *gift voucher code* in this chat. Once paid, reply *paid* to check. Type *book* to book a treatment too.")
}

// GiftPaid delivers the code (expires is a YYYY-MM-DD date or "").
func GiftPaid(l L, code string, nominal float64, outlet, recipient, expires string) string {
	var b strings.Builder
	b.WriteString(t(l, "Pembayaran gift voucher diterima ✅\n\n🎁 Kode gift voucher: *", "Gift voucher payment received ✅\n\n🎁 Gift voucher code: *") + code + "*\n")
	b.WriteString(t(l, "Nominal: ", "Amount: ") + Rupiah(nominal) + t(l, " · berlaku di *", " · valid at *") + outlet + "*\n")
	if expires != "" {
		b.WriteString(t(l, "Berlaku sampai: ", "Valid until: ") + LongDate(l, expires) + "\n")
	}
	if strings.TrimSpace(recipient) != "" {
		b.WriteString(t(l, "Untuk: ", "For: ") + strings.TrimSpace(recipient) + "\n")
	}
	b.WriteString(t(l, "\nTeruskan kode ini ke penerima. Tunjukkan kodenya ke kasir saat membayar treatment di outlet. Terima kasih 🌿",
		"\nForward this code to the recipient. Show it to the cashier when paying for a treatment at the outlet. Thank you 🌿"))
	return b.String()
}

func GiftNotPaid(l L, g *GiftDraft) string {
	return t(l, "Pembayaran gift voucher belum terlihat di sistem. Kalau baru saja bayar, tunggu 1–2 menit lalu balas *sudah bayar* lagi. Link pembayaran:\n",
		"The gift voucher payment hasn't shown up yet. If you just paid, wait 1–2 minutes and reply *paid* again. Payment link:\n") + g.PayURL
}

func GiftExpired(l L) string {
	return t(l, "Link pembayaran gift voucher sudah kedaluwarsa. Ketik *gift voucher* untuk membuat yang baru.",
		"The gift voucher payment link has expired. Type *gift voucher* to start a new one.")
}

func GiftCancelled(l L) string {
	return t(l, "Baik, pembelian gift voucher dibatalkan. Ketik *booking* untuk booking treatment, atau *gift voucher* untuk mulai lagi.",
		"Alright, the gift voucher purchase is cancelled. Type *book* to book a treatment, or *gift voucher* to start again.")
}
