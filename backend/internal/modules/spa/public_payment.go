package spa

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/validate"
)

// Public therapist choice and online payment (Xendit invoice) for website
// bookings. Paying online settles the booking without a POS order; paying at
// the outlet keeps the POS checkout.

const (
	PaymentAtOutlet = "outlet"
	PaymentOnline   = "online"

	spaInvoicePrefix = "spa-booking-"
	// A link younger than this is reused instead of creating a new invoice.
	invoiceReuseMargin = 5 * time.Minute
)

// PublicTherapist is a therapist a guest may pick for a slot; only a short
// display name is public.
type PublicTherapist struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Gender *string `json:"gender"`
}

// PublicPayment is POST /api/public/spa/bookings/{token}/pay.
type PublicPayment struct {
	InvoiceURL string `json:"invoice_url"`
	Mock       bool   `json:"mock"`
}

// InvoiceCallback is the part of a Xendit invoice callback spa reads.
type InvoiceCallback struct {
	ID         string
	ExternalID string
	Status     string
	PaidAmount *float64
}

// publicName is "Ayu L." from "Ayu Lestari": enough to recognise, no full name.
func publicName(full string) string {
	parts := strings.Fields(full)
	switch len(parts) {
	case 0:
		return "Terapis"
	case 1:
		return parts[0]
	default:
		return parts[0] + " " + string([]rune(parts[len(parts)-1])[:1]) + "."
	}
}

// PublicTherapists lists the therapists free for the whole visit starting at
// startsAt: on duty at the outlet that day, inside their shift, matching the
// gender preference and without an overlapping booking. A full slot (no
// capacity left for reservations already waiting) lists nobody.
func (s *Service) PublicTherapists(ctx context.Context, branchID string, startsAt time.Time, variantIDs []string, pref string) ([]PublicTherapist, error) {
	if _, err := s.publicOutlet(ctx, s.db, branchID); err != nil {
		return nil, err
	}
	reqs := make([]itemRequest, len(variantIDs))
	for i, id := range variantIDs {
		reqs[i] = itemRequest{VariantID: id}
	}
	items, err := s.planItems(ctx, s.db, branchID, startsAt, reqs)
	if err != nil {
		return nil, err
	}
	available, err := s.publicCapacity(ctx, s.db, branchID, items, pref)
	if err != nil || !available {
		return []PublicTherapist{}, err
	}
	rows := make([]itemRow, len(items))
	for i, item := range items {
		rows[i] = itemRow{DurationMin: item.Variant.DurationMin, Status: item.Status}
	}
	iv, err := bookingInterval(startsAt, rows)
	if err != nil {
		return nil, err
	}
	free, err := s.freeTherapists(ctx, s.db, branchID, iv, pref)
	if err != nil {
		return nil, err
	}
	out := make([]PublicTherapist, len(free))
	for i, t := range free {
		out[i] = PublicTherapist{ID: t.ID, Name: publicName(t.FullName), Gender: t.Gender}
	}
	return out, nil
}

// freeTherapists applies checkBookingTherapist's rules to every eligible
// therapist at once.
func (s *Service) freeTherapists(ctx context.Context, q Q, branchID string, iv domain.Interval, pref string) ([]Therapist, error) {
	eligible, err := s.st.eligibleTherapists(ctx, q, branchID, domain.WIBDate(iv.Start))
	if err != nil {
		return nil, err
	}
	candidates := make([]Therapist, 0, len(eligible))
	ids := make([]string, 0, len(eligible))
	employees := make([]string, 0, len(eligible))
	for _, t := range eligible {
		if pref != "any" && (t.Gender == nil || *t.Gender != pref) {
			continue
		}
		candidates = append(candidates, t.Therapist)
		ids = append(ids, t.ID)
		employees = append(employees, t.EmployeeID)
	}
	if len(candidates) == 0 {
		return []Therapist{}, nil
	}
	rosters, err := s.ports.People.Rosters(ctx, q, employees, domain.WIBDate(iv.Start))
	if err != nil {
		return nil, err
	}
	conflicts, err := s.st.bookingConflicts(ctx, q, ids, iv.Start, iv.End, "")
	if err != nil {
		return nil, err
	}
	local := iv.Start.In(domain.WIB)
	visitStart := local.Hour()*60 + local.Minute()
	visitEnd := visitStart + int(iv.End.Sub(iv.Start)/time.Minute)
	free := make([]Therapist, 0, len(candidates))
	for _, t := range candidates {
		roster := rosters[t.EmployeeID]
		if roster.OnLeave || roster.DayOff || len(conflicts[t.ID]) > 0 {
			continue
		}
		if shift := roster.Shift; shift != nil {
			start, startOK := domain.ClockMinutes(shift.StartTime)
			end, endOK := domain.ClockMinutes(shift.EndTime)
			if startOK && endOK {
				if end <= start {
					end = 24 * 60
				}
				if visitStart < start || visitEnd > end {
					continue
				}
			}
		}
		free = append(free, t)
	}
	// Bookings still waiting for a therapist reserve capacity (as in
	// publicCapacity): that many of the free therapists are spoken for.
	reserved, err := s.st.unassignedOverlaps(ctx, q, branchID, iv.Start, iv.End)
	if err != nil {
		return nil, err
	}
	if reserved >= len(free) {
		return []Therapist{}, nil
	}
	return free[:len(free)-reserved], nil
}

func (s *Service) onlinePaymentReady() bool {
	return s.ports.Payments != nil && s.ports.Payments.Configured()
}

// OnlinePaymentReady reports whether guests can pay online (other contexts).
func (s *Service) OnlinePaymentReady() bool { return s.onlinePaymentReady() }

// appOrigin is the public site the invoice sends the guest back to.
func appOrigin() string {
	origin := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL"))
	if origin == "" {
		origin = strings.TrimSpace(os.Getenv("NEXT_PUBLIC_BASE_URL"))
	}
	return strings.TrimRight(origin, "/")
}

type payRow struct {
	ID, Code, CustomerName, Status, PaymentStatus string
	PosOrderID                                    *string
	InvoiceID, InvoiceURL                         *string
	InvoiceAmount                                 *float64
	InvoiceExpires                                *time.Time
}

func (store) payRow(ctx context.Context, q Q, where string, arg any) (*payRow, error) {
	var b payRow
	err := q.QueryRow(ctx, `SELECT id::text, booking_code, customer_name, status, payment_status, pos_order_id::text,
	    xendit_invoice_id, xendit_invoice_url, invoice_amount_idr::float8, invoice_expires_at
	   FROM spa.bookings WHERE `+where+` FOR UPDATE`, arg).
		Scan(&b.ID, &b.Code, &b.CustomerName, &b.Status, &b.PaymentStatus, &b.PosOrderID,
			&b.InvoiceID, &b.InvoiceURL, &b.InvoiceAmount, &b.InvoiceExpires)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &b, err
}

func (store) activeTotal(ctx context.Context, q Q, bookingID string) (float64, error) {
	var total float64
	err := q.QueryRow(ctx, `SELECT (COALESCE((SELECT sum(price_idr) FROM spa.booking_items WHERE booking_id = $1 AND status <> 'cancelled'), 0)
	    + COALESCE((SELECT room_price_idr FROM spa.bookings WHERE id = $1), 0))::float8`, bookingID).Scan(&total)
	return total, err
}

// PublicPay returns a payment link for an unpaid booking: the live one when
// it still has time, otherwise a new Xendit invoice for the current total.
func (s *Service) PublicPay(ctx context.Context, token string) (*PublicPayment, error) {
	if !s.onlinePaymentReady() {
		return nil, httpx.Status(503, "Pembayaran online belum tersedia. Silakan bayar di outlet.")
	}
	now := s.clock()
	var b *payRow
	var total float64
	var reuse *PublicPayment
	err := s.tx(ctx, func(q Q) error {
		var err error
		b, err = s.st.payRow(ctx, q, `public_token = $1::uuid AND source IN ('public', 'whatsapp')`, token)
		if err != nil {
			return err
		}
		if b == nil {
			return httpx.NotFound("Booking tidak ditemukan")
		}
		if b.Status != domain.BookingUnassigned && b.Status != domain.BookingAssigned {
			return httpx.Conflict("Booking ini tidak bisa dibayar online lagi")
		}
		if b.PaymentStatus != domain.PaymentUnpaid {
			return httpx.Conflict("Booking ini sudah dibayar")
		}
		if b.PosOrderID != nil {
			return httpx.Conflict("Tagihan sudah dibuka di kasir outlet. Silakan bayar di outlet.")
		}
		if total, err = s.st.activeTotal(ctx, q, b.ID); err != nil {
			return err
		}
		prepaid, err := s.st.paidDeposit(ctx, q, b.ID)
		if err != nil {
			return err
		}
		total -= prepaid
		if total <= 0 {
			return httpx.Conflict("Booking tidak memiliki treatment aktif")
		}
		if b.InvoiceURL != nil && b.InvoiceExpires != nil && b.InvoiceExpires.After(now.Add(invoiceReuseMargin)) &&
			b.InvoiceAmount != nil && *b.InvoiceAmount == total {
			reuse = &PublicPayment{InvoiceURL: *b.InvoiceURL, Mock: strings.HasPrefix(deref(b.InvoiceID), "mock-")}
		}
		return nil
	})
	if err != nil || reuse != nil {
		return reuse, err
	}

	statusURL := appOrigin() + "/booking/spa/status/" + token
	inv, err := s.ports.Payments.CreateInvoice(ctx, InvoiceRequest{
		ExternalID:  spaInvoicePrefix + b.ID,
		Amount:      total,
		PayerName:   b.CustomerName,
		Description: "Booking Mizu " + b.Code,
		RedirectURL: statusURL,
	})
	if err != nil {
		if s.log != nil {
			s.log.Error("[spa] invoice error", "booking", b.Code, "error", err)
		}
		return nil, httpx.Status(502, "Pembayaran online sedang gangguan. Coba lagi, atau bayar di outlet.")
	}
	if inv.Mock {
		// No hosted page exists in mock mode: the status page simulates it.
		inv.URL = statusURL + "?bayar=simulasi"
	}
	err = s.tx(ctx, func(q Q) error {
		tag, err := q.Exec(ctx, `UPDATE spa.bookings SET payment_method = 'online', xendit_invoice_id = $2,
		    xendit_invoice_url = $3, invoice_amount_idr = $4, invoice_expires_at = $5, updated_at = now()
		  WHERE id = $1 AND payment_status = 'unpaid'`, b.ID, inv.ID, inv.URL, total, inv.ExpiresAt)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.Conflict("Booking ini sudah dibayar")
		}
		return s.st.event(ctx, q, b.ID, nil, "payment_link", nil, nil, "", "Link bayar online dibuat (Xendit)")
	})
	if err != nil {
		return nil, err
	}
	return &PublicPayment{InvoiceURL: inv.URL, Mock: inv.Mock}, nil
}

// settleOnline marks a booking paid by its Xendit invoice. It is idempotent:
// a booking already paid is left alone. A paid amount below the invoice is
// refused (logged) rather than settled.
func (s *Service) settleOnline(ctx context.Context, bookingID, invoiceID string, paid *float64, via string) (bool, error) {
	settled := false
	err := s.tx(ctx, func(q Q) error {
		b, err := s.st.payRow(ctx, q, `id = $1`, bookingID)
		if err != nil || b == nil || b.PaymentStatus != domain.PaymentUnpaid {
			return err
		}
		if paid != nil && b.InvoiceAmount != nil && *paid+0.5 < *b.InvoiceAmount {
			if s.log != nil {
				s.log.Error("[spa] Xendit PAID below invoice amount", "booking", b.Code, "paid", *paid, "invoice", *b.InvoiceAmount)
			}
			return nil
		}
		if _, err := q.Exec(ctx, `UPDATE spa.bookings SET payment_status = 'paid', payment_method = 'online',
		    paid_at = COALESCE(paid_at, now()), paid_online_at = now(),
		    xendit_invoice_id = COALESCE(NULLIF($2, ''), xendit_invoice_id), updated_at = now()
		  WHERE id = $1 AND payment_status = 'unpaid'`, b.ID, invoiceID); err != nil {
			return err
		}
		note := "Dibayar online (" + via + ")"
		if !domain.IsOpenBooking(b.Status) {
			note += " setelah booking " + b.Status + " — perlu refund"
		}
		settled = true
		if err := s.st.event(ctx, q, b.ID, nil, "paid", ptr(domain.PaymentUnpaid), ptr(domain.PaymentPaid), "", note); err != nil {
			return err
		}
		// Tell the guest (WhatsApp bot subscribes; EPIC-053).
		if n, err := s.st.notice(ctx, q, b.ID); err != nil {
			return err
		} else if n != nil {
			return outbox.Publish(ctx, q, TopicBookingPaidOnline, b.ID, n)
		}
		return nil
	})
	return settled, err
}

// PublicInvoiceCallback handles a Xendit invoice callback for spa bookings.
// It reports what happened; other prefixes are ignored for other modules.
func (s *Service) PublicInvoiceCallback(ctx context.Context, cb InvoiceCallback) (string, error) {
	if !strings.HasPrefix(cb.ExternalID, spaInvoicePrefix) && !strings.HasPrefix(cb.ExternalID, spaDepositPrefix) {
		return "ignored", nil
	}
	id := strings.TrimPrefix(strings.TrimPrefix(cb.ExternalID, spaInvoicePrefix), spaDepositPrefix)
	if !validate.IsUUID(id) {
		return "ignored", nil
	}
	if strings.HasPrefix(cb.ExternalID, spaDepositPrefix) {
		return s.depositCallback(ctx, id, cb)
	}
	switch strings.ToUpper(cb.Status) {
	case "PAID", "SETTLED":
		settled, err := s.settleOnline(ctx, id, cb.ID, cb.PaidAmount, "Xendit")
		if err != nil {
			return "", err
		}
		if settled {
			return "paid", nil
		}
		return "unchanged", nil
	case "EXPIRED":
		_, err := s.db.Exec(ctx, `UPDATE spa.bookings SET xendit_invoice_url = NULL, updated_at = now()
		  WHERE id = $1 AND xendit_invoice_id = $2 AND payment_status = 'unpaid'`, id, cb.ID)
		return "expired", err
	}
	return "ignored", nil
}

// depositCallback settles or expires a DP invoice.
func (s *Service) depositCallback(ctx context.Context, id string, cb InvoiceCallback) (string, error) {
	switch strings.ToUpper(cb.Status) {
	case "PAID", "SETTLED":
		settled, err := s.settleDeposit(ctx, id, cb.ID, "Xendit")
		if err != nil {
			return "", err
		}
		if settled {
			return "deposit_paid", nil
		}
		return "unchanged", nil
	case "EXPIRED":
		_, err := s.db.Exec(ctx, `UPDATE spa.bookings SET deposit_invoice_url = NULL, updated_at = now()
		  WHERE id = $1 AND deposit_invoice_id = $2 AND deposit_status = 'pending'`, id, cb.ID)
		return "expired", err
	}
	return "ignored", nil
}

// syncOnlinePayment asks Xendit about a pending invoice when the guest opens
// the status page (back from the payment page before the webhook lands).
func (s *Service) syncOnlinePayment(ctx context.Context, token string) {
	if !s.onlinePaymentReady() {
		return
	}
	var id string
	var invoiceID *string
	var amount *float64
	err := s.db.QueryRow(ctx, `SELECT id::text, xendit_invoice_id, invoice_amount_idr::float8 FROM spa.bookings
	  WHERE public_token = $1::uuid AND payment_method = 'online' AND payment_status = 'unpaid'
	    AND xendit_invoice_id IS NOT NULL AND invoice_expires_at > now() - interval '1 day'`, token).
		Scan(&id, &invoiceID, &amount)
	if err != nil || invoiceID == nil || strings.HasPrefix(*invoiceID, "mock-") {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	status, err := s.ports.Payments.InvoiceStatus(ctx, *invoiceID)
	if err == nil && (status == "PAID" || status == "SETTLED") {
		_, err = s.settleOnline(ctx, id, *invoiceID, amount, "Xendit")
	}
	if err != nil && s.log != nil && !errors.Is(err, context.Canceled) {
		s.log.Warn("[spa] invoice sync", "error", err)
	}
}

// PublicMockPay completes a simulated payment (XENDIT_MOCK=1 only).
func (s *Service) PublicMockPay(ctx context.Context, token string) (*PublicBookingResult, error) {
	if s.ports.Payments == nil || !s.ports.Payments.Mock() {
		return nil, httpx.NotFound("Tidak tersedia")
	}
	var id string
	var invoiceID *string
	var amount *float64
	err := s.db.QueryRow(ctx, `SELECT id::text, xendit_invoice_id, invoice_amount_idr::float8 FROM spa.bookings
	  WHERE public_token = $1::uuid AND source IN ('public', 'whatsapp')`, token).Scan(&id, &invoiceID, &amount)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Booking tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	if invoiceID == nil || !strings.HasPrefix(*invoiceID, "mock-") {
		return nil, httpx.Conflict("Belum ada pembayaran simulasi untuk booking ini")
	}
	if _, err := s.settleOnline(ctx, id, *invoiceID, amount, "simulasi Xendit"); err != nil {
		return nil, err
	}
	return s.PublicBooking(ctx, token)
}
