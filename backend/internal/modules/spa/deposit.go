package spa

import (
	"context"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
)

/* ── deposit (DP) for online bookings ────────────────────────────────── */

// Deposit statuses (spa.bookings.deposit_status).
const (
	DepositNone    = "none"
	DepositPending = "pending"
	DepositPaid    = "paid"
	DepositWaived  = "waived"
	DepositExpired = "expired"
)

// spaDepositPrefix marks deposit invoices (external_id) apart from full payments.
const spaDepositPrefix = "spa-dp-"

// TopicBookingDepositPaid / TopicBookingDepositExpired tell the WhatsApp
// bot (and anyone else) about a deposit outcome.
const (
	TopicBookingDepositPaid    = "spa.booking.deposit_paid"
	TopicBookingDepositExpired = "spa.booking.deposit_expired"
)

// Setting keys (configuration.app_settings).
const (
	depositAmountKey = "spa_deposit_idr"
	depositHoldKey   = "spa_deposit_hold_minutes"
)

// DepositSettings is the global DP policy for website/chat bookings.
type DepositSettings struct {
	AmountIDR   float64 `json:"amount_idr"`   // 0 = no deposit
	HoldMinutes int     `json:"hold_minutes"` // how long a pending booking keeps its slot
	// Enabled: a deposit can actually be collected (amount > 0 and online
	// payment configured).
	Enabled bool `json:"enabled"`
}

// DepositSettings reads the policy (defaults: Rp100.000, 60 minutes).
func (s *Service) DepositSettings(ctx context.Context) (DepositSettings, error) {
	return s.depositSettings(ctx, s.db)
}

func (s *Service) depositSettings(ctx context.Context, q Q) (DepositSettings, error) {
	out := DepositSettings{AmountIDR: 100000, HoldMinutes: 60}
	rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key IN ($1, $2)`, depositAmountKey, depositHoldKey)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var v *string
		if err := rows.Scan(&k, &v); err != nil {
			return out, err
		}
		if v == nil {
			continue
		}
		switch k {
		case depositAmountKey:
			if f, err := strconv.ParseFloat(strings.TrimSpace(*v), 64); err == nil && f >= 0 {
				out.AmountIDR = f
			}
		case depositHoldKey:
			if n, err := strconv.Atoi(strings.TrimSpace(*v)); err == nil && n > 0 {
				out.HoldMinutes = n
			}
		}
	}
	out.Enabled = out.AmountIDR > 0 && s.onlinePaymentReady()
	return out, rows.Err()
}

// SetDepositSettings stores the policy (staff with the outlets menu).
func (s *Service) SetDepositSettings(ctx context.Context, userID string, in DepositSettings) (DepositSettings, error) {
	if _, err := s.scope(ctx, userID); err != nil {
		return DepositSettings{}, err
	}
	if in.AmountIDR < 0 || in.AmountIDR > 10000000 {
		return DepositSettings{}, httpx.BadRequest("Nominal DP harus 0–10.000.000")
	}
	if in.HoldMinutes < 10 || in.HoldMinutes > 1440 {
		return DepositSettings{}, httpx.BadRequest("Batas waktu DP harus 10–1440 menit")
	}
	for key, value := range map[string]string{depositAmountKey: strconv.FormatFloat(in.AmountIDR, 'f', 0, 64), depositHoldKey: strconv.Itoa(in.HoldMinutes)} {
		if _, err := s.db.Exec(ctx, `INSERT INTO configuration.app_settings (key, value) VALUES ($1, $2)
		  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, value); err != nil {
			return DepositSettings{}, err
		}
	}
	return s.depositSettings(ctx, s.db)
}

// applyDeposit sets the DP requirement on a freshly inserted online booking.
func (s *Service) applyDeposit(ctx context.Context, q Q, bookingID string, now time.Time) error {
	cfg, err := s.depositSettings(ctx, q)
	if err != nil || !cfg.Enabled {
		return err
	}
	hold := now.Add(time.Duration(cfg.HoldMinutes) * time.Minute)
	if _, err := q.Exec(ctx, `UPDATE spa.bookings SET deposit_idr = $2, deposit_status = 'pending', deposit_hold_until = $3, updated_at = now()
	  WHERE id = $1`, bookingID, cfg.AmountIDR, hold); err != nil {
		return err
	}
	return s.st.event(ctx, q, bookingID, nil, "deposit_pending", nil, nil, "",
		"DP "+domainRupiah(cfg.AmountIDR)+" ditunggu sampai "+hold.In(domain.WIB).Format("02 Jan 15:04")+" WIB")
}

// DepositInfo is what the public page and the bot need about a DP.
type DepositInfo struct {
	AmountIDR  float64       `json:"deposit_idr"`
	Status     string        `json:"deposit_status"`
	PaidAt     *httpx.JSTime `json:"deposit_paid_at"`
	HoldUntil  *httpx.JSTime `json:"deposit_hold_until"`
	InvoiceURL *string       `json:"deposit_invoice_url"`
	// RemainingIDR is what is still due at the outlet (total minus a paid DP).
	RemainingIDR float64 `json:"remaining_idr"`
}

type depositRow struct {
	ID, Code, CustomerName, Status, PaymentStatus string
	Amount                                        float64
	DepositStatus                                 string
	HoldUntil, InvoiceExpires, PaidAt             *time.Time
	InvoiceID, InvoiceURL                         *string
}

func (store) depositRow(ctx context.Context, q Q, where string, arg any) (*depositRow, error) {
	var r depositRow
	err := q.QueryRow(ctx, `SELECT id::text, booking_code, customer_name, status, payment_status, deposit_idr::float8, deposit_status,
	    deposit_hold_until, deposit_invoice_expires_at, deposit_paid_at, deposit_invoice_id, deposit_invoice_url
	   FROM spa.bookings WHERE `+where+` FOR UPDATE`, arg).
		Scan(&r.ID, &r.Code, &r.CustomerName, &r.Status, &r.PaymentStatus, &r.Amount, &r.DepositStatus,
			&r.HoldUntil, &r.InvoiceExpires, &r.PaidAt, &r.InvoiceID, &r.InvoiceURL)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &r, err
}

// depositInfo fills the public/staff view of a booking's DP.
func (store) depositInfo(ctx context.Context, q Q, bookingID string, total float64, now time.Time) (DepositInfo, error) {
	var info DepositInfo
	var paidAt, holdUntil, invoiceExpires *time.Time
	var url *string
	err := q.QueryRow(ctx, `SELECT deposit_idr::float8, deposit_status, deposit_paid_at, deposit_hold_until, deposit_invoice_url, deposit_invoice_expires_at
	   FROM spa.bookings WHERE id = $1`, bookingID).Scan(&info.AmountIDR, &info.Status, &paidAt, &holdUntil, &url, &invoiceExpires)
	if err != nil {
		return info, err
	}
	if paidAt != nil {
		t := httpx.JSTime(*paidAt)
		info.PaidAt = &t
	}
	if holdUntil != nil {
		t := httpx.JSTime(*holdUntil)
		info.HoldUntil = &t
	}
	if info.Status == DepositPending && url != nil && (invoiceExpires == nil || invoiceExpires.After(now)) {
		info.InvoiceURL = url
	}
	info.RemainingIDR = total
	if info.Status == DepositPaid {
		info.RemainingIDR = total - info.AmountIDR
		if info.RemainingIDR < 0 {
			info.RemainingIDR = 0
		}
	}
	return info, nil
}

// PublicPayDeposit makes (or reuses) the DP invoice of a booking.
func (s *Service) PublicPayDeposit(ctx context.Context, token string) (*PublicPayment, error) {
	if !s.onlinePaymentReady() {
		return nil, httpx.Status(503, "Pembayaran online belum tersedia.")
	}
	now := s.clock()
	var b *depositRow
	var reuse *PublicPayment
	err := s.tx(ctx, func(q Q) error {
		var err error
		b, err = s.st.depositRow(ctx, q, `public_token = $1::uuid AND source IN ('public', 'whatsapp')`, token)
		if err != nil {
			return err
		}
		if b == nil {
			return httpx.NotFound("Booking tidak ditemukan")
		}
		if b.DepositStatus != DepositPending {
			return httpx.Conflict("Booking ini tidak menunggu DP")
		}
		if b.Status != domain.BookingUnassigned && b.Status != domain.BookingAssigned {
			return httpx.Conflict("Booking ini sudah tidak aktif")
		}
		if b.InvoiceURL != nil && b.InvoiceExpires != nil && b.InvoiceExpires.After(now.Add(invoiceReuseMargin)) {
			reuse = &PublicPayment{InvoiceURL: *b.InvoiceURL, Mock: strings.HasPrefix(deref(b.InvoiceID), "mock-")}
		}
		return nil
	})
	if err != nil || reuse != nil {
		return reuse, err
	}
	statusURL := appOrigin() + "/booking/spa/status/" + token
	inv, err := s.ports.Payments.CreateInvoice(ctx, InvoiceRequest{
		ExternalID:  spaDepositPrefix + b.ID,
		Amount:      b.Amount,
		PayerName:   b.CustomerName,
		Description: "DP booking Mizu " + b.Code,
		RedirectURL: statusURL,
	})
	if err != nil {
		if s.log != nil {
			s.log.Error("[spa] deposit invoice error", "booking", b.Code, "error", err)
		}
		return nil, httpx.Status(502, "Pembayaran DP sedang gangguan. Coba lagi sebentar.")
	}
	if inv.Mock {
		inv.URL = statusURL + "?bayar=dp-simulasi"
	}
	err = s.tx(ctx, func(q Q) error {
		if _, err := q.Exec(ctx, `UPDATE spa.bookings SET deposit_invoice_id = $2, deposit_invoice_url = $3, deposit_invoice_expires_at = $4, updated_at = now()
		  WHERE id = $1 AND deposit_status = 'pending'`, b.ID, inv.ID, inv.URL, inv.ExpiresAt); err != nil {
			return err
		}
		return s.st.event(ctx, q, b.ID, nil, "deposit_link", nil, nil, "", "Link DP dibuat (Xendit)")
	})
	if err != nil {
		return nil, err
	}
	return &PublicPayment{InvoiceURL: inv.URL, Mock: inv.Mock}, nil
}

// settleDeposit marks the DP paid (idempotent) and tells subscribers.
func (s *Service) settleDeposit(ctx context.Context, bookingID, invoiceID, via string) (bool, error) {
	settled := false
	err := s.tx(ctx, func(q Q) error {
		b, err := s.st.depositRow(ctx, q, `id = $1`, bookingID)
		if err != nil || b == nil || b.DepositStatus != DepositPending {
			return err
		}
		if _, err := q.Exec(ctx, `UPDATE spa.bookings SET deposit_status = 'paid', deposit_paid_at = now(), deposit_hold_until = NULL,
		    deposit_invoice_id = COALESCE(NULLIF($2, ''), deposit_invoice_id), updated_at = now() WHERE id = $1`, bookingID, invoiceID); err != nil {
			return err
		}
		if err := s.st.event(ctx, q, bookingID, nil, "deposit_paid", nil, nil, "", "DP "+domainRupiah(b.Amount)+" diterima ("+via+")"); err != nil {
			return err
		}
		settled = true
		n, err := s.st.notice(ctx, q, bookingID)
		if err != nil || n == nil {
			return err
		}
		return outbox.Publish(ctx, q, TopicBookingDepositPaid, bookingID, n)
	})
	return settled, err
}

// PublicMockPayDeposit settles the DP in XENDIT_MOCK mode.
func (s *Service) PublicMockPayDeposit(ctx context.Context, token string) (*PublicBookingResult, error) {
	if s.ports.Payments == nil || !s.ports.Payments.Mock() {
		return nil, httpx.NotFound("Tidak tersedia")
	}
	var id string
	var invoiceID *string
	err := s.db.QueryRow(ctx, `SELECT id::text, deposit_invoice_id FROM spa.bookings WHERE public_token = $1::uuid AND source IN ('public', 'whatsapp')`, token).Scan(&id, &invoiceID)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Booking tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	if invoiceID == nil || !strings.HasPrefix(*invoiceID, "mock-") {
		return nil, httpx.Conflict("Belum ada pembayaran DP simulasi untuk booking ini")
	}
	if _, err := s.settleDeposit(ctx, id, *invoiceID, "simulasi Xendit"); err != nil {
		return nil, err
	}
	return s.PublicBooking(ctx, token)
}

// ExpireDeposits cancels pending-DP bookings past their hold and frees the
// slots; it returns how many were cancelled.
func (s *Service) ExpireDeposits(ctx context.Context) (int, error) {
	now := s.clock()
	n := 0
	err := s.tx(ctx, func(q Q) error {
		rows, err := q.Query(ctx, `SELECT id::text, status FROM spa.bookings
		  WHERE deposit_status = 'pending' AND deposit_hold_until < $1 AND status IN ('unassigned', 'assigned')
		  FOR UPDATE SKIP LOCKED`, now)
		if err != nil {
			return err
		}
		type due struct{ id, status string }
		var list []due
		for rows.Next() {
			var d due
			if err := rows.Scan(&d.id, &d.status); err != nil {
				rows.Close()
				return err
			}
			list = append(list, d)
		}
		rows.Close()
		for _, d := range list {
			reason := "DP tidak dibayar dalam batas waktu"
			if err := s.st.cancelBooking(ctx, q, d.id, reason, now); err != nil {
				return err
			}
			if _, err := q.Exec(ctx, `UPDATE spa.bookings SET deposit_status = 'expired', updated_at = now() WHERE id = $1`, d.id); err != nil {
				return err
			}
			from := d.status
			if err := s.st.event(ctx, q, d.id, nil, "cancel", &from, ptr(domain.BookingCancelled), "", reason); err != nil {
				return err
			}
			if notice, err := s.st.notice(ctx, q, d.id); err != nil {
				return err
			} else if notice != nil {
				if err := outbox.Publish(ctx, q, TopicBookingDepositExpired, d.id, notice); err != nil {
					return err
				}
			}
			n++
		}
		return nil
	})
	return n, err
}

// SetDepositStatus is the front office's hand: "paid" records a DP received
// outside Xendit (transfer, cash), "waive" drops the requirement.
func (s *Service) SetDepositStatus(ctx context.Context, userID, id, action, note string) (*Booking, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	err = s.tx(ctx, func(q Q) error {
		b, err := s.lockBooking(ctx, q, sc, id)
		if err != nil {
			return err
		}
		if !domain.IsOpenBooking(b.Status) {
			return httpx.Conflict("Booking sudah ditutup")
		}
		row, err := s.st.depositRow(ctx, q, `id = $1`, id)
		if err != nil {
			return err
		}
		switch action {
		case "paid":
			if row.DepositStatus == DepositPaid {
				return httpx.Conflict("DP sudah tercatat diterima")
			}
			if _, err := q.Exec(ctx, `UPDATE spa.bookings SET deposit_status = 'paid', deposit_paid_at = now(), deposit_hold_until = NULL, deposit_note = $2, updated_at = now() WHERE id = $1`, id, note); err != nil {
				return err
			}
			return s.st.event(ctx, q, id, nil, "deposit_paid", nil, nil, userID, strings.TrimSpace("DP diterima manual. "+note))
		case "waive":
			if _, err := q.Exec(ctx, `UPDATE spa.bookings SET deposit_status = 'waived', deposit_hold_until = NULL, deposit_note = $2, updated_at = now() WHERE id = $1`, id, note); err != nil {
				return err
			}
			return s.st.event(ctx, q, id, nil, "deposit_waived", nil, nil, userID, strings.TrimSpace("DP dibebaskan. "+note))
		}
		return httpx.BadRequest("Aksi DP tidak dikenal")
	})
	if err != nil {
		return nil, err
	}
	return s.visibleBooking(ctx, sc, id)
}

// paidDeposit is the DP already collected for a booking (0 when none).
func (store) paidDeposit(ctx context.Context, q Q, bookingID string) (float64, error) {
	var amount float64
	err := q.QueryRow(ctx, `SELECT CASE WHEN deposit_status = 'paid' THEN deposit_idr ELSE 0 END::float8 FROM spa.bookings WHERE id = $1`, bookingID).Scan(&amount)
	return amount, err
}

func domainRupiah(v float64) string {
	n := int64(v + 0.5)
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return "Rp" + b.String()
}
