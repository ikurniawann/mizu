package app

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/modules/crm/inbox"
	inboxdomain "nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/modules/wabot"
	"nuhabit/backend/internal/modules/wabot/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// wabot adapters: the spa's public booking service, WhatsApp sending and
// logging through the inbox gateway, and the OpenAI extractor.

func waBotPorts(d module.Deps) wabot.Ports {
	return wabot.Ports{
		Spa:       waBotSpa{svc: spa.NewService(d.DB, SpaPorts(), d)},
		Sender:    waBotSender{gw: crmInboxGateway(d)},
		Recorder:  waBotRecorder{gw: crmInboxGateway(d)},
		Extractor: wabot.OpenAIExtractor{Getenv: os.Getenv},
		AppURL:    strings.TrimRight(firstNonEmptyStr(os.Getenv("NEXT_PUBLIC_APP_URL"), os.Getenv("NEXT_PUBLIC_BASE_URL")), "/"),
	}
}

var (
	waBotOnce   sync.Once
	waBotShared *wabot.Engine
)

// waBotEngine is the one engine the webhook uses (built lazily, shared).
func waBotEngine(d module.Deps) waBotWebhook {
	waBotOnce.Do(func() { waBotShared = wabot.NewEngine(waBotPorts(d), d.Log, d.Now) })
	return waBotWebhook{engine: waBotShared}
}

type waBotWebhook struct{ engine *wabot.Engine }

func (w waBotWebhook) Handle(ctx context.Context, db database.DB, conversationID, phone string, body *string, at time.Time) (bool, error) {
	if body == nil {
		return false, nil
	}
	return w.engine.Handle(ctx, db, conversationID, *body, at, nil)
}

/* ── spa ─────────────────────────────────────────────────────────────── */

type waBotSpa struct{ svc *spa.Service }

var _ wabot.Spa = waBotSpa{}

func (a waBotSpa) Outlets(ctx context.Context) ([]spa.PublicOutlet, error) {
	return a.svc.PublicOutlets(ctx)
}
func (a waBotSpa) Treatments(ctx context.Context, branchID string) ([]spa.PublicTreatment, error) {
	return a.svc.PublicTreatments(ctx, branchID)
}
func (a waBotSpa) Slots(ctx context.Context, branchID, date string, variantIDs []string, pref string) ([]spa.PublicSlot, error) {
	return a.svc.PublicSlots(ctx, branchID, date, variantIDs, pref)
}
func (a waBotSpa) Therapists(ctx context.Context, branchID string, startsAt time.Time, variantIDs []string, pref string) ([]spa.PublicTherapist, error) {
	return a.svc.PublicTherapists(ctx, branchID, startsAt, variantIDs, pref)
}
func (a waBotSpa) Book(ctx context.Context, in spa.PublicBookingInput) (*spa.PublicBookingResult, error) {
	return a.svc.PublicBook(ctx, in)
}
func (a waBotSpa) Pay(ctx context.Context, token string) (*spa.PublicPayment, error) {
	return a.svc.PublicPay(ctx, token)
}
func (a waBotSpa) Booking(ctx context.Context, token string) (*spa.PublicBookingResult, error) {
	return a.svc.PublicBooking(ctx, token)
}
func (a waBotSpa) OnlinePayment() bool { return a.svc.OnlinePaymentReady() }
func (a waBotSpa) BookGroup(ctx context.Context, in spa.PublicGroupInput) ([]*spa.PublicBookingResult, error) {
	return a.svc.PublicBookGroup(ctx, in)
}
func (a waBotSpa) JoinWaitlist(ctx context.Context, in spa.WaitlistInput) (*spa.WaitlistEntry, error) {
	return a.svc.JoinWaitlist(ctx, in)
}
func (a waBotSpa) CancelWaitlist(ctx context.Context, id string) error {
	return a.svc.CancelWaitlist(ctx, id)
}
func (a waBotSpa) OpenWaitlist(ctx context.Context) ([]spa.WaitlistEntry, error) {
	return a.svc.OpenWaitlist(ctx)
}
func (a waBotSpa) MarkWaitlistNotified(ctx context.Context, id string) error {
	return a.svc.MarkWaitlistNotified(ctx, id)
}
func (a waBotSpa) UpcomingBookings(ctx context.Context, from, to time.Time) ([]spa.BookingNotice, error) {
	return a.svc.UpcomingBookings(ctx, from, to)
}
func (a waBotSpa) DepositPolicy(ctx context.Context) (float64, int, bool) {
	cfg, err := a.svc.DepositSettings(ctx)
	if err != nil {
		return 0, 0, false
	}
	return cfg.AmountIDR, cfg.HoldMinutes, cfg.Enabled
}
func (a waBotSpa) ExpireDeposits(ctx context.Context) (int, error) { return a.svc.ExpireDeposits(ctx) }
func (a waBotSpa) PhoneBanned(ctx context.Context, phone string) (bool, error) {
	return a.svc.PhoneBanned(ctx, phone)
}
func (a waBotSpa) Rooms(ctx context.Context, branchID string, start, end time.Time, people int) ([]spa.PublicRoom, error) {
	return a.svc.PublicRoomsAt(ctx, branchID, start, end, people)
}
func (a waBotSpa) PendingDeposits(ctx context.Context, from, to time.Time) ([]spa.BookingNotice, error) {
	return a.svc.PendingDeposits(ctx, from, to)
}

/* ── WhatsApp ────────────────────────────────────────────────────────── */

type waBotSender struct{ gw inbox.Gateway }

func (s waBotSender) Send(ctx context.Context, db database.DB, phone, conversationID, text string) error {
	res := s.gw.SendText(ctx, db, phone, text, "bot", "", conversationID)
	if !res.Success {
		return errors.New(firstNonEmptyStr(res.Reason, "pengiriman WhatsApp gagal"))
	}
	return nil
}

// SendMenu shows the options as a Meta list/buttons; the text (which
// already numbers them) goes out as-is on other providers.
func (s waBotSender) SendMenu(ctx context.Context, db database.DB, phone, conversationID, text string, options []domain.MenuOption) error {
	opts := make([]whatsapp.Option, len(options))
	for i, o := range options {
		opts[i] = whatsapp.Option{ID: "k:" + o.Key, Title: o.Label, Description: o.Label}
	}
	res := s.gw.SendMenu(ctx, db, phone, text, opts, "bot", conversationID)
	if !res.Success {
		return errors.New(firstNonEmptyStr(res.Reason, "pengiriman WhatsApp gagal"))
	}
	return nil
}

// SendNotice sends text inside the 24-hour window, the template outside it
// (Meta); other providers always send the text.
func (s waBotSender) SendNotice(ctx context.Context, db database.DB, phone, conversationID, text string, tpl wabot.Template) error {
	res := s.gw.SendNotice(ctx, db, phone, text, inbox.Template{Name: tpl.Name, Lang: tpl.Lang, Params: tpl.Params}, "bot", conversationID)
	if !res.Success {
		return errors.New(firstNonEmptyStr(res.Reason, "pengiriman WhatsApp gagal"))
	}
	return nil
}

type waBotRecorder struct{ gw inbox.Gateway }

// RecordInbound stores a simulated customer message like the gateway would.
func (r waBotRecorder) RecordInbound(ctx context.Context, db database.DB, phone, pushName, text string, at time.Time) (string, error) {
	id := "sim-" + at.UTC().Format("20060102150405.000000000")
	var name *string
	if strings.TrimSpace(pushName) != "" {
		name = &pushName
	}
	_, conversationID, err := r.gw.Record(ctx, db, inboxdomain.Inbound{
		Channel: "whatsapp", ExternalID: phone, Phone: &phone, Direction: "in", Body: &text,
		ProviderMessageID: &id, PushName: name, SentAt: &at,
	})
	if err != nil {
		return "", err
	}
	if conversationID == "" {
		return "", errors.New("percakapan simulasi tidak tercatat")
	}
	return conversationID, nil
}
