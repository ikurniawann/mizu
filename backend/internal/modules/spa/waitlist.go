package spa

import (
	"context"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

/* ── waitlist (EPIC-053 Fase 3) ───────────────────────────────────────── */

// Waitlist statuses.
const (
	WaitlistOpen      = "open"
	WaitlistNotified  = "notified"
	WaitlistBooked    = "booked"
	WaitlistCancelled = "cancelled"
	WaitlistExpired   = "expired"
)

var waitlistStatuses = []string{WaitlistOpen, WaitlistNotified, WaitlistBooked, WaitlistCancelled, WaitlistExpired}

// WaitlistEntry is one guest waiting for a free slot.
type WaitlistEntry struct {
	ID             string        `json:"id"`
	BranchID       string        `json:"branch_id"`
	BranchName     string        `json:"branch_name"`
	CustomerName   string        `json:"customer_name"`
	CustomerPhone  string        `json:"customer_phone"`
	ConversationID *string       `json:"conversation_id"`
	VisitDate      string        `json:"visit_date"`
	Period         string        `json:"period"`
	People         int           `json:"people"`
	VariantIDs     []string      `json:"variant_ids"`
	VariantLabels  []string      `json:"variant_labels"`
	Source         string        `json:"source"`
	Status         string        `json:"status"`
	Note           string        `json:"note"`
	NotifiedAt     *httpx.JSTime `json:"notified_at"`
	ResolvedAt     *httpx.JSTime `json:"resolved_at"`
	CreatedAt      httpx.JSTime  `json:"created_at"`
}

// WaitlistInput creates an entry (bot or front office).
type WaitlistInput struct {
	BranchID       string
	CustomerName   string
	CustomerPhone  string
	ConversationID string
	VisitDate      string
	Period         string
	People         int
	VariantIDs     []string
	VariantLabels  []string
	Source         string
	Note           string
	CreatedBy      string
}

const waitlistColumns = `w.id::text, w.branch_id::text, COALESCE(b.name, ''), w.customer_name, w.customer_phone, w.conversation_id::text,
	  to_char(w.visit_date, 'YYYY-MM-DD'), w.period, w.people, w.variant_ids::text[], w.variant_labels, w.source, w.status, w.note,
	  w.notified_at, w.resolved_at, w.created_at
	  FROM spa.booking_waitlist w LEFT JOIN configuration.branches b ON b.id = w.branch_id`

func scanWaitlist(row interface{ Scan(...any) error }) (*WaitlistEntry, error) {
	var e WaitlistEntry
	var notified, resolved *time.Time
	var created time.Time
	var ids []string
	if err := row.Scan(&e.ID, &e.BranchID, &e.BranchName, &e.CustomerName, &e.CustomerPhone, &e.ConversationID,
		&e.VisitDate, &e.Period, &e.People, &ids, &e.VariantLabels, &e.Source, &e.Status, &e.Note,
		&notified, &resolved, &created); err != nil {
		return nil, err
	}
	e.VariantIDs = ids
	if e.VariantIDs == nil {
		e.VariantIDs = []string{}
	}
	if e.VariantLabels == nil {
		e.VariantLabels = []string{}
	}
	if notified != nil {
		t := httpx.JSTime(*notified)
		e.NotifiedAt = &t
	}
	if resolved != nil {
		t := httpx.JSTime(*resolved)
		e.ResolvedAt = &t
	}
	e.CreatedAt = httpx.JSTime(created)
	return &e, nil
}

// JoinWaitlist records a guest's wish; one open entry per phone+outlet+date
// (a repeat updates the existing entry instead of duplicating it).
func (s *Service) JoinWaitlist(ctx context.Context, in WaitlistInput) (*WaitlistEntry, error) {
	phone := domain.NormalizePhone(in.CustomerPhone)
	if phone == "" {
		return nil, httpx.BadRequest("Nomor HP tidak valid")
	}
	if _, _, ok := domain.DayBounds(in.VisitDate); !ok {
		return nil, httpx.BadRequest("Tanggal tidak valid")
	}
	if in.People < 1 {
		in.People = 1
	}
	if in.People > 10 {
		return nil, httpx.BadRequest("Daftar tunggu maksimal 10 orang")
	}
	if in.Source == "" {
		in.Source = "whatsapp"
	}
	if _, err := s.publicOutlet(ctx, s.db, in.BranchID); err != nil {
		return nil, err
	}
	var conv, by *string
	if in.ConversationID != "" {
		conv = &in.ConversationID
	}
	if in.CreatedBy != "" {
		by = &in.CreatedBy
	}
	if in.VariantIDs == nil {
		in.VariantIDs = []string{}
	}
	if in.VariantLabels == nil {
		in.VariantLabels = []string{}
	}
	var id string
	err := s.db.QueryRow(ctx, `INSERT INTO spa.booking_waitlist
	  (branch_id, customer_name, customer_phone, conversation_id, visit_date, period, people, variant_ids, variant_labels, source, note, created_by)
	  SELECT $1::uuid, $2, $3, $4::uuid, $5::date, $6, $7, $8::uuid[], $9::text[], $10, $11, $12::uuid
	  WHERE NOT EXISTS (SELECT 1 FROM spa.booking_waitlist
	    WHERE customer_phone = $3 AND branch_id = $1::uuid AND visit_date = $5::date AND status IN ('open', 'notified'))
	  RETURNING id::text`,
		in.BranchID, strings.TrimSpace(in.CustomerName), phone, conv, in.VisitDate, in.Period, in.People,
		in.VariantIDs, in.VariantLabels, in.Source, strings.TrimSpace(in.Note), by).Scan(&id)
	if database.IsNoRows(err) {
		// Already waiting: refresh the wish and go back to open.
		err = s.db.QueryRow(ctx, `UPDATE spa.booking_waitlist
		  SET period = $4, people = $5, variant_ids = $6::uuid[], variant_labels = $7::text[], conversation_id = COALESCE($8::uuid, conversation_id),
		      status = 'open', notified_at = NULL, updated_at = now()
		  WHERE customer_phone = $1 AND branch_id = $2::uuid AND visit_date = $3::date AND status IN ('open', 'notified')
		  RETURNING id::text`, phone, in.BranchID, in.VisitDate, in.Period, in.People, in.VariantIDs, in.VariantLabels, conv).Scan(&id)
	}
	if err != nil {
		return nil, err
	}
	return s.waitlistEntry(ctx, id)
}

func (s *Service) waitlistEntry(ctx context.Context, id string) (*WaitlistEntry, error) {
	e, err := scanWaitlist(s.db.QueryRow(ctx, `SELECT `+waitlistColumns+` WHERE w.id = $1::uuid`, id))
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Daftar tunggu tidak ditemukan")
	}
	return e, err
}

// WaitlistFilter narrows the staff list.
type WaitlistFilter struct {
	BranchID string
	Status   string // "" = open + notified
	From, To string
}

// Waitlist lists entries for staff within their branch scope.
func (s *Service) Waitlist(ctx context.Context, userID string, f WaitlistFilter) ([]WaitlistEntry, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if f.BranchID, err = branchFilter(sc, f.BranchID); err != nil {
		return nil, err
	}
	where := []string{"1=1"}
	args := []any{}
	if f.BranchID != "" {
		args = append(args, f.BranchID)
		where = append(where, "w.branch_id = $"+strconv.Itoa(len(args))+"::uuid")
	}
	if f.Status != "" {
		args = append(args, f.Status)
		where = append(where, "w.status = $"+strconv.Itoa(len(args)))
	} else {
		where = append(where, "w.status IN ('open', 'notified')")
	}
	if f.From != "" {
		args = append(args, f.From)
		where = append(where, "w.visit_date >= $"+strconv.Itoa(len(args))+"::date")
	}
	if f.To != "" {
		args = append(args, f.To)
		where = append(where, "w.visit_date <= $"+strconv.Itoa(len(args))+"::date")
	}
	rows, err := s.db.Query(ctx, `SELECT `+waitlistColumns+` WHERE `+strings.Join(where, " AND ")+
		` ORDER BY w.visit_date, w.created_at LIMIT 500`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WaitlistEntry{}
	for rows.Next() {
		e, err := scanWaitlist(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

// SetWaitlistStatus closes or reopens an entry (front office).
func (s *Service) SetWaitlistStatus(ctx context.Context, userID, id, status string) (*WaitlistEntry, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	e, err := s.waitlistEntry(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := s.outletIn(ctx, s.db, sc, e.BranchID); err != nil {
		return nil, err
	}
	switch status {
	case WaitlistOpen, WaitlistBooked, WaitlistCancelled:
	default:
		return nil, httpx.BadRequest("Status daftar tunggu tidak dikenal")
	}
	resolved := "now()"
	if status == WaitlistOpen {
		resolved = "NULL"
	}
	if _, err := s.db.Exec(ctx, `UPDATE spa.booking_waitlist SET status = $2, resolved_at = `+resolved+`, updated_at = now() WHERE id = $1::uuid`, id, status); err != nil {
		return nil, err
	}
	return s.waitlistEntry(ctx, id)
}

// OpenWaitlist is what the bot's watcher checks: entries still waiting whose
// date has not passed (older ones are expired on the way).
func (s *Service) OpenWaitlist(ctx context.Context) ([]WaitlistEntry, error) {
	today := domain.WIBDate(s.clock())
	if _, err := s.db.Exec(ctx, `UPDATE spa.booking_waitlist SET status = 'expired', resolved_at = now(), updated_at = now()
	  WHERE status IN ('open', 'notified') AND visit_date < $1::date`, today); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT `+waitlistColumns+` WHERE w.status = 'open' AND w.visit_date >= $1::date ORDER BY w.visit_date, w.created_at LIMIT 200`, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WaitlistEntry{}
	for rows.Next() {
		e, err := scanWaitlist(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

// MarkWaitlistNotified records that the guest was told a slot is free.
func (s *Service) MarkWaitlistNotified(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE spa.booking_waitlist SET status = 'notified', notified_at = now(), updated_at = now() WHERE id = $1::uuid AND status = 'open'`, id)
	return err
}

// ResolveWaitlistByPhone closes the guest's waiting entries for an outlet+date
// once a booking exists (any source).
func (s *Service) ResolveWaitlistByPhone(ctx context.Context, branchID, phone, date string) error {
	phone = domain.NormalizePhone(phone)
	if phone == "" {
		return nil
	}
	_, err := s.db.Exec(ctx, `UPDATE spa.booking_waitlist SET status = 'booked', resolved_at = now(), updated_at = now()
	  WHERE customer_phone = $1 AND branch_id = $2::uuid AND visit_date = $3::date AND status IN ('open', 'notified')`, phone, branchID, date)
	return err
}

// resolveWaitlistIn is ResolveWaitlistByPhone inside a booking transaction.
func (s *Service) resolveWaitlistIn(ctx context.Context, q Q, branchID, phone, date string) error {
	_, err := q.Exec(ctx, `UPDATE spa.booking_waitlist SET status = 'booked', resolved_at = now(), updated_at = now()
	  WHERE customer_phone = $1 AND branch_id = $2::uuid AND visit_date = $3::date AND status IN ('open', 'notified')`, phone, branchID, date)
	return err
}

// CancelWaitlist closes an entry on the guest's own request (bot).
func (s *Service) CancelWaitlist(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE spa.booking_waitlist SET status = 'cancelled', resolved_at = now(), updated_at = now()
	  WHERE id = $1::uuid AND status IN ('open', 'notified')`, id)
	return err
}
