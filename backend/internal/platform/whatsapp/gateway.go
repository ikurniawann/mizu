package whatsapp

import (
	"context"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/safehttp"
)

// Gateway is the self-hosted gateway's GatewayConfig.
type Gateway struct {
	BaseURL string
	Token   string
	Timeout time.Duration
	// knownContact (set by LoadGateway) guards against blocking: the
	// unofficial gateway only messages numbers that have chatted to it
	// before (owner decision 13 Oct 2026). nil = no check.
	knownContact func(ctx context.Context, target string) bool
}

// NotContacted is the reason a gateway message to a number that never
// chatted to the WhatsApp number is not sent.
const NotContacted = "Nomor belum pernah chat ke nomor WhatsApp ini — pesan pertama tidak dikirim (mencegah blokir)"

// KnownContact reports whether target (0812…, 62812…, +62…) has ever sent a
// message to the business number.
func KnownContact(ctx context.Context, q database.Querier, target string) bool {
	phone := contactDigits(target)
	if phone == "" {
		return false
	}
	var ok bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM crm.wa_messages WHERE direction = 'in' AND phone::text IN ($1::text, $2::text))`,
		phone, "+"+phone).Scan(&ok)
	return err == nil && ok
}

// contactDigits is the 62… form crm.wa_messages stores for inbound phones.
func contactDigits(target string) string {
	var b strings.Builder
	for _, r := range target {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	d := b.String()
	switch {
	case strings.HasPrefix(d, "0"):
		d = "62" + d[1:]
	case strings.HasPrefix(d, "8"):
		d = "62" + d
	}
	if len(d) < 10 {
		return ""
	}
	return d
}

// DefaultGatewayURL is the gateway on the app's own host, used when neither
// the settings nor WA_GATEWAY_URL name one.
const (
	defaultGatewayHost = "127.0.0.1:3471"
	DefaultGatewayURL  = "http://" + defaultGatewayHost
)

// GatewayPolicy is the safehttp policy of gateway calls: SAFEHTTP_ALLOW_HOSTS
// plus the configured gateway's host:port (from the settings or the env,
// trusted like them) and an explicit entry for DefaultGatewayURL. Any other
// destination, a redirect included, must be public https.
func GatewayPolicy(baseURL string) safehttp.Policy {
	p := safehttp.FromEnv(nil)
	p.AllowHosts = append(p.AllowHosts, defaultGatewayHost)
	if u, err := url.Parse(baseURL); err == nil && u.Hostname() != "" {
		port := u.Port()
		if port == "" && u.Scheme == "https" {
			port = "443"
		} else if port == "" {
			port = "80"
		}
		p.AllowHosts = append(p.AllowHosts, strings.ToLower(net.JoinHostPort(u.Hostname(), port)))
	}
	return p
}

// gatewayClients holds one client per gateway base URL, so connections are
// reused across sends.
var gatewayClients sync.Map // base URL -> *http.Client

// HTTPClient is the safehttp client for calls to this gateway. Each call
// carries its own deadline; the client bounds a call to 60 seconds.
func (g *Gateway) HTTPClient() *http.Client { return GatewayClient(g.BaseURL) }

// GatewayClient is the safehttp client for the gateway at baseURL.
func GatewayClient(baseURL string) *http.Client {
	if c, ok := gatewayClients.Load(baseURL); ok {
		return c.(*http.Client)
	}
	c, _ := gatewayClients.LoadOrStore(baseURL, GatewayPolicy(baseURL).Client(60*time.Second))
	return c.(*http.Client)
}

// gatewayCacheTTL keeps one settings read per 30 seconds, like the TS.
const gatewayCacheTTL = 30 * time.Second

// LoadGateway is loadGatewayConfig: the URL and token from
// configuration.app_settings, then the env (a settings read failure falls
// back to the env), cached 30 seconds. nil when no token is set.
func (c *Client) LoadGateway(ctx context.Context, q database.Querier) *Gateway {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.cachedAt.IsZero() && time.Since(c.cachedAt) < gatewayCacheTTL {
		return guarded(c.cached, q)
	}
	stored := map[string]string{}
	if rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`,
		[]string{"wa_gateway_url", "wa_gateway_token"}); err == nil {
		for rows.Next() {
			var key string
			var value *string
			if rows.Scan(&key, &value) == nil && value != nil {
				stored[key] = strings.TrimSpace(*value)
			}
		}
		rows.Close()
	}
	var g *Gateway
	if token := firstSet(stored["wa_gateway_token"], c.Getenv("WA_GATEWAY_TOKEN")); token != "" {
		ms, err := strconv.ParseFloat(c.Getenv("WA_GATEWAY_TIMEOUT_MS"), 64)
		if err != nil || ms <= 0 {
			ms = 20000
		}
		g = &Gateway{
			BaseURL: firstSet(stored["wa_gateway_url"], c.Getenv("WA_GATEWAY_URL"), DefaultGatewayURL),
			Token:   token,
			Timeout: time.Duration(ms * float64(time.Millisecond)),
		}
	}
	c.cached, c.cachedAt = g, time.Now()
	return guarded(g, q)
}

// guarded is a copy of g that only messages known contacts, checked on q.
func guarded(g *Gateway, q database.Querier) *Gateway {
	if g == nil {
		return nil
	}
	cp := *g
	cp.knownContact = func(ctx context.Context, target string) bool { return KnownContact(ctx, q, target) }
	return &cp
}

// timeoutReason is the gateway's reason for an uncertain send.
const timeoutReason = "Gateway tidak merespons (timeout)"

// SendImage posts a PNG (base64) with a caption to {baseUrl}/send-image.
func (g *Gateway) SendImage(ctx context.Context, target string, png []byte, caption string) Result {
	if g.knownContact != nil && !g.knownContact(ctx, target) {
		return Result{Provider: "gateway", Reason: NotContacted}
	}
	ctx, cancel := context.WithTimeout(ctx, g.Timeout*2)
	defer cancel()
	status, data, err := postJSON(ctx, g.HTTPClient(), g.BaseURL+"/send-image", map[string]string{
		"target": target, "caption": caption, "mimetype": "image/png", "image": base64.StdEncoding.EncodeToString(png),
	}, map[string]string{"x-gateway-token": g.Token})
	switch {
	case errors.Is(err, errNotJSON):
	case err != nil && isTimeout(ctx, err):
		return Result{Provider: "gateway", Reason: timeoutReason, TimedOut: true}
	case err != nil:
		return Result{Provider: "gateway", Reason: fetchFailed}
	}
	if !is2xx(status) {
		reason, isString := field(data, "error").(string)
		if !isString {
			reason = "Gateway menolak kiriman gambar"
		}
		return Result{Provider: "gateway", Reason: reason}
	}
	id, _ := field(data, "messageId").(string)
	return Result{Success: true, Provider: "gateway", MessageID: id}
}

// SendText is sendGatewayText: POST {baseUrl}/send with x-gateway-token,
// bounded by the gateway timeout. It does not log to crm.wa_messages.
func (g *Gateway) SendText(ctx context.Context, target, message string) Result {
	if g.knownContact != nil && !g.knownContact(ctx, target) {
		return Result{Provider: "gateway", Reason: NotContacted}
	}
	return g.sendText(ctx, target, message)
}

// sendText posts without the known-contact check (login OTPs the guest
// just requested themselves).
func (g *Gateway) sendText(ctx context.Context, target, message string) Result {
	ctx, cancel := context.WithTimeout(ctx, g.Timeout)
	defer cancel()
	status, data, err := postJSON(ctx, g.HTTPClient(), g.BaseURL+"/send", map[string]string{"target": target, "message": message},
		map[string]string{"x-gateway-token": g.Token})
	switch {
	case errors.Is(err, errNotJSON): // response.json().catch(() => null)
	case err != nil && isTimeout(ctx, err):
		return Result{Provider: "gateway", Reason: timeoutReason, TimedOut: true}
	case err != nil:
		return Result{Provider: "gateway", Reason: fetchFailed}
	}
	if !is2xx(status) {
		reason, isString := field(data, "error").(string)
		if !isString {
			reason = "Gateway menolak permintaan kirim"
		}
		return Result{Provider: "gateway", Reason: reason}
	}
	id, _ := field(data, "messageId").(string)
	return Result{Success: true, Provider: "gateway", MessageID: id}
}
