package wabot

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/modules/wabot/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/whatsapp"
)

/* ── customer notices: payment confirmation & reminders (EPIC-053) ───── */

const subscriberPaid = "wabot.customer-paid-notice"

// Reminder windows: the watcher ticks every 10 minutes, so each window is
// wider than a tick and the wa_notif_log claim keeps every notice single.
var reminderKinds = []struct {
	kind     string
	from, to time.Duration
}{
	{"h1", 22 * time.Hour, 26 * time.Hour},
	{"2h", 90 * time.Minute, 150 * time.Minute},
}

// Subscribe sends the guest a WhatsApp confirmation when an online payment
// settles (bus may be nil in tests).
func (e *Engine) Subscribe(bus *outbox.Bus, db database.DB) {
	if bus == nil {
		return
	}
	bus.Subscribe(spa.TopicBookingPaidOnline, subscriberPaid, func(ctx context.Context, tx pgx.Tx, ev outbox.Event) error {
		var n spa.BookingNotice
		if err := ev.Decode(&n); err != nil {
			return err
		}
		return e.PaidNotice(ctx, tx, db, n)
	})
}

// PaidNotice sends one payment confirmation; the claim lives in q (the
// delivery transaction) so a failed send is retried by the outbox.
func (e *Engine) PaidNotice(ctx context.Context, q database.Querier, db database.DB, n spa.BookingNotice) error {
	settings, err := e.st.settings(ctx, q)
	if err != nil {
		return err
	}
	if !settings.NotifyCustomer || !allowedSource(n.Source) {
		return nil
	}
	phone := waPhone(n.CustomerPhone)
	if phone == "" {
		return nil
	}
	at := n.ScheduledAt.In(domain.WIB)
	msg := domain.PaidNotice(n.CustomerName, n.Code, n.BranchName, at.Format("2006-01-02"), domain.Clock(at), n.Items, n.TotalIDR, e.statusURL(n.Token))
	id, err := whatsapp.Claim(ctx, q, "spa_paid", n.ID, msg, []string{phone})
	if err != nil || id == "" {
		return err // "" = already sent
	}
	tpl := e.template(ctx, q, metaPaidTemplateKey, []string{firstNonBlank(n.CustomerName, "Kak"), n.Code, n.BranchName,
		domain.LongDate(at.Format("2006-01-02")) + " " + domain.Clock(at), domain.Rupiah(n.TotalIDR), e.statusURL(n.Token)})
	return e.sendNotice(ctx, db, phone, e.st.conversationID(ctx, q, phone), msg, tpl)
}

// sendNotice prefers the template-aware sender (Meta outside the 24-hour
// window); plain senders get the text.
func (e *Engine) sendNotice(ctx context.Context, db database.DB, phone, conversationID, text string, tpl Template) error {
	if ns, ok := e.ports.Sender.(NoticeSender); ok {
		return ns.SendNotice(ctx, db, phone, conversationID, text, tpl)
	}
	return e.ports.Sender.Send(ctx, db, phone, conversationID, text)
}

// Meta template names/language live in configuration.app_settings (set on
// the WhatsApp settings page); an empty name means "text only".
const (
	metaReminderTemplateKey = "meta_wa_reminder_template"
	metaPaidTemplateKey     = "meta_wa_paid_template"
	metaTemplateLangKey     = "meta_wa_template_lang"
)

func (e *Engine) template(ctx context.Context, q database.Querier, key string, params []string) Template {
	stored, err := appSettings(ctx, q, key, metaTemplateLangKey)
	if err != nil {
		return Template{}
	}
	return Template{Name: strings.TrimSpace(stored[key]), Lang: firstNonBlank(stored[metaTemplateLangKey], "id"), Params: params}
}

func firstNonBlank(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// RemindUpcoming sends the H-1 and 2-hour reminders due now; it returns how
// many were sent.
func (e *Engine) RemindUpcoming(ctx context.Context, db database.DB) (int, error) {
	settings, err := e.st.settings(ctx, db)
	if err != nil || !settings.NotifyCustomer {
		return 0, err
	}
	now := e.now()
	sent := 0
	for _, w := range reminderKinds {
		list, err := e.ports.Spa.UpcomingBookings(ctx, now.Add(w.from), now.Add(w.to))
		if err != nil {
			return sent, err
		}
		for _, n := range list {
			phone := waPhone(n.CustomerPhone)
			if phone == "" || !allowedSource(n.Source) {
				continue
			}
			at := n.ScheduledAt.In(domain.WIB)
			msg := domain.ReminderNotice(w.kind, n.CustomerName, n.Code, n.BranchName, at.Format("2006-01-02"), domain.Clock(at), n.Items,
				n.PaymentStatus == "paid", e.statusURL(n.Token))
			id, err := whatsapp.Claim(ctx, db, "spa_remind_"+w.kind, n.ID, msg, []string{phone})
			if err != nil {
				return sent, err
			}
			if id == "" {
				continue
			}
			tpl := e.template(ctx, db, metaReminderTemplateKey, []string{firstNonBlank(n.CustomerName, "Kak"), n.Code, n.BranchName,
				domain.LongDate(at.Format("2006-01-02")) + " " + domain.Clock(at), strings.Join(n.Items, ", "), e.statusURL(n.Token)})
			if err := e.sendNotice(ctx, db, phone, e.st.conversationID(ctx, db, phone), msg, tpl); err != nil {
				e.log.Warn("[wabot] pengingat gagal dikirim", "booking", n.Code, "error", err)
				_ = whatsapp.Release(ctx, db, id)
				continue
			}
			sent++
		}
	}
	return sent, nil
}

func (e *Engine) statusURL(token string) string {
	return strings.TrimRight(e.ports.AppURL, "/") + "/booking/spa/status/" + token
}

// allowedSource: only guests who booked online or by chat gave a number for
// WhatsApp; front-office bookings are the outlet's to handle.
func allowedSource(source string) bool { return source == "public" || source == "whatsapp" }

// waPhone turns 0812… / +62… into the gateway's 62… form; "" when not usable.
func waPhone(raw string) string {
	var digits strings.Builder
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	d := digits.String()
	if strings.HasPrefix(d, "0") {
		d = "62" + d[1:]
	}
	if len(d) < 10 || len(d) > 15 {
		return ""
	}
	return d
}
