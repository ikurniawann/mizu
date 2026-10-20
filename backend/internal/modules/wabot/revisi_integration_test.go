package wabot_test

import (
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/platform/testutil"
)

// Revisi bot booking chat (Okt 2026): bot note & admin hours, outlet
// descriptions and last order, groups up to 10 with a treatment per guest,
// free therapists per gender per time, and gift vouchers bought in the chat.

// putOutlet re-saves an outlet's settings through the staff API.
func (e *botEnv) putOutlet(branchID string, body map[string]any) {
	e.t.Helper()
	deps := testutil.Deps(e.t, func() time.Time { return fixedNow })
	admin := testutil.CreateStaff(e.t, testutil.StaffOptions{Menus: map[string][]string{"spa.outlets": nil}})
	mux := testutil.Mux(spa.NewOn(deps, e.tx, app.SpaPorts()))
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT warehouse_id::text FROM spa.outlets WHERE branch_id = $1`, branchID).Scan(&warehouse); err != nil {
		e.t.Fatal(err)
	}
	body["warehouse_id"] = warehouse
	rec, _ := testutil.Do(e.t, mux, testutil.AsStaff(testutil.Request("PUT", "/api/spa/outlets/"+branchID, body), admin))
	if rec.Code != http.StatusOK {
		e.t.Fatalf("PUT outlet: %d %s", rec.Code, rec.Body.String())
	}
}

func (e *botEnv) setting(key, value string) {
	e.t.Helper()
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO crm.crm_settings (key, value) VALUES ($1, $2::jsonb)
	  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, key, value); err != nil {
		e.t.Fatal(err)
	}
}

// The bot says it is a bot, and a handover tells when admins work: at
// 09:00 WIB with admins 10–22 the guest hears they answer later.
func TestBotSaysItIsABotAndAdminHours(t *testing.T) {
	e := setupBot(t)
	e.setting("cs_business_hours_start", "10")
	e.setting("cs_business_hours_end", `"22"`)
	r := e.say("halo")
	e.wants(r, "balasan otomatis (bot), bukan admin")
	r = e.say("1")
	e.wants(r, "asisten booking", "bukan admin", "admin live tersedia jam 10.00–22.00 WIB", "*gift voucher*")
	r = e.say("admin")
	e.wants(r, "di luar jam kerja admin (*10.00–22.00 WIB*)", "jam kerja berikutnya")

	g := e.newConv("6281255500411", "Tamu Pagi")
	e.setting("cs_business_hours_start", "8")
	g.say("halo")
	g.say("1")
	r = g.say("mau bicara sama admin")
	g.wants(r, "saya sambungkan ke admin Mizu", "admin live tersedia jam 08.00–22.00 WIB")
}

// A group up to 10 is taken by the bot; more is explained, not dropped.
func TestBotGroupsUpToTen(t *testing.T) {
	e := setupBot(t)
	r := e.start()
	e.wants(r, "sampai 10 orang")
	r = e.say("12 orang")
	e.wants(r, "rombongan lebih dari 10 orang", "Untuk berapa orang?")
	r = e.say("10 orang")
	e.wants(r, "Treatment untuk *Tamu 1* (dari 10 orang)")
	r = e.say("1 semua")
	e.wants(r, "Mau datang kapan?")
	var people, persons int
	if err := e.tx.QueryRow(e.ctx, `SELECT (state->>'people')::int, jsonb_array_length(state->'persons') FROM crm.wa_bot_sessions WHERE conversation_id = $1::uuid`,
		e.conv).Scan(&people, &persons); err != nil {
		t.Fatal(err)
	}
	if people != 10 || persons != 10 {
		t.Fatalf("people=%d persons=%d", people, persons)
	}
}

// Each guest may take a different treatment, asked one by one.
func TestBotGroupDifferentTreatments(t *testing.T) {
	e := setupBot(t)
	if _, err := e.tx.Exec(e.ctx, `WITH t AS (INSERT INTO spa.treatments (code, name) VALUES ('BOTT'||upper(substr(md5(random()::text), 1, 4)), 'Thai Massage') RETURNING id)
	  INSERT INTO spa.treatment_variants (treatment_id, name, duration_min, price_idr) SELECT id, '60 menit', 60, 200000 FROM t`); err != nil {
		t.Fatal(err)
	}
	e.start()
	r := e.say("2")
	thai := menuKey(t, r, "Thai Massage")
	refl := menuKey(t, r, "Reflexology")
	r = e.say(thai)
	e.wants(r, "✅ Tamu 1: Thai Massage · 60 menit", "Treatment untuk *Tamu 2*")
	r = e.say(refl)
	e.wants(r, "Mau datang kapan?")
	r = e.say("besok")
	e.wants(r, "terapis kosong: 2 wanita")
	r = e.say("1")
	e.wants(r, "1. Thai Massage · 60 menit — Rp 200.000", "2. Reflexology · 45 menit — Rp 150.000", "Rp 350.000")
}

// Outlets carry a description and a last order: the menu and the hours
// answer show them, "bedanya apa" compares the outlets, and no time after
// the last order is offered.
func TestBotOutletDescriptionCompareAndLastOrder(t *testing.T) {
	e := setupBot(t)
	second := e.addOutlet("10:00", "20:00", 2)
	e.putOutlet(e.branch, map[string]any{"open_time": "10:00", "close_time": "20:00", "slot_minutes": 30,
		"last_order_time": "18:00", "description": "Outlet pertama Mizu, suasana tenang dan harga reguler."})
	e.putOutlet(second, map[string]any{"open_time": "10:00", "close_time": "20:00", "slot_minutes": 30,
		"description": "Outlet premium dengan ruang VIP dan treatment signature."})
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.variant_outlet_prices (variant_id, branch_id, price_idr) VALUES ($1, $2, 175000)`, e.variant, second); err != nil {
		t.Fatal(err)
	}
	var first string
	if err := e.tx.QueryRow(e.ctx, `SELECT name FROM configuration.branches WHERE id = $1`, e.branch).Scan(&first); err != nil {
		t.Fatal(err)
	}
	r := e.start()
	e.wants(r, first+" (buka 10.00–20.00, last order 18.00)", "Outlet pertama Mizu, suasana tenang", "Outlet premium dengan ruang VIP", "*bedanya apa*")
	r = e.say("bedanya outlet yang satu sama yang lain apa?")
	e.wants(r, "Perbedaan outlet Mizu", "Outlet premium dengan ruang VIP", "Harga yang berbeda", "Reflexology · 45 menit: ", "Rp 150.000", "Rp 175.000", "Lanjut booking")
	r = e.say("last order jam berapa?")
	e.wants(r, "last order 18.00", "(treatment terakhir selesai sebelum 20.00)")
	r = e.say(menuKey(t, r+"\n"+e.lastMenu(), first))
	e.say("1")
	e.say("1")
	r = e.say("besok malam")
	e.wants(r, "Last order di "+first+": jam *18.00* WIB")
	for _, m := range regexp.MustCompile(`(?m)^\d+\. (\d\d)\.(\d\d)`).FindAllStringSubmatch(r, -1) {
		if m[1] > "18" || (m[1] == "18" && m[2] > "00") {
			t.Fatalf("slot after last order offered: %s\n%s", m[0], r)
		}
	}
	// The public API refuses a start after the last order.
	_, err := e.spa.Book(e.ctx, spa.PublicBookingInput{BranchID: e.branch, ScheduledAt: time.Date(2026, 10, 9, 11, 30, 0, 0, time.UTC),
		CustomerName: "Telat", CustomerPhone: "081299990000", VariantIDs: []string{e.variant}, Source: "whatsapp"})
	if err == nil || !strings.Contains(err.Error(), "last order") {
		t.Fatalf("booking after last order: %v", err)
	}
}

// lastMenu renders the session's current menu (the outlet menu after a FAQ answer).
func (e *botEnv) lastMenu() string {
	var menu string
	if err := e.tx.QueryRow(e.ctx, `SELECT COALESCE(string_agg((m->>'key')||'. '||(m->>'label'), E'\n'), '')
	  FROM crm.wa_bot_sessions, jsonb_array_elements(state->'menu') m WHERE conversation_id = $1::uuid`, e.conv).Scan(&menu); err != nil {
		e.t.Fatal(err)
	}
	return menu
}

// A gift voucher is bought in the chat: nominal, recipient, link, and the
// code once paid — by "sudah bayar" and by the outbox notice (sent once).
func TestBotSellsGiftVoucher(t *testing.T) {
	if os.Getenv("XENDIT_MOCK") != "1" {
		t.Skip("needs XENDIT_MOCK=1")
	}
	e := setupBot(t)
	e.say("halo")
	e.say("1")
	r := e.say("mau beli gift voucher dong")
	e.wants(r, "Pilih nominal gift voucher", "Rp 100.000")
	r = e.say("abc")
	e.wants(r, "belum paham", "Pilih nominal")
	r = e.say("350rb")
	e.wants(r, "untuk siapa", "*0*")
	r = e.say("ani lestari")
	e.wants(r, "Ringkasan gift voucher", "Nominal: *Rp 350.000*", "Untuk: *Ani Lestari*", "Pembeli: *Fajar Bot*")
	r = e.say("ya")
	e.wants(r, "Silakan bayar gift voucher *Rp 350.000*", "?bayar=simulasi", "*sudah bayar*")
	token := regexp.MustCompile(`/booking/spa/gift/([0-9a-f-]{36})`).FindStringSubmatch(r)
	if token == nil {
		t.Fatalf("no gift link:\n%s", r)
	}
	r = e.say("sudah bayar")
	e.wants(r, "belum terlihat")
	if _, err := e.spa.svc.PublicGiftMockPay(e.ctx, token[1]); err != nil {
		t.Fatal(err)
	}
	r = e.say("sudah bayar")
	e.wants(r, "Pembayaran gift voucher diterima", "Kode gift voucher: *", "Rp 350.000", "Untuk: Ani Lestari")
	var code, branch, source string
	var balance float64
	if err := e.tx.QueryRow(e.ctx, `SELECT c.code, c.branch_id::text, c.balance::float8, c.source_type FROM spa.gift_orders g
	  JOIN giftcard.gift_cards c ON c.id = g.gift_card_id WHERE g.public_token = $1::uuid`, token[1]).Scan(&code, &branch, &balance, &source); err != nil {
		t.Fatal(err)
	}
	if branch != e.branch || balance != 350000 || source != "xendit_invoice" || !strings.Contains(r, code) {
		t.Fatalf("card %s branch=%s balance=%v source=%s", code, branch, balance, source)
	}
	// The outbox notice sends the code once.
	order, err := e.spa.svc.PublicGiftOrderStatus(e.ctx, token[1])
	if err != nil {
		t.Fatal(err)
	}
	e.sender.sent = nil
	n := spa.GiftNotice{GiftOrder: *order, Phone: e.phone}
	for range 2 {
		if err := e.engine.GiftNotice(e.ctx, e.tx, e.tx, n); err != nil {
			t.Fatal(err)
		}
	}
	if len(e.sender.sent) != 1 || !strings.Contains(e.sender.sent[0], code) {
		t.Fatalf("gift notice sent %d: %v", len(e.sender.sent), e.sender.sent)
	}
	// Booking still works afterwards (the name step comes first).
	r = e.say("booking")
	e.wants(r, "nama")
	r = e.say("1")
	e.wants(r, "Untuk berapa orang?")
}

// Cancelling a gift voucher mid-way returns to normal chat.
func TestBotGiftVoucherCancel(t *testing.T) {
	e := setupBot(t)
	e.say("halo")
	e.say("1")
	r := e.say("gift voucher")
	if strings.Contains(r, "belum bisa dibeli") {
		t.Skip("online payment off (needs XENDIT_MOCK=1)")
	}
	e.wants(r, "Pilih nominal")
	r = e.say("batal")
	e.wants(r, "pembelian gift voucher dibatalkan")
	r = e.say("1")
	e.wants(r, "Untuk berapa orang?")
}
