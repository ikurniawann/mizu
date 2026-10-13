package spa

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
)

/* ── customer notices (EPIC-053: WA confirmation & reminders) ────────── */

// TopicBookingPaidOnline is published when an online invoice is settled.
// Subscribers (the WhatsApp bot) tell the guest; the payload is a
// BookingNotice so they need no further lookup.
const TopicBookingPaidOnline = "spa.booking.paid_online"

// BookingNotice is what a customer-facing message needs about a booking.
type BookingNotice struct {
	ID            string    `json:"id"`
	Code          string    `json:"code"`
	CustomerName  string    `json:"customer_name"`
	CustomerPhone string    `json:"customer_phone"` // local format (0812…)
	BranchName    string    `json:"branch_name"`
	ScheduledAt   time.Time `json:"scheduled_at"`
	Items         []string  `json:"items"` // "Reflexology · 45 menit"
	TotalIDR      float64   `json:"total_idr"`
	Token         string    `json:"token"` // public status page token
	Source        string    `json:"source"`
	Status        string    `json:"status"`
	PaymentStatus string    `json:"payment_status"`
	DepositIDR    float64   `json:"deposit_idr"`
	DepositStatus string    `json:"deposit_status"`
}

const noticeSelect = `SELECT b.id::text, b.booking_code, b.customer_name, COALESCE(b.customer_phone, ''), COALESCE(br.name, ''),
	    b.scheduled_at, COALESCE(b.public_token::text, ''), b.source, b.status, b.payment_status,
	    COALESCE((SELECT array_agg(i.treatment_name || ' · ' || i.variant_name ORDER BY i.sort_order)
	              FROM spa.booking_items i WHERE i.booking_id = b.id AND i.status <> 'cancelled'), '{}'),
	    COALESCE((SELECT sum(i.price_idr)::float8 FROM spa.booking_items i WHERE i.booking_id = b.id AND i.status <> 'cancelled'), 0),
	    b.deposit_idr::float8, b.deposit_status
	   FROM spa.bookings b LEFT JOIN configuration.branches br ON br.id = b.branch_id`

func scanNotice(row interface{ Scan(...any) error }) (*BookingNotice, error) {
	var n BookingNotice
	if err := row.Scan(&n.ID, &n.Code, &n.CustomerName, &n.CustomerPhone, &n.BranchName, &n.ScheduledAt, &n.Token,
		&n.Source, &n.Status, &n.PaymentStatus, &n.Items, &n.TotalIDR, &n.DepositIDR, &n.DepositStatus); err != nil {
		return nil, err
	}
	if n.Items == nil {
		n.Items = []string{}
	}
	return &n, nil
}

func (store) notice(ctx context.Context, q Q, bookingID string) (*BookingNotice, error) {
	n, err := scanNotice(q.QueryRow(ctx, noticeSelect+` WHERE b.id = $1`, bookingID))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return n, err
}

// UpcomingBookings lists open bookings made by guests themselves (website or
// chat) that start within [from, to), for reminders. Front-office bookings
// are left to the outlet.
func (s *Service) UpcomingBookings(ctx context.Context, from, to time.Time) ([]BookingNotice, error) {
	rows, err := s.db.Query(ctx, noticeSelect+` WHERE b.scheduled_at >= $1 AND b.scheduled_at < $2
	   AND b.status IN ($3, $4) AND b.source IN ('public', 'whatsapp') AND COALESCE(b.customer_phone, '') <> ''
	   ORDER BY b.scheduled_at LIMIT 500`, from, to, domain.BookingUnassigned, domain.BookingAssigned)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BookingNotice{}
	for rows.Next() {
		n, err := scanNotice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *n)
	}
	return out, rows.Err()
}
