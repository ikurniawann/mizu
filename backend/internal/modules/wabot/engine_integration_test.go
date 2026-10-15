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
	"nuhabit/backend/internal/modules/wabot/domain"
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
func (a txSpa) BookGroup(ctx context.Context, in spa.PublicGroupInput) ([]*spa.PublicBookingResult, error) {
	return a.svc.PublicBookGroup(ctx, in)
}
func (a txSpa) JoinWaitlist(ctx context.Context, in spa.WaitlistInput) (*spa.WaitlistEntry, error) {
	return a.svc.JoinWaitlist(ctx, in)
}
func (a txSpa) CancelWaitlist(ctx context.Context, id string) error {
	return a.svc.CancelWaitlist(ctx, id)
}
func (a txSpa) OpenWaitlist(ctx context.Context) ([]spa.WaitlistEntry, error) {
	return a.svc.OpenWaitlist(ctx)
}
func (a txSpa) MarkWaitlistNotified(ctx context.Context, id string) error {
	return a.svc.MarkWaitlistNotified(ctx, id)
}
func (a txSpa) UpcomingBookings(ctx context.Context, from, to time.Time) ([]spa.BookingNotice, error) {
	return a.svc.UpcomingBookings(ctx, from, to)
}
func (a txSpa) DepositPolicy(ctx context.Context) (float64, int, bool) {
	cfg, err := a.svc.DepositSettings(ctx)
	if err != nil {
		return 0, 0, false
	}
	return cfg.AmountIDR, cfg.HoldMinutes, cfg.Enabled
}
func (a txSpa) ExpireDeposits(ctx context.Context) (int, error) { return a.svc.ExpireDeposits(ctx) }
func (a txSpa) PhoneBanned(ctx context.Context, phone string) (bool, error) {
	return a.svc.PhoneBanned(ctx, phone)
}
func (a txSpa) BookingQR(ctx context.Context, token string) ([]byte, error) {
	png, _, err := a.svc.PublicBookingQR(ctx, token)
	return png, err
}
func (a txSpa) Rooms(ctx context.Context, branchID string, start, end time.Time, people int) ([]spa.PublicRoom, error) {
	return a.svc.PublicRoomsAt(ctx, branchID, start, end, people)
}
func (a txSpa) PendingDeposits(ctx context.Context, from, to time.Time) ([]spa.BookingNotice, error) {
	return a.svc.PendingDeposits(ctx, from, to)
}

type memSender struct {
	sent   []string
	images []memImage
	// newNumbersBlocked mimics the unofficial gateway: proactive notices only
	// to numbers that chatted before.
	newNumbersBlocked bool
}

func (m *memSender) MayMessage(context.Context, database.Querier, string) bool {
	return !m.newNumbersBlocked
}

type memImage struct {
	caption, link string
	png           []byte
}

func (m *memSender) Send(_ context.Context, _ database.DB, _, _, text string) error {
	m.sent = append(m.sent, text)
	return nil
}

func (m *memSender) SendImage(_ context.Context, _ database.DB, _, _, caption string, png []byte, link string) error {
	m.images = append(m.images, memImage{caption: caption, link: link, png: png})
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
	ports := wabot.Ports{Spa: svc, Sender: sender, AppURL: "https://paddy.test"}
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

// start runs the opening steps (language 1 = Indonesian, name = profile)
// and returns the reply that follows (people question, or the outlet menu).
func (e *botEnv) start() string {
	e.t.Helper()
	r := e.say("halo")
	e.wants(r, "Pilih bahasa", "1. Bahasa Indonesia", "2. English")
	r = e.say("1")
	e.wants(r, "asisten booking", "nama")
	return e.say("1")
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
	r := e.start()
	e.wants(r, "orang") // people question (single outlet auto-picked)
	r = e.say("2")
	e.wants(r, "Reflexology", "Rp 150.000")
	r = e.say("1")
	e.wants(r, "Hari ini", "Besok")
	r = e.say("2") // tomorrow
	e.wants(r, "jam", "10.00")
	// Pick the first offered time.
	m := regexp.MustCompile(`(?m)^1\. (\d\d\.\d\d)`).FindStringSubmatch(r)
	if m == nil {
		t.Fatalf("no slot menu:\n%s", r)
	}
	// Groups are assigned by Paddy (no therapist question); the WhatsApp
	// profile name fills the name step, so the summary follows directly.
	r = e.say("1")
	e.wants(r, "dipilihkan oleh Paddy", "Fajar Bot", "2 orang", "Rp 300.000", "Balas *ya*")
	r = e.say("1")
	// Online payment is off in this test, so no payment question is asked.
	if strings.Contains(r, "Bayar online") {
		t.Fatalf("online payment offered while disabled:\n%s", r)
	}
	e.wants(r, "Kode booking", "https://paddy.test/booking/spa/status/", "di toko")
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
	e.wants(r, "Booking terakhir", "https://paddy.test/booking/spa/status/")
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
	e.start()
	e.say("1")
	e.say("1")
	r := e.say("besok jam 2 siang") // free text: date + exact time, auto-picked
	e.wants(r, "Pilihkan oleh Paddy", "Terapis S. (wanita)", "Terapis D. (wanita)")
	picked := regexp.MustCompile(`(?m)^2\. (Terapis \w\.)`).FindStringSubmatch(r)
	if picked == nil {
		t.Fatalf("no therapist menu:\n%s", r)
	}
	r = e.say("2")
	e.wants(r, "jam *14.00* WIB", "Crew: *"+picked[1])
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
	e.start()
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
	e.start()
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

/* ── Fase 3: groups, alternatives, waitlist ─────────────────────────── */

// newConv starts another customer chatting with the same bot.
func (e *botEnv) newConv(phone, name string) *botEnv {
	e.t.Helper()
	var conv string
	if err := e.tx.QueryRow(e.ctx, `INSERT INTO crm.wa_conversations (phone, external_id, display_name, last_message_at)
	  VALUES ($1::text, $1::text, $2, $3) RETURNING id::text`, phone, name, fixedNow).Scan(&conv); err != nil {
		e.t.Fatal(err)
	}
	c := *e
	c.conv, c.phone, c.sender = conv, phone, &memSender{}
	c.engine = wabot.NewEngine(wabot.Ports{Spa: e.spa, Sender: c.sender, AppURL: "https://paddy.test"}, nil, func() time.Time { return fixedNow })
	return &c
}

// addOutlet configures a second public outlet (its own branch) with the
// given hours and number of female therapists; returns its branch id.
func (e *botEnv) addOutlet(open, close string, therapists int) string {
	e.t.Helper()
	deps := testutil.Deps(e.t, func() time.Time { return fixedNow })
	admin := testutil.CreateStaff(e.t, testutil.StaffOptions{Menus: map[string][]string{"spa.outlets": nil, "spa.therapists": nil}})
	org := testutil.CreateOrg(e.t, e.tx)
	mux := testutil.Mux(spa.NewOn(deps, e.tx, app.SpaPorts()))
	call := func(method, path string, body any, status int) {
		e.t.Helper()
		rec, _ := testutil.Do(e.t, mux, testutil.AsStaff(testutil.Request(method, path, body), admin))
		if rec.Code != status {
			e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
		}
	}
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 LIMIT 1`, org.BranchID).Scan(&warehouse); err != nil {
		e.t.Fatal(err)
	}
	call("PUT", "/api/spa/outlets/"+org.BranchID, map[string]any{"warehouse_id": warehouse, "open_time": open, "close_time": close, "slot_minutes": 30}, http.StatusOK)
	for i := 0; i < therapists; i++ {
		var emp string
		if err := e.tx.QueryRow(e.ctx, `INSERT INTO hris.employees (full_name, nip, email, phone, join_date)
		  VALUES ('Terapis Kecil '||$1, 'BOTK-'||$1, 'botk-'||$1||'@test.local', '0812', CURRENT_DATE) RETURNING id::text`, testutil.RandomHex(4)).Scan(&emp); err != nil {
			e.t.Fatal(err)
		}
		call("POST", "/api/spa/therapists", map[string]any{"employee_id": emp, "home_branch_id": org.BranchID, "gender": "female"}, http.StatusCreated)
	}
	return org.BranchID
}

// menuKey finds the number of the option whose label contains text.
func menuKey(t *testing.T, reply, text string) string {
	t.Helper()
	for _, line := range strings.Split(reply, "\n") {
		if strings.Contains(line, text) {
			if m := regexp.MustCompile(`^(\d+)\. `).FindStringSubmatch(line); m != nil {
				return m[1]
			}
		}
	}
	t.Fatalf("no menu line with %q:\n%s", text, reply)
	return ""
}

// Three guests, two therapists: no slot fits all at once, so the bot
// offers two waves and books the group all-or-nothing at two times.
func TestBotStaggersGroupWhenNoCommonSlot(t *testing.T) {
	e := setupBot(t)
	e.start()
	e.say("3")
	e.say("1")
	r := e.say("besok")
	e.wants(r, "bergantian", "10.00 (2 orang) & 11.00 (1 orang)")
	r = e.say("1")
	e.wants(r, "bergantian", "(jam 10.00)", "(jam 11.00)", "Rp 450.000")
	r = e.say("ya")
	e.wants(r, "Kode booking", "jam 10.00", "jam 11.00")
	var at10, at11 int
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*) FILTER (WHERE scheduled_at = '2026-10-09T03:00:00Z'), count(*) FILTER (WHERE scheduled_at = '2026-10-09T04:00:00Z')
	  FROM spa.bookings WHERE customer_phone = $1 AND source = 'whatsapp'`, e.local()).Scan(&at10, &at11); err != nil {
		t.Fatal(err)
	}
	if at10 != 2 || at11 != 1 {
		t.Fatalf("staggered bookings: 10.00=%d 11.00=%d", at10, at11)
	}
}

// A full day offers the next days, the other outlet the same day and the
// waitlist; when a booking is cancelled the watcher tells the waiting guest,
// who then books with "ambil".
func TestBotWaitlistAndAlternatives(t *testing.T) {
	e := setupBot(t)
	small := e.addOutlet("10:00", "11:00", 1) // one 45-minute slot a day
	// Guest 1 takes the only slot tomorrow.
	g1 := e.newConv("6281255500201", "Tamu Satu")
	r := g1.start()
	g1.say(menuKey(t, r, "Go Test B"+smallSuffix(e, small)))
	g1.say("1")
	g1.say("1")
	r = g1.say("besok")
	g1.wants(r, "1. 10.00")
	g1.say("1")
	g1.say("0")
	r = g1.say("ya")
	g1.wants(r, "Kode booking")

	// Guest 2 finds tomorrow full: alternatives include the big outlet and the waitlist.
	g2 := e.newConv("6281255500202", "Tamu Dua")
	r = g2.start()
	g2.say(menuKey(t, r, "Go Test B"+smallSuffix(e, small)))
	g2.say("1")
	g2.say("1")
	r = g2.say("besok")
	g2.wants(r, "jadwal sudah penuh", "hari yang sama", "daftar tunggu", "Sabtu, 10 Okt 2026")
	r = g2.say(menuKey(t, r, "daftar tunggu"))
	g2.wants(r, "masuk daftar tunggu", "Jumat, 9 Okt 2026")
	var status string
	if err := e.tx.QueryRow(e.ctx, `SELECT status FROM spa.booking_waitlist WHERE customer_phone = $1`, g2.local()).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "open" {
		t.Fatalf("waitlist status = %s", status)
	}

	// Guest 3 picks the other outlet the same day instead.
	g3 := e.newConv("6281255500203", "Tamu Tiga")
	r = g3.start()
	g3.say(menuKey(t, r, "Go Test B"+smallSuffix(e, small)))
	g3.say("1")
	g3.say("1")
	r = g3.say("besok")
	r = g3.say(menuKey(t, r, "hari yang sama"))
	g3.wants(r, "Jam yang masih tersedia pada *Jumat, 9 Okt 2026*", "10.00")
	var outlet string
	if err := e.tx.QueryRow(e.ctx, `SELECT state->>'outlet_id' FROM crm.wa_bot_sessions WHERE conversation_id = $1::uuid`, g3.conv).Scan(&outlet); err != nil {
		t.Fatal(err)
	}
	if outlet != e.branch {
		t.Fatalf("outlet switch: session outlet %s, want %s", outlet, e.branch)
	}

	// Nothing to tell yet; then guest 1 cancels and the watcher notifies guest 2.
	watcher := e.newConv("6281255500299", "Pengawas")
	if n, err := watcher.engine.NotifyWaitlist(e.ctx, e.tx); err != nil || n != 0 {
		t.Fatalf("notify before cancel: n=%d err=%v", n, err)
	}
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.bookings SET status = 'cancelled', cancelled_at = now() WHERE customer_phone = $1`, g1.local()); err != nil {
		t.Fatal(err)
	}
	watcher.sender.sent = nil
	n, err := watcher.engine.NotifyWaitlist(e.ctx, e.tx)
	if err != nil || n != 1 || len(watcher.sender.sent) != 1 {
		t.Fatalf("notify after cancel: n=%d err=%v sent=%v", n, err, watcher.sender.sent)
	}
	if msg := watcher.sender.sent[0]; !strings.Contains(msg, "Kabar baik, Tamu Dua") || !strings.Contains(msg, "10.00") {
		t.Fatalf("waitlist message: %s", msg)
	}
	if err := e.tx.QueryRow(e.ctx, `SELECT status FROM spa.booking_waitlist WHERE customer_phone = $1`, g2.local()).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "notified" {
		t.Fatalf("waitlist status after notify = %s", status)
	}
	// Guest 2 takes it: the draft is prefilled, only the time is asked.
	r = g2.say("ambil")
	g2.wants(r, "Jam yang masih tersedia pada *Jumat, 9 Okt 2026*", "1. 10.00")
	g2.say("1")
	g2.say("0")
	r = g2.say("ya")
	g2.wants(r, "Kode booking")
	if err := e.tx.QueryRow(e.ctx, `SELECT status FROM spa.booking_waitlist WHERE customer_phone = $1`, g2.local()).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "booked" {
		t.Fatalf("waitlist status after booking = %s", status)
	}
}

// smallSuffix returns the branch name tail so menuKey can tell outlets apart.
func smallSuffix(e *botEnv, branchID string) string {
	var name string
	if err := e.tx.QueryRow(e.ctx, `SELECT name FROM configuration.branches WHERE id = $1`, branchID).Scan(&name); err != nil {
		e.t.Fatal(err)
	}
	return strings.TrimPrefix(name, "Go Test B")
}

/* ── Fase 4: interactive menus ──────────────────────────────────────── */

type menuSender struct {
	memSender
	menus [][]domain.MenuOption
}

func (m *menuSender) SendMenu(_ context.Context, _ database.DB, _, _, text string, options []domain.MenuOption) error {
	m.sent = append(m.sent, text)
	m.menus = append(m.menus, options)
	return nil
}

// A sender that can show menus gets the turn's options (the last reply)
// as an interactive message; the plain greeting stays text.
func TestBotOffersMenusInteractively(t *testing.T) {
	e := setupBot(t)
	ms := &menuSender{}
	handled, err := e.engine.Handle(e.ctx, e.tx, e.conv, "halo", e.at, ms)
	if err != nil || !handled {
		t.Fatalf("handle: %v %v", handled, err)
	}
	// The language question is the first menu (two buttons).
	if len(ms.sent) != 1 || len(ms.menus) != 1 || len(ms.menus[0]) != 2 || ms.menus[0][1].Label != "English" {
		t.Fatalf("language menu: sent=%d menus=%v", len(ms.sent), ms.menus)
	}
	e.engine.Handle(e.ctx, e.tx, e.conv, "1", e.at, ms) // Indonesian → greeting + name (profile as option 1)
	e.engine.Handle(e.ctx, e.tx, e.conv, "1", e.at, ms) // name → people menu
	last := ms.menus[len(ms.menus)-1]
	if len(last) != 3 || last[0].Key != "1" || last[2].Label != "3 orang" {
		t.Fatalf("people menu: %v", last)
	}
}

// Treatments named before the outlet is chosen are applied once it is; the
// outlet name is read from free text even on the first message.
func TestBotKeepsTreatmentsNamedBeforeOutlet(t *testing.T) {
	e := setupBot(t)
	second := e.addOutlet("10:00", "20:00", 2)
	g := e.newConv("6281255500301", "Tamu Awal")
	r := g.say("halo, mau reflexology buat 2 orang besok") // Indonesian detected: no language question
	g.wants(r, "nama")
	r = g.say("1")
	g.wants(r, "Mau datang ke toko Paddy mana?")
	name := "Go Test B" + smallSuffix(e, second)
	r = g.say("di " + name + " saja")
	// Outlet matched from text, treatments applied from the pending list: straight to the time question.
	g.wants(r, "Jam yang masih tersedia pada *Jumat, 9 Okt 2026*")
	var outlet string
	if err := e.tx.QueryRow(e.ctx, `SELECT state->>'outlet_id' FROM crm.wa_bot_sessions WHERE conversation_id = $1::uuid`, g.conv).Scan(&outlet); err != nil {
		t.Fatal(err)
	}
	if outlet != second {
		t.Fatalf("outlet from text: %s want %s", outlet, second)
	}
}

/* ── FAQ ─────────────────────────────────────────────────────────────── */

type fakeAnswerer struct {
	fakeExtractor
	facts   string
	pending string
}

func (f *fakeAnswerer) Converse(_ context.Context, _ database.Querier, text, _, lang, pending string) (wabot.ConverseResult, error) {
	f.pending = pending
	switch {
	case strings.Contains(text, "booking saya yang tadi"):
		return wabot.ConverseResult{Intent: "status"}, nil
	case strings.Contains(text, "makasih"):
		return wabot.ConverseResult{Reply: "Sama-sama! (" + lang + ")"}, nil
	}
	return wabot.ConverseResult{}, nil
}

type fakeExtractor struct{}

func (fakeExtractor) Extract(context.Context, database.Querier, string, wabot.ExtractContext) (*wabot.Extraction, error) {
	return &wabot.Extraction{}, nil
}

func (f *fakeAnswerer) Answer(_ context.Context, _ database.Querier, question, facts string) (string, error) {
	f.facts = facts
	if strings.Contains(question, "parkir") {
		return "", nil // not in the facts
	}
	return "Jawaban AI untuk: " + question, nil
}

// Address, hours and price questions are answered from system data and the
// pending booking question follows; unknown questions go to the AI with the
// facts, and "ask admin" when it does not know.
func TestBotAnswersQuestionsFromSystemData(t *testing.T) {
	e := setupBot(t)
	if _, err := e.tx.Exec(e.ctx, `UPDATE configuration.branches SET address = 'Jl. Uji No. 7', city = 'Bandung' WHERE id = $1`, e.branch); err != nil {
		t.Fatal(err)
	}
	ai := &fakeAnswerer{}
	e.engine = wabot.NewEngine(wabot.Ports{Spa: e.spa, Sender: e.sender, Extractor: ai, AppURL: "https://paddy.test"}, nil, func() time.Time { return fixedNow })
	r := e.say("Kalau alamatnya dimana ya?")
	e.wants(r, "📍", "Jl. Uji No. 7, Bandung", "google.com/maps", "buka 10.00–20.00", "Lanjut booking — Boleh tahu nama")
	r = e.say("jam buka sampai jam berapa")
	e.wants(r, "setiap hari 10.00–20.00 WIB")
	r = e.say("harga reflexology berapa?")
	e.wants(r, "Daftar harga", "Reflexology · 45 menit — Rp 150.000")
	r = e.say("bisa bayar pakai qris?")
	e.wants(r, "di toko setelah layanan")
	r = e.say("kalau mau ubah jadwal gimana")
	e.wants(r, "1 jam sebelum")
	r = e.say("ada ruang keluarga ga?")
	e.wants(r, "Jawaban AI untuk: ada ruang keluarga ga?")
	if !strings.Contains(ai.facts, "Jl. Uji No. 7") || !strings.Contains(ai.facts, "Reflexology") || !strings.Contains(ai.facts, "KEBIJAKAN") {
		t.Fatalf("facts given to the AI: %s", ai.facts)
	}
	r = e.say("parkirnya luas?")
	e.wants(r, "belum punya jawabannya", "*admin*")
	r = e.say("terapisnya ada yang pria?") // a preference word alone is still a question
	e.wants(r, "Jawaban AI untuk: terapisnya ada yang pria?")
	// A booking-shaped question is not a FAQ: "bisa besok jam 3?" asks for a slot.
	e.say("1") // name
	e.say("2")
	e.say("1")
	r = e.say("bisa besok jam 3?")
	e.wants(r, "ringkasan")
}

// A party of three counts once against the per-phone cap (two earlier
// bookings + a group of three is fine); hitting the cap keeps the bot
// answering instead of handing over.
func TestBotGroupCountsOnceAgainstCap(t *testing.T) {
	e := setupBot(t)
	big := e.addOutlet("10:00", "20:00", 3)
	for _, at := range []string{"2026-10-09T03:00:00Z", "2026-10-09T09:00:00Z"} {
		when, _ := time.Parse(time.RFC3339, at)
		if _, err := e.spa.Book(e.ctx, spa.PublicBookingInput{BranchID: big, ScheduledAt: when, CustomerName: "Fajar Bot", CustomerPhone: e.phone,
			VariantIDs: []string{e.variant}, Source: "whatsapp"}); err != nil {
			t.Fatal(err)
		}
	}
	pick := "Go Test B" + smallSuffix(e, big)
	r := e.start()
	e.say(menuKey(t, r, pick))
	e.say("3")
	e.say("1")
	r = e.say("besok")
	e.wants(r, "Jam yang masih tersedia")
	e.say("1")
	r = e.say("ya")
	e.wants(r, "Kode booking")
	// Five bookings are now open: another visit is refused but the bot stays on.
	r = e.say("booking baru")
	e.say(menuKey(t, r, pick))
	e.say("1")
	e.say("1")
	e.say("besok")
	e.say("8")
	e.say("0")
	r = e.say("ya")
	e.wants(r, "terlalu banyak booking aktif", "Ketik *status*")
	var active bool
	if err := e.tx.QueryRow(e.ctx, `SELECT bot_active FROM crm.wa_conversations WHERE id = $1::uuid`, e.conv).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if !active {
		t.Fatal("the cap must not hand the conversation over")
	}
}

/* ── language ────────────────────────────────────────────────────────── */

// An English first message skips the language question; prompts, menus,
// dates and the summary follow in English, and "yes" books.
func TestBotEnglishFlow(t *testing.T) {
	e := setupBot(t)
	r := e.say("Hi, I'd like to book a massage for 2 people tomorrow afternoon")
	e.wants(r, "booking assistant", "May I have your name", "1. Use *Fajar Bot*")
	r = e.say("1")
	e.wants(r, "Choose a Paddy Experience service", "Reply with *one number*")
	r = e.say("1")
	e.wants(r, "Times still available on *Friday, 9 Oct 2026*", "(afternoon)")
	r = e.say("1")
	e.wants(r, "Here's your booking summary", "2 people", "• Name: *Fajar Bot*", "Reply *yes* to book")
	r = e.say("yes")
	e.wants(r, "Booking confirmed ✅", "Booking codes:", "Schedule: Friday, 9 Oct 2026", "see you at Paddy")
	r = e.say("where are you located?")
	e.wants(r, "📍", "(open 10.00–20.00)")
}

// The language menu: 2 = English; an unclear reply after the menu means Indonesian.
func TestBotLanguageMenu(t *testing.T) {
	e := setupBot(t)
	r := e.say("halo")
	e.wants(r, "Pilih bahasa / choose a language")
	r = e.say("2")
	// The bot name comes from crm_settings.bot_name (migration default; seeders/paddy-branding.js sets "Paddy Assistant").
	e.wants(r, "Assistant, Paddy Experience's booking assistant", "May I have your name")
	e2 := e.newConv("6281255500777", "Siti Aminah")
	e2.say("...")
	r = e2.say("ok")
	e2.wants(r, "Boleh tahu nama Anda", "1. Pakai nama *Siti Aminah*")
	r = e2.say("Nita")
	e2.wants(r, "Untuk berapa orang")
	var name string
	if err := e.tx.QueryRow(e.ctx, `SELECT state->>'name' FROM crm.wa_bot_sessions WHERE conversation_id = $1::uuid`, e2.conv).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "Nita" {
		t.Fatalf("typed name = %q", name)
	}
}

// "kembali" steps back one question; "booking baru" after a booking keeps
// the language and name.
func TestBotBackAndNewBooking(t *testing.T) {
	e := setupBot(t)
	e.start()
	e.say("2")
	r := e.say("1")
	e.wants(r, "Mau datang kapan?")
	r = e.say("kembali")
	e.wants(r, "Oke, kembali satu langkah.", "Pilih layanan")
	r = e.say("kembali")
	e.wants(r, "Untuk berapa orang?")
	e.say("1")
	e.say("1")
	e.say("besok")
	e.say("1")
	r = e.say("back") // at the therapist question: the time is undone
	e.wants(r, "Oke, kembali satu langkah.", "Jam yang masih tersedia")
	e.say("1")
	e.say("0")
	r = e.say("ya")
	e.wants(r, "Kode booking")
	// The done message says "ketik *booking*": that starts a new booking
	// instead of repeating the done message.
	r = e.say("Booking")
	e.wants(r, "Untuk berapa orang?")
	if strings.Contains(r, "sudah selesai") {
		t.Fatalf("\"booking\" after a finished booking repeated the done message:\n%s", r)
	}
	r = e.say("booking baru")
	e.wants(r, "Untuk berapa orang?") // name and language remembered: straight to the booking
	r = e.say("kembali")
	e.wants(r, "Tidak ada langkah")
}

// Commands are read anywhere in a short message; off-script messages go to
// the AI fallback, which names an intent or answers briefly without
// counting as a miss.
func TestBotOffScriptMessages(t *testing.T) {
	e := setupBot(t)
	ai := &fakeAnswerer{}
	e.engine = wabot.NewEngine(wabot.Ports{Spa: e.spa, Sender: e.sender, Extractor: ai, AppURL: "https://paddy.test"}, nil, func() time.Time { return fixedNow })
	e.start()
	e.say("2")
	r := e.say("Halo coba ulang ya") // command inside a short sentence (no AI needed)
	e.wants(r, "Untuk berapa orang?")
	if strings.Contains(r, "belum paham") {
		t.Fatalf("restart must not count as a miss: %s", r)
	}
	r = e.say("makasih ya kak") // chit-chat → AI reply + pending question, no miss
	e.wants(r, "Sama-sama! (Bahasa Indonesia)", "Lanjut booking — Untuk berapa orang?")
	if !strings.Contains(ai.pending, "Untuk berapa orang?") {
		t.Fatalf("pending question given to the AI: %q", ai.pending)
	}
	r = e.say("eh booking saya yang tadi gimana") // AI names the intent
	e.wants(r, "Belum ada booking di chat ini")
	var misses int
	if err := e.tx.QueryRow(e.ctx, `SELECT misses FROM crm.wa_bot_sessions WHERE conversation_id = $1::uuid`, e.conv).Scan(&misses); err != nil {
		t.Fatal(err)
	}
	if misses != 0 {
		t.Fatalf("misses = %d", misses)
	}
	r = e.say("xyzzy") // truly unknown: still a miss
	e.wants(r, "belum paham")
}

/* ── deposit (DP); runs with XENDIT_MOCK=1 ──────────────────────────── */

// With a deposit policy the bot skips the payment question: the
// confirmation carries the DP link and deadline, "sudah bayar" checks the
// DP, and a paid DP is reported with the remainder due at the outlet.
func TestBotDepositFlow(t *testing.T) {
	if _, _, enabled := e2Enabled(t); !enabled {
		t.Skip("needs XENDIT_MOCK=1")
	}
	e := setupBot(t)
	e.start()
	e.say("1")
	e.say("1")
	e.say("besok jam 10 pagi")
	r := e.say("0")
	e.wants(r, "ringkasan", "Booking fee (DP): *Rp 100.000*", "Sisa: *Rp 50.000* dibayar di toko")
	r = e.say("ya")
	e.wants(r, "Kode booking", "Jadwal dikunci setelah DP *Rp 100.000* dibayar", "bayar=dp-simulasi", "Sisa *Rp 50.000* dibayar di toko")
	if strings.Contains(r, "Mau bayar bagaimana?") {
		t.Fatalf("no payment menu with a deposit:\n%s", r)
	}
	r = e.say("sudah bayar")
	e.wants(r, "DP *PD-", "belum terlihat")
	var token string
	if err := e.tx.QueryRow(e.ctx, `SELECT public_token::text FROM spa.bookings WHERE customer_phone = $1 AND source = 'whatsapp'`, e.local()).Scan(&token); err != nil {
		t.Fatal(err)
	}
	if _, err := e.spa.svc.PublicMockPayDeposit(e.ctx, token); err != nil {
		t.Fatal(err)
	}
	r = e.say("sudah bayar")
	e.wants(r, "DP untuk booking *PD-", "sudah kami terima ✅", "Sisa *Rp 50.000*")
}

// e2Enabled reports whether the deposit policy is active in this run
// (XENDIT_MOCK=1 makes online payment "configured").
func e2Enabled(t *testing.T) (float64, int, bool) {
	t.Helper()
	deps := testutil.Deps(t, nil)
	tx := testutil.Tx(t)
	cfg, err := spa.NewService(tx, app.SpaPorts(), deps).DepositSettings(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return cfg.AmountIDR, cfg.HoldMinutes, cfg.Enabled
}

// A banned member (revisi R8) is told every day is full, with no other days,
// outlets or waitlist offered — and never that they are banned.
func TestBotBannedMemberSeesEveryDayFull(t *testing.T) {
	e := setupBot(t)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO pos.pos_customers (phone, name, member_type, banned_at, banned_reason)
	  VALUES ($1, 'Fajar Bot', 'registered', now(), 'uji')
	  ON CONFLICT (phone) DO UPDATE SET banned_at = now(), banned_reason = 'uji'`, e.local()); err != nil {
		t.Fatal(err)
	}
	e.start()
	e.say("1")
	e.say("1")
	r := e.say("besok")
	e.wants(r, "jadwal sudah penuh", "Coba tulis tanggal lain")
	for _, forbidden := range []string{"daftar tunggu", "Yang bisa saya tawarkan", "blokir", "banned"} {
		if strings.Contains(strings.ToLower(r), strings.ToLower(forbidden)) {
			t.Fatalf("banned member must not see %q:\n%s", forbidden, r)
		}
	}
	r = e.say("lusa")
	e.wants(r, "jadwal sudah penuh")
	// Unbanned: the same day has slots again.
	if _, err := e.tx.Exec(e.ctx, `UPDATE pos.pos_customers SET banned_at = NULL, banned_reason = NULL WHERE phone = $1`, e.local()); err != nil {
		t.Fatal(err)
	}
	r = e.say("besok")
	e.wants(r, "Jam yang masih tersedia")
}

// The guest chooses a room in the chat (revisi R6): it shows in the summary,
// is added to the total and lands on the booking.
func TestBotGuestChoosesRoom(t *testing.T) {
	e := setupBot(t)
	var roomID string
	if err := e.tx.QueryRow(e.ctx, `INSERT INTO spa.rooms (branch_id, name, capacity, price_idr) VALUES ($1, 'VIP Bot', 2, 100000) RETURNING id::text`,
		e.branch).Scan(&roomID); err != nil {
		t.Fatal(err)
	}
	e.start()
	e.say("1")
	e.say("1")
	e.say("besok jam 10 pagi")
	r := e.say("0") // crew member chosen by Paddy → the room question
	e.wants(r, "Mau pakai room tertentu?", "Tanpa room khusus", "VIP Bot · 2 orang · Rp 100.000")
	r = e.say("1")
	e.wants(r, "ringkasan", "Room: *VIP Bot* — Rp 100.000", "Total: *Rp 250.000*")
	// "kembali" from the summary asks the room again.
	r = e.say("kembali")
	e.wants(r, "Mau pakai room tertentu?")
	r = e.say("1")
	e.wants(r, "Room: *VIP Bot*")
	r = e.say("ya")
	e.wants(r, "Kode booking")
	var got string
	var price float64
	if err := e.tx.QueryRow(e.ctx, `SELECT room_id::text, room_price_idr::float8 FROM spa.bookings WHERE customer_phone = $1 AND source = 'whatsapp'`, e.local()).
		Scan(&got, &price); err != nil {
		t.Fatal(err)
	}
	if got != roomID || price != 100000 {
		t.Fatalf("booking room = %s / %v", got, price)
	}
}

// After payment the guest receives the booking QR as a picture, once.
func TestBotSendsBookingQRAfterPayment(t *testing.T) {
	e := setupBot(t)
	e.start()
	e.say("1")
	e.say("1")
	e.say("besok jam 10 pagi")
	e.say("0")
	r := e.say("ya")
	e.wants(r, "Kode booking")
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.bookings SET payment_status = 'paid' WHERE customer_phone = $1 AND source = 'whatsapp'`, e.local()); err != nil {
		t.Fatal(err)
	}
	list, err := e.spa.svc.UpcomingBookings(e.ctx, fixedNow, fixedNow.Add(72*time.Hour))
	if err != nil || len(list) == 0 {
		t.Fatalf("notices: %v %v", list, err)
	}
	var n spa.BookingNotice
	for _, x := range list {
		if x.Source == "whatsapp" {
			n = x
		}
	}
	e.sender.images = nil
	if err := e.engine.PaidNotice(e.ctx, e.tx, e.tx, n); err != nil {
		t.Fatal(err)
	}
	if len(e.sender.images) != 1 {
		t.Fatalf("images = %d", len(e.sender.images))
	}
	img := e.sender.images[0]
	if !strings.Contains(img.caption, "QR booking *"+n.Code+"*") || !strings.Contains(img.caption, "Tunjukkan QR ini ke kasir") ||
		!strings.HasSuffix(img.link, "/api/public/spa/bookings/"+n.Token+"/qr.png") || len(img.png) < 100 || string(img.png[1:4]) != "PNG" {
		t.Fatalf("QR image = %q %q %d bytes", img.caption, img.link, len(img.png))
	}
	// Sent once per booking.
	if err := e.engine.PaidNotice(e.ctx, e.tx, e.tx, n); err != nil || len(e.sender.images) != 1 {
		t.Fatalf("QR must be sent once: err=%v images=%d", err, len(e.sender.images))
	}
}

// Proactive notices are skipped (not failed, so the outbox does not retry)
// for numbers the provider may not write to first; nothing is claimed, so
// they go out once the guest has chatted.
func TestBotSkipsProactiveNoticesToNewNumbers(t *testing.T) {
	e := setupBot(t)
	n := spa.BookingNotice{ID: "0b6f1c2e-0000-4000-8000-0000000000ab", Code: "PD-TEST-NEW", CustomerName: "Baru", CustomerPhone: "081377778888",
		BranchName: "Paddy Uji", ScheduledAt: time.Date(2026, 10, 9, 3, 0, 0, 0, time.UTC), Items: []string{"Personalisasi Nama & Inisial · 30 menit"}, TotalIDR: 150000,
		Token: "tok", Source: "public", Status: "assigned", PaymentStatus: "paid"}
	e.sender.newNumbersBlocked = true
	if err := e.engine.PaidNotice(e.ctx, e.tx, e.tx, n); err != nil || len(e.sender.sent) != 0 {
		t.Fatalf("blocked: err=%v sent=%v", err, e.sender.sent)
	}
	if err := e.engine.DepositNotice(e.ctx, e.tx, e.tx, n, true); err != nil || len(e.sender.sent) != 0 {
		t.Fatalf("blocked DP notice: err=%v sent=%v", err, e.sender.sent)
	}
	e.sender.newNumbersBlocked = false
	if err := e.engine.PaidNotice(e.ctx, e.tx, e.tx, n); err != nil || len(e.sender.sent) != 1 {
		t.Fatalf("allowed later: err=%v sent=%v", err, e.sender.sent)
	}
}
