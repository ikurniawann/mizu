package spa

import (
	"context"
	"fmt"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// The board displays visits; the therapist's task list still displays the
// individual treatments so their progress and commissions remain separate.
func groupBoardBookings(items []BoardItem) []BoardItem {
	groups := map[string][]BoardItem{}
	order := []string{}
	for _, it := range items {
		if _, ok := groups[it.BookingID]; !ok {
			order = append(order, it.BookingID)
		}
		groups[it.BookingID] = append(groups[it.BookingID], it)
	}
	out := make([]BoardItem, 0, len(order))
	for _, id := range order {
		group := groups[id]
		performers := map[string]bool{}
		for _, it := range group {
			performers[deref(it.TherapistID)] = true
		}
		// Archived visits predating booking-level assignment retain their actual
		// performers instead of being displayed under an arbitrary therapist.
		if len(performers) > 1 {
			for _, it := range group {
				it.AssignmentLocked = true
				out = append(out, it)
			}
			continue
		}
		row := group[0]
		row.ID, row.TreatmentCount = id, len(group)
		row.PriceIDR = 0
		row.DurationMin = 0
		names := make([]string, 0, len(group))
		for _, it := range group {
			names = append(names, it.TreatmentName)
			row.PriceIDR += it.PriceIDR
			row.DurationMin += it.DurationMin
			if it.Status == domain.ItemInTreatment || it.Status == domain.ItemCompleted {
				row.AssignmentLocked = true
			}
		}
		row.TreatmentName = strings.Join(names, " + ")
		if len(group) > 1 {
			row.VariantName = fmt.Sprintf("%d treatment", len(group))
		}
		if row.BookingStatus != domain.BookingExpired {
			row.Status = row.BookingStatus
		}
		out = append(out, row)
	}
	return out
}

// bookingInterval reserves one therapist for the full sum of active durations.
func bookingInterval(start time.Time, items []itemRow) (domain.Interval, error) {
	minutes := 0
	for _, it := range items {
		if it.Status != domain.ItemCancelled {
			minutes += it.DurationMin
		}
	}
	if minutes == 0 {
		return domain.Interval{}, httpx.Conflict("Booking tidak memiliki treatment aktif")
	}
	return domain.Interval{Start: start, End: start.Add(time.Duration(minutes) * time.Minute)}, nil
}

func (s *Service) checkBookingTherapist(ctx context.Context, q Q, b *bookingRow, items []itemRow, therapistID string) (*Therapist, error) {
	iv, err := bookingInterval(b.ScheduledAt, items)
	if err != nil {
		return nil, err
	}
	if domain.WIBDate(iv.Start) != domain.WIBDate(iv.End.Add(-time.Nanosecond)) {
		return nil, httpx.Conflict("Booking harus selesai pada hari yang sama")
	}
	if err := s.st.lockTherapist(ctx, q, therapistID); err != nil {
		return nil, err
	}
	eligible, err := s.st.eligibleTherapists(ctx, q, b.BranchID, domain.WIBDate(iv.Start))
	if err != nil {
		return nil, err
	}
	var therapist *Therapist
	for _, t := range eligible {
		if t.ID == therapistID {
			copy := t.Therapist
			therapist = &copy
			break
		}
	}
	if therapist == nil {
		return nil, httpx.Conflict("Terapis tidak bertugas di outlet ini pada tanggal tersebut")
	}
	if b.GenderPref != "any" && (therapist.Gender == nil || *therapist.Gender != b.GenderPref) {
		return nil, httpx.Conflict("Gender terapis tidak sesuai preferensi booking")
	}
	rosters, err := s.ports.People.Rosters(ctx, q, []string{therapist.EmployeeID}, domain.WIBDate(iv.Start))
	if err != nil {
		return nil, err
	}
	if shift := rosters[therapist.EmployeeID].Shift; shift != nil {
		start, startOK := domain.ClockMinutes(shift.StartTime)
		end, endOK := domain.ClockMinutes(shift.EndTime)
		if startOK && endOK {
			if end <= start {
				end = 24 * 60
			}
			local := iv.Start.In(domain.WIB)
			bookingStart := local.Hour()*60 + local.Minute()
			bookingEnd := bookingStart + int(iv.End.Sub(iv.Start)/time.Minute)
			if bookingStart < start || bookingEnd > end {
				return nil, httpx.Conflict(fmt.Sprintf("Booking di luar shift terapis (%s–%s WIB)", domain.HHMM(shift.StartTime), domain.HHMM(shift.EndTime)))
			}
		}
	}
	conflicts, err := s.st.bookingConflicts(ctx, q, []string{therapistID}, iv.Start, iv.End, b.ID)
	if err != nil {
		return nil, err
	}
	if len(conflicts[therapistID]) > 0 {
		return nil, httpx.Conflict("Terapis bentrok dengan booking " + conflicts[therapistID][0].BookingCode)
	}
	return therapist, nil
}

// AssignBooking changes all pending treatments atomically under a booking lock.
// An empty therapistID returns the whole booking to the unassigned queue.
func (s *Service) AssignBooking(ctx context.Context, userID, id, therapistID string) (*Booking, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	err = s.tx(ctx, func(q Q) error {
		b, err := s.lockBooking(ctx, q, sc, id)
		if err != nil {
			return err
		}
		return s.assignBooking(ctx, q, userID, b, therapistID)
	})
	if err != nil {
		return nil, err
	}
	return s.visibleBooking(ctx, nil, id)
}

func (s *Service) assignBooking(ctx context.Context, q Q, userID string, b *bookingRow, therapistID string) error {
	if !domain.IsOpenBooking(b.Status) {
		return httpx.Conflict("Booking sudah ditutup")
	}
	items, err := s.st.itemRows(ctx, q, b.ID, true)
	if err != nil {
		return err
	}
	for _, it := range items {
		if it.Status == domain.ItemInTreatment || it.Status == domain.ItemCompleted {
			return httpx.Conflict("Terapis tidak dapat diganti atau dilepas setelah treatment dimulai")
		}
	}
	if _, err := bookingInterval(b.ScheduledAt, items); err != nil {
		return err
	}
	note, action := "", "unassign"
	if therapistID != "" {
		t, err := s.checkBookingTherapist(ctx, q, b, items, therapistID)
		if err != nil {
			return err
		}
		note, action = t.FullName, "assign"
	}
	if deref(b.TherapistID) == therapistID {
		return nil
	}
	if _, err := q.Exec(ctx, `UPDATE spa.bookings SET therapist_id = $2::uuid, updated_at = now() WHERE id = $1`, b.ID, nullable(therapistID)); err != nil {
		return err
	}
	if err := s.st.event(ctx, q, b.ID, nil, action, nil, nil, userID, note); err != nil {
		return err
	}
	return s.syncStatus(ctx, q, b.ID, userID)
}
