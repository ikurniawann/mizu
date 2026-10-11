package insights

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/insights/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/validate"
)

type reportOutlet struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type monthlySalesTarget struct {
	ID         string  `json:"id"`
	BranchID   string  `json:"branch_id"`
	BranchName string  `json:"branch_name"`
	Month      string  `json:"month"`
	Amount     float64 `json:"amount"`
}

type salesTargetInput struct {
	BranchID string  `json:"branch_id"`
	Month    string  `json:"month"`
	Amount   float64 `json:"amount"`
}

type salesTargetMonth struct {
	Month       string   `json:"month"`
	Sales       float64  `json:"sales"`
	Target      *float64 `json:"target"`
	TargetCount int      `json:"target_count"`
}

type salesTargetReport struct {
	Year        int                `json:"year"`
	Outlets     []reportOutlet     `json:"outlets"`
	OutletCount int                `json:"outlet_count"`
	Months      []salesTargetMonth `json:"months"`
}

func (s *Service) salesTargetRoutes() []module.Route {
	staff := func(pattern, action string, fn func(http.ResponseWriter, *http.Request, *auth.User) error) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			u, err := s.auth.RequireMenuAction(r, action, iam.ReportSalesTarget...)
			if err != nil {
				return err
			}
			return fn(w, r, u)
		})}
	}
	return []module.Route{
		staff("GET /api/reports/sales-vs-target", "read", s.salesVsTarget),
		staff("GET /api/reports/sales-targets", "read", s.listSalesTargets),
		staff("POST /api/reports/sales-targets", "create", s.createSalesTarget),
		staff("PATCH /api/reports/sales-targets/{id}", "update", s.updateSalesTarget),
		staff("DELETE /api/reports/sales-targets/{id}", "delete", s.deleteSalesTarget),
		staff("GET /api/reports/sales-target-years", "read", s.listSalesTargetYears),
		staff("PUT /api/reports/sales-target-years/{year}", "read", s.saveSalesTargetYear),
		staff("DELETE /api/reports/sales-target-years/{year}", "delete", s.deleteSalesTargetYear),
	}
}

func (s *Service) salesOutlets(ctx context.Context, userID string) ([]reportOutlet, error) {
	sc, err := scope.Load(ctx, s.db, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT b.id::text,b.name FROM configuration.branches b
	 LEFT JOIN configuration.companies c ON c.id=b.company_id
	 WHERE $1::boolean OR ($2='holding' AND c.holding_id=$3::uuid)
	 OR ($2='company' AND b.company_id=$4::uuid) OR ($2='branch' AND b.id=$5::uuid)
	 ORDER BY b.name,b.id`, sc.Unscoped, sc.Level(), sc.HoldingID, sc.CompanyID, sc.BranchID)
	if err != nil {
		return nil, err
	}
	outlets, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (reportOutlet, error) {
		var o reportOutlet
		err := r.Scan(&o.ID, &o.Name)
		return o, err
	})
	return outlets, err
}

func (s *Service) salesFilters(r *http.Request, u *auth.User) (int, []reportOutlet, []string, error) {
	year := s.now().In(domain.WIB).Year()
	if raw := r.URL.Query().Get("year"); raw != "" {
		var err error
		year, err = strconv.Atoi(raw)
		if err != nil || year < 2000 || year > 2100 {
			return 0, nil, nil, httpx.BadRequest("Tahun harus antara 2000 dan 2100")
		}
	}
	branch := r.URL.Query().Get("branch_id")
	if branch != "" && !validate.IsUUID(branch) {
		return 0, nil, nil, httpx.BadRequest("Outlet tidak valid")
	}
	outlets, err := s.salesOutlets(r.Context(), u.ID)
	if err != nil {
		return 0, nil, nil, err
	}
	ids := make([]string, 0, len(outlets))
	for _, o := range outlets {
		if branch == "" || branch == o.ID {
			ids = append(ids, o.ID)
		}
	}
	if branch != "" && len(ids) == 0 {
		return 0, nil, nil, httpx.Forbidden("Outlet di luar akses Anda")
	}
	return year, outlets, ids, nil
}

func (s *Service) salesVsTarget(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	year, outlets, ids, err := s.salesFilters(r, u)
	if err != nil {
		return err
	}
	start := time.Date(year, 1, 1, 0, 0, 0, 0, domain.WIB)
	end := start.AddDate(1, 0, 0)
	// Aggregate order headers once; Spa checkouts already create POS orders.
	// Legacy orders without branch_id inherit their warehouse's branch.
	rows, err := s.db.Query(r.Context(), `WITH sales AS (
	 SELECT date_trunc('month',o.ordered_at AT TIME ZONE 'Asia/Jakarta')::date AS month,
	 sum(o.total_amount) AS amount FROM pos.pos_orders o
	 LEFT JOIN configuration.warehouses wh ON wh.id=o.warehouse_id
	 WHERE o.ordered_at >= $1 AND o.ordered_at < $2 AND o.payment_status='paid'
	 AND o.status NOT IN ('cancelled','voided','merged') AND o.voided_at IS NULL
	 AND o.merged_to_order_id IS NULL AND COALESCE(o.branch_id,wh.branch_id)=ANY($3::uuid[])
	 GROUP BY 1
	), targets AS (
	 SELECT month,sum(amount) AS amount,count(*)::int AS count
	 FROM configuration.monthly_sales_targets WHERE month >= $4::date AND month < $5::date
	 AND branch_id=ANY($3::uuid[]) GROUP BY month
	)
	 SELECT to_char(m.month,'YYYY-MM'),COALESCE(s.amount,0)::float8,t.amount::float8,COALESCE(t.count,0)
	 FROM generate_series($4::date,($5::date - interval '1 month'),'1 month'::interval) m(month)
	 LEFT JOIN sales s ON s.month=m.month::date LEFT JOIN targets t ON t.month=m.month::date ORDER BY m.month`,
		start, end, ids, start.Format("2006-01-02"), end.Format("2006-01-02"))
	if err != nil {
		return err
	}
	months, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (salesTargetMonth, error) {
		var m salesTargetMonth
		err := r.Scan(&m.Month, &m.Sales, &m.Target, &m.TargetCount)
		return m, err
	})
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, salesTargetReport{Year: year, Outlets: outlets, OutletCount: len(ids), Months: months})
}

const targetColumns = `t.id::text,t.branch_id::text,b.name,to_char(t.month,'YYYY-MM'),t.amount::float8`

func (s *Service) listSalesTargets(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	year, _, ids, err := s.salesFilters(r, u)
	if err != nil {
		return err
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+targetColumns+` FROM configuration.monthly_sales_targets t
	 JOIN configuration.branches b ON b.id=t.branch_id
	 WHERE t.branch_id=ANY($1::uuid[]) AND EXTRACT(YEAR FROM t.month)=$2 ORDER BY t.month,b.name,t.id`, ids, year)
	if err != nil {
		return err
	}
	targets, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (monthlySalesTarget, error) {
		var t monthlySalesTarget
		err := r.Scan(&t.ID, &t.BranchID, &t.BranchName, &t.Month, &t.Amount)
		return t, err
	})
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, targets)
}

func (s *Service) salesTargetBody(r *http.Request, u *auth.User) (salesTargetInput, error) {
	var body salesTargetInput
	if err := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 4096)).Decode(&body); err != nil {
		return body, httpx.BadRequest("Data target tidak valid")
	}
	month, err := time.Parse("2006-01", body.Month)
	if err != nil || month.Year() < 2000 || month.Year() > 2100 {
		return body, httpx.BadRequest("Bulan target tidak valid")
	}
	if !validate.IsUUID(body.BranchID) {
		return body, httpx.BadRequest("Outlet wajib dipilih")
	}
	if math.IsNaN(body.Amount) || math.IsInf(body.Amount, 0) || body.Amount <= 0 || body.Amount > 100000000000 || math.Round(body.Amount*100) == 0 {
		return body, httpx.BadRequest("Target harus lebih dari 0 dan maksimal Rp100 miliar")
	}
	outlets, err := s.salesOutlets(r.Context(), u.ID)
	if err != nil {
		return body, err
	}
	if !slices.ContainsFunc(outlets, func(o reportOutlet) bool { return o.ID == body.BranchID }) {
		return body, httpx.Forbidden("Outlet di luar akses Anda")
	}
	return body, nil
}

func (s *Service) targetInScope(r *http.Request, u *auth.User) (string, []string, error) {
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return "", nil, httpx.BadRequest("ID target tidak valid")
	}
	outlets, err := s.salesOutlets(r.Context(), u.ID)
	if err != nil {
		return "", nil, err
	}
	ids := make([]string, 0, len(outlets))
	for _, o := range outlets {
		ids = append(ids, o.ID)
	}
	var found string
	err = s.db.QueryRow(r.Context(), `SELECT id::text FROM configuration.monthly_sales_targets WHERE id=$1 AND branch_id=ANY($2::uuid[])`, id, ids).Scan(&found)
	if database.IsNoRows(err) {
		return "", nil, httpx.NotFound("Target tidak ditemukan")
	}
	return found, ids, err
}

func (s *Service) createSalesTarget(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	body, err := s.salesTargetBody(r, u)
	if err != nil {
		return err
	}
	return salesTargetResponse(w, s.db.QueryRow(r.Context(), `WITH t AS (
 INSERT INTO configuration.monthly_sales_targets(branch_id,month,amount,created_by,updated_by)
 VALUES ($1,$2::date,$3,$4,$4) RETURNING *)
 SELECT `+targetColumns+` FROM t JOIN configuration.branches b ON b.id=t.branch_id`, body.BranchID, body.Month+"-01", body.Amount, u.ID), http.StatusCreated)
}

func (s *Service) updateSalesTarget(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, ids, err := s.targetInScope(r, u)
	if err != nil {
		return err
	}
	body, err := s.salesTargetBody(r, u)
	if err != nil {
		return err
	}
	// Recheck scope in the write itself if another editor moved the target.
	return salesTargetResponse(w, s.db.QueryRow(r.Context(), `WITH t AS (
 UPDATE configuration.monthly_sales_targets SET branch_id=$2,month=$3::date,amount=$4,updated_by=$5,updated_at=now()
 WHERE id=$1 AND branch_id=ANY($6::uuid[]) RETURNING *)
 SELECT `+targetColumns+` FROM t JOIN configuration.branches b ON b.id=t.branch_id`, id, body.BranchID, body.Month+"-01", body.Amount, u.ID, ids), http.StatusOK)
}

func salesTargetResponse(w http.ResponseWriter, row pgx.Row, status int) error {
	var target monthlySalesTarget
	err := row.Scan(&target.ID, &target.BranchID, &target.BranchName, &target.Month, &target.Amount)
	if database.IsUniqueViolation(err) {
		return httpx.Conflict("Target untuk outlet dan bulan ini sudah ada")
	}
	if database.IsNoRows(err) {
		return httpx.NotFound("Target tidak ditemukan")
	}
	if err != nil {
		return err
	}
	return httpx.Data(w, status, target)
}

func (s *Service) deleteSalesTarget(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, ids, err := s.targetInScope(r, u)
	if err != nil {
		return err
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM configuration.monthly_sales_targets WHERE id=$1 AND branch_id=ANY($2::uuid[])`, id, ids)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Target tidak ditemukan")
	}
	return httpx.Data(w, http.StatusOK, map[string]string{"id": id})
}
