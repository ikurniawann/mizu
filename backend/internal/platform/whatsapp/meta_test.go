package whatsapp

import (
	"context"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Meta interactive menus and templates (EPIC-053 Fase 4).
func TestMetaMenusAndTemplates(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	meta := &stub{status: 200, body: `{"messages":[{"id":"wamid.1"}]}`}
	c := newClient(t, tx, map[string]string{"META_WA_ACCESS_TOKEN": "tok", "META_WA_PHONE_NUMBER_ID": "123", "WHATSAPP_PROVIDER": "meta"})
	c.MetaBase = meta.start(t)
	phone := "62812" + digits(7)

	opts := []Option{{ID: "k:1", Title: "Ya, buat booking"}, {ID: "k:2", Title: "Ubah"}}
	if res := c.DispatchMenu(ctx, tx, phone, "Sudah benar?", "", opts, "fallback"); !res.Success || res.Provider != "meta" {
		t.Fatalf("buttons: %+v", res)
	}
	req := meta.requests[len(meta.requests)-1]
	inter, _ := req["interactive"].(map[string]any)
	if req["type"] != "interactive" || inter["type"] != "button" {
		t.Fatalf("two short options must be buttons: %v", req)
	}
	// Long or many options become a list with the label in title and description.
	long := []Option{}
	for i := range 8 {
		long = append(long, Option{ID: "k:" + string(rune('1'+i)), Title: "Balinese Massage · 60 menit — Rp 185.000", Description: "Balinese Massage · 60 menit — Rp 185.000"})
	}
	c.DispatchMenu(ctx, tx, phone, "Pilih treatment:", "", long, "fallback")
	req = meta.requests[len(meta.requests)-1]
	inter, _ = req["interactive"].(map[string]any)
	action, _ := inter["action"].(map[string]any)
	sections, _ := action["sections"].([]any)
	rows, _ := sections[0].(map[string]any)["rows"].([]any)
	title, _ := rows[0].(map[string]any)["title"].(string)
	if inter["type"] != "list" || len(rows) != 8 || len([]rune(title)) > 24 || action["button"] != "Pilih" {
		t.Fatalf("list: %v", inter)
	}
	// More than ten options: plain text fallback.
	many := append(long, long[:3]...)
	c.DispatchMenu(ctx, tx, phone, "x", "", many, "teks biasa")
	req = meta.requests[len(meta.requests)-1]
	if req["type"] != "text" {
		t.Fatalf(">10 options must fall back to text: %v", req)
	}
	// Template with ordered body parameters.
	c.DispatchTemplate(ctx, tx, phone, "spa_reminder", "id", []string{"Fajar", "PD-1\nx"}, "fallback")
	req = meta.requests[len(meta.requests)-1]
	tpl, _ := req["template"].(map[string]any)
	comps, _ := tpl["components"].([]any)
	params, _ := comps[0].(map[string]any)["parameters"].([]any)
	if req["type"] != "template" || tpl["name"] != "spa_reminder" || len(params) != 2 || params[1].(map[string]any)["text"] != "PD-1 x" {
		t.Fatalf("template: %v", req)
	}
	// The settings page's provider choice beats the env, and settings hold credentials too.
	setting(t, tx, ProviderKey, "gateway")
	if p := c.Provider(ctx, tx); p != "" { // gateway is not configured in this test
		t.Fatalf("provider override: %q", p)
	}
	setting(t, tx, ProviderKey, "meta")
	setting(t, tx, MetaPhoneNumberIDKey, "999")
	c.DispatchMenu(ctx, tx, phone, "x", "", opts, "f")
	if last := meta.paths[len(meta.paths)-1]; !strings.Contains(last, "/999/messages") {
		t.Fatalf("phone number id from settings: %s", last)
	}
}
