package spa

import (
	"context"
	"net/http"
	"regexp"

	"rsc.io/qr"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// BookingQRPNG is the booking's QR (the booking code, as on the status page)
// as a PNG for WhatsApp: the receptionist scans it at check-in.
func BookingQRPNG(code string) ([]byte, error) {
	c, err := qr.Encode(code, qr.M)
	if err != nil {
		return nil, err
	}
	c.Scale = 12
	return c.PNG(), nil
}

// PublicBookingQR returns the QR PNG and booking code for a public token.
func (s *Service) PublicBookingQR(ctx context.Context, token string) ([]byte, string, error) {
	if !uuidPattern.MatchString(token) {
		return nil, "", httpx.NotFound("Booking tidak ditemukan")
	}
	var code string
	err := s.db.QueryRow(ctx, `SELECT booking_code FROM spa.bookings
	  WHERE public_token = $1::uuid AND source IN ('public', 'whatsapp') AND status <> 'cancelled'`, token).Scan(&code)
	if database.IsNoRows(err) {
		return nil, "", httpx.NotFound("Booking tidak ditemukan")
	}
	if err != nil {
		return nil, "", err
	}
	png, err := BookingQRPNG(code)
	return png, code, err
}

// publicBookingQR: GET /api/public/spa/bookings/{token}/qr.png (Meta sends
// the image by this link).
func (h *Handler) publicBookingQR(w http.ResponseWriter, r *http.Request) error {
	token, err := pathUUID(r, "token")
	if err != nil {
		return err
	}
	png, _, err := h.svc.PublicBookingQR(r.Context(), token)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	_, err = w.Write(png)
	return err
}
