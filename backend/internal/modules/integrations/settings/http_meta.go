package settings

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/integrations/internal/appsettings"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Meta WhatsApp Cloud API settings (EPIC-053 Fase 4): credentials, the
// webhook verify token/app secret, template names for notices outside the
// 24-hour window, and which provider sends (meta | gateway).

const (
	metaReminderTemplateKey = "meta_wa_reminder_template"
	metaPaidTemplateKey     = "meta_wa_paid_template"
	metaTemplateLangKey     = "meta_wa_template_lang"
)

type waMetaSettings struct {
	Provider          string  `json:"provider"` // "" = auto (meta if configured, else gateway)
	PhoneNumberID     string  `json:"phone_number_id"`
	AccessTokenMasked *string `json:"access_token_masked"`
	AccessTokenEnv    bool    `json:"access_token_from_env"`
	VerifyToken       string  `json:"verify_token"`
	AppSecretMasked   *string `json:"app_secret_masked"`
	AppSecretEnv      bool    `json:"app_secret_from_env"`
	GraphVersion      string  `json:"graph_version"`
	ReminderTemplate  string  `json:"reminder_template"`
	PaidTemplate      string  `json:"paid_template"`
	TemplateLang      string  `json:"template_lang"`
	WebhookURL        string  `json:"webhook_url"`
}

func (h *Handler) metaClient() *whatsapp.Client {
	c := whatsapp.New(h.log)
	c.Getenv = h.getenv
	return c
}

// GET /api/settings/wa-meta
func (h *Handler) getWaMeta(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireSuperAdmin(r); err != nil {
		return err
	}
	ctx := r.Context()
	stored, err := appsettings.GetMany(ctx, h.db, whatsapp.ProviderKey, whatsapp.MetaPhoneNumberIDKey, whatsapp.MetaAccessTokenKey,
		whatsapp.MetaVerifyTokenKey, whatsapp.MetaAppSecretKey, whatsapp.MetaGraphVersionKey, metaReminderTemplateKey, metaPaidTemplateKey, metaTemplateLangKey)
	if err != nil {
		return err
	}
	settings := waMetaSettings{
		Provider:          stored.Trimmed(whatsapp.ProviderKey),
		PhoneNumberID:     firstNonEmpty(stored.Trimmed(whatsapp.MetaPhoneNumberIDKey), h.getenv("META_WA_PHONE_NUMBER_ID")),
		AccessTokenMasked: appsettings.Mask(stored[whatsapp.MetaAccessTokenKey]),
		AccessTokenEnv:    stored.Trimmed(whatsapp.MetaAccessTokenKey) == "" && h.getenv("META_WA_ACCESS_TOKEN") != "",
		VerifyToken:       firstNonEmpty(stored.Trimmed(whatsapp.MetaVerifyTokenKey), h.getenv("META_WA_VERIFY_TOKEN")),
		AppSecretMasked:   appsettings.Mask(stored[whatsapp.MetaAppSecretKey]),
		AppSecretEnv:      stored.Trimmed(whatsapp.MetaAppSecretKey) == "" && h.getenv("META_WA_APP_SECRET") != "",
		GraphVersion:      firstNonEmpty(stored.Trimmed(whatsapp.MetaGraphVersionKey), h.getenv("META_WA_GRAPH_VERSION"), "v21.0"),
		ReminderTemplate:  stored.Trimmed(metaReminderTemplateKey),
		PaidTemplate:      stored.Trimmed(metaPaidTemplateKey),
		TemplateLang:      firstNonEmpty(stored.Trimmed(metaTemplateLangKey), "id"),
		WebhookURL:        strings.TrimRight(h.getenv("NEXT_PUBLIC_APP_URL"), "/") + "/api/wa/meta",
	}
	c := h.metaClient()
	return httpx.Data(w, http.StatusOK, struct {
		Settings waMetaSettings      `json:"settings"`
		Status   whatsapp.MetaStatus `json:"status"`
		Active   string              `json:"active_provider"`
	}{settings, c.MetaStatus(ctx, h.db), c.Provider(ctx, h.db)})
}

// PATCH /api/settings/wa-meta: empty secrets mean "keep"; other empty
// strings clear the value (the env then applies).
func (h *Handler) patchWaMeta(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireSuperAdmin(r); err != nil {
		return err
	}
	body, ok := lenientBody(r)
	if !ok {
		body = map[string]any{}
	}
	f := validate.New(body, true)
	provider := f.Str("provider", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Check: validate.EnumCheck([]string{"", "meta", "gateway"})})
	phoneID := f.Str("phone_number_id", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 40})
	token := f.Str("access_token", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 600})
	verify := f.Str("verify_token", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 120})
	secret := f.Str("app_secret", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 120})
	version := f.Str("graph_version", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 10})
	reminder := f.Str("reminder_template", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 120})
	paid := f.Str("paid_template", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 120})
	lang := f.Str("template_lang", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 10})
	if !f.Valid() {
		return httpx.BadRequest("Payload tidak valid")
	}
	ctx := r.Context()
	set := func(key string, v *string) error {
		if v == nil {
			return nil
		}
		return appsettings.Set(ctx, h.db, key, appsettings.Ptr(*v))
	}
	for key, v := range map[string]*string{
		whatsapp.ProviderKey: provider, whatsapp.MetaPhoneNumberIDKey: phoneID, whatsapp.MetaVerifyTokenKey: verify,
		whatsapp.MetaGraphVersionKey: version, metaReminderTemplateKey: reminder, metaPaidTemplateKey: paid, metaTemplateLangKey: lang,
	} {
		if err := set(key, v); err != nil {
			return err
		}
	}
	if token != nil && *token != "" {
		if err := appsettings.Set(ctx, h.db, whatsapp.MetaAccessTokenKey, token); err != nil {
			return err
		}
	}
	if secret != nil && *secret != "" {
		if err := appsettings.Set(ctx, h.db, whatsapp.MetaAppSecretKey, secret); err != nil {
			return err
		}
	}
	c := h.metaClient()
	return httpx.Data(w, http.StatusOK, struct {
		Status whatsapp.MetaStatus `json:"status"`
		Active string              `json:"active_provider"`
	}{c.MetaStatus(ctx, h.db), c.Provider(ctx, h.db)})
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
