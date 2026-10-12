package wabot_test

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/modules/wabot"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

// The engine runs against the real spa public service in one rolled-back
// transaction: menu-number replies only (no AI), one outlet, 2 guests.

var fixedNow = time.Date(2026, 10, 8, 2, 0, 0, 0, time.UTC) // 09:00 WIB

type txSpa struct{ svc *spa.Service }

func (a txSpa) Outlets(ctx context.Context) ([]spa.PublicOutlet, error) {
	return a.svc.PublicOutlets(ctx)
}
func (a txSpa) Treatments(ctx context.Context, b string) ([]spa.PublicTreatment, error) {
	return a.svc.PublicTreatments(ctx, b)
}
func (a txSpa) Slots(ctx context.Context, b, date string, ids []string, pref string) ([]spa.PublicSlot, error) {
	return a.svc.PublicSlots(ctx, b, date, ids, pref)
}
func (a txSpa) Therapists(ctx context.Context, b string, at time.Time, ids []string, pref string) ([]spa.PublicTherapist, error) {
	return a.svc.PublicTherapists(ctx, b, at, ids, pref)
}
func (a txSpa) Book(ctx context.Context, in spa.PublicBookingInput) (*spa.PublicBookingResult, error) {
	return a.svc.PublicBook(ctx, in)
}
func (a txSpa) Pay(ctx context.Context, token string) (*spa.PublicPayment, error) {
	return a.svc.PublicPay(ctx, token)
}
func (a txSpa) Booking(ctx context.Context, token string) (*spa.PublicBookingResult, error) {
	return a.svc.PublicBooking(ctx, token)
}
func (a txSpa) OnlinePayment() bool { return false }

type memSender struct{ sent []string }

func (m *memSender) Send(_ context.Context, _ database.DB, _, _, text string) error {
	m.sent = append(m.sent, text)
	return nil
}

type botEnv struct {
	t       *testing.T
	ctx     context.Context
	tx      pgx.Tx
	engine  *wabot.Engine
	conv    string
	phone   string
	branch  string
	sender  *memSender
	at      time.Time
	spa     txSpa
	variant string
}

func setupBot(t *testing.T) *botEnv {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return fixedNow })
	admin := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{
		"spa.bookings": nil, "spa.treatments": nil, "spa.therapists": nil, "spa.outlets": nil,
	}})
	tx := testutil.Tx(t)
	ctx := context.Background()
	org := testutil.CreateOrg(t, tx)
	// Only this outlet is public so the bot skips the outlet question.
	if _, err := tx.Exec(ctx, `UPDATE spa.outlets SET is_active = false`); err != nil {
		t.Fatal(err)
	}
	mux := testutil.Mux(spa.NewOn(deps, tx, app.SpaPorts()))
	call := func(method, path string, body any, status int) map[string]any {
		t.Helper()
		rec, out := testutil.Do(t, mux, testutil.AsStaff(testutil.Request(method, path, body), admin))
		if rec.Code != status {
			t.Fatalf("%s %s: status %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
		}
		d, _ := out["data"].(map[string]any)
		return d
	}
	var warehouse string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 LIMIT 1`, org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	call("PUT", "/api/spa/outlets/"+org.BranchID, map[string]any{
		"warehouse_id": warehouse, "open_time": "10:00", "close_time": "20:00", "slot_minutes": 30,
	}, http.StatusOK)
	tr := call("POST", "/api/spa/treatments", map[string]any{
		"code": "BOT" + testutil.RandomHex(2), "name": "Reflexology",
		"variants": []any{map[string]any{"name": "45 menit", "duration_min": 45, "price_idr": 150000}},
	}, http.StatusCreated)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	for _, name := range []string{"Terapis Bot Satu", "Terapis Bot Dua"} {
		var emp string
		if err := tx.QueryRow(ctx, `INSERT INTO hris.employees (full_name, nip, email, phone, join_date)
		  VALUES ($1, 'BOT-'||$2, 'bot-'||$2||'@test.local', '0812', CURRENT_DATE) RETURNING id::text`, name, testutil.RandomHex(4)).Scan(&emp); err != nil {
			t.Fatal(err)
		}
		call("POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": org.BranchID, "gender": "female"}, http.StatusCreated)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_settings (key, value) VALUES ('bot_enabled', 'true'::jsonb)
	  ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb`); err != nil {
		t.Fatal(err)
	}
	phone := fmt.Sprintf("62812%08d", time.Now().UnixNano()%100000000)
	var conv string
	if err := tx.QueryRow(ctx, `INSERT INTO crm.wa_conversations (phone, external_id, display_name, last_message_at)
	  VALUES ($1::text, $1::text, 'Fajar Bot', $2) RETURNING id::text`, phone, fixedNow).Scan(&conv); err != nil {
		t.Fatal(err)
	}
	sender := &memSender{}
	svc := txSpa{svc: spa.NewService(tx, app.SpaPorts(), deps)}
	ports := wabot.Ports{Spa: svc, Sender: sender, AppURL: "https://mizu.test"}
	return &botEnv{t: t, ctx: ctx, tx: tx, engine: wabot.NewEngine(ports, deps.Log, deps.Now), conv: conv, phone: phone,
		branch: org.BranchID, sender: sender, at: fixedNow, spa: svc, variant: variant}
}

// local is the phone as spa stores it (0812…).
func (e *botEnv) local() string { return "0" + e.phone[2:] }

// say sends one customer message and returns the bot's replies joined.
func (e *botEnv) say(text string) string {
	e.t.Helper()
	e.sender.sent = nil
	e.at = e.at.Add(10 * time.Second)
	handled, err := e.engine.Handle(e.ctx, e.tx, e.conv, text, e.at, nil)
	if err != nil {
		e.t.Fatalf("say %q: %v", text, err)
	}
	if !handled {
		e.t.Fatalf("say %q: bot did not handle", text)
	}
	reply := strings.Join(e.sender.sent, "\n---\n")
	e.t.Logf("> %s\n%s", text, reply)
	return reply
}

func (e *botEnv) wants(reply string, parts ...string) {
	e.t.Helper()
	for _, p := range parts {
		if !strings.Contains(reply, p) {
			e.t.Fatalf("reply misses %q:\n%s", p, reply)
		}
	}
}

func TestBotBooksTwoGuestsByMenu(t *testing.T) {
	e := setupBot(t)
	r := e.say("halo")
	e.wants(r, "asisten booking", "orang") // greeting + people question (single outlet auto-picked)
	r = e.say("2")
	e.wants(r, "Reflexology", "Rp150.000")
	r = e.say("1")
	e.wants(r, "Hari ini", "Besok")
	r = e.say("2") // tomorrow
	e.wants(r, "jam", "10.00")
	// Pick the first offered time.
	m := regexp.MustCompile(`(?m)^1\. (\d\d\.\d\d)`).FindStringSubmatch(r)
	if m == nil {
		t.Fatalf("no slot menu:\n%s", r)
	}
	// Groups are assigned by Mizu (no therapist question); the WhatsApp
	// profile name fills the name step, so the summary follows directly.
	r = e.say("1")
	e.wants(r, "dipilihkan oleh Mizu", "Fajar Bot", "2 orang", "Rp300.000", "Balas *ya*")
	r = e.say("1")
	// Online payment is off in this test, so no payment question is asked.
	if strings.Contains(r, "Bayar online") {
		t.Fatalf("online payment offered while disabled:\n%s", r)
	}
	e.wants(r, "Kode booking", "https://mizu.test/booking/spa/status/", "di outlet")
	var n int
	var source, status, name string
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*), min(source), min(status), min(customer_name) FROM spa.bookings
	  WHERE branch_id = $1 AND customer_phone = $2`, e.branch, e.local()).Scan(&n, &source, &status, &name); err != nil {
		t.Fatal(err)
	}
	if n != 2 || source != "whatsapp" || status != "unassigned" || !strings.HasPrefix(name, "Fajar Bot") {
		t.Fatalf("bookings: n=%d source=%s status=%s name=%s", n, source, status, name)
	}
	// Done state: status question and a thank-you.
	r = e.say("status")
	e.wants(r, "Booking terakhir", "https://mizu.test/booking/spa/status/")
	var active bool
	var reason *string
	if err := e.tx.QueryRow(e.ctx, `SELECT bot_active, bot_handover_reason FROM crm.wa_conversations WHERE id = $1::uuid`, e.conv).Scan(&active, &reason); err != nil {
		t.Fatal(err)
	}
	if !active || reason != nil {
		t.Fatalf("bot should still own the conversation: active=%v reason=%v", active, reason)
	}
	var step string
	var latency int
	if err := e.tx.QueryRow(e.ctx, `SELECT step, last_latency_ms FROM crm.wa_bot_sessions WHERE conversation_id = $1::uuid`, e.conv).Scan(&step, &latency); err != nil {
		t.Fatal(err)
	}
	t.Logf("session step=%s latency=%dms", step, latency)
}

// One guest may pick a therapist from the free list; the booking is
// assigned to her straight away.
func TestBotSingleGuestPicksTherapist(t *testing.T) {
	e := setupBot(t)
	e.say("halo")
	e.say("1")
	e.say("1")
	r := e.say("besok jam 2 siang") // free text: date + exact time, auto-picked
	e.wants(r, "Pilihkan oleh Mizu", "Terapis S. (wanita)", "Terapis D. (wanita)")
	picked := regexp.MustCompile(`(?m)^2\. (Terapis \w\.)`).FindStringSubmatch(r)
	if picked == nil {
		t.Fatalf("no therapist menu:\n%s", r)
	}
	r = e.say("2")
	e.wants(r, "jam *14.00* WIB", "Terapis: *"+picked[1])
	r = e.say("ya")
	e.wants(r, "Kode booking")
	var status string
	var therapist *string
	if err := e.tx.QueryRow(e.ctx, `SELECT b.status, e.full_name FROM spa.bookings b
	  LEFT JOIN spa.therapists th ON th.id = b.therapist_id LEFT JOIN hris.employees e ON e.id = th.employee_id
	  WHERE b.customer_phone = $1`, e.local()).Scan(&status, &therapist); err != nil {
		t.Fatal(err)
	}
	initial := string(picked[1][len(picked[1])-2])
	if status != "assigned" || therapist == nil || !strings.HasPrefix(*therapist, "Terapis Bot "+initial) {
		t.Fatalf("booking status=%s therapist=%v want %s", status, therapist, picked[1])
	}
}

func TestBotHandsOverToAdminAndStaysQuiet(t *testing.T) {
	e := setupBot(t)
	e.say("halo")
	r := e.say("mau bicara dengan admin")
	e.wants(r, "admin")
	var active bool
	var reason string
	if err := e.tx.QueryRow(e.ctx, `SELECT bot_active, bot_handover_reason FROM crm.wa_conversations WHERE id = $1::uuid`, e.conv).Scan(&active, &reason); err != nil {
		t.Fatal(err)
	}
	if active || reason != "customer" {
		t.Fatalf("handover: active=%v reason=%s", active, reason)
	}
	e.sender.sent = nil
	handled, err := e.engine.Handle(e.ctx, e.tx, e.conv, "halo lagi", e.at.Add(time.Minute), nil)
	if err != nil || handled || len(e.sender.sent) != 0 {
		t.Fatalf("bot must stay quiet after handover: handled=%v err=%v sent=%v", handled, err, e.sender.sent)
	}
}

// Three misses in a row also hand over (separate test: one tx locks spa.outlets).
func TestBotHandsOverAfterThreeMisses(t *testing.T) {
	e := setupBot(t)
	e.say("halo")
	for i := 0; i < 2; i++ {
		r := e.say("xyzzy " + fmt.Sprint(i))
		e.wants(r, "belum")
	}
	r := e.say("xyzzy 9")
	e.wants(r, "admin")
}

func TestBotDisabledDoesNothing(t *testing.T) {
	e := setupBot(t)
	if _, err := e.tx.Exec(e.ctx, `UPDATE crm.crm_settings SET value = 'false'::jsonb WHERE key = 'bot_enabled'`); err != nil {
		t.Fatal(err)
	}
	handled, err := e.engine.Handle(e.ctx, e.tx, e.conv, "halo", e.at, nil)
	if err != nil || handled || len(e.sender.sent) != 0 {
		t.Fatalf("disabled bot: handled=%v err=%v sent=%v", handled, err, e.sender.sent)
	}
}
