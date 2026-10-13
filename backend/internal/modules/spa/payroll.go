package spa

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

/* ── Therapist payroll (revisi R1) ────────────────────────────────────
   Two pay types: "salary_commission" (fixed salary from HRIS + commission)
   and "commission_only". Two paydays a month:
     • commission run — pay date = commission day (default 15), pays the
       commission of treatments completed on days 1..commission day;
     • regular run — pay date = salary day (default 30, or the month's last
       day), pays the fixed salary (salary_commission therapists) plus the
       commission completed after the commission day.
   Commission counts once the treatment is completed and its booking paid;
   every commission item is paid by exactly one run, so a booking paid late
   rolls into the next run. Runs move draft → approved → paid; a draft can be
   recalculated (manual bonus/deduction kept) or deleted. */

// Pay types.
const (
	PaySalaryCommission = "salary_commission"
	PayCommissionOnly   = "commission_only"
)

// Run kinds.
const (
	PayRunCommission = "commission"
	PayRunRegular    = "regular"
)

const (
	payCommissionDayKey = "spa_pay_commission_day"
	paySalaryDayKey     = "spa_pay_salary_day"
	// payCatchUp: unpaid commission completed up to this long before the
	// period start is still picked up (bookings paid late).
	payCatchUp = 62 * 24 * time.Hour
)

// PaySettings are the paydays (day of month, WIB).
type PaySettings struct {
	CommissionDay int `json:"commission_day"`
	SalaryDay     int `json:"salary_day"`
}

// PayRun is one payroll run.
type PayRun struct {
	ID          string        `json:"id"`
	PeriodMonth string        `json:"period_month"`
	Kind        string        `json:"kind"`
	PeriodStart string        `json:"period_start"`
	PeriodEnd   string        `json:"period_end"`
	PayDate     string        `json:"pay_date"`
	Status      string        `json:"status"`
	TotalIDR    float64       `json:"total_idr"`
	Notes       string        `json:"notes"`
	LineCount   int           `json:"line_count"`
	CreatedAt   httpx.JSTime  `json:"created_at"`
	ApprovedAt  *httpx.JSTime `json:"approved_at"`
	PaidAt      *httpx.JSTime `json:"paid_at"`
	Lines       []PayLine     `json:"lines,omitempty"`
}

// PayLine is one therapist's pay in a run.
type PayLine struct {
	ID              string  `json:"id"`
	RunID           string  `json:"run_id"`
	TherapistID     string  `json:"therapist_id"`
	TherapistName   string  `json:"therapist_name"`
	BranchName      string  `json:"branch_name"`
	PayType         string  `json:"pay_type"`
	BaseSalaryIDR   float64 `json:"base_salary_idr"`
	AllowanceIDR    float64 `json:"allowance_idr"`
	CommissionIDR   float64 `json:"commission_idr"`
	CommissionCount int     `json:"commission_count"`
	BonusIDR        float64 `json:"bonus_idr"`
	DeductionIDR    float64 `json:"deduction_idr"`
	TotalIDR        float64 `json:"total_idr"`
	Note            string  `json:"note"`
	// Therapist view only.
	RunKind    string `json:"run_kind,omitempty"`
	RunStatus  string `json:"run_status,omitempty"`
	PayDate    string `json:"pay_date,omitempty"`
	PeriodFrom string `json:"period_start,omitempty"`
	PeriodTo   string `json:"period_end,omitempty"`
}

// TherapistPay is a therapist with their pay type and HRIS salary.
type TherapistPay struct {
	TherapistID   string  `json:"therapist_id"`
	FullName      string  `json:"full_name"`
	BranchName    string  `json:"branch_name"`
	IsActive      bool    `json:"is_active"`
	PayType       string  `json:"pay_type"`
	BaseSalaryIDR float64 `json:"base_salary_idr"`
	AllowanceIDR  float64 `json:"allowance_idr"`
}

/* ── settings ────────────────────────────────────────────────────────── */

func (s *Service) PaySettings(ctx context.Context) (PaySettings, error) {
	out := PaySettings{CommissionDay: 15, SalaryDay: 30}
	rows, err := s.db.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key IN ($1, $2)`, payCommissionDayKey, paySalaryDayKey)
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
		n, err := strconv.Atoi(strings.TrimSpace(*v))
		if err != nil || n < 1 || n > 31 {
			continue
		}
		if k == payCommissionDayKey {
			out.CommissionDay = n
		} else {
			out.SalaryDay = n
		}
	}
	return out, rows.Err()
}

func (s *Service) SavePaySettings(ctx context.Context, in PaySettings) (PaySettings, error) {
	if in.CommissionDay < 1 || in.CommissionDay > 28 {
		return PaySettings{}, httpx.BadRequest("Tanggal pembayaran komisi 1–28")
	}
	if in.SalaryDay < 1 || in.SalaryDay > 31 {
		return PaySettings{}, httpx.BadRequest("Tanggal gajian 1–31")
	}
	if in.SalaryDay <= in.CommissionDay {
		return PaySettings{}, httpx.BadRequest("Tanggal gajian harus setelah tanggal pembayaran komisi")
	}
	for k, v := range map[string]int{payCommissionDayKey: in.CommissionDay, paySalaryDayKey: in.SalaryDay} {
		if _, err := s.db.Exec(ctx, `INSERT INTO configuration.app_settings (key, value) VALUES ($1, $2)
		  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, k, strconv.Itoa(v)); err != nil {
			return PaySettings{}, err
		}
	}
	return s.PaySettings(ctx)
}

// payPeriod is a run's covered dates and pay date for month/kind.
func payPeriod(month, kind string, cfg PaySettings) (start, end, payDate string, ok bool) {
	first, next, ok := domain.MonthBounds(month)
	if !ok {
		return "", "", "", false
	}
	last := next.AddDate(0, 0, -1).Day()
	clamp := func(d int) int {
		if d > last {
			return last
		}
		return d
	}
	day := func(d int) string { return first.AddDate(0, 0, d-1).Format("2006-01-02") }
	cut := clamp(cfg.CommissionDay)
	if kind == PayRunCommission {
		return day(1), day(cut), day(cut), true
	}
	return day(cut + 1), day(last), day(clamp(cfg.SalaryDay)), true
}

/* ── store ───────────────────────────────────────────────────────────── */

const payRunColumns = `r.id::text, r.period_month, r.kind, r.period_start::text, r.period_end::text, r.pay_date::text, r.status,
	r.total_idr::float8, r.notes, (SELECT count(*) FROM spa.pay_lines l WHERE l.run_id = r.id)::int, r.created_at, r.approved_at, r.paid_at`

func scanPayRun(r pgx.Row) (PayRun, error) {
	var x PayRun
	var created time.Time
	var approved, paid *time.Time
	err := r.Scan(&x.ID, &x.PeriodMonth, &x.Kind, &x.PeriodStart, &x.PeriodEnd, &x.PayDate, &x.Status, &x.TotalIDR, &x.Notes,
		&x.LineCount, &created, &approved, &paid)
	x.CreatedAt = jsTime(created)
	if approved != nil {
		t := jsTime(*approved)
		x.ApprovedAt = &t
	}
	if paid != nil {
		t := jsTime(*paid)
		x.PaidAt = &t
	}
	return x, err
}

func (store) payRun(ctx context.Context, q Q, id string, lock bool) (*PayRun, error) {
	sql := `SELECT ` + payRunColumns + ` FROM spa.pay_runs r WHERE r.id = $1`
	if lock {
		sql += ` FOR UPDATE`
	}
	x, err := scanPayRun(q.QueryRow(ctx, sql, id))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &x, err
}

const payLineColumns = `l.id::text, l.run_id::text, l.therapist_id::text, e.full_name, br.name, l.pay_type, l.base_salary_idr::float8,
	l.allowance_idr::float8, l.commission_idr::float8, l.commission_count, l.bonus_idr::float8, l.deduction_idr::float8,
	l.total_idr::float8, l.note`

const payLineFrom = `spa.pay_lines l JOIN spa.therapists t ON t.id = l.therapist_id JOIN hris.employees e ON e.id = t.employee_id
	JOIN configuration.branches br ON br.id = t.home_branch_id`

func scanPayLine(r pgx.Row, extra ...any) (PayLine, error) {
	var x PayLine
	dest := append([]any{&x.ID, &x.RunID, &x.TherapistID, &x.TherapistName, &x.BranchName, &x.PayType, &x.BaseSalaryIDR, &x.AllowanceIDR,
		&x.CommissionIDR, &x.CommissionCount, &x.BonusIDR, &x.DeductionIDR, &x.TotalIDR, &x.Note}, extra...)
	return x, r.Scan(dest...)
}

func (store) payLines(ctx context.Context, q Q, runID string) ([]PayLine, error) {
	return many(ctx, q, func(r pgx.Row) (PayLine, error) { return scanPayLine(r) },
		`SELECT `+payLineColumns+` FROM `+payLineFrom+` WHERE l.run_id = $1 ORDER BY br.name, e.full_name`, runID)
}

func (store) therapistPays(ctx context.Context, q Q, onDate string) ([]TherapistPay, error) {
	return many(ctx, q, func(r pgx.Row) (TherapistPay, error) {
		var x TherapistPay
		err := r.Scan(&x.TherapistID, &x.FullName, &x.BranchName, &x.IsActive, &x.PayType, &x.BaseSalaryIDR, &x.AllowanceIDR)
		return x, err
	}, `SELECT t.id::text, e.full_name, br.name, t.is_active AND COALESCE(e.is_active, true), t.pay_type,
	        COALESCE(s.base_salary, 0)::float8, COALESCE(s.fixed_allowance, 0)::float8
	   FROM spa.therapists t JOIN hris.employees e ON e.id = t.employee_id
	   JOIN configuration.branches br ON br.id = t.home_branch_id
	   LEFT JOIN LATERAL (SELECT es.base_salary, es.fixed_allowance FROM hris.employee_salary es
	                       WHERE es.employee_id = t.employee_id AND es.is_active AND es.effective_date <= $1::date
	                         AND (es.end_date IS NULL OR es.end_date >= $1::date)
	                       ORDER BY es.effective_date DESC LIMIT 1) s ON true
	  ORDER BY br.name, e.full_name`, onDate)
}

type unpaidCommission struct {
	itemID      string
	therapistID string
	amount      float64
}

// unpaidCommissions are completed, paid treatments not yet in any run,
// completed in [from, to).
func (store) unpaidCommissions(ctx context.Context, q Q, from, to time.Time) ([]unpaidCommission, error) {
	return many(ctx, q, func(r pgx.Row) (unpaidCommission, error) {
		var x unpaidCommission
		return x, r.Scan(&x.itemID, &x.therapistID, &x.amount)
	}, `SELECT i.id::text, i.therapist_id::text, COALESCE(i.commission_idr, 0)::float8
	   FROM spa.booking_items i JOIN spa.bookings b ON b.id = i.booking_id
	  WHERE i.status = 'completed' AND b.payment_status = 'paid' AND i.therapist_id IS NOT NULL
	    AND i.completed_at >= $1 AND i.completed_at < $2
	    AND NOT EXISTS (SELECT 1 FROM spa.pay_commission_items p WHERE p.item_id = i.id)`, from, to)
}

/* ── service ─────────────────────────────────────────────────────────── */

// TherapistPays lists every therapist's pay type and HRIS salary today.
func (s *Service) TherapistPays(ctx context.Context) ([]TherapistPay, error) {
	return s.st.therapistPays(ctx, s.db, domain.WIBDate(s.clock()))
}

// SetPayType sets a therapist's pay type.
func (s *Service) SetPayType(ctx context.Context, therapistID, payType string) error {
	if payType != PaySalaryCommission && payType != PayCommissionOnly {
		return httpx.BadRequest("Tipe gaji tidak dikenal")
	}
	tag, err := s.db.Exec(ctx, `UPDATE spa.therapists SET pay_type = $2, updated_at = now() WHERE id = $1`, therapistID, payType)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Terapis tidak ditemukan")
	}
	return nil
}

// PayRuns lists runs, newest period first.
func (s *Service) PayRuns(ctx context.Context, year string) ([]PayRun, error) {
	sql := `SELECT ` + payRunColumns + ` FROM spa.pay_runs r`
	args := []any{}
	if year != "" {
		sql += ` WHERE r.period_month LIKE $1`
		args = append(args, year+"-%")
	}
	return many(ctx, s.db, scanPayRun, sql+` ORDER BY r.period_month DESC, r.kind DESC`, args...)
}

// PayRunDetail is a run with its lines.
func (s *Service) PayRunDetail(ctx context.Context, id string) (*PayRun, error) {
	run, err := s.st.payRun(ctx, s.db, id, false)
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, httpx.NotFound("Payroll terapis tidak ditemukan")
	}
	if run.Lines, err = s.st.payLines(ctx, s.db, id); err != nil {
		return nil, err
	}
	return run, nil
}

// CreatePayRun creates and calculates the run of month/kind.
func (s *Service) CreatePayRun(ctx context.Context, userID, month, kind string) (*PayRun, error) {
	if kind != PayRunCommission && kind != PayRunRegular {
		return nil, httpx.BadRequest("Jenis payroll tidak dikenal")
	}
	cfg, err := s.PaySettings(ctx)
	if err != nil {
		return nil, err
	}
	start, end, payDate, ok := payPeriod(month, kind, cfg)
	if !ok {
		return nil, httpx.BadRequest("Bulan tidak valid (YYYY-MM)")
	}
	var id string
	err = s.tx(ctx, func(q Q) error {
		err := q.QueryRow(ctx, `INSERT INTO spa.pay_runs (period_month, kind, period_start, period_end, pay_date, created_by)
		  VALUES ($1, $2, $3::date, $4::date, $5::date, NULLIF($6, '')::uuid) RETURNING id::text`,
			month, kind, start, end, payDate, userID).Scan(&id)
		if database.IsUniqueViolation(err) {
			return httpx.Conflict(fmt.Sprintf("Payroll %s %s sudah ada", payKindLabel(kind), month))
		}
		if err != nil {
			return err
		}
		return s.calculatePayRun(ctx, q, id, nil)
	})
	if err != nil {
		return nil, err
	}
	return s.PayRunDetail(ctx, id)
}

func payKindLabel(kind string) string {
	if kind == PayRunCommission {
		return "komisi"
	}
	return "gaji reguler"
}

// RecalculatePayRun rebuilds a draft run's lines, keeping manual bonus,
// deduction and notes per therapist.
func (s *Service) RecalculatePayRun(ctx context.Context, id string) (*PayRun, error) {
	err := s.tx(ctx, func(q Q) error {
		run, err := s.st.payRun(ctx, q, id, true)
		if err != nil {
			return err
		}
		if run == nil {
			return httpx.NotFound("Payroll terapis tidak ditemukan")
		}
		if run.Status != "draft" {
			return httpx.Conflict("Hanya payroll draft yang bisa dihitung ulang")
		}
		lines, err := s.st.payLines(ctx, q, id)
		if err != nil {
			return err
		}
		keep := map[string]PayLine{}
		for _, l := range lines {
			keep[l.TherapistID] = l
		}
		if _, err := q.Exec(ctx, `DELETE FROM spa.pay_lines WHERE run_id = $1`, id); err != nil {
			return err
		}
		return s.calculatePayRun(ctx, q, id, keep)
	})
	if err != nil {
		return nil, err
	}
	return s.PayRunDetail(ctx, id)
}

func (s *Service) calculatePayRun(ctx context.Context, q Q, id string, keep map[string]PayLine) error {
	run, err := s.st.payRun(ctx, q, id, false)
	if err != nil {
		return err
	}
	from, _, _ := domain.DayBounds(run.PeriodStart)
	_, to, _ := domain.DayBounds(run.PeriodEnd)
	items, err := s.st.unpaidCommissions(ctx, q, from.Add(-payCatchUp), to)
	if err != nil {
		return err
	}
	byTherapist := map[string][]unpaidCommission{}
	for _, it := range items {
		byTherapist[it.therapistID] = append(byTherapist[it.therapistID], it)
	}
	pays, err := s.st.therapistPays(ctx, q, run.PeriodEnd)
	if err != nil {
		return err
	}
	for _, p := range pays {
		comm := byTherapist[p.TherapistID]
		line := PayLine{TherapistID: p.TherapistID, PayType: p.PayType, CommissionCount: len(comm)}
		for _, c := range comm {
			line.CommissionIDR += c.amount
		}
		if run.Kind == PayRunRegular && p.PayType == PaySalaryCommission && p.IsActive {
			line.BaseSalaryIDR, line.AllowanceIDR = p.BaseSalaryIDR, p.AllowanceIDR
		}
		if k, ok := keep[p.TherapistID]; ok {
			line.BonusIDR, line.DeductionIDR, line.Note = k.BonusIDR, k.DeductionIDR, k.Note
		}
		line.TotalIDR = line.BaseSalaryIDR + line.AllowanceIDR + line.CommissionIDR + line.BonusIDR - line.DeductionIDR
		if line.BaseSalaryIDR+line.AllowanceIDR+line.CommissionIDR+line.BonusIDR+line.DeductionIDR == 0 {
			continue // nothing to pay this therapist in this run
		}
		var lineID string
		if err := q.QueryRow(ctx, `INSERT INTO spa.pay_lines (run_id, therapist_id, pay_type, base_salary_idr, allowance_idr, commission_idr,
		    commission_count, bonus_idr, deduction_idr, total_idr, note)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::text`,
			id, line.TherapistID, line.PayType, line.BaseSalaryIDR, line.AllowanceIDR, line.CommissionIDR, line.CommissionCount,
			line.BonusIDR, line.DeductionIDR, line.TotalIDR, line.Note).Scan(&lineID); err != nil {
			return err
		}
		for _, c := range comm {
			if _, err := q.Exec(ctx, `INSERT INTO spa.pay_commission_items (run_id, line_id, item_id, commission_idr) VALUES ($1, $2, $3, $4)`,
				id, lineID, c.itemID, c.amount); err != nil {
				return err
			}
		}
	}
	return s.refreshRunTotal(ctx, q, id)
}

func (s *Service) refreshRunTotal(ctx context.Context, q Q, id string) error {
	_, err := q.Exec(ctx, `UPDATE spa.pay_runs SET total_idr = COALESCE((SELECT sum(total_idr) FROM spa.pay_lines WHERE run_id = $1), 0),
	    updated_at = now() WHERE id = $1`, id)
	return err
}

// UpdatePayLine sets a draft line's manual bonus, deduction and note.
func (s *Service) UpdatePayLine(ctx context.Context, lineID string, bonus, deduction float64, note string) (*PayRun, error) {
	var runID string
	err := s.tx(ctx, func(q Q) error {
		if err := q.QueryRow(ctx, `SELECT run_id::text FROM spa.pay_lines WHERE id = $1`, lineID).Scan(&runID); err != nil {
			if database.IsNoRows(err) {
				return httpx.NotFound("Baris payroll tidak ditemukan")
			}
			return err
		}
		run, err := s.st.payRun(ctx, q, runID, true)
		if err != nil {
			return err
		}
		if run.Status != "draft" {
			return httpx.Conflict("Payroll sudah disetujui; tidak bisa diubah")
		}
		if _, err := q.Exec(ctx, `UPDATE spa.pay_lines SET bonus_idr = $2, deduction_idr = $3, note = $4,
		    total_idr = base_salary_idr + allowance_idr + commission_idr + $2 - $3 WHERE id = $1`, lineID, bonus, deduction, note); err != nil {
			return err
		}
		return s.refreshRunTotal(ctx, q, runID)
	})
	if err != nil {
		return nil, err
	}
	return s.PayRunDetail(ctx, runID)
}

// PayRunAction moves a run: approve (draft → approved), pay (approved →
// paid), reopen (approved → draft).
func (s *Service) PayRunAction(ctx context.Context, userID, id, action string) (*PayRun, error) {
	err := s.tx(ctx, func(q Q) error {
		run, err := s.st.payRun(ctx, q, id, true)
		if err != nil {
			return err
		}
		if run == nil {
			return httpx.NotFound("Payroll terapis tidak ditemukan")
		}
		switch {
		case action == "approve" && run.Status == "draft":
			_, err = q.Exec(ctx, `UPDATE spa.pay_runs SET status = 'approved', approved_at = now(), approved_by = NULLIF($2, '')::uuid, updated_at = now() WHERE id = $1`, id, userID)
		case action == "pay" && run.Status == "approved":
			_, err = q.Exec(ctx, `UPDATE spa.pay_runs SET status = 'paid', paid_at = now(), paid_by = NULLIF($2, '')::uuid, updated_at = now() WHERE id = $1`, id, userID)
		case action == "reopen" && run.Status == "approved":
			_, err = q.Exec(ctx, `UPDATE spa.pay_runs SET status = 'draft', approved_at = NULL, approved_by = NULL, updated_at = now() WHERE id = $1`, id)
		default:
			return httpx.Conflict("Status payroll tidak sesuai untuk aksi ini")
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.PayRunDetail(ctx, id)
}

// DeletePayRun removes a draft run and frees its commission items.
func (s *Service) DeletePayRun(ctx context.Context, id string) error {
	return s.tx(ctx, func(q Q) error {
		run, err := s.st.payRun(ctx, q, id, true)
		if err != nil {
			return err
		}
		if run == nil {
			return httpx.NotFound("Payroll terapis tidak ditemukan")
		}
		if run.Status != "draft" {
			return httpx.Conflict("Hanya payroll draft yang bisa dihapus")
		}
		_, err = q.Exec(ctx, `DELETE FROM spa.pay_runs WHERE id = $1`, id)
		return err
	})
}

// MyPay is the therapist's lines in approved or paid runs (latest first).
func (s *Service) MyPay(ctx context.Context, userID string) ([]PayLine, error) {
	t, err := s.requireMe(ctx, userID)
	if err != nil {
		return nil, err
	}
	return many(ctx, s.db, func(r pgx.Row) (PayLine, error) {
		var kind, status, payDate, from, to string
		line, err := scanPayLine(r, &kind, &status, &payDate, &from, &to)
		line.RunKind, line.RunStatus, line.PayDate, line.PeriodFrom, line.PeriodTo = kind, status, payDate, from, to
		return line, err
	}, `SELECT `+payLineColumns+`, r.kind, r.status, r.pay_date::text, r.period_start::text, r.period_end::text
	   FROM `+payLineFrom+` JOIN spa.pay_runs r ON r.id = l.run_id
	  WHERE l.therapist_id = $1 AND r.status IN ('approved', 'paid')
	  ORDER BY r.pay_date DESC LIMIT 12`, t.ID)
}
