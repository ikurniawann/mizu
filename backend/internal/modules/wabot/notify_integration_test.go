package wabot_test

import (
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/spa"
)

// Reminders go out once per window to guests who booked by chat/website.
func TestBotRemindsUpcomingBookingsOnce(t *testing.T) {
	e := setupBot(t)
	e.say("halo")
	e.say("1")
	e.say("1")
	r := e.say("besok jam 10 pagi") // 2026-10-09 10:00 WIB = 25h after fixedNow (09:00 WIB on the 8th)
	e.wants(r, "Pilihkan oleh Mizu")
	e.say("0")
	r = e.say("ya")
	e.wants(r, "Kode booking")
	e.sender.sent = nil
	n, err := e.engine.RemindUpcoming(e.ctx, e.tx)
	if err != nil || n != 1 || len(e.sender.sent) != 1 {
		t.Fatalf("H-1 reminder: n=%d err=%v sent=%d", n, err, len(e.sender.sent))
	}
	msg := e.sender.sent[0]
	if !strings.Contains(msg, "Pengingat: besok *Jumat, 9 Okt 2026* jam *10.00*") || !strings.Contains(msg, "Reflexology") || !strings.Contains(msg, "/booking/spa/status/") {
		t.Fatalf("reminder text: %s", msg)
	}
	// Same window again: nothing (claimed in configuration.wa_notif_log).
	e.sender.sent = nil
	if n, err := e.engine.RemindUpcoming(e.ctx, e.tx); err != nil || n != 0 || len(e.sender.sent) != 0 {
		t.Fatalf("duplicate reminder: n=%d err=%v sent=%d", n, err, len(e.sender.sent))
	}
	// Switch the notices off: no 2-hour reminder either.
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO crm.crm_settings (key, value) VALUES ('bot_notify_customer', 'false'::jsonb)
	  ON CONFLICT (key) DO UPDATE SET value = 'false'::jsonb`); err != nil {
		t.Fatal(err)
	}
	if n, err := e.engine.RemindUpcoming(e.ctx, e.tx); err != nil || n != 0 {
		t.Fatalf("notices off: n=%d err=%v", n, err)
	}
}

// A settled online payment produces a WhatsApp confirmation, once.
func TestBotPaidNoticeOnce(t *testing.T) {
	e := setupBot(t)
	n := spa.BookingNotice{ID: "0b6f1c2e-0000-4000-8000-000000000001", Code: "MZ-TEST-PAID", CustomerName: "Fajar", CustomerPhone: "0812" + e.phone[4:],
		BranchName: "Mizu Uji", ScheduledAt: time.Date(2026, 10, 9, 3, 0, 0, 0, time.UTC), Items: []string{"Reflexology · 45 menit"}, TotalIDR: 150000,
		Token: "tok", Source: "whatsapp", Status: "assigned", PaymentStatus: "paid"}
	if err := e.engine.PaidNotice(e.ctx, e.tx, e.tx, n); err != nil {
		t.Fatal(err)
	}
	if len(e.sender.sent) != 1 || !strings.Contains(e.sender.sent[0], "Pembayaran diterima ✅ Terima kasih, Fajar!") || !strings.Contains(e.sender.sent[0], "MZ-TEST-PAID") || !strings.Contains(e.sender.sent[0], "Rp150.000") {
		t.Fatalf("paid notice: %v", e.sender.sent)
	}
	if err := e.engine.PaidNotice(e.ctx, e.tx, e.tx, n); err != nil || len(e.sender.sent) != 1 {
		t.Fatalf("paid notice must be sent once: err=%v sent=%d", err, len(e.sender.sent))
	}
	n.Source = "front_office"
	n.ID = "0b6f1c2e-0000-4000-8000-000000000002"
	if err := e.engine.PaidNotice(e.ctx, e.tx, e.tx, n); err != nil || len(e.sender.sent) != 1 {
		t.Fatalf("front-office bookings get no bot notice: err=%v sent=%d", err, len(e.sender.sent))
	}
}
