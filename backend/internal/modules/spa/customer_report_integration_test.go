package spa_test

import (
 "net/http"
 "testing"

 "nuhabit/backend/internal/platform/testutil"
)

func TestCustomerReportUsesPaidPOSOrdersAndWIB(t *testing.T) {
 e := setup(t)
 var customers [2]string
 for i := range customers {
  if err := e.tx.QueryRow(e.ctx, `INSERT INTO pos.pos_customers (name, phone) VALUES ($1, $2) RETURNING id::text`, "Customer report", "628"+testutil.RandomHex(10)).Scan(&customers[i]); err != nil { t.Fatal(err) }
 }
 var treatment, variant, product string
 if err := e.tx.QueryRow(e.ctx, `INSERT INTO spa.treatments (code, name) VALUES ($1, 'Pijat') RETURNING id::text`, "R"+testutil.RandomHex(8)).Scan(&treatment); err != nil { t.Fatal(err) }
 if err := e.tx.QueryRow(e.ctx, `INSERT INTO spa.treatment_variants (treatment_id, name, duration_min, price_idr) VALUES ($1, '60 menit', 60, 100) RETURNING id::text`, treatment).Scan(&variant); err != nil { t.Fatal(err) }
 if err := e.tx.QueryRow(e.ctx, `INSERT INTO pos.pos_products (sku, name, station) VALUES ($1, 'Pijat 60 menit', 'spa') RETURNING id::text`, "R"+testutil.RandomHex(8)).Scan(&product); err != nil { t.Fatal(err) }
 if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.variant_pos_products (variant_id, branch_id, pos_product_id) VALUES ($1,$2,$3)`, variant, e.org.BranchID, product); err != nil { t.Fatal(err) }
 cashier := e.employee("Customer report cashier", nil)
 for i, row := range []struct{ customer, at, payment, status string; total int }{
  {customers[0], "2031-01-14T17:00:00Z", "paid", "completed", 100},
  {customers[0], "2031-01-15T03:00:00Z", "paid", "completed", 100},
  {customers[1], "2031-01-15T04:00:00Z", "paid", "completed", 300},
  {customers[1], "2031-01-15T05:00:00Z", "unpaid", "completed", 900},
  {customers[1], "2031-01-15T06:00:00Z", "paid", "voided", 900},
  {customers[1], "2031-01-14T16:59:59Z", "paid", "completed", 900},
 } {
  var order string
  if err := e.tx.QueryRow(e.ctx, `INSERT INTO pos.pos_orders (order_number, cashier_id, customer_id, branch_id, ordered_at, payment_status, status, total_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`, "R"+testutil.RandomHex(8), cashier, row.customer, e.org.BranchID, row.at, row.payment, row.status, row.total).Scan(&order); err != nil { t.Fatal(err) }
  if i < 3 { if _, err := e.tx.Exec(e.ctx, `INSERT INTO pos.pos_order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, subtotal, total_amount) VALUES ($1,$2,'Pijat 60 menit','P',1,100,100,100)`, order, product); err != nil { t.Fatal(err) } }
 }
 path := "/api/spa/reports/customer?from=2031-01-15&to=2031-01-16&branch_id="+e.org.BranchID+"&interval=daily"
 got := e.data(&e.admin, "GET", path, nil, 200)
 if got["total_customers"] != float64(2) || got["total_transactions"] != float64(3) || got["total_sales"] != float64(500) { t.Fatalf("summary: %v", got) }
 treatments := got["top_treatments"].([]any)
 if len(treatments) != 1 || treatments[0].(map[string]any)["quantity"] != float64(3) { t.Fatalf("treatments: %v", treatments) }
 visits := got["top_customers"].([]any)
 if visits[0].(map[string]any)["customer_id"] != customers[0] { t.Fatalf("visits: %v", visits) }
 sales := got["top_sales_customers"].([]any)
 if sales[0].(map[string]any)["customer_id"] != customers[1] { t.Fatalf("sales: %v", sales) }
 periods := got["periods"].([]any)
 if len(periods) != 2 || periods[0].(map[string]any)["customers"] != float64(1) || periods[1].(map[string]any)["customers"] != float64(2) { t.Fatalf("periods: %v", periods) }
 for _, interval := range []string{"monthly", "yearly"} {
  grouped := e.data(&e.admin, "GET", "/api/spa/reports/customer?from=2031-01-15&to=2031-01-16&branch_id="+e.org.BranchID+"&interval="+interval, nil, 200)
  rows := grouped["periods"].([]any)
  if len(rows) != 1 || rows[0].(map[string]any)["customers"] != float64(2) { t.Fatalf("%s periods: %v", interval, rows) }
 }
 e.call(&e.therapist, "GET", path, nil, http.StatusForbidden)
 e.call(nil, "GET", path, nil, http.StatusUnauthorized)
 e.call(&e.admin, "GET", path+"&interval=weekly", nil, http.StatusBadRequest)
}
