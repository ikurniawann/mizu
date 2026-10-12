package webhooks

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/modules/integrations/internal/appsettings"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Meta WhatsApp Cloud API webhook (EPIC-053 Fase 4). Public like the
// gateway webhook: Meta verifies the subscription with hub.verify_token
// and signs every delivery with X-Hub-Signature-256 (app secret).

type metaWebhookConfig struct{ verifyToken, appSecret string }

func (h *Handler) metaConfig(r *http.Request) metaWebhookConfig {
	stored, _ := appsettings.GetMany(r.Context(), h.db, whatsapp.MetaVerifyTokenKey, whatsapp.MetaAppSecretKey)
	cfg := metaWebhookConfig{verifyToken: stored.Trimmed(whatsapp.MetaVerifyTokenKey), appSecret: stored.Trimmed(whatsapp.MetaAppSecretKey)}
	if cfg.verifyToken == "" {
		cfg.verifyToken = h.getenv("META_WA_VERIFY_TOKEN")
	}
	if cfg.appSecret == "" {
		cfg.appSecret = h.getenv("META_WA_APP_SECRET")
	}
	return cfg
}

// metaHandshake answers Meta's subscription check with hub.challenge.
func (h *Handler) metaHandshake(w http.ResponseWriter, r *http.Request) {
	cfg := h.metaConfig(r)
	if cfg.verifyToken == "" {
		http.Error(w, "Meta Cloud API belum dikonfigurasi", http.StatusServiceUnavailable)
		return
	}
	q := r.URL.Query()
	if q.Get("hub.mode") != "subscribe" || !tokenMatches(q.Get("hub.verify_token"), cfg.verifyToken) || !q.Has("hub.challenge") {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte(q.Get("hub.challenge")))
}

// metaWebhook stores every message of a signed delivery and runs the same
// inbound flow as the gateway (CS rules, booking bot). It answers 200 once
// the signature holds: a non-2xx makes Meta retry and eventually disable
// the subscription, so a bad message is only logged.
func (h *Handler) metaWebhook(w http.ResponseWriter, r *http.Request) {
	cfg := h.metaConfig(r)
	if cfg.appSecret == "" {
		fail(w, http.StatusServiceUnavailable, "Meta Cloud API belum dikonfigurasi")
		return
	}
	raw, err := readBody(r, 4*inboundMaxBody)
	if err != nil {
		fail(w, http.StatusBadRequest, "Payload tidak valid")
		return
	}
	if !verifyMetaSignature(raw, r.Header.Get("X-Hub-Signature-256"), cfg.appSecret) {
		fail(w, http.StatusUnauthorized, "Signature tidak valid")
		return
	}
	var payload any
	if json.Unmarshal(raw, &payload) != nil {
		_ = httpx.JSON(w, http.StatusOK, struct {
			Received bool `json:"received"`
		}{true})
		return
	}
	stored := 0
	for _, m := range normalizeMetaWebhook(payload) {
		recorded, err := h.receive(r, m)
		if err != nil {
			h.log.ErrorContext(r.Context(), "[wa-meta] Gagal merekam pesan", "error", err)
		}
		if recorded {
			stored++
		}
	}
	_ = httpx.JSON(w, http.StatusOK, struct {
		Received bool `json:"received"`
		Stored   int  `json:"stored"`
	}{true, stored})
}

// menuReplyPrefix marks interactive reply ids the bot can read as a menu
// number ("k:2" → "2").
const menuReplyPrefix = "k:"

// normalizeMetaWebhook flattens entry[].changes[].value.messages[] into
// inbound messages; statuses (delivered/read) are ignored. Interactive
// replies become their option key so the bot handles them like a typed
// number.
func normalizeMetaWebhook(payload any) []domain.GatewayInbound {
	var out []domain.GatewayInbound
	for _, entry := range list(field(payload, "entry")) {
		for _, change := range list(field(entry, "changes")) {
			value := field(change, "value")
			if s, _ := field(value, "messaging_product").(string); s != "whatsapp" {
				continue
			}
			names := map[string]string{}
			for _, c := range list(field(value, "contacts")) {
				if id, ok := field(c, "wa_id").(string); ok {
					names[id], _ = field(field(c, "profile"), "name").(string)
				}
			}
			for _, msg := range list(field(value, "messages")) {
				m := metaMessage(msg, names)
				if m != nil {
					out = append(out, *m)
				}
			}
		}
	}
	return out
}

func metaMessage(msg any, names map[string]string) *domain.GatewayInbound {
	from, _ := field(msg, "from").(string)
	id, _ := field(msg, "id").(string)
	kind, _ := field(msg, "type").(string)
	if from == "" || id == "" {
		return nil
	}
	m := domain.GatewayInbound{Channel: "whatsapp", ExternalID: from, Phone: &from, Direction: "in", ProviderMessageID: &id}
	if name := strings.TrimSpace(names[from]); name != "" {
		m.PushName = &name
	}
	if ts, ok := field(msg, "timestamp").(string); ok {
		if sec, err := strconv.ParseInt(ts, 10, 64); err == nil {
			at := time.Unix(sec, 0).UTC()
			m.SentAt = &at
		}
	}
	var body string
	switch kind {
	case "text":
		body, _ = field(field(msg, "text"), "body").(string)
	case "interactive":
		inter := field(msg, "interactive")
		reply := field(inter, "list_reply")
		if reply == nil {
			reply = field(inter, "button_reply")
		}
		rid, _ := field(reply, "id").(string)
		title, _ := field(reply, "title").(string)
		if key, ok := strings.CutPrefix(rid, menuReplyPrefix); ok {
			body = key
		} else {
			body = title
		}
	case "button": // quick-reply button of a template
		body, _ = field(field(msg, "button"), "text").(string)
	case "image", "video", "audio", "document", "sticker":
		mediaType := kind
		m.MediaType = &mediaType
		if caption, ok := field(field(msg, kind), "caption").(string); ok && caption != "" {
			body = caption
		}
	default:
		return nil
	}
	if body != "" {
		m.Body = &body
	}
	return &m
}

func list(v any) []any {
	l, _ := v.([]any)
	return l
}

func field(v any, key string) any {
	m, _ := v.(map[string]any)
	return m[key]
}

// verifyMetaSignature checks X-Hub-Signature-256 ("sha256=" + hex
// HMAC-SHA256 of the raw body with the app secret) in constant time.
func verifyMetaSignature(raw []byte, header, appSecret string) bool {
	if header == "" || appSecret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(appSecret))
	mac.Write(raw)
	return hmac.Equal([]byte(header), []byte("sha256="+hex.EncodeToString(mac.Sum(nil))))
}
