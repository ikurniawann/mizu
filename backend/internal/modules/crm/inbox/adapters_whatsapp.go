package inbox

import (
	"context"
	"log/slog"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/whatsapp"
)

// WhatsAppGateway is lib/whatsapp dispatchText on platform/whatsapp; the
// inbox logs the send itself.
type WhatsAppGateway struct{ Client *whatsapp.Client }

var _ WhatsApp = (*WhatsAppGateway)(nil)

// SendText dispatches one free-text message.
func (g *WhatsAppGateway) SendText(ctx context.Context, q database.Querier, target, message string) SendResult {
	res := g.Client.Dispatch(ctx, q, target, message)
	out := SendResult{Success: res.Success, Reason: res.Reason, Provider: res.Provider}
	if res.MessageID != "" {
		out.MessageID = &res.MessageID
	}
	return out
}

// OwnerNotifierWA is lib/wa/notifications-sender fireOwnerNotification on
// platform/whatsapp.
type OwnerNotifierWA struct {
	DB       database.DB
	WhatsApp *whatsapp.Client
	Log      *slog.Logger
}

var _ OwnerNotifier = (*OwnerNotifierWA)(nil)

// Fire sends in the background; failures are only logged.
func (n *OwnerNotifierWA) Fire(notifType, dedupKey, message string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if err := n.WhatsApp.SendOwnerNotification(ctx, n.DB, notifType, dedupKey, message, nil); err != nil {
			n.Log.Error("[wa-notif] gagal terkirim", "type", notifType, "error", err)
		}
	}()
}

// SendMenu dispatches an interactive menu (Meta) or the fallback text.
func (g *WhatsAppGateway) SendMenu(ctx context.Context, q database.Querier, target, body string, options []whatsapp.Option, fallback string) SendResult {
	return toSendResult(g.Client.DispatchMenu(ctx, q, target, body, "", options, fallback))
}

// SendTemplate dispatches a Meta template or the fallback text.
func (g *WhatsAppGateway) SendTemplate(ctx context.Context, q database.Querier, target, name, lang string, params []string, fallback string) SendResult {
	return toSendResult(g.Client.DispatchTemplate(ctx, q, target, name, lang, params, fallback))
}

// Provider names the active provider.
func (g *WhatsAppGateway) Provider(ctx context.Context, q database.Querier) string {
	return g.Client.Provider(ctx, q)
}

func toSendResult(res whatsapp.Result) SendResult {
	out := SendResult{Success: res.Success, Reason: res.Reason, Provider: res.Provider}
	if res.MessageID != "" {
		id := res.MessageID
		out.MessageID = &id
	}
	return out
}
