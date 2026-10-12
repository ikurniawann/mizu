package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"nuhabit/backend/internal/platform/database"
)

/* ── Meta WhatsApp Cloud API: interactive menus, templates, status ───── */

// Meta setting keys (configuration.app_settings), each with its env fallback.
const (
	MetaAccessTokenKey   = "meta_wa_access_token"
	MetaPhoneNumberIDKey = "meta_wa_phone_number_id"
	MetaGraphVersionKey  = "meta_wa_graph_version"
	MetaVerifyTokenKey   = "meta_wa_verify_token"
	MetaAppSecretKey     = "meta_wa_app_secret"
	ProviderKey          = "whatsapp_provider"
)

// Option is one choice of an interactive message. ID comes back in the
// customer's reply; Title shows on the row/button (Meta: 24/20 chars),
// Description under a list row (72 chars).
type Option struct {
	ID          string
	Title       string
	Description string
}

const (
	metaListMax      = 10
	metaButtonMax    = 3
	metaRowTitleMax  = 24
	metaRowDescMax   = 72
	metaButtonMax20  = 20
	metaBodyMax      = 1024
	metaListButton   = "Pilih"
	metaSectionTitle = "Pilihan"
)

// Provider is the resolved provider name ("meta", "gateway", "fonnte", "").
func (c *Client) Provider(ctx context.Context, q database.Querier) string { return c.provider(ctx, q) }

// DispatchMenu sends body with options as a Meta interactive message (list
// up to 10 rows, buttons up to 3); other providers get fallback as text.
// More than 10 options also fall back to text.
func (c *Client) DispatchMenu(ctx context.Context, q database.Querier, target, body, footer string, options []Option, fallback string) Result {
	if c.provider(ctx, q) != "meta" || len(options) == 0 || len(options) > metaListMax {
		return c.Dispatch(ctx, q, target, fallback)
	}
	cfg := c.metaConfig(ctx, q)
	interactive := map[string]any{"body": map[string]any{"text": cut(body, metaBodyMax)}}
	if strings.TrimSpace(footer) != "" {
		interactive["footer"] = map[string]any{"text": cut(footer, 60)}
	}
	if len(options) <= metaButtonMax && allShort(options) {
		buttons := make([]any, len(options))
		for i, o := range options {
			buttons[i] = map[string]any{"type": "reply", "reply": map[string]any{"id": o.ID, "title": cut(o.Title, metaButtonMax20)}}
		}
		interactive["type"] = "button"
		interactive["action"] = map[string]any{"buttons": buttons}
	} else {
		rows := make([]any, len(options))
		for i, o := range options {
			row := map[string]any{"id": o.ID, "title": cut(o.Title, metaRowTitleMax)}
			if d := strings.TrimSpace(o.Description); d != "" {
				row["description"] = cut(d, metaRowDescMax)
			}
			rows[i] = row
		}
		interactive["type"] = "list"
		interactive["action"] = map[string]any{"button": metaListButton, "sections": []any{map[string]any{"title": metaSectionTitle, "rows": rows}}}
	}
	return c.postMeta(ctx, cfg, map[string]any{
		"messaging_product": "whatsapp", "recipient_type": "individual", "to": target,
		"type": "interactive", "interactive": interactive,
	})
}

// allShort: buttons need titles that fit 20 characters without cutting.
func allShort(options []Option) bool {
	for _, o := range options {
		if utf8.RuneCountInString(o.Title) > metaButtonMax20 {
			return false
		}
	}
	return true
}

// DispatchTemplate sends an approved Meta template with body parameters
// ({{1}}, {{2}}, … in order); other providers get fallback as text.
func (c *Client) DispatchTemplate(ctx context.Context, q database.Querier, target, name, lang string, params []string, fallback string) Result {
	if c.provider(ctx, q) != "meta" {
		return c.Dispatch(ctx, q, target, fallback)
	}
	if strings.TrimSpace(name) == "" {
		return Result{Provider: "meta", Reason: "Nama template Meta belum diisi"}
	}
	list := make([]any, len(params))
	for i, p := range params {
		list[i] = map[string]any{"type": "text", "text": strings.ReplaceAll(strings.TrimSpace(p), "\n", " ")}
	}
	var components []any
	if len(list) > 0 {
		components = append(components, map[string]any{"type": "body", "parameters": list})
	}
	return c.postMeta(ctx, c.metaConfig(ctx, q), map[string]any{
		"messaging_product": "whatsapp", "recipient_type": "individual", "to": target,
		"type":     "template",
		"template": map[string]any{"name": name, "language": map[string]any{"code": firstSet(lang, "id")}, "components": components},
	})
}

// MetaStatus describes the configured Cloud API number.
type MetaStatus struct {
	Configured  bool   `json:"configured"`
	Reachable   bool   `json:"reachable"`
	PhoneNumber string `json:"phone_number"`
	Name        string `json:"verified_name"`
	Quality     string `json:"quality_rating"`
	Error       string `json:"error,omitempty"`
}

// MetaStatus asks Graph about the phone number (a cheap credential check).
func (c *Client) MetaStatus(ctx context.Context, q database.Querier) MetaStatus {
	cfg := c.metaConfig(ctx, q)
	if cfg == nil {
		return MetaStatus{}
	}
	st := MetaStatus{Configured: true}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.MetaBase+"/"+cfg.graphVersion+"/"+cfg.phoneNumberID+"?fields=display_phone_number,verified_name,quality_rating", nil)
	if err != nil {
		st.Error = err.Error()
		return st
	}
	req.Header.Set("Authorization", "Bearer "+cfg.accessToken)
	resp, err := httpClient.Do(req)
	if err != nil {
		st.Error = fetchFailed
		return st
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	data, perr := decodeJSON(raw)
	if !is2xx(resp.StatusCode) {
		if perr == nil {
			st.Error = metaError(data)
		} else {
			st.Error = "HTTP " + strconv.Itoa(resp.StatusCode)
		}
		return st
	}
	st.Reachable = true
	st.PhoneNumber, _ = field(data, "display_phone_number").(string)
	st.Name, _ = field(data, "verified_name").(string)
	st.Quality, _ = field(data, "quality_rating").(string)
	return st
}

// cut trims s to max runes with an ellipsis.
func cut(s string, max int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:max-1])) + "…"
}

var errEmpty = errors.New("empty")

func decodeJSON(raw []byte) (any, error) {
	if len(raw) == 0 {
		return nil, errEmpty
	}
	var data any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	return data, nil
}
