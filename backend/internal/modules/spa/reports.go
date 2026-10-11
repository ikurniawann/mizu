package spa

import (
	"context"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/scope"
)

type HourlyBookings struct {
	Hour     int `json:"hour"`
	Bookings int `json:"bookings"`
}
type RushHourReport struct {
	From          string           `json:"from"`
	To            string           `json:"to"`
	TotalBookings int              `json:"total_bookings"`
	PeakBookings  int              `json:"peak_bookings"`
	PeakHours     []int            `json:"peak_hours"`
	Hourly        []HourlyBookings `json:"hourly"`
}
type PeriodBookings struct {
	Period   string `json:"period"`
	Bookings int    `json:"bookings"`
}
type TrendReport struct {
	From          string           `json:"from"`
	To            string           `json:"to"`
	Interval      string           `json:"interval"`
	TotalBookings int              `json:"total_bookings"`
	Periods       []PeriodBookings `json:"periods"`
}
type RatingBooking struct {
	ID          string    `json:"id"`
	Code        string    `json:"booking_code"`
	Customer    string    `json:"customer_name"`
	Branch      string    `json:"branch_name"`
	TherapistID string    `json:"therapist_id"`
	Therapist   string    `json:"therapist_name"`
	ScheduledAt time.Time `json:"scheduled_at"`
	Rating      int       `json:"rating"`
}
type RatingSummary struct {
	TotalRatings  int     `json:"total_ratings"`
	AverageRating float64 `json:"average_rating"`
}
type TherapistRating struct {
	TherapistID   string `json:"therapist_id"`
	TherapistName string `json:"therapist_name"`
	RatingSummary
}
type RatingReport struct {
	From string `json:"from"`
	To   string `json:"to"`
	RatingSummary
	Bookings   []RatingBooking  `json:"bookings"`
	Therapists []TherapistRating `json:"therapists"`
}

func reportParams(r *http.Request) (from, to, branch string, err error) {
	if from, err = queryDate(r, "from", true); err != nil {
		return
	}
	if to, err = queryDate(r, "to", true); err != nil {
		return
	}
	if from > to {
		err = httpx.BadRequest("Periode tidak valid: tanggal awal harus sebelum tanggal akhir")
		return
	}
	branch, err = queryUUID(r, "branch_id", false)
	return
}
func (h *Handler) rushHourReport(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	from, to, branch, err := reportParams(r)
	if err != nil {
		return err
	}
	data, err := h.svc.RushHour(r.Context(), u.ID, from, to, branch)
	if err != nil {
		return err
	}
	return ok(w, data)
}
func (h *Handler) trendReport(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	from, to, branch, err := reportParams(r)
	if err != nil {
		return err
	}
	data, err := h.svc.Trend(r.Context(), u.ID, from, to, branch, r.URL.Query().Get("interval"))
	if err != nil {
		return err
	}
	return ok(w, data)
}
func (h *Handler) ratingReport(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	from, to, branch, err := reportParams(r)
	if err != nil {
		return err
	}
	data, err := h.svc.Rating(r.Context(), u.ID, from, to, branch)
	if err != nil {
		return err
	}
	return ok(w, data)
}

// reportBranches applies strict business ownership through the branch directory,
// including holding scope and profiles whose scope IDs are missing.
func (store) reportBranches(ctx context.Context, q Q, sc *scope.Scope) ([]string, error) {
	w := &where{}
	if sc != nil && !sc.Unscoped {
		switch sc.Level() {
		case "holding":
			w.add("c.holding_id = ?::uuid", sc.HoldingID)
		case "company":
			w.add("br.company_id = ?::uuid", sc.CompanyID)
		case "branch":
			w.add("br.id = ?::uuid", sc.BranchID)
		default:
			w.parts = append(w.parts, "false")
		}
	}
	return many(ctx, q, func(r pgx.Row) (string, error) {
		var id string
		err := r.Scan(&id)
		return id, err
	}, `SELECT br.id::text FROM configuration.branches br
 LEFT JOIN configuration.companies c ON c.id = br.company_id WHERE `+w.sql(), w.args...)
}
func (s *Service) reportBranchIDs(ctx context.Context, userID, branchID string) ([]string, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	branches, err := s.st.reportBranches(ctx, s.db, sc)
	if err != nil {
		return nil, err
	}
	if branchID != "" {
		if !slices.Contains(branches, branchID) {
			return nil, httpx.Forbidden("Outlet di luar akses Anda")
		}
		return []string{branchID}, nil
	}
	return branches, nil
}

// Count booking headers directly; treatment joins would duplicate bookings.
func (store) bookingBuckets(ctx context.Context, q Q, start, end time.Time, branches []string, interval string) (map[string]int, error) {
	expression := `EXTRACT(HOUR FROM scheduled_at AT TIME ZONE 'Asia/Jakarta')::int::text`
	args := []any{start, end, branches}
	if interval != "hourly" {
		precision := map[string]string{"daily": "day", "monthly": "month", "yearly": "year"}[interval]
		if precision == "" {
			return nil, httpx.BadRequest("Kelompok periode tidak valid")
		}
		expression = `to_char(date_trunc($4, scheduled_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD')`
		args = append(args, precision)
	}
	rows, err := q.Query(ctx, `SELECT `+expression+`, count(*)::int FROM spa.bookings
 WHERE scheduled_at >= $1 AND scheduled_at < $2 AND branch_id = ANY($3::uuid[])
 AND status IN ('unassigned', 'assigned', 'in_treatment', 'completed') GROUP BY 1`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var bucket string
		var count int
		if err := rows.Scan(&bucket, &count); err != nil {
			return nil, err
		}
		counts[bucket] = count
	}
	return counts, rows.Err()
}
func (s *Service) RushHour(ctx context.Context, userID, from, to, branchID string) (*RushHourReport, error) {
	start, end, ok := domain.RangeBounds(from, to)
	if !ok {
		return nil, httpx.BadRequest("Periode tidak valid")
	}
	branches, err := s.reportBranchIDs(ctx, userID, branchID)
	if err != nil {
		return nil, err
	}
	s.maintain(ctx)
	counts, err := s.st.bookingBuckets(ctx, s.db, start, end, branches, "hourly")
	if err != nil {
		return nil, err
	}
	result := &RushHourReport{From: from, To: to, Hourly: make([]HourlyBookings, 24), PeakHours: []int{}}
	for hour := 0; hour < 24; hour++ {
		count := counts[strconv.Itoa(hour)]
		result.Hourly[hour] = HourlyBookings{Hour: hour, Bookings: count}
		result.TotalBookings += count
		if count > result.PeakBookings {
			result.PeakBookings = count
			result.PeakHours = []int{hour}
		} else if count > 0 && count == result.PeakBookings {
			result.PeakHours = append(result.PeakHours, hour)
		}
	}
	return result, nil
}
func (s *Service) Trend(ctx context.Context, userID, from, to, branchID, interval string) (*TrendReport, error) {
	periods, err := domain.TrendPeriods(from, to, interval)
	if err != nil {
		return nil, httpx.BadRequest(err.Error())
	}
	branches, err := s.reportBranchIDs(ctx, userID, branchID)
	if err != nil {
		return nil, err
	}
	start, end, _ := domain.RangeBounds(from, to)
	s.maintain(ctx)
	counts, err := s.st.bookingBuckets(ctx, s.db, start, end, branches, interval)
	if err != nil {
		return nil, err
	}
	result := &TrendReport{From: from, To: to, Interval: interval, Periods: make([]PeriodBookings, len(periods))}
	for i, period := range periods {
		count := counts[period]
		result.Periods[i] = PeriodBookings{Period: period, Bookings: count}
		result.TotalBookings += count
	}
	return result, nil
}

func (store) ratedBookings(ctx context.Context, q Q, start, end time.Time, branches []string) ([]RatingBooking, error) {
	return many(ctx, q, func(row pgx.Row) (RatingBooking, error) {
		var b RatingBooking
		err := row.Scan(&b.ID, &b.Code, &b.Customer, &b.Branch, &b.TherapistID, &b.Therapist, &b.ScheduledAt, &b.Rating)
		return b, err
	}, `SELECT b.id::text, b.booking_code, b.customer_name, br.name,
	 b.therapist_id::text, e.full_name, b.scheduled_at, b.therapist_rating
	 FROM spa.bookings b JOIN configuration.branches br ON br.id = b.branch_id
	 JOIN spa.therapists t ON t.id = b.therapist_id
	 JOIN hris.employees e ON e.id = t.employee_id
	 WHERE b.scheduled_at >= $1 AND b.scheduled_at < $2
	 AND b.branch_id = ANY($3::uuid[]) AND b.therapist_rating IS NOT NULL
	 AND b.status = 'completed'
	 ORDER BY b.scheduled_at DESC, b.id`, start, end, branches)
}

func (s *Service) Rating(ctx context.Context, userID, from, to, branchID string) (*RatingReport, error) {
	branches, err := s.reportBranchIDs(ctx, userID, branchID)
	if err != nil {
		return nil, err
	}
	start, end, ok := domain.RangeBounds(from, to)
	if !ok {
		return nil, httpx.BadRequest("Periode tidak valid")
	}
	s.maintain(ctx)
	bookings, err := s.st.ratedBookings(ctx, s.db, start, end, branches)
	if err != nil {
		return nil, err
	}
	result := &RatingReport{From: from, To: to, Bookings: bookings, Therapists: []TherapistRating{}}
	byTherapist := map[string]*TherapistRating{}
	var total int
	for _, b := range bookings {
		total += b.Rating
		t := byTherapist[b.TherapistID]
		if t == nil {
			t = &TherapistRating{TherapistID: b.TherapistID, TherapistName: b.Therapist}
			byTherapist[b.TherapistID] = t
		}
		t.TotalRatings++
		t.AverageRating += float64(b.Rating)
	}
	result.TotalRatings = len(bookings)
	if len(bookings) > 0 {
		result.AverageRating = float64(total) / float64(len(bookings))
	}
	for _, t := range byTherapist {
		t.AverageRating /= float64(t.TotalRatings)
		result.Therapists = append(result.Therapists, *t)
	}
	sort.Slice(result.Therapists, func(i, j int) bool {
		a, b := result.Therapists[i], result.Therapists[j]
		if a.AverageRating != b.AverageRating {
			return a.AverageRating > b.AverageRating
		}
		if a.TotalRatings != b.TotalRatings {
			return a.TotalRatings > b.TotalRatings
		}
		return a.TherapistName < b.TherapistName
	})
	return result, nil
}
