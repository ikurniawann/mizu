package inbox

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Gateway is the inbox's exported service for the WhatsApp gateway webhook
// (POST /api/wa/inbound, integrations module) and the message log's manual
// resend: record a gateway message on its conversation
// (recordGatewayMessage), apply the CS rules to an inbound message
// (onInboundMessage in lib/crm/cs-server.ts) and send a reply that is logged
// on its conversation (sendWhatsAppText with meta).
type Gateway struct {
	WhatsApp WhatsApp
	Log      *slog.Logger
	// BrandName fills the default auto-reply text (brandName()).
	BrandName string
}

// Record stores one gateway message and returns its conversation id. An
// echo of a message already stored reports stored=false.
func (g Gateway) Record(ctx context.Context, db database.DB, m domain.Inbound) (stored bool, conversationID string, err error) {
	if stored, err = recordMessage(ctx, db, m); err != nil {
		return false, "", err
	}
	err = db.QueryRow(ctx, `SELECT id::text FROM crm.wa_conversations WHERE channel = $1 AND external_id = $2`,
		m.Channel, m.ExternalID).Scan(&conversationID)
	if database.IsNoRows(err) {
		return stored, "", nil
	}
	return stored, conversationID, err
}

// InboundOutcome is onInboundMessage's result: the auto-reply to send
// (nil = none) and the CSAT score captured (0 = none).
type InboundOutcome struct {
	AutoReplyText *string
	CsatCaptured  int
}

// OnInboundMessage runs after an inbound message is stored: it captures a
// CSAT rating the conversation was waiting for, starts the SLA clock, and
// claims today's out-of-hours auto-reply (once per WIB day).
func (g Gateway) OnInboundMessage(ctx context.Context, q database.Querier, conversationID string, body *string, receivedAt time.Time) (InboundOutcome, error) {
	var out InboundOutcome
	settings, err := g.csInboundSettings(ctx, q)
	if err != nil {
		return out, err
	}
	var awaitingSince, csatAskedAt *time.Time
	var csatScore *int32
	var autoReplySentOn *string
	err = q.QueryRow(ctx, `SELECT awaiting_since, csat_asked_at, csat_score, auto_reply_sent_on::text
       FROM crm.wa_conversations WHERE id = $1`, conversationID).Scan(&awaitingSince, &csatAskedAt, &csatScore, &autoReplySentOn)
	if database.IsNoRows(err) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if csatAskedAt != nil && csatScore == nil {
		if score := domain.ParseCsatReply(body); score > 0 {
			// A rating reopened the conversation through the inbound path;
			// rating it does not reopen the complaint.
			if _, err := q.Exec(ctx, `UPDATE crm.wa_conversations
            SET csat_score = $2, status = 'resolved', unread_count = 0, awaiting_since = NULL
          WHERE id = $1`, conversationID, score); err != nil {
				return out, err
			}
			out.CsatCaptured = score
		}
	}
	if awaitingSince == nil && out.CsatCaptured == 0 {
		if _, err := q.Exec(ctx, `UPDATE crm.wa_conversations
          SET awaiting_since = $2, sla_response_breached = false, escalated_at = NULL
        WHERE id = $1 AND awaiting_since IS NULL`, conversationID, receivedAt); err != nil {
			return out, err
		}
	}
	if settings.AutoReplyEnabled && !domain.IsWithinBusinessHours(receivedAt, settings.BusinessHoursStart, settings.BusinessHoursEnd) {
		today := domain.WibDateKey(receivedAt)
		if autoReplySentOn == nil || *autoReplySentOn != today {
			tag, err := q.Exec(ctx, `UPDATE crm.wa_conversations
            SET auto_reply_sent_on = $2::date
          WHERE id = $1 AND (auto_reply_sent_on IS DISTINCT FROM $2::date)`, conversationID, today)
			if err != nil {
				return out, err
			}
			// 0 rows: another process claimed today's slot.
			if tag.RowsAffected() > 0 {
				out.AutoReplyText = &settings.AutoReplyText
			}
		}
	}
	return out, nil
}

// csInboundSettings is getCsSettings for the keys an inbound message reads
// (crm_settings values are jsonb).
func (g Gateway) csInboundSettings(ctx context.Context, q database.Querier) (domain.CsInboundSettings, error) {
	s := domain.DefaultCsInboundSettings(g.BrandName)
	rows, err := q.Query(ctx, `SELECT key, value FROM crm.crm_settings WHERE key LIKE 'cs_%'`)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return s, err
		}
		var v any
		_ = json.Unmarshal(raw, &v)
		switch key {
		case "cs_business_hours_start":
			s.BusinessHoursStart = readNumber(v, s.BusinessHoursStart)
		case "cs_business_hours_end":
			s.BusinessHoursEnd = readNumber(v, s.BusinessHoursEnd)
		case "cs_auto_reply_enabled":
			switch x := v.(type) {
			case bool:
				s.AutoReplyEnabled = x
			case string:
				s.AutoReplyEnabled = x == "true"
			}
		case "cs_auto_reply_text":
			if text, ok := v.(string); ok && domain.JSTrim(text) != "" {
				s.AutoReplyText = text
			}
		}
	}
	return s, rows.Err()
}

// readNumber is cs-server's readNumber: a number, or a numeric string.
func readNumber(v any, fallback float64) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		if n, ok := jsNumber(x); ok {
			return n
		}
	}
	return fallback
}

// jsNumber is Number(s) for a finite result ("" is 0).
func jsNumber(s string) (float64, bool) {
	t := domain.JSTrim(s)
	if t == "" {
		return 0, true
	}
	n, err := strconv.ParseFloat(t, 64)
	return n, err == nil && !math.IsInf(n, 0)
}

// SendText sends message to phone and logs it on conversationID ("" =
// none) with messageType and sentByUserID ("" = NULL), like
// sendWhatsAppText(…, { messageType, sentByUserId, conversationId }).
// SendMenu sends an interactive menu where the provider supports it (the
// text, which numbers the options itself, is the fallback and what the
// inbox logs).
func (g Gateway) SendMenu(ctx context.Context, db database.DB, phone, text string, options []whatsapp.Option, messageType, conversationID string) SendResult {
	h := &handler{Ports: Ports{WhatsApp: g.WhatsApp}, db: db, log: g.logger()}
	res := g.WhatsApp.SendMenu(ctx, db, phone, menuBody(text), options, text)
	if err := h.logOutbound(ctx, &phone, text, res, textMeta{messageType: messageType, conversationID: conversationID}); err != nil {
		h.log.Error("[wa-log] Gagal mencatat pesan keluar", "error", err)
	}
	return res
}

// SendNotice sends text while the customer's 24-hour window is open; on
// Meta, outside it, an approved template is sent instead (and the text is
// logged as what the guest effectively received). Without a template name
// the notice is skipped rather than refused by Meta.
func (g Gateway) SendNotice(ctx context.Context, db database.DB, phone, text string, tpl Template, messageType, conversationID string) SendResult {
	h := &handler{Ports: Ports{WhatsApp: g.WhatsApp}, db: db, log: g.logger()}
	var res SendResult
	if g.WhatsApp.Provider(ctx, db) == "meta" && !customerWindowOpen(ctx, db, phone) {
		if tpl.Name == "" {
			return SendResult{Success: false, Provider: "meta", Reason: "Di luar jendela 24 jam dan template Meta belum diatur"}
		}
		res = g.WhatsApp.SendTemplate(ctx, db, phone, tpl.Name, tpl.Lang, tpl.Params, text)
	} else {
		res = g.WhatsApp.SendText(ctx, db, phone, text)
	}
	if err := h.logOutbound(ctx, &phone, text, res, textMeta{messageType: messageType, conversationID: conversationID}); err != nil {
		h.log.Error("[wa-log] Gagal mencatat pesan keluar", "error", err)
	}
	return res
}

func (g Gateway) logger() *slog.Logger {
	if g.Log == nil {
		return slog.Default()
	}
	return g.Log
}

// customerWindowOpen: Meta lets a business send free-form text for 24 hours
// after the customer's last message.
func customerWindowOpen(ctx context.Context, q database.Querier, phone string) bool {
	var ok bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM crm.wa_messages
	  WHERE direction = 'in' AND phone = $1 AND created_at > now() - interval '24 hours')`, phone).Scan(&ok)
	return err == nil && ok
}

// menuBody drops the numbered option lines from text: the interactive
// message lists them itself.
func menuBody(text string) string {
	var keep []string
	for _, line := range strings.Split(text, "\n") {
		if numberedLine.MatchString(line) {
			continue
		}
		keep = append(keep, line)
	}
	out := strings.TrimSpace(strings.Join(keep, "\n"))
	for strings.Contains(out, "\n\n\n") {
		out = strings.ReplaceAll(out, "\n\n\n", "\n\n")
	}
	return out
}

var numberedLine = regexp.MustCompile(`^\s*\d{1,2}\. `)

func (g Gateway) SendText(ctx context.Context, db database.DB, phone, message, messageType, sentByUserID, conversationID string) SendResult {
	log := g.Log
	if log == nil {
		log = slog.Default()
	}
	h := &handler{Ports: Ports{WhatsApp: g.WhatsApp}, db: db, log: log}
	return h.sendWhatsApp(ctx, &phone, message, textMeta{messageType: messageType, sentByUserID: sentByUserID, conversationID: conversationID})
}
