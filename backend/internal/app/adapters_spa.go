package app

import (
	"context"
	"strings"

	"nuhabit/backend/internal/modules/hris/domain"
	"nuhabit/backend/internal/modules/spa"
	spadomain "nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
)

// spa adapters: the POS catalog and open bills (pos-ops / pos-sales tables),
// POS customers, and HRIS employees, shifts and leave. Each method runs on
// the caller's querier so it joins the spa transaction.

// SpaPorts wires the spa module.
func SpaPorts() spa.Ports {
	return spa.Ports{POS: spaPOS{}, Customers: spaCustomers{}, People: spaPeople{}}
}

// spaFallbackCashier is the POS placeholder cashier for staff without an
// employee record (pos-sales uses the same id).
const spaFallbackCashier = "00000000-0000-0000-0000-000000000001"

/* ── POS ─────────────────────────────────────────────────────────────── */

type spaPOS struct{}

var _ spa.POS = spaPOS{}

// EnsureTreatmentProduct upserts the master product (item.products, in the
// outlet stall, station spa) and its POS product, returning the POS id.
func (spaPOS) EnsureTreatmentProduct(ctx context.Context, q database.Querier, p spa.TreatmentProduct) (string, error) {
	var masterID *string
	if p.ExistingID != "" {
		if err := q.QueryRow(ctx, `SELECT source_product_id::text FROM pos.pos_products WHERE id = $1`, p.ExistingID).
			Scan(&masterID); err != nil && !database.IsNoRows(err) {
			return "", err
		}
	}
	if masterID == nil {
		var id string
		err := q.QueryRow(ctx, `SELECT id::text FROM item.products
		  WHERE warehouse_id = $1 AND kode = $2 AND deleted_at IS NULL LIMIT 1`, p.WarehouseID, p.Code).Scan(&id)
		if err != nil && !database.IsNoRows(err) {
			return "", err
		}
		if id != "" {
			masterID = &id
		}
	}
	if masterID == nil {
		var id string
		if err := q.QueryRow(ctx, `INSERT INTO item.products (kode, nama, kategori, harga_jual, harga_modal, markup_persen,
		    company_id, branch_id, warehouse_id, station, production_output_type, is_active)
		  VALUES ($1, $2, $3, $4, 0, 0, $5::uuid, $6, $7, 'spa', 'FINISHED_GOOD', $8) RETURNING id::text`,
			p.Code, p.Name, p.Category, p.Price, p.CompanyID, p.BranchID, p.WarehouseID, p.Active).Scan(&id); err != nil {
			return "", err
		}
		masterID = &id
	} else if _, err := q.Exec(ctx, `UPDATE item.products SET nama = $2, kategori = $3, harga_jual = $4, station = 'spa',
	    is_active = $5, updated_at = now() WHERE id = $1`, *masterID, p.Name, p.Category, p.Price, p.Active); err != nil {
		return "", err
	}

	var categoryID *string
	if err := q.QueryRow(ctx, `SELECT id::text FROM pos.pos_categories WHERE lower(name) = lower($1) ORDER BY display_order LIMIT 1`,
		p.Category).Scan(&categoryID); err != nil && !database.IsNoRows(err) {
		return "", err
	}
	var id string
	if err := q.QueryRow(ctx, `SELECT id::text FROM pos.pos_products WHERE source_product_id = $1 OR sku = $2
	  ORDER BY (source_product_id = $1) DESC NULLS LAST LIMIT 1`, *masterID, p.SKU).Scan(&id); err != nil && !database.IsNoRows(err) {
		return "", err
	}
	if id != "" {
		_, err := q.Exec(ctx, `UPDATE pos.pos_products SET name = $2, category_id = $3::uuid, base_price = $4, is_active = $5,
		    station = 'spa', source_product_id = $6::uuid, updated_at = now() WHERE id = $1`,
			id, p.Name, categoryID, p.Price, p.Active, *masterID)
		return id, err
	}
	err := q.QueryRow(ctx, `INSERT INTO pos.pos_products (sku, name, description, category_id, base_price, cost_price,
	    is_active, is_available, inventory_tracking, station, source_product_id, sales_channels)
	  VALUES ($1, $2, 'Treatment spa', $3::uuid, $4, 0, $5, true, false, 'spa', $6::uuid, ARRAY['pos'])
	  RETURNING id::text`, p.SKU, p.Name, categoryID, p.Price, p.Active, *masterID).Scan(&id)
	return id, err
}

// OpenBill inserts an unpaid POS order (open bill) with the treatment lines;
// the cashier settles it through the normal PATCH /api/pos/orders/{id}.
func (spaPOS) OpenBill(ctx context.Context, q database.Querier, b spa.Bill) (spa.OrderRef, error) {
	var number string
	if err := q.QueryRow(ctx, `SELECT public.generate_order_number()`).Scan(&number); err != nil {
		return spa.OrderRef{}, err
	}
	cashier := spaFallbackCashier
	var employee string
	if err := q.QueryRow(ctx, `SELECT id::text FROM hris.employees WHERE user_id = $1 LIMIT 1`, b.CashierUserID).
		Scan(&employee); err != nil && !database.IsNoRows(err) {
		return spa.OrderRef{}, err
	}
	if employee != "" {
		cashier = employee
	}
	total := 0.0
	for _, l := range b.Lines {
		total += l.UnitPrice
	}
	var id string
	err := q.QueryRow(ctx, `INSERT INTO pos.pos_orders (order_number, order_type, status, payment_status, customer_id,
	    cashier_id, guest_count, subtotal, discount_amount, tax_amount, service_charge_amount, other_charges_amount,
	    charges_breakdown, total_amount, amount_paid, ark_coins_used, notes, contact_name, contact_phone,
	    company_id, branch_id, warehouse_id, sold_from, ordered_at)
	  VALUES ($1, 'dine_in', 'pending', 'unpaid', $2::uuid, $3::uuid, 1, $4, 0, 0, 0, 0, '[]'::jsonb, $4, 0, 0, $5,
	    $6, NULLIF($7, ''), $8::uuid, $9, $10, 'stall', now())
	  RETURNING id::text`, number, b.CustomerID, cashier, total, b.Notes, b.ContactName, b.ContactPhone,
		b.CompanyID, b.BranchID, b.WarehouseID).Scan(&id)
	if err != nil {
		return spa.OrderRef{}, err
	}
	for _, l := range b.Lines {
		if _, err := q.Exec(ctx, `INSERT INTO pos.pos_order_items (order_id, product_id, product_name, product_sku,
		    variants, modifiers, quantity, unit_price, subtotal, total_amount, kitchen_notes, station, kitchen_status,
		    xp_earned, inventory_deducted)
		  VALUES ($1, $2, $3, $4, '[]'::jsonb, '[]'::jsonb, 1, $5, $5, $5, NULLIF($6, ''), 'spa', 'served', 0, false)`,
			id, l.ProductID, l.Name, l.SKU, l.UnitPrice, l.Note); err != nil {
			return spa.OrderRef{}, err
		}
	}
	if _, err := q.Exec(ctx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes)
	  VALUES ($1, NULL, 'pending', $2, $3)`, id, cashier, b.Notes); err != nil {
		return spa.OrderRef{}, err
	}
	return spa.OrderRef{ID: id, Number: number}, nil
}

func (spaPOS) OrderStates(ctx context.Context, q database.Querier, ids []string) (map[string]spa.OrderState, error) {
	out := map[string]spa.OrderState{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, order_number, status::text, payment_status::text
	   FROM pos.pos_orders WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var s spa.OrderState
		if err := rows.Scan(&id, &s.Number, &s.Status, &s.PaymentStatus); err != nil {
			return nil, err
		}
		out[id] = s
	}
	return out, rows.Err()
}

/* ── customers ───────────────────────────────────────────────────────── */

type spaCustomers struct{}

var _ spa.Customers = spaCustomers{}

func (spaCustomers) Search(ctx context.Context, q database.Querier, term string, limit int) ([]spa.CustomerRef, error) {
	like := "%" + strings.ReplaceAll(strings.ReplaceAll(term, "%", ""), "_", "") + "%"
	rows, err := q.Query(ctx, `SELECT id::text, COALESCE(name, ''), phone, email FROM pos.pos_customers
	  WHERE COALESCE(is_active, true) AND (name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1)
	  ORDER BY last_visit DESC NULLS LAST, name LIMIT $2`, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []spa.CustomerRef{}
	for rows.Next() {
		var c spa.CustomerRef
		if err := rows.Scan(&c.ID, &c.Name, &c.Phone, &c.Email); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (spaCustomers) FindOrCreate(ctx context.Context, q database.Querier, name, phone string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO pos.pos_customers (phone, name, member_type)
	  VALUES ($1, $2, 'registered')
	  ON CONFLICT (phone) DO UPDATE SET name = COALESCE(NULLIF(pos.pos_customers.name, ''), EXCLUDED.name)
	  RETURNING id::text`, phone, name).Scan(&id)
	return id, err
}

/* ── people ──────────────────────────────────────────────────────────── */

type spaPeople struct{}

var _ spa.People = spaPeople{}

func (spaPeople) SearchEmployees(ctx context.Context, q database.Querier, term string, limit int) ([]spa.EmployeeCandidate, error) {
	like := "%" + term + "%"
	rows, err := q.Query(ctx, `SELECT e.id::text, e.full_name, e.nip, p.title
	   FROM hris.employees e LEFT JOIN hris.positions p ON p.id = e.job_title_id
	  WHERE COALESCE(e.is_active, true) AND ($1 = '%%' OR e.full_name ILIKE $1 OR e.nip ILIKE $1)
	  ORDER BY e.full_name LIMIT $2`, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []spa.EmployeeCandidate{}
	for rows.Next() {
		var c spa.EmployeeCandidate
		if err := rows.Scan(&c.ID, &c.FullName, &c.NIP, &c.PositionTitle); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (spaPeople) EmployeeExists(ctx context.Context, q database.Querier, id string) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM hris.employees WHERE id = $1)`, id).Scan(&ok)
	return ok, err
}

func (spaPeople) EmployeeIDByUser(ctx context.Context, q database.Querier, userID string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM hris.employees WHERE user_id = $1 ORDER BY is_active DESC NULLS LAST LIMIT 1`, userID).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

// Rosters reads each employee's shift pattern row in force on date (hris
// employee_shifts + shifts, resolved with the HRIS domain rule) and whether
// an approved leave covers the date.
func (spaPeople) Rosters(ctx context.Context, q database.Querier, employeeIDs []string, date string) (map[string]spa.Roster, error) {
	out := map[string]spa.Roster{}
	if len(employeeIDs) == 0 {
		return out, nil
	}
	start, _, ok := spadomain.DayBounds(date)
	if !ok {
		return out, nil
	}
	weekday := spadomain.Weekday(start)
	rows, err := q.Query(ctx, `SELECT es.employee_id::text, es.effective_from::text, es.effective_to::text,
	        s.id::text, s.name, to_char(s.start_time, 'HH24:MI'), to_char(s.end_time, 'HH24:MI')
	   FROM hris.employee_shifts es LEFT JOIN hris.shifts s ON s.id = es.shift_id
	  WHERE es.employee_id = ANY($1::uuid[]) AND es.day_of_week = $2`, employeeIDs, weekday)
	if err != nil {
		return nil, err
	}
	type pattern struct {
		row   domain.ScheduleRow
		shift *spa.ShiftInfo
	}
	patterns := map[string][]pattern{}
	for rows.Next() {
		var emp, from string
		var to, shiftID, name, startT, endT *string
		if err := rows.Scan(&emp, &from, &to, &shiftID, &name, &startT, &endT); err != nil {
			rows.Close()
			return nil, err
		}
		p := pattern{row: domain.ScheduleRow{DayOfWeek: weekday, EffectiveFrom: from, EffectiveTo: to, ShiftID: shiftID}}
		if shiftID != nil && name != nil && startT != nil && endT != nil {
			p.shift = &spa.ShiftInfo{Name: *name, StartTime: *startT, EndTime: *endT}
		}
		patterns[emp] = append(patterns[emp], p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for emp, list := range patterns {
		rowsOnly := make([]domain.ScheduleRow, len(list))
		for i, p := range list {
			rowsOnly[i] = p.row
		}
		r := spa.Roster{}
		if i := domain.ResolveScheduleRow(rowsOnly, date); i >= 0 {
			r.Shift = list[i].shift
			r.DayOff = list[i].shift == nil
		}
		out[emp] = r
	}
	leaves, err := q.Query(ctx, `SELECT DISTINCT employee_id::text FROM hris.leaves
	  WHERE employee_id = ANY($1::uuid[]) AND status::text = 'approved' AND $2::date BETWEEN start_date AND end_date`, employeeIDs, date)
	if err != nil {
		return nil, err
	}
	defer leaves.Close()
	for leaves.Next() {
		var emp string
		if err := leaves.Scan(&emp); err != nil {
			return nil, err
		}
		r := out[emp]
		r.OnLeave = true
		out[emp] = r
	}
	return out, leaves.Err()
}
