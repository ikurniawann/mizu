package spa

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// A therapist's own view: upcoming bookings assigned to them with the
// commission each treatment earns (frozen once completed, otherwise an
// estimate with the rule in force today), and the month's commission split
// into earned, waiting for payment and expected from the schedule.

// MaxScheduleDays bounds GET /api/spa/me/schedule.
const MaxScheduleDays = 31

// MyScheduleItem is a treatment on the therapist's schedule.
type MyScheduleItem struct {
	BoardItem
	// CommissionEstimated: CommissionIDR is an estimate (treatment not done yet).
	CommissionEstimated bool `json:"commission_estimated"`
	// Notes are the guest's notes on the booking (complaints, focus areas).
	Notes string `json:"notes"`
	// AssignedAt is when the booking was last assigned to this therapist.
	AssignedAt *httpx.JSTime `json:"assigned_at"`
}

// MySummary is GET /api/spa/me/summary.
type MySummary struct {
	UpcomingUnconfiguredCount int     `json:"upcoming_unconfigured_count"`
	Month                     string  `json:"month"`
	EarnedIDR                 float64 `json:"earned_idr"`
	EarnedCount               int     `json:"earned_count"`
	PendingIDR                float64 `json:"pending_idr"`
	PendingCount              int     `json:"pending_count"`
	UpcomingIDR               float64 `json:"upcoming_idr"`
	UpcomingCount             int     `json:"upcoming_count"`
}

type myItemRow struct {
	item  MyScheduleItem
	level int
}

// myItems are the therapist's non-cancelled treatments of bookings starting in [start, end).
func (store) myItems(ctx context.Context, q Q, therapistID string, start, end time.Time) ([]myItemRow, error) {
	return many(ctx, q, func(r pgx.Row) (myItemRow, error) {
		var row myItemRow
		var starts, ends time.Time
		var assigned *time.Time
		item, err := scanItem(r, &starts, &ends, &row.item.BookingID, &row.item.BookingCode, &row.item.BranchID, &row.item.BranchName,
			&row.item.CustomerName, &row.item.GenderPref, &row.item.BookingStatus, &row.item.PaymentStatus, &row.item.GroupID,
			&row.item.Notes, &assigned, &row.level)
		row.item.Item = item
		row.item.StartsAt, row.item.EndsAt = jsTime(starts), jsTime(ends)
		if assigned != nil {
			at := jsTime(*assigned)
			row.item.AssignedAt = &at
		}
		return row, err
	}, `SELECT `+boardItemColumns+`, b.notes,
	        (SELECT max(ev.created_at) FROM spa.booking_events ev WHERE ev.booking_id = b.id AND ev.action = 'assign'), COALESCE(t.level,0)
	   FROM spa.booking_items i JOIN spa.bookings b ON b.id = i.booking_id
	   JOIN configuration.branches br ON br.id = b.branch_id `+itemJoins+`
	  WHERE i.therapist_id = $1 AND b.scheduled_at >= $2 AND b.scheduled_at < $3
	    AND i.status <> 'cancelled' AND b.status <> 'cancelled'
	  ORDER BY b.scheduled_at, i.sort_order`, therapistID, start, end)
}

// withCommission fills each item's commission: the frozen amount once
// completed, else an estimate from the active rules.
func (s *Service) withCommission(ctx context.Context, rows []myItemRow) ([]MyScheduleItem, error) {
	rules, err := s.CommissionSettings(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]MyScheduleItem, len(rows))
	for i, row := range rows {
		it := row.item
		if it.Status != domain.ItemCompleted {
			it.CommissionIDR = nil
			it.CommissionEstimated = true
			it.CommissionLevel = &row.level
			for _, r := range rules {
				if r.VariantID == it.VariantID {
					it.CommissionIDR = r.Values[row.level]
					break
				}
			}
		}

		out[i] = it
	}
	return out, nil
}

// MySchedule lists the therapist's bookings from `from` (WIB date) for `days` days.
func (s *Service) MySchedule(ctx context.Context, userID, from string, days int) ([]MyScheduleItem, error) {
	t, err := s.requireMe(ctx, userID)
	if err != nil {
		return nil, err
	}
	start, _, ok := domain.DayBounds(from)
	if !ok {
		return nil, httpx.BadRequest("Tanggal tidak valid")
	}
	if days < 1 || days > MaxScheduleDays {
		return nil, httpx.BadRequest("Rentang jadwal 1–31 hari")
	}
	s.maintain(ctx)
	rows, err := s.st.myItems(ctx, s.db, t.ID, start, start.AddDate(0, 0, days))
	if err != nil {
		return nil, err
	}
	return s.withCommission(ctx, rows)
}

// MySummary splits the month's commission: earned (completed in the month,
// booking paid — the same lines as GET /me/commissions), pending (completed,
// booking not yet paid) and upcoming (estimated from treatments still on the
// schedule this month).
func (s *Service) MySummary(ctx context.Context, userID, month string) (*MySummary, error) {
	t, err := s.requireMe(ctx, userID)
	if err != nil {
		return nil, err
	}
	start, end, ok := domain.MonthBounds(month)
	if !ok {
		return nil, httpx.BadRequest("Bulan tidak valid")
	}
	// Earned matches the commission detail (completed in the month, booking paid).
	earned, err := s.report(ctx, start, end, "", t.ID)
	if err != nil {
		return nil, err
	}
	sum := &MySummary{Month: month, EarnedIDR: earned.TotalIDR}
	for _, tc := range earned.Therapists {
		sum.EarnedCount += tc.TreatmentCount
	}
	rows, err := s.st.myItems(ctx, s.db, t.ID, start, end)
	if err != nil {
		return nil, err
	}
	items, err := s.withCommission(ctx, rows)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		if it.CommissionReset {
			continue
		}
		if it.CommissionIDR == nil {
			if it.Status != domain.ItemCompleted && it.BookingStatus != domain.BookingExpired {
				sum.UpcomingUnconfiguredCount++
			}
			continue
		}
		amount := *it.CommissionIDR
		switch {
		case it.Status == domain.ItemCompleted && it.PaymentStatus != domain.PaymentPaid:
			sum.PendingIDR += amount
			sum.PendingCount++
		case it.Status != domain.ItemCompleted && it.BookingStatus != domain.BookingExpired:
			sum.UpcomingIDR += amount
			sum.UpcomingCount++
		}
	}
	return sum, nil
}
