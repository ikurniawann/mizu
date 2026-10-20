package wabot

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/modules/wabot/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Gift voucher bought in the chat (revisi bot): the bot fills a GiftDraft
// (outlet, nominal, recipient), the spa service makes the Xendit link and,
// once paid, issues the gift card; the code comes back by the outbox
// (GiftNotice) or when the guest replies "sudah bayar".

const subscriberGiftPaid = "wabot.gift-paid"

// giftTurn handles a message while a gift is being filled in, or the ask
// that starts one.
func (t *turn) giftTurn(ctx context.Context, text string, intent domain.Intent) []string {
	s := t.sess
	l := s.Lang
	g := s.Gift
	if !g.Active() {
		return t.giftStart(ctx, text)
	}
	switch {
	case intent == domain.IntentRestart || (intent == domain.IntentNo && g.Next() == domain.GiftStepConfirm):
		s.Gift = nil
		s.ClearMenu()
		return []string{domain.GiftCancelled(l)}
	case intent == domain.IntentBack:
		if g.Back(len(s.Outlets) <= 1) {
			return t.giftPrompt(ctx, domain.BackOK(l))
		}
		return t.giftPrompt(ctx, "")
	}
	failure := ""
	applied := false
	nums := domain.MenuNumbers(text)
	pick := func() *domain.MenuOption {
		if nums == nil || s.MenuStep != g.Next() {
			return nil
		}
		for i := range s.Menu {
			if s.Menu[i].Key == strconv.Itoa(nums[0]) {
				return &s.Menu[i]
			}
		}
		return nil
	}
	switch g.Next() {
	case domain.GiftStepOutlet:
		if o := pick(); o != nil {
			applied = t.giftOutlet(o.Value)
		} else if i := domain.MatchName(text, outletNames(s.Outlets)); i >= 0 {
			applied = t.giftOutlet(s.Outlets[i].ID)
		}
	case domain.GiftStepNominal:
		if o := pick(); o != nil {
			g.Nominal, _ = strconv.ParseFloat(o.Value, 64)
			applied = true
		} else if n := domain.ParseNominal(text); n > 0 {
			if g.Allowed(n) {
				g.Nominal, applied = n, true
			} else {
				failure, applied = domain.GiftNominalRejected(l, n), true
			}
		}
	case domain.GiftStepRecipient:
		n := domain.Normalize(strings.Trim(text, ".!"))
		switch {
		case nums != nil && nums[0] == 0, n == "sendiri", n == "saya sendiri", n == "untuk saya", n == "diri sendiri", n == "myself", n == "for me", n == "me":
			g.ForSelf, applied = true, true
		case nums == nil && looksLikeName(text) && intent == domain.IntentNone:
			g.Recipient, applied = titleCase(strings.TrimSpace(strings.Trim(text, ".!"))), true
		}
	case domain.GiftStepConfirm:
		if (nums != nil && nums[0] == 1) || intent == domain.IntentYes {
			return t.giftOrder(ctx)
		}
		if nums != nil && nums[0] == 2 {
			s.Gift = nil
			s.ClearMenu()
			return []string{domain.GiftCancelled(l)}
		}
	}
	if !applied {
		return t.giftPrompt(ctx, strings.TrimSpace(domain.NotUnderstood(l, "", 1, t.settings.AdminHours)))
	}
	return t.giftPrompt(ctx, failure)
}

// giftStart opens a gift draft with the shop's options; the message may
// already name the outlet or the nominal ("gift voucher 500rb di Signature").
func (t *turn) giftStart(ctx context.Context, text string) []string {
	s := t.sess
	l := s.Lang
	opts, err := t.e.ports.Spa.GiftOptions(ctx)
	if err != nil {
		t.e.log.Warn("[wabot] opsi gift voucher", "error", err)
	}
	if err != nil || opts == nil || !opts.Available {
		return []string{domain.GiftUnavailable(l, t.settings.AdminHours)}
	}
	s.Gift = &domain.GiftDraft{Presets: opts.Presets, AllowCustom: opts.AllowCustom, MinIDR: opts.MinIDR, MaxIDR: opts.MaxIDR, ExpiryMonths: opts.ExpiryMonths}
	if len(s.Outlets) == 0 {
		t.loadOutlets(ctx)
	}
	if i := domain.MatchName(text, outletNames(s.Outlets)); i >= 0 {
		t.giftOutlet(s.Outlets[i].ID)
	}
	if n := domain.ParseNominal(text); n > 0 && s.Gift.Allowed(n) {
		s.Gift.Nominal = n
	}
	return t.giftPrompt(ctx, "")
}

func (t *turn) giftOutlet(id string) bool {
	for _, o := range t.sess.Outlets {
		if o.ID == id {
			t.sess.Gift.OutletID, t.sess.Gift.OutletName = o.ID, o.Name
			return true
		}
	}
	return false
}

// giftPrompt asks the next gift question (lead, when set, goes first).
func (t *turn) giftPrompt(ctx context.Context, lead string) []string {
	s := t.sess
	l := s.Lang
	g := s.Gift
	msg := ""
	switch g.Next() {
	case domain.GiftStepOutlet:
		if len(s.Outlets) == 0 {
			t.loadOutlets(ctx)
		}
		if len(s.Outlets) == 1 {
			t.giftOutlet(s.Outlets[0].ID)
			return t.giftPrompt(ctx, lead)
		}
		if len(s.Outlets) == 0 {
			s.Gift = nil
			return []string{domain.GiftUnavailable(l, t.settings.AdminHours)}
		}
		opts := make([]domain.MenuOption, len(s.Outlets))
		for i, o := range s.Outlets {
			opts[i] = domain.MenuOption{Key: strconv.Itoa(i + 1), Label: o.Name, Value: o.ID}
		}
		s.SetMenu(domain.GiftStepOutlet, opts)
		msg = domain.GiftAskOutlet(l, opts)
	case domain.GiftStepNominal:
		opts := make([]domain.MenuOption, len(g.Presets))
		for i, p := range g.Presets {
			opts[i] = domain.MenuOption{Key: strconv.Itoa(i + 1), Label: domain.Rupiah(p), Value: strconv.FormatFloat(p, 'f', -1, 64)}
		}
		s.SetMenu(domain.GiftStepNominal, opts)
		msg = domain.GiftAskNominal(l, g.OutletName, opts, g)
	case domain.GiftStepRecipient:
		s.SetMenu(domain.GiftStepRecipient, nil)
		msg = domain.GiftAskRecipient(l)
	case domain.GiftStepConfirm:
		yes, cancel := domain.GiftConfirmLabels(l)
		s.SetMenu(domain.GiftStepConfirm, []domain.MenuOption{{Key: "1", Label: yes, Value: "yes"}, {Key: "2", Label: cancel, Value: "no"}})
		msg = domain.GiftSummary(l, g, t.buyerName())
	default:
		s.ClearMenu()
		msg = domain.GiftPayLink(l, g)
	}
	if lead != "" {
		msg = lead + "\n\n" + msg
	}
	return []string{msg}
}

func (t *turn) buyerName() string {
	switch {
	case strings.TrimSpace(t.sess.Name) != "":
		return t.sess.Name
	case looksLikeName(t.conv.DisplayName):
		return strings.TrimSpace(t.conv.DisplayName)
	}
	if t.sess.Lang == domain.LangEN {
		return "WhatsApp customer"
	}
	return "Pelanggan WhatsApp"
}

// giftOrder makes the purchase and its payment link.
func (t *turn) giftOrder(ctx context.Context) []string {
	s := t.sess
	l := s.Lang
	g := s.Gift
	order, err := t.e.ports.Spa.GiftOrder(ctx, spa.GiftOrderInput{BranchID: g.OutletID, Nominal: g.Nominal, BuyerName: t.buyerName(),
		BuyerPhone: t.conv.Phone, RecipientName: g.Recipient, Source: "whatsapp"})
	if err != nil {
		t.e.log.Warn("[wabot] gift voucher ditolak", "error", err)
		var he *httpx.Error
		msg := domain.GiftUnavailable(l, t.settings.AdminHours)
		if errors.As(err, &he) && he.Status == 400 {
			msg = he.Message
			g.Nominal = 0 // the nominal is what a 400 refuses; ask it again
			return t.giftPrompt(ctx, msg)
		}
		s.Gift = nil
		s.ClearMenu()
		return []string{msg}
	}
	g.Token = order.Token
	if order.PayURL != nil {
		g.PayURL = *order.PayURL
	}
	if order.PayUntil != nil {
		g.PayUntil = domain.Clock(time.Time(*order.PayUntil))
	}
	return t.giftPrompt(ctx, "")
}

// giftCheck answers "sudah bayar" while a gift link is open.
func (t *turn) giftCheck(ctx context.Context) string {
	s := t.sess
	l := s.Lang
	g := s.Gift
	order, err := t.e.ports.Spa.GiftOrderStatus(ctx, g.Token)
	if err != nil {
		t.e.log.Warn("[wabot] cek gift voucher", "error", err)
		return domain.GiftNotPaid(l, g)
	}
	switch order.Status {
	case spa.GiftPaid:
		if order.Code != nil {
			g.Code = *order.Code
		}
		return domain.GiftPaid(l, g.Code, order.NominalIDR, order.BranchName, deref(order.RecipientName), giftExpiry(order))
	case spa.GiftExpired:
		s.Gift = nil
		return domain.GiftExpired(l)
	}
	return domain.GiftNotPaid(l, g)
}

func giftExpiry(o *spa.GiftOrder) string {
	if o.CardExpiresAt == nil {
		return ""
	}
	return time.Time(*o.CardExpiresAt).In(domain.WIB).Format("2006-01-02")
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// GiftNotice sends the code of a paid gift voucher once (outbox delivery).
func (e *Engine) GiftNotice(ctx context.Context, q database.Querier, db database.DB, n spa.GiftNotice) error {
	phone := waPhone(n.Phone)
	if phone == "" || n.Code == nil || !e.mayMessage(ctx, q, phone) {
		return nil
	}
	conversationID := e.st.conversationID(ctx, q, phone)
	l := domain.LangID
	if conversationID != "" {
		l = e.st.sessionLang(ctx, q, conversationID)
	}
	msg := domain.GiftPaid(l, *n.Code, n.NominalIDR, n.BranchName, deref(n.RecipientName), giftExpiry(&n.GiftOrder))
	id, err := whatsapp.Claim(ctx, q, "spa_gift_paid", n.Token, msg, []string{phone})
	if err != nil || id == "" {
		return err // "" = already sent
	}
	return e.sendNotice(ctx, db, phone, conversationID, msg, Template{})
}
