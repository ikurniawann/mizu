package spa

import (
 "context"
 "net/http"
 "time"

 "github.com/jackc/pgx/v5"
 "nuhabit/backend/internal/modules/spa/domain"
 "nuhabit/backend/internal/platform/auth"
 "nuhabit/backend/internal/platform/httpx"
)

type CustomerReportRow struct {
 CustomerID string `json:"customer_id"`
 CustomerName string `json:"customer_name"`
 Transactions int `json:"transactions"`
 Sales float64 `json:"sales"`
}
type TreatmentReportRow struct {
 TreatmentID string `json:"treatment_id"`
 TreatmentName string `json:"treatment_name"`
 Quantity float64 `json:"quantity"`
}
type CustomerPeriod struct {
 Period string `json:"period"`
 Customers int `json:"customers"`
}
type CustomerReport struct {
 From string `json:"from"`
 To string `json:"to"`
 Interval string `json:"interval"`
 TotalCustomers int `json:"total_customers"`
 TotalTransactions int `json:"total_transactions"`
 TotalSales float64 `json:"total_sales"`
 TopTreatments []TreatmentReportRow `json:"top_treatments"`
 TopCustomers []CustomerReportRow `json:"top_customers"`
 TopSalesCustomers []CustomerReportRow `json:"top_sales_customers"`
 Periods []CustomerPeriod `json:"periods"`
}

func (h *Handler) customerReport(w http.ResponseWriter, r *http.Request, u *auth.User) error {
 from, to, branch, err := reportParams(r)
 if err != nil { return err }
 result, err := h.svc.CustomerReport(r.Context(), u.ID, from, to, branch, r.URL.Query().Get("interval"))
 if err != nil { return err }
 return ok(w, result)
}

const customerPaidOrders = `FROM pos.pos_orders o
 WHERE o.ordered_at >= $1 AND o.ordered_at < $2
 AND o.branch_id = ANY($3::uuid[]) AND o.customer_id IS NOT NULL
 AND o.payment_status = 'paid' AND o.status NOT IN ('cancelled', 'voided', 'merged')
 AND o.voided_at IS NULL`

func (s *Service) CustomerReport(ctx context.Context, userID, from, to, branchID, interval string) (*CustomerReport, error) {
 periods, err := domain.TrendPeriods(from, to, interval)
 if err != nil { return nil, httpx.BadRequest(err.Error()) }
 branches, err := s.reportBranchIDs(ctx, userID, branchID)
 if err != nil { return nil, err }
 start, end, _ := domain.RangeBounds(from, to)
 result := &CustomerReport{From:from, To:to, Interval:interval, TopTreatments:[]TreatmentReportRow{}, TopCustomers:[]CustomerReportRow{}, TopSalesCustomers:[]CustomerReportRow{}, Periods:make([]CustomerPeriod,len(periods))}
 args := []any{start,end,branches}
 err = s.db.QueryRow(ctx, `SELECT count(DISTINCT o.customer_id)::int, count(*)::int, COALESCE(sum(o.total_amount),0)::float8 `+customerPaidOrders, args...).Scan(&result.TotalCustomers,&result.TotalTransactions,&result.TotalSales)
 if err != nil { return nil, err }
 buckets, err := s.st.customerBuckets(ctx, s.db, start, end, branches, interval)
 if err != nil { return nil, err }
 for i, period := range periods { result.Periods[i] = CustomerPeriod{Period:period, Customers:buckets[period]} }
 result.TopTreatments, err = s.st.customerTreatments(ctx, s.db, start, end, branches)
 if err != nil { return nil, err }
 result.TopCustomers, err = s.st.customerLeaders(ctx, s.db, start, end, branches, false)
 if err != nil { return nil, err }
 result.TopSalesCustomers, err = s.st.customerLeaders(ctx, s.db, start, end, branches, true)
 return result, err
}

func (store) customerBuckets(ctx context.Context, q Q, start, end time.Time, branches []string, interval string) (map[string]int, error) {
 precision := map[string]string{"daily":"day", "monthly":"month", "yearly":"year"}[interval]
 rows, err := q.Query(ctx, `SELECT to_char(date_trunc($4, o.ordered_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD'), count(DISTINCT o.customer_id)::int `+customerPaidOrders+` GROUP BY 1`, start,end,branches,precision)
 if err != nil { return nil, err }
 defer rows.Close()
 counts := map[string]int{}
 for rows.Next() { var period string; var count int; if err := rows.Scan(&period,&count); err != nil { return nil, err }; counts[period]=count }
 return counts, rows.Err()
}

func (store) customerTreatments(ctx context.Context, q Q, start, end time.Time, branches []string) ([]TreatmentReportRow, error) {
 return many(ctx, q, func(row pgx.Row) (TreatmentReportRow,error) {
  var v TreatmentReportRow
  err := row.Scan(&v.TreatmentID,&v.TreatmentName,&v.Quantity)
  return v,err
 }, `WITH orders AS (SELECT o.id, o.branch_id `+customerPaidOrders+`)
 SELECT t.id::text, t.name, sum(i.quantity)::float8
 FROM orders o JOIN pos.pos_order_items i ON i.order_id = o.id AND i.kitchen_status IS DISTINCT FROM 'cancelled'
 JOIN spa.variant_pos_products m ON m.pos_product_id = i.product_id AND m.branch_id = o.branch_id
 JOIN spa.treatment_variants v ON v.id = m.variant_id
 JOIN spa.treatments t ON t.id = v.treatment_id
 GROUP BY t.id, t.name ORDER BY sum(i.quantity) DESC, t.name, t.id LIMIT 10`, start,end,branches)
}

func (store) customerLeaders(ctx context.Context, q Q, start, end time.Time, branches []string, bySales bool) ([]CustomerReportRow,error) {
 order := `count(*) DESC, sum(o.total_amount) DESC`
 if bySales { order = `sum(o.total_amount) DESC, count(*) DESC` }
 return many(ctx, q, func(row pgx.Row) (CustomerReportRow,error) {
  var v CustomerReportRow
  err := row.Scan(&v.CustomerID,&v.CustomerName,&v.Transactions,&v.Sales)
  return v,err
 }, `WITH orders AS (SELECT o.customer_id, o.total_amount `+customerPaidOrders+`)
 SELECT c.id::text, COALESCE(NULLIF(btrim(c.name),''), c.phone), count(*)::int, sum(o.total_amount)::float8
 FROM orders o JOIN pos.pos_customers c ON c.id = o.customer_id
 GROUP BY c.id, c.name, c.phone ORDER BY `+order+`, c.id LIMIT 10`, start,end,branches)
}
