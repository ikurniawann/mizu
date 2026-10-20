package spa

import (
	"context"
	"errors"
	"strconv"
	"time"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/httpx"
)

/* ── group booking from the chat bot (EPIC-053 Fase 3) ───────────────── */

// PublicGuest is one guest of a group: their own treatments and start time
// (guests may be staggered when no slot fits everyone at once).
type PublicGuest struct {
	VariantIDs  []string
	ScheduledAt time.Time
	TherapistID string
}

// PublicGroupInput books several guests under one contact in one
// transaction: either every guest gets a booking or none does.
type PublicGroupInput struct {
	BranchID            string
	CustomerName        string
	CustomerPhone       string
	TherapistGenderPref string
	Notes               string
	PaymentMethod       string
	Source              string
	Guests              []PublicGuest
	// RoomID: one room for the whole party (its capacity must fit them;
	// the room price is charged once, on the first guest).
	RoomID string
}

// MaxPublicGroup is the most guests one chat group booking covers.
const MaxPublicGroup = 10

// PublicBookGroup creates the guests' bookings all-or-nothing. Guests are
// named "Nama (1)", "Nama (2)" so the front office can tell them apart.
func (s *Service) PublicBookGroup(ctx context.Context, in PublicGroupInput) ([]*PublicBookingResult, error) {
	if len(in.Guests) < 2 || len(in.Guests) > MaxPublicGroup {
		return nil, httpx.BadRequest("Booking bersama lewat chat untuk 2–" + strconv.Itoa(MaxPublicGroup) + " orang")
	}
	now := s.clock()
	inputs := make([]publicBookingInput, len(in.Guests))
	for i, g := range in.Guests {
		inputs[i] = publicBookingInput{
			BranchID: in.BranchID, ScheduledAt: g.ScheduledAt, CustomerName: in.CustomerName + " (" + strconv.Itoa(i+1) + ")",
			CustomerPhone: in.CustomerPhone, TherapistGenderPref: in.TherapistGenderPref, Notes: in.Notes,
			VariantIDs: g.VariantIDs, PaymentMethod: in.PaymentMethod, Source: in.Source, TherapistID: g.TherapistID,
			RoomID: in.RoomID, roomPriceWaived: i > 0,
		}
		if err := publicBookingChecks(&inputs[i], now, s.onlinePaymentReady()); err != nil {
			return nil, err
		}
	}
	tokens := make([]string, 0, len(inputs))
	err := s.tx(ctx, func(q Q) error {
		tokens = tokens[:0]
		// The party counts once against the per-phone cap (one visit).
		open, err := s.st.openPublicBookings(ctx, q, domain.NormalizePhone(in.CustomerPhone), now)
		if err != nil {
			return err
		}
		if open >= MaxPublicOpenBookings {
			return httpx.TooManyRequests(tooManyOpenBookings)
		}
		for i := range inputs {
			inputs[i].skipCap = true
			res, err := s.publicBookIn(ctx, q, inputs[i], now)
			if err != nil {
				var he *httpx.Error
				if errors.As(err, &he) && he.Status == 409 {
					return httpx.Conflict("Jam untuk tamu ke-" + strconv.Itoa(i+1) + " sudah penuh. " + he.Message)
				}
				return err
			}
			tokens = append(tokens, res.AccessToken)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	out := make([]*PublicBookingResult, 0, len(tokens))
	for _, token := range tokens {
		res, err := s.PublicBooking(ctx, token)
		if err != nil {
			return nil, err
		}
		out = append(out, res)
	}
	return out, nil
}
