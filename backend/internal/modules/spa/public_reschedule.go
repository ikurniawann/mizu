package spa

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/ratelimit"
	"nuhabit/backend/internal/platform/validate"
)

// Self-service changes to a website booking. A guest reschedules up to one
// hour before the visit (paid online or not, as long as the cashier has not
// opened the bill); cancelling stays a day ahead and only while unpaid.
// The guest proves ownership with the booking code plus the WhatsApp number
// used to book (/booking/spa/ubah), or with the WhatsApp code on the status page.
const (
	PublicRescheduleCutoff = time.Hour
	PublicCancelCutoff     = 24 * time.Hour
)

// PublicLookup is POST /api/public/spa/bookings/find: the booking's status
// link token plus a one-off, 15-minute grant to change it.
type PublicLookup struct {
	AccessToken string `json:"access_token"`
	Grant       string `json:"grant"`
}

var bookingCodePattern = regexp.MustCompile(`^MZ-\d{6}-[A-Z0-9]{4}$`)

// normalizeBookingCode accepts "mz 261012 fh2u", "MZ-261012-FH2U", …
func normalizeBookingCode(raw string) string {
	s := strings.ToUpper(strings.Join(strings.Fields(raw), ""))
	s = strings.ReplaceAll(s, "-", "")
	if len(s) == 12 && strings.HasPrefix(s, "MZ") {
		s = s[:2] + "-" + s[2:8] + "-" + s[8:]
	}
	return s
}

// PublicFindBooking matches a booking code with the booker's phone number.
// A mismatch never says which half was wrong.
func (s *Service) PublicFindBooking(ctx context.Context, code, phone string) (*PublicLookup, error) {
	code = normalizeBookingCode(code)
	phone = domain.NormalizePhone(phone)
	notFound := httpx.NotFound("Kode booking atau nomor WhatsApp tidak cocok")
	if !bookingCodePattern.MatchString(code) || phone == "" {
		return nil, notFound
	}
	grant := newUUID()
	digest := sha256.Sum256([]byte(grant))
	var token string
	err := s.tx(ctx, func(q Q) error {
		var id string
		err := q.QueryRow(ctx, `SELECT id::text, public_token::text FROM spa.bookings
		  WHERE booking_code = $1 AND customer_phone = $2 AND source = 'public'`, code, phone).Scan(&id, &token)
		if database.IsNoRows(err) {
			return notFound
		}
		if err != nil {
			return err
		}
		// The code + phone check stands in for the WhatsApp code: record it as an
		// already-verified challenge carrying the grant.
		_, err = q.Exec(ctx, `INSERT INTO spa.public_booking_challenges
		    (booking_id, code_hash, expires_at, consumed_at, grant_hash, grant_expires_at)
		  VALUES ($1, 'booking-code', now(), now(), $2, now() + interval '15 minutes')`, id, hex.EncodeToString(digest[:]))
		return err
	})
	if err != nil {
		return nil, err
	}
	return &PublicLookup{AccessToken: token, Grant: grant}, nil
}

// rescheduleBlocked explains why a booking cannot be moved now ("" = allowed).
func rescheduleBlocked(b *bookingRow, now time.Time) string {
	switch {
	case b.Status != domain.BookingUnassigned && b.Status != domain.BookingAssigned:
		return "Booking ini sudah berjalan, selesai atau dibatalkan"
	case b.PosOrderID != nil:
		return "Tagihan sudah dibuka di kasir. Hubungi outlet untuk mengubah jadwal"
	case b.ScheduledAt.Sub(now) < PublicRescheduleCutoff:
		return "Jadwal hanya bisa diubah paling lambat 1 jam sebelum kunjungan. Hubungi outlet"
	}
	return ""
}

// newUUID is a random (v4) UUID, the grant format POST …/change validates.
func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b[:])
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

func clientIP(h http.Header) string {
	if ip := strings.TrimSpace(h.Get("cf-connecting-ip")); ip != "" {
		return ip
	}
	if first := strings.TrimSpace(strings.Split(h.Get("x-forwarded-for"), ",")[0]); first != "" {
		return first
	}
	return strings.TrimSpace(h.Get("x-real-ip"))
}

// publicFindBooking: 10 lookups per IP per 10 minutes (codes are short).
func (h *Handler) publicFindBooking(w http.ResponseWriter, r *http.Request) error {
	allowed, _, err := ratelimit.New(h.svc.db).Sliding(r.Context(), "spa-find-booking:"+clientIP(r.Header), 10, 10*time.Minute, h.svc.clock())
	if err != nil {
		return err
	}
	if !allowed {
		return httpx.Status(http.StatusTooManyRequests, "Terlalu banyak percobaan. Coba lagi dalam 10 menit")
	}
	f := body(r)
	code := str(f.Str("booking_code", req, validate.StrOpts{Trim: true, Min: 6, Max: 30}))
	phone := str(f.Str("phone", req, validate.StrOpts{Trim: true, Min: 8, Max: 30}))
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	found, err := h.svc.PublicFindBooking(r.Context(), code, phone)
	if err != nil {
		return err
	}
	return ok(w, found)
}
