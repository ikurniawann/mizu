package spa

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Q is a pool or a transaction.
type Q = database.Querier

// store holds the SQL of the spa schema. Read models join
// configuration.branches/warehouses, hris.employees and pos.pos_customers for
// display names only (the gym-scheduling convention); every write outside
// the spa schema goes through Ports.
type store struct{}

func one[T any](v *T, err error) (*T, error) {
	if database.IsNoRows(err) {
		return nil, nil
	}
	return v, err
}

func many[T any](ctx context.Context, q Q, scan func(pgx.Row) (T, error), sql string, args ...any) ([]T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// where builds a dynamic WHERE clause with numbered args.
type where struct {
	parts []string
	args  []any
}

func (w *where) add(cond string, v any) {
	w.args = append(w.args, v)
	w.parts = append(w.parts, strings.ReplaceAll(cond, "?", "$"+strconv.Itoa(len(w.args))))
}

func (w *where) sql() string {
	if len(w.parts) == 0 {
		return "true"
	}
	return strings.Join(w.parts, " AND ")
}

func jsTime(t time.Time) httpx.JSTime { return httpx.JSTime(t) }

/* ── outlets ─────────────────────────────────────────────────────────── */

// outletRow is an outlet's configuration as booking rules need it.
type outletRow struct {
	BranchID      string
	BranchName    string
	BranchCode    string
	CompanyID     *string
	WarehouseID   string
	OpenTime      string
	CloseTime     string
	SlotMinutes   int
	PublicBooking bool
	IsActive      bool
}

func (store) outlets(ctx context.Context, q Q) ([]Outlet, error) {
	return many(ctx, q, func(r pgx.Row) (Outlet, error) {
		var o Outlet
		var configured *string
		var open, closeAt *string
		var slot *int
		var public, active *bool
		var whIDs, whNames, whCodes []string
		err := r.Scan(&o.BranchID, &o.BranchName, &o.CompanyID, &configured, &o.WarehouseID, &o.WarehouseName,
			&open, &closeAt, &slot, &public, &active, &whIDs, &whNames, &whCodes)
		o.Configured = configured != nil
		o.OpenTime, o.CloseTime, o.SlotMinutes, o.PublicBooking, o.IsActive = "10:00", "22:00", 30, true, false
		if o.Configured {
			o.OpenTime, o.CloseTime, o.SlotMinutes, o.PublicBooking, o.IsActive = *open, *closeAt, *slot, *public, *active
		}
		o.Warehouses = make([]WarehouseRef, len(whIDs))
		for i := range whIDs {
			o.Warehouses[i] = WarehouseRef{ID: whIDs[i], Name: whNames[i], Code: whCodes[i]}
		}
		return o, err
	}, `SELECT b.id::text, b.name, b.company_id::text, so.branch_id::text, so.warehouse_id::text, w.name,
	        to_char(so.open_time, 'HH24:MI'), to_char(so.close_time, 'HH24:MI'), so.slot_minutes, so.public_booking, so.is_active,
	        COALESCE((SELECT array_agg(x.id::text ORDER BY x.is_default DESC, x.name) FROM configuration.warehouses x
	                   WHERE x.branch_id = b.id AND x.is_active), '{}'),
	        COALESCE((SELECT array_agg(x.name ORDER BY x.is_default DESC, x.name) FROM configuration.warehouses x
	                   WHERE x.branch_id = b.id AND x.is_active), '{}'),
	        COALESCE((SELECT array_agg(COALESCE(x.code, '') ORDER BY x.is_default DESC, x.name) FROM configuration.warehouses x
	                   WHERE x.branch_id = b.id AND x.is_active), '{}')
	   FROM configuration.branches b
	   LEFT JOIN spa.outlets so ON so.branch_id = b.id
	   LEFT JOIN configuration.warehouses w ON w.id = so.warehouse_id
	  WHERE b.is_active
	  ORDER BY (so.branch_id IS NULL), b.name`)
}

func (store) outlet(ctx context.Context, q Q, branchID string) (*outletRow, error) {
	var o outletRow
	err := q.QueryRow(ctx, `SELECT b.id::text, b.name, COALESCE(b.code, ''), b.company_id::text, so.warehouse_id::text,
	        to_char(so.open_time, 'HH24:MI'), to_char(so.close_time, 'HH24:MI'), so.slot_minutes, so.public_booking,
	        so.is_active AND b.is_active
	   FROM spa.outlets so JOIN configuration.branches b ON b.id = so.branch_id
	  WHERE so.branch_id = $1`, branchID).Scan(&o.BranchID, &o.BranchName, &o.BranchCode, &o.CompanyID, &o.WarehouseID,
		&o.OpenTime, &o.CloseTime, &o.SlotMinutes, &o.PublicBooking, &o.IsActive)
	return one(&o, err)
}

func (store) branchExists(ctx context.Context, q Q, branchID string) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM configuration.branches WHERE id = $1)`, branchID).Scan(&ok)
	return ok, err
}

func (store) warehouseOfBranch(ctx context.Context, q Q, warehouseID, branchID string) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM configuration.warehouses WHERE id = $1 AND branch_id = $2)`,
		warehouseID, branchID).Scan(&ok)
	return ok, err
}

type outletInput struct {
	WarehouseID   string
	OpenTime      string
	CloseTime     string
	SlotMinutes   int
	PublicBooking bool
	IsActive      bool
}

func (store) upsertOutlet(ctx context.Context, q Q, branchID string, in outletInput) error {
	_, err := q.Exec(ctx, `INSERT INTO spa.outlets (branch_id, warehouse_id, open_time, close_time, slot_minutes, public_booking, is_active)
	  VALUES ($1, $2, $3::time, $4::time, $5, $6, $7)
	  ON CONFLICT (branch_id) DO UPDATE SET warehouse_id = EXCLUDED.warehouse_id, open_time = EXCLUDED.open_time,
	    close_time = EXCLUDED.close_time, slot_minutes = EXCLUDED.slot_minutes, public_booking = EXCLUDED.public_booking,
	    is_active = EXCLUDED.is_active, updated_at = now()`,
		branchID, in.WarehouseID, in.OpenTime, in.CloseTime, in.SlotMinutes, in.PublicBooking, in.IsActive)
	return err
}

func (store) publicOutlets(ctx context.Context, q Q) ([]PublicOutlet, error) {
	return many(ctx, q, func(r pgx.Row) (PublicOutlet, error) {
		var o PublicOutlet
		err := r.Scan(&o.BranchID, &o.Name, &o.Address, &o.City, &o.Phone, &o.OpenTime, &o.CloseTime, &o.SlotMinutes)
		return o, err
	}, `SELECT b.id::text, b.name, b.address, b.city, b.phone,
	        to_char(so.open_time, 'HH24:MI'), to_char(so.close_time, 'HH24:MI'), so.slot_minutes
	   FROM spa.outlets so JOIN configuration.branches b ON b.id = so.branch_id
	  WHERE so.is_active AND so.public_booking AND b.is_active
	  ORDER BY b.name`)
}

/* ── treatments ──────────────────────────────────────────────────────── */

func (s store) treatments(ctx context.Context, q Q, activeOnly bool, id string) ([]Treatment, error) {
	w := &where{}
	if activeOnly {
		w.parts = append(w.parts, "t.is_active")
	}
	if id != "" {
		w.add("t.id = ?", id)
	}
	list, err := many(ctx, q, func(r pgx.Row) (Treatment, error) {
		var t Treatment
		err := r.Scan(&t.ID, &t.Code, &t.Name, &t.Category, &t.Description, &t.IsActive, &t.SortOrder)
		t.Variants = []Variant{}
		return t, err
	}, `SELECT t.id::text, t.code, t.name, t.category, t.description, t.is_active, t.sort_order
	      FROM spa.treatments t WHERE `+w.sql()+` ORDER BY t.sort_order, t.name`, w.args...)
	if err != nil || len(list) == 0 {
		return list, err
	}
	ids := make([]string, len(list))
	index := map[string]int{}
	for i, t := range list {
		ids[i] = t.ID
		index[t.ID] = i
	}
	type vrow struct {
		treatmentID string
		v           Variant
	}
	variants, err := many(ctx, q, func(r pgx.Row) (vrow, error) {
		var x vrow
		var priceBranches []string
		var prices []float64
		err := r.Scan(&x.treatmentID, &x.v.ID, &x.v.Name, &x.v.DurationMin, &x.v.BufferMin, &x.v.PriceIDR,
			&x.v.IsActive, &x.v.SortOrder, &priceBranches, &prices)
		x.v.OutletPrices = make([]OutletPrice, len(priceBranches))
		for i := range priceBranches {
			x.v.OutletPrices[i] = OutletPrice{BranchID: priceBranches[i], PriceIDR: prices[i]}
		}
		return x, err
	}, `SELECT v.treatment_id::text, v.id::text, v.name, v.duration_min, v.buffer_min, v.price_idr, v.is_active, v.sort_order,
	        COALESCE((SELECT array_agg(p.branch_id::text ORDER BY p.branch_id) FROM spa.variant_outlet_prices p WHERE p.variant_id = v.id), '{}'),
	        COALESCE((SELECT array_agg(p.price_idr::float8 ORDER BY p.branch_id) FROM spa.variant_outlet_prices p WHERE p.variant_id = v.id), '{}')
	   FROM spa.treatment_variants v
	  WHERE v.treatment_id = ANY($1::uuid[]) AND ($2 = false OR v.is_active)
	  ORDER BY v.sort_order, v.duration_min, v.name`, ids, activeOnly)
	if err != nil {
		return nil, err
	}
	for _, x := range variants {
		i := index[x.treatmentID]
		list[i].Variants = append(list[i].Variants, x.v)
	}
	return list, nil
}

func (s store) treatment(ctx context.Context, q Q, id string) (*Treatment, error) {
	list, err := s.treatments(ctx, q, false, id)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

type treatmentInput struct {
	Code, Name, Category, Description *string
	IsActive                          *bool
	SortOrder                         *int
	Variants                          []variantInput // nil = unchanged
}

type variantInput struct {
	ID                     string
	Name                   string
	DurationMin, BufferMin int
	PriceIDR               float64
	IsActive               bool
	SortOrder              int
}

func (store) insertTreatment(ctx context.Context, q Q, in treatmentInput) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO spa.treatments (code, name, category, description, is_active, sort_order)
	  VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
		*in.Code, *in.Name, deref(in.Category), deref(in.Description), in.IsActive == nil || *in.IsActive, derefInt(in.SortOrder)).Scan(&id)
	return id, err
}

func (store) updateTreatment(ctx context.Context, q Q, id string, in treatmentInput) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE spa.treatments SET code = COALESCE($2, code), name = COALESCE($3, name),
	    category = COALESCE($4, category), description = COALESCE($5, description),
	    is_active = COALESCE($6, is_active), sort_order = COALESCE($7, sort_order), updated_at = now()
	  WHERE id = $1`, id, in.Code, in.Name, in.Category, in.Description, in.IsActive, in.SortOrder)
	return tag.RowsAffected() > 0, err
}

// replaceVariants applies a full variant set: listed ids are updated, new
// rows inserted, missing ones deactivated (they may sit on old bookings).
func (store) replaceVariants(ctx context.Context, q Q, treatmentID string, variants []variantInput) error {
	keep := []string{}
	for _, v := range variants {
		if v.ID != "" {
			tag, err := q.Exec(ctx, `UPDATE spa.treatment_variants SET name = $3, duration_min = $4, buffer_min = $5,
			    price_idr = $6, is_active = $7, sort_order = $8, updated_at = now()
			  WHERE id = $1 AND treatment_id = $2`, v.ID, treatmentID, v.Name, v.DurationMin, v.BufferMin, v.PriceIDR, v.IsActive, v.SortOrder)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return httpx.BadRequest("Varian tidak ditemukan pada treatment ini")
			}
			keep = append(keep, v.ID)
			continue
		}
		var id string
		if err := q.QueryRow(ctx, `INSERT INTO spa.treatment_variants (treatment_id, name, duration_min, buffer_min, price_idr, is_active, sort_order)
		  VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
			treatmentID, v.Name, v.DurationMin, v.BufferMin, v.PriceIDR, v.IsActive, v.SortOrder).Scan(&id); err != nil {
			return err
		}
		keep = append(keep, id)
	}
	_, err := q.Exec(ctx, `UPDATE spa.treatment_variants SET is_active = false, updated_at = now()
	  WHERE treatment_id = $1 AND NOT (id = ANY($2::uuid[])) AND is_active`, treatmentID, keep)
	return err
}

func (store) setPrice(ctx context.Context, q Q, treatmentID, variantID, branchID string, price *float64) error {
	var ok bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM spa.treatment_variants WHERE id = $1 AND treatment_id = $2)`,
		variantID, treatmentID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return httpx.BadRequest("Varian tidak ditemukan pada treatment ini")
	}
	if price == nil {
		_, err := q.Exec(ctx, `DELETE FROM spa.variant_outlet_prices WHERE variant_id = $1 AND branch_id = $2`, variantID, branchID)
		return err
	}
	_, err := q.Exec(ctx, `INSERT INTO spa.variant_outlet_prices (variant_id, branch_id, price_idr) VALUES ($1, $2, $3)
	  ON CONFLICT (variant_id, branch_id) DO UPDATE SET price_idr = EXCLUDED.price_idr, updated_at = now()`, variantID, branchID, *price)
	return err
}

// variantRow is a variant with its treatment and the price at one outlet.
type variantRow struct {
	ID            string
	Name          string
	DurationMin   int
	BufferMin     int
	Price         float64
	IsActive      bool
	TreatmentID   string
	TreatmentCode string
	TreatmentName string
	Category      string
	TreatmentOn   bool
	PosProductID  *string
}

func (store) variants(ctx context.Context, q Q, ids []string, branchID string) (map[string]variantRow, error) {
	list, err := many(ctx, q, func(r pgx.Row) (variantRow, error) {
		var v variantRow
		err := r.Scan(&v.ID, &v.Name, &v.DurationMin, &v.BufferMin, &v.Price, &v.IsActive,
			&v.TreatmentID, &v.TreatmentCode, &v.TreatmentName, &v.Category, &v.TreatmentOn, &v.PosProductID)
		return v, err
	}, `SELECT v.id::text, v.name, v.duration_min, v.buffer_min, COALESCE(p.price_idr, v.price_idr), v.is_active,
	        t.id::text, t.code, t.name, t.category, t.is_active, m.pos_product_id::text
	   FROM spa.treatment_variants v
	   JOIN spa.treatments t ON t.id = v.treatment_id
	   LEFT JOIN spa.variant_outlet_prices p ON p.variant_id = v.id AND p.branch_id = $2
	   LEFT JOIN spa.variant_pos_products m ON m.variant_id = v.id AND m.branch_id = $2
	  WHERE v.id = ANY($1::uuid[])`, ids, branchID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]variantRow, len(list))
	for _, v := range list {
		out[v.ID] = v
	}
	return out, nil
}

func (store) activeVariantIDs(ctx context.Context, q Q) ([]string, error) {
	return many(ctx, q, func(r pgx.Row) (string, error) {
		var id string
		return id, r.Scan(&id)
	}, `SELECT v.id::text FROM spa.treatment_variants v JOIN spa.treatments t ON t.id = v.treatment_id
	     WHERE v.is_active AND t.is_active`)
}

func (store) mapPosProduct(ctx context.Context, q Q, variantID, branchID, productID string) error {
	_, err := q.Exec(ctx, `INSERT INTO spa.variant_pos_products (variant_id, branch_id, pos_product_id) VALUES ($1, $2, $3)
	  ON CONFLICT (variant_id, branch_id) DO UPDATE SET pos_product_id = EXCLUDED.pos_product_id, synced_at = now()`,
		variantID, branchID, productID)
	return err
}

func (store) publicTreatments(ctx context.Context, q Q, branchID string) ([]PublicTreatment, error) {
	type row struct {
		t PublicTreatment
		v PublicVariant
	}
	rows, err := many(ctx, q, func(r pgx.Row) (row, error) {
		var x row
		err := r.Scan(&x.t.ID, &x.t.Name, &x.t.Category, &x.t.Description, &x.v.ID, &x.v.Name, &x.v.DurationMin, &x.v.PriceIDR)
		return x, err
	}, `SELECT t.id::text, t.name, t.category, t.description, v.id::text, v.name, v.duration_min, COALESCE(p.price_idr, v.price_idr)
	   FROM spa.treatments t JOIN spa.treatment_variants v ON v.treatment_id = t.id
	   LEFT JOIN spa.variant_outlet_prices p ON p.variant_id = v.id AND p.branch_id = $1
	  WHERE t.is_active AND v.is_active
	  ORDER BY t.sort_order, t.name, v.sort_order, v.duration_min`, branchID)
	if err != nil {
		return nil, err
	}
	out := []PublicTreatment{}
	index := map[string]int{}
	for _, x := range rows {
		i, ok := index[x.t.ID]
		if !ok {
			x.t.Variants = []PublicVariant{}
			out = append(out, x.t)
			i = len(out) - 1
			index[x.t.ID] = i
		}
		out[i].Variants = append(out[i].Variants, x.v)
	}
	return out, nil
}

/* ── therapists ──────────────────────────────────────────────────────── */

const therapistColumns = `t.id::text, t.employee_id::text, e.full_name, e.nip, e.phone, e.photo_url,
	t.home_branch_id::text, b.name, t.gender, t.is_active`

const therapistFrom = `spa.therapists t
	JOIN hris.employees e ON e.id = t.employee_id
	JOIN configuration.branches b ON b.id = t.home_branch_id`

func scanTherapist(r pgx.Row) (Therapist, error) {
	var t Therapist
	err := r.Scan(&t.ID, &t.EmployeeID, &t.FullName, &t.NIP, &t.Phone, &t.PhotoURL, &t.HomeBranchID, &t.HomeBranchName, &t.Gender, &t.IsActive)
	return t, err
}

func (store) therapists(ctx context.Context, q Q, branchID string, activeOnly bool) ([]Therapist, error) {
	w := &where{}
	if branchID != "" {
		w.add("t.home_branch_id = ?", branchID)
	}
	if activeOnly {
		w.parts = append(w.parts, "t.is_active AND COALESCE(e.is_active, true)")
	}
	return many(ctx, q, scanTherapist, `SELECT `+therapistColumns+` FROM `+therapistFrom+` WHERE `+w.sql()+` ORDER BY e.full_name`, w.args...)
}

func (store) therapist(ctx context.Context, q Q, id string) (*Therapist, error) {
	t, err := scanTherapist(q.QueryRow(ctx, `SELECT `+therapistColumns+` FROM `+therapistFrom+` WHERE t.id = $1`, id))
	return one(&t, err)
}

func (store) therapistByEmployee(ctx context.Context, q Q, employeeID string) (*Therapist, error) {
	t, err := scanTherapist(q.QueryRow(ctx, `SELECT `+therapistColumns+` FROM `+therapistFrom+` WHERE t.employee_id = $1`, employeeID))
	return one(&t, err)
}

// eligibleTherapist is a therapist who may work at an outlet on a date.
type eligibleTherapist struct {
	Therapist
	Assisting bool
}

// eligibleTherapists: active therapists whose home is the outlet (and who
// are not lent elsewhere that day) plus those lent to it that day.
func (store) eligibleTherapists(ctx context.Context, q Q, branchID, date string) ([]eligibleTherapist, error) {
	return many(ctx, q, func(r pgx.Row) (eligibleTherapist, error) {
		var t eligibleTherapist
		err := r.Scan(&t.ID, &t.EmployeeID, &t.FullName, &t.NIP, &t.Phone, &t.PhotoURL, &t.HomeBranchID, &t.HomeBranchName,
			&t.Gender, &t.IsActive, &t.Assisting)
		return t, err
	}, `SELECT `+therapistColumns+`, t.home_branch_id <> $1
	   FROM `+therapistFrom+`
	  WHERE t.is_active AND COALESCE(e.is_active, true)
	    AND ((t.home_branch_id = $1 AND NOT EXISTS (
	            SELECT 1 FROM spa.therapist_assists a
	             WHERE a.therapist_id = t.id AND a.branch_id <> $1 AND $2::date BETWEEN a.start_date AND a.end_date))
	      OR EXISTS (SELECT 1 FROM spa.therapist_assists a
	             WHERE a.therapist_id = t.id AND a.branch_id = $1 AND $2::date BETWEEN a.start_date AND a.end_date))
	  ORDER BY t.home_branch_id <> $1, e.full_name`, branchID, date)
}

func (store) insertTherapist(ctx context.Context, q Q, employeeID, branchID string, gender *string, active bool) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO spa.therapists (employee_id, home_branch_id, gender, is_active) VALUES ($1, $2, $3, $4)
	  RETURNING id::text`, employeeID, branchID, gender, active).Scan(&id)
	if database.IsUniqueViolation(err) {
		return "", httpx.Conflict("Karyawan ini sudah terdaftar sebagai terapis")
	}
	return id, err
}

func (store) updateTherapist(ctx context.Context, q Q, id string, branchID *string, gender *string, genderSent bool, active *bool) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE spa.therapists SET home_branch_id = COALESCE($2, home_branch_id),
	    gender = CASE WHEN $3 THEN $4 ELSE gender END, is_active = COALESCE($5, is_active), updated_at = now()
	  WHERE id = $1`, id, branchID, genderSent, gender, active)
	return tag.RowsAffected() > 0, err
}

func (store) assists(ctx context.Context, q Q, branchID, from, to string) ([]Assist, error) {
	w := &where{}
	if branchID != "" {
		w.add("a.branch_id = ?", branchID)
	}
	if from != "" {
		w.add("a.end_date >= ?::date", from)
	}
	if to != "" {
		w.add("a.start_date <= ?::date", to)
	}
	return many(ctx, q, func(r pgx.Row) (Assist, error) {
		var a Assist
		err := r.Scan(&a.ID, &a.TherapistID, &a.TherapistName, &a.BranchID, &a.BranchName, &a.StartDate, &a.EndDate, &a.Note)
		return a, err
	}, `SELECT a.id::text, a.therapist_id::text, e.full_name, a.branch_id::text, b.name, a.start_date::text, a.end_date::text, a.note
	   FROM spa.therapist_assists a
	   JOIN spa.therapists t ON t.id = a.therapist_id
	   JOIN hris.employees e ON e.id = t.employee_id
	   JOIN configuration.branches b ON b.id = a.branch_id
	  WHERE `+w.sql()+` ORDER BY a.start_date DESC, e.full_name`, w.args...)
}

func (store) insertAssist(ctx context.Context, q Q, therapistID, branchID, start, end, note, userID string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO spa.therapist_assists (therapist_id, branch_id, start_date, end_date, note, created_by)
	  VALUES ($1, $2, $3::date, $4::date, $5, $6) RETURNING id::text`, therapistID, branchID, start, end, note, nullable(userID)).Scan(&id)
	return id, err
}

func (store) deleteAssist(ctx context.Context, q Q, id string) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM spa.therapist_assists WHERE id = $1`, id)
	return tag.RowsAffected() > 0, err
}

func (store) pics(ctx context.Context, q Q, branchID string) ([]OutletPIC, error) {
	w := &where{}
	if branchID != "" {
		w.add("p.branch_id = ?", branchID)
	}
	return many(ctx, q, func(r pgx.Row) (OutletPIC, error) {
		var p OutletPIC
		err := r.Scan(&p.BranchID, &p.BranchName, &p.EmployeeID, &p.FullName)
		return p, err
	}, `SELECT p.branch_id::text, b.name, p.employee_id::text, e.full_name
	   FROM spa.outlet_pics p
	   JOIN configuration.branches b ON b.id = p.branch_id
	   JOIN hris.employees e ON e.id = p.employee_id
	  WHERE `+w.sql()+` ORDER BY b.name, e.full_name`, w.args...)
}

func (store) insertPIC(ctx context.Context, q Q, branchID, employeeID string) error {
	_, err := q.Exec(ctx, `INSERT INTO spa.outlet_pics (branch_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, branchID, employeeID)
	return err
}

func (store) deletePIC(ctx context.Context, q Q, branchID, employeeID string) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM spa.outlet_pics WHERE branch_id = $1 AND employee_id = $2`, branchID, employeeID)
	return tag.RowsAffected() > 0, err
}

/* ── bookings ────────────────────────────────────────────────────────── */

type bookingFilter struct {
	BranchID      string
	From, To      *time.Time
	Status        string
	PaymentStatus string
	Search        string
	Page, Limit   int
}

const summaryColumns = `b.id::text, b.booking_code, b.branch_id::text, br.name, b.booking_type, b.source, b.customer_name,
	b.customer_phone, b.scheduled_at, b.status, b.payment_status,
	(SELECT count(*) FROM spa.booking_items i WHERE i.booking_id = b.id AND i.status <> 'cancelled')::int,
	(SELECT COALESCE(sum(i.price_idr), 0) FROM spa.booking_items i WHERE i.booking_id = b.id AND i.status <> 'cancelled')::float8,
	COALESCE((SELECT array_agg(DISTINCT e.full_name) FROM spa.booking_items i
	            JOIN spa.therapists t ON t.id = i.therapist_id JOIN hris.employees e ON e.id = t.employee_id
	           WHERE i.booking_id = b.id AND i.status <> 'cancelled'), '{}'),
	b.pos_order_id::text, b.created_at`

func scanSummary(r pgx.Row, extra ...any) (BookingSummary, error) {
	var s BookingSummary
	var scheduled, created time.Time
	dest := append([]any{&s.ID, &s.BookingCode, &s.BranchID, &s.BranchName, &s.BookingType, &s.Source, &s.CustomerName,
		&s.CustomerPhone, &scheduled, &s.Status, &s.PaymentStatus, &s.ItemCount, &s.TotalIDR, &s.TherapistNames,
		&s.PosOrderID, &created}, extra...)
	err := r.Scan(dest...)
	s.ScheduledAt, s.CreatedAt = jsTime(scheduled), jsTime(created)
	return s, err
}

func (store) bookings(ctx context.Context, q Q, f bookingFilter) ([]BookingSummary, int, error) {
	w := &where{}
	if f.BranchID != "" {
		w.add("b.branch_id = ?", f.BranchID)
	}
	if f.From != nil {
		w.add("b.scheduled_at >= ?", *f.From)
	}
	if f.To != nil {
		w.add("b.scheduled_at < ?", *f.To)
	}
	if f.Status != "" {
		w.add("b.status = ?", f.Status)
	}
	if f.PaymentStatus != "" {
		w.add("b.payment_status = ?", f.PaymentStatus)
	}
	if f.Search != "" {
		w.add("(b.booking_code ILIKE ? OR b.customer_name ILIKE ? OR b.customer_phone ILIKE ?)", "%"+f.Search+"%")
	}
	args := append(w.args, f.Limit, (f.Page-1)*f.Limit)
	total := 0
	list, err := many(ctx, q, func(r pgx.Row) (BookingSummary, error) {
		return scanSummary(r, &total)
	}, `SELECT `+summaryColumns+`, count(*) OVER ()::int
	   FROM spa.bookings b JOIN configuration.branches br ON br.id = b.branch_id
	  WHERE `+w.sql()+`
	  ORDER BY b.scheduled_at DESC, b.created_at DESC
	  LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	return list, total, err
}

// bookingRow is the booking header the service rules need.
type bookingRow struct {
	ID            string
	Code          string
	CompanyID     *string
	BranchID      string
	WarehouseID   string
	CustomerID    *string
	CustomerName  string
	CustomerPhone string
	Status        string
	PaymentStatus string
	PosOrderID    *string
	CheckedOutAt  *time.Time
	ScheduledAt   time.Time
}

func (store) bookingRow(ctx context.Context, q Q, id string, lock bool) (*bookingRow, error) {
	sql := `SELECT id::text, booking_code, company_id::text, branch_id::text, warehouse_id::text, customer_id::text,
	        customer_name, customer_phone, status, payment_status, pos_order_id::text, checked_out_at, scheduled_at
	   FROM spa.bookings WHERE id = $1`
	if lock {
		sql += ` FOR UPDATE`
	}
	var b bookingRow
	err := q.QueryRow(ctx, sql, id).Scan(&b.ID, &b.Code, &b.CompanyID, &b.BranchID, &b.WarehouseID, &b.CustomerID,
		&b.CustomerName, &b.CustomerPhone, &b.Status, &b.PaymentStatus, &b.PosOrderID, &b.CheckedOutAt, &b.ScheduledAt)
	return one(&b, err)
}

func (store) bookingIDOfItem(ctx context.Context, q Q, itemID string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT booking_id::text FROM spa.booking_items WHERE id = $1`, itemID).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

const itemColumns = `i.id::text, i.variant_id::text, i.treatment_name, i.variant_name, i.duration_min, i.buffer_min,
	i.price_idr::float8, i.therapist_id::text, e.full_name, i.starts_at, i.ends_at, i.status, i.started_at, i.completed_at,
	i.commission_idr::float8`

const itemJoins = `LEFT JOIN spa.therapists t ON t.id = i.therapist_id
	LEFT JOIN hris.employees e ON e.id = t.employee_id`

func scanItem(r pgx.Row, extra ...any) (Item, error) {
	var it Item
	var starts, ends time.Time
	var started, completed *time.Time
	dest := append([]any{&it.ID, &it.VariantID, &it.TreatmentName, &it.VariantName, &it.DurationMin, &it.BufferMin,
		&it.PriceIDR, &it.TherapistID, &it.TherapistName, &starts, &ends, &it.Status, &started, &completed, &it.CommissionIDR}, extra...)
	err := r.Scan(dest...)
	it.StartsAt, it.EndsAt = jsTime(starts), jsTime(ends)
	it.StartedAt, it.CompletedAt = httpx.NewJSTime(started), httpx.NewJSTime(completed)
	return it, err
}

func (store) items(ctx context.Context, q Q, bookingID string) ([]Item, error) {
	return many(ctx, q, func(r pgx.Row) (Item, error) { return scanItem(r) },
		`SELECT `+itemColumns+` FROM spa.booking_items i `+itemJoins+`
		  WHERE i.booking_id = $1 ORDER BY i.sort_order, i.starts_at`, bookingID)
}

func (store) events(ctx context.Context, q Q, bookingID string) ([]Event, error) {
	return many(ctx, q, func(r pgx.Row) (Event, error) {
		var e Event
		var at time.Time
		err := r.Scan(&e.ID, &e.ItemID, &e.Action, &e.FromStatus, &e.ToStatus, &e.ActorName, &e.Note, &at)
		e.CreatedAt = jsTime(at)
		return e, err
	}, `SELECT ev.id::text, ev.item_id::text, ev.action, ev.from_status, ev.to_status,
	        COALESCE(u.full_name, au.email), ev.note, ev.created_at
	   FROM spa.booking_events ev
	   LEFT JOIN configuration.users u ON u.id = ev.actor_user_id
	   LEFT JOIN auth.users au ON au.id = ev.actor_user_id
	  WHERE ev.booking_id = $1 ORDER BY ev.created_at, ev.id`, bookingID)
}

func (s store) bookingDetail(ctx context.Context, q Q, id string) (*Booking, error) {
	var b Booking
	var checked, paid, cancelled *time.Time
	summary, err := scanSummary(q.QueryRow(ctx, `SELECT `+summaryColumns+`, b.company_id::text, b.warehouse_id::text,
	        b.customer_id::text, b.therapist_gender_pref, b.notes, b.checked_out_at, b.paid_at, b.cancelled_at, b.cancel_reason
	   FROM spa.bookings b JOIN configuration.branches br ON br.id = b.branch_id WHERE b.id = $1`, id),
		&b.CompanyID, &b.WarehouseID, &b.CustomerID, &b.TherapistGenderPref, &b.Notes, &checked, &paid, &cancelled, &b.CancelReason)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	b.BookingSummary = summary
	b.CheckedOutAt, b.PaidAt, b.CancelledAt = httpx.NewJSTime(checked), httpx.NewJSTime(paid), httpx.NewJSTime(cancelled)
	if b.Items, err = s.items(ctx, q, id); err != nil {
		return nil, err
	}
	if b.Events, err = s.events(ctx, q, id); err != nil {
		return nil, err
	}
	return &b, nil
}

type newBooking struct {
	Code                string
	CompanyID           *string
	BranchID            string
	WarehouseID         string
	BookingType         string
	Source              string
	CustomerID          *string
	CustomerName        string
	CustomerPhone       string
	TherapistGenderPref string
	Notes               string
	ScheduledAt         time.Time
	CreatedBy           string
}

func (store) insertBooking(ctx context.Context, q Q, b newBooking) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO spa.bookings (booking_code, company_id, branch_id, warehouse_id, booking_type, source,
	    customer_id, customer_name, customer_phone, therapist_gender_pref, notes, scheduled_at, created_by)
	  VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10, $11, $12, $13) RETURNING id::text`,
		b.Code, b.CompanyID, b.BranchID, b.WarehouseID, b.BookingType, b.Source, b.CustomerID, b.CustomerName, b.CustomerPhone,
		b.TherapistGenderPref, b.Notes, b.ScheduledAt, nullable(b.CreatedBy)).Scan(&id)
	return id, err
}

type newItem struct {
	BookingID   string
	Variant     variantRow
	TherapistID *string
	StartsAt    time.Time
	Status      string
	SortOrder   int
}

func (store) insertItem(ctx context.Context, q Q, it newItem) (string, error) {
	var id string
	ends := it.StartsAt.Add(time.Duration(it.Variant.DurationMin) * time.Minute)
	err := q.QueryRow(ctx, `INSERT INTO spa.booking_items (booking_id, variant_id, treatment_name, variant_name, duration_min,
	    buffer_min, price_idr, therapist_id, starts_at, ends_at, status, sort_order)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10, $11, $12) RETURNING id::text`,
		it.BookingID, it.Variant.ID, it.Variant.TreatmentName, it.Variant.Name, it.Variant.DurationMin, it.Variant.BufferMin,
		it.Variant.Price, it.TherapistID, it.StartsAt, ends, it.Status, it.SortOrder).Scan(&id)
	return id, err
}

// itemRow is an item as the transition rules need it.
type itemRow struct {
	ID          string
	BookingID   string
	VariantID   string
	TreatmentID string
	Status      string
	TherapistID *string
	StartsAt    time.Time
	DurationMin int
	BufferMin   int
	Price       float64
}

func (store) itemRows(ctx context.Context, q Q, bookingID string, lock bool) ([]itemRow, error) {
	sql := `SELECT i.id::text, i.booking_id::text, i.variant_id::text, v.treatment_id::text, i.status, i.therapist_id::text,
	        i.starts_at, i.duration_min, i.buffer_min, i.price_idr::float8
	   FROM spa.booking_items i JOIN spa.treatment_variants v ON v.id = i.variant_id
	  WHERE i.booking_id = $1 ORDER BY i.sort_order, i.starts_at`
	if lock {
		sql += ` FOR UPDATE OF i`
	}
	return many(ctx, q, func(r pgx.Row) (itemRow, error) {
		var it itemRow
		err := r.Scan(&it.ID, &it.BookingID, &it.VariantID, &it.TreatmentID, &it.Status, &it.TherapistID,
			&it.StartsAt, &it.DurationMin, &it.BufferMin, &it.Price)
		return it, err
	}, sql, bookingID)
}

func (store) setItemTherapist(ctx context.Context, q Q, itemID string, therapistID *string, status string) error {
	_, err := q.Exec(ctx, `UPDATE spa.booking_items SET therapist_id = $2::uuid, status = $3, updated_at = now() WHERE id = $1`,
		itemID, therapistID, status)
	return err
}

func (store) setItemStatus(ctx context.Context, q Q, itemID, status string, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE spa.booking_items SET status = $2,
	    started_at = CASE WHEN $2 = 'in_treatment' THEN $3 ELSE started_at END,
	    completed_at = CASE WHEN $2 = 'completed' THEN $3 ELSE completed_at END,
	    updated_at = now()
	  WHERE id = $1`, itemID, status, at)
	return err
}

func (store) setItemCommission(ctx context.Context, q Q, itemID string, ctype *string, value *float64, amount float64) error {
	_, err := q.Exec(ctx, `UPDATE spa.booking_items SET commission_type = $2, commission_value = $3, commission_idr = $4 WHERE id = $1`,
		itemID, ctype, value, amount)
	return err
}

func (store) rescheduleItem(ctx context.Context, q Q, itemID string, start time.Time, durationMin int) error {
	_, err := q.Exec(ctx, `UPDATE spa.booking_items SET starts_at = $2, ends_at = $3, updated_at = now() WHERE id = $1`,
		itemID, start, start.Add(time.Duration(durationMin)*time.Minute))
	return err
}

func (store) setBookingStatus(ctx context.Context, q Q, id, status string) error {
	_, err := q.Exec(ctx, `UPDATE spa.bookings SET status = $2, updated_at = now() WHERE id = $1`, id, status)
	return err
}

// syncScheduledAt keeps the booking time at its earliest active item.
func (store) syncScheduledAt(ctx context.Context, q Q, id string) error {
	_, err := q.Exec(ctx, `UPDATE spa.bookings b SET scheduled_at = x.first, updated_at = now()
	   FROM (SELECT min(starts_at) AS first FROM spa.booking_items WHERE booking_id = $1 AND status <> 'cancelled') x
	  WHERE b.id = $1 AND x.first IS NOT NULL AND x.first <> b.scheduled_at`, id)
	return err
}

type bookingPatch struct {
	CustomerName, CustomerPhone, Notes, GenderPref *string
}

func (store) patchBooking(ctx context.Context, q Q, id string, p bookingPatch) error {
	_, err := q.Exec(ctx, `UPDATE spa.bookings SET customer_name = COALESCE($2, customer_name),
	    customer_phone = COALESCE($3, customer_phone), notes = COALESCE($4, notes),
	    therapist_gender_pref = COALESCE($5, therapist_gender_pref), updated_at = now()
	  WHERE id = $1`, id, p.CustomerName, p.CustomerPhone, p.Notes, p.GenderPref)
	return err
}

func (store) cancelBooking(ctx context.Context, q Q, id, reason string, at time.Time) error {
	if _, err := q.Exec(ctx, `UPDATE spa.booking_items SET status = 'cancelled', updated_at = now()
	  WHERE booking_id = $1 AND status IN ('unassigned', 'assigned')`, id); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `UPDATE spa.bookings SET status = 'cancelled', cancelled_at = $2, cancel_reason = $3, updated_at = now()
	  WHERE id = $1`, id, at, reason)
	return err
}

func (store) setCheckout(ctx context.Context, q Q, id, orderID string, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE spa.bookings SET pos_order_id = $2::uuid, checked_out_at = $3, payment_status = 'unpaid', updated_at = now()
	  WHERE id = $1`, id, orderID, at)
	return err
}

func (store) event(ctx context.Context, q Q, bookingID string, itemID *string, action string, from, to *string, actor, note string) error {
	_, err := q.Exec(ctx, `INSERT INTO spa.booking_events (booking_id, item_id, action, from_status, to_status, actor_user_id, note)
	  VALUES ($1, $2::uuid, $3, $4, $5, $6::uuid, $7)`, bookingID, itemID, action, from, to, nullable(actor), note)
	return err
}

// lockTherapist serialises assignments of one therapist.
func (store) lockTherapist(ctx context.Context, q Q, therapistID string) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('spa-therapist:' || $1))`, therapistID)
	return err
}

// conflicts lists the therapist's active items overlapping [start, end).
func (store) conflicts(ctx context.Context, q Q, therapistIDs []string, start, end time.Time, excludeItemID string) (map[string][]Conflict, error) {
	type row struct {
		therapist string
		c         Conflict
	}
	rows, err := many(ctx, q, func(r pgx.Row) (row, error) {
		var x row
		var s, e time.Time
		err := r.Scan(&x.therapist, &x.c.ItemID, &x.c.BookingCode, &s, &e)
		x.c.StartsAt, x.c.EndsAt = jsTime(s), jsTime(e)
		return x, err
	}, `SELECT i.therapist_id::text, i.id::text, b.booking_code, i.starts_at, i.ends_at
	   FROM spa.booking_items i JOIN spa.bookings b ON b.id = i.booking_id
	  WHERE i.therapist_id = ANY($1::uuid[]) AND i.status IN ('assigned', 'in_treatment')
	    AND b.status NOT IN ('cancelled', 'expired')
	    AND i.id::text <> $4
	    AND i.starts_at < $3 AND i.ends_at + make_interval(mins => i.buffer_min) > $2
	  ORDER BY i.starts_at`, therapistIDs, start, end, excludeItemID)
	if err != nil {
		return nil, err
	}
	out := map[string][]Conflict{}
	for _, x := range rows {
		out[x.therapist] = append(out[x.therapist], x.c)
	}
	return out, nil
}

// expire marks untouched bookings whose last item ended before cutoff.
func (store) expire(ctx context.Context, q Q, cutoff time.Time) error {
	_, err := q.Exec(ctx, `WITH due AS (
	    SELECT b.id, b.status FROM spa.bookings b
	     WHERE b.status IN ('unassigned', 'assigned')
	       AND (SELECT max(i.ends_at) FROM spa.booking_items i WHERE i.booking_id = b.id AND i.status <> 'cancelled') < $1
	     FOR UPDATE SKIP LOCKED),
	  upd AS (UPDATE spa.bookings b SET status = 'expired', updated_at = now() FROM due WHERE b.id = due.id RETURNING b.id, due.status)
	  INSERT INTO spa.booking_events (booking_id, action, from_status, to_status, note)
	  SELECT id, 'expire', status, 'expired', 'Lewat jadwal tanpa dimulai' FROM upd`, cutoff)
	return err
}

// pendingPayments are bookings sent to the cashier and not yet paid.
func (store) pendingPayments(ctx context.Context, q Q) (map[string]string, error) {
	type row struct{ booking, order string }
	rows, err := many(ctx, q, func(r pgx.Row) (row, error) {
		var x row
		return x, r.Scan(&x.booking, &x.order)
	}, `SELECT id::text, pos_order_id::text FROM spa.bookings WHERE payment_status = 'unpaid' AND pos_order_id IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(rows))
	for _, x := range rows {
		out[x.booking] = x.order
	}
	return out, nil
}

func (store) markPaid(ctx context.Context, q Q, orderID string, at time.Time) ([]string, error) {
	return many(ctx, q, func(r pgx.Row) (string, error) {
		var id string
		return id, r.Scan(&id)
	}, `UPDATE spa.bookings SET payment_status = 'paid', paid_at = COALESCE(paid_at, $2), updated_at = now()
	  WHERE pos_order_id = $1::uuid AND payment_status = 'unpaid' RETURNING id::text`, orderID, at)
}

func (store) markVoid(ctx context.Context, q Q, orderIDs []string) ([]string, error) {
	return many(ctx, q, func(r pgx.Row) (string, error) {
		var id string
		return id, r.Scan(&id)
	}, `UPDATE spa.bookings SET payment_status = 'void', updated_at = now()
	  WHERE pos_order_id = ANY($1::uuid[]) AND payment_status = 'paid' RETURNING id::text`, orderIDs)
}

const boardItemColumns = itemColumns + `, b.id::text, b.booking_code, b.branch_id::text, br.name, b.customer_name, b.status, b.payment_status`

func scanBoardItem(r pgx.Row) (BoardItem, error) {
	var bi BoardItem
	item, err := scanItem(r, &bi.BookingID, &bi.BookingCode, &bi.BranchID, &bi.BranchName, &bi.CustomerName, &bi.BookingStatus, &bi.PaymentStatus)
	bi.Item = item
	return bi, err
}

// dayItems are the non-cancelled items of an outlet's day.
func (store) dayItems(ctx context.Context, q Q, branchID string, start, end time.Time) ([]BoardItem, error) {
	return many(ctx, q, scanBoardItem, `SELECT `+boardItemColumns+`
	   FROM spa.booking_items i JOIN spa.bookings b ON b.id = i.booking_id
	   JOIN configuration.branches br ON br.id = b.branch_id `+itemJoins+`
	  WHERE b.branch_id = $1 AND i.starts_at >= $2 AND i.starts_at < $3
	    AND i.status <> 'cancelled' AND b.status <> 'cancelled'
	  ORDER BY i.starts_at, b.booking_code`, branchID, start, end)
}

// therapistItems are a therapist's items starting in [start, end), any outlet.
func (store) therapistItems(ctx context.Context, q Q, therapistID string, start, end time.Time) ([]BoardItem, error) {
	return many(ctx, q, scanBoardItem, `SELECT `+boardItemColumns+`
	   FROM spa.booking_items i JOIN spa.bookings b ON b.id = i.booking_id
	   JOIN configuration.branches br ON br.id = b.branch_id `+itemJoins+`
	  WHERE i.therapist_id = $1 AND i.starts_at >= $2 AND i.starts_at < $3
	    AND i.status <> 'cancelled' AND b.status <> 'cancelled'
	  ORDER BY i.starts_at`, therapistID, start, end)
}

func (store) boardItem(ctx context.Context, q Q, itemID string) (*BoardItem, error) {
	bi, err := scanBoardItem(q.QueryRow(ctx, `SELECT `+boardItemColumns+`
	   FROM spa.booking_items i JOIN spa.bookings b ON b.id = i.booking_id
	   JOIN configuration.branches br ON br.id = b.branch_id `+itemJoins+` WHERE i.id = $1`, itemID))
	return one(&bi, err)
}

// openPublicBookings counts a phone's open future public bookings.
func (store) openPublicBookings(ctx context.Context, q Q, phone string, now time.Time) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM spa.bookings
	  WHERE source = 'public' AND customer_phone = $1 AND scheduled_at > $2 AND status IN ('unassigned', 'assigned')`,
		phone, now).Scan(&n)
	return n, err
}

/* ── commissions ─────────────────────────────────────────────────────── */

func (store) activeRules(ctx context.Context, q Q) ([]domain.CommissionRule, error) {
	return many(ctx, q, func(r pgx.Row) (domain.CommissionRule, error) {
		var c domain.CommissionRule
		var t, v, b *string
		err := r.Scan(&c.ID, &t, &v, &b, &c.Type, &c.Value)
		c.TreatmentID, c.VariantID, c.BranchID = deref(t), deref(v), deref(b)
		return c, err
	}, `SELECT id::text, treatment_id::text, variant_id::text, branch_id::text, commission_type, value::float8
	   FROM spa.commission_rules WHERE is_active`)
}

func (store) rules(ctx context.Context, q Q) ([]CommissionRuleView, error) {
	return many(ctx, q, func(r pgx.Row) (CommissionRuleView, error) {
		var c CommissionRuleView
		err := r.Scan(&c.ID, &c.TreatmentID, &c.TreatmentName, &c.VariantID, &c.VariantName, &c.BranchID, &c.BranchName,
			&c.CommissionType, &c.Value, &c.IsActive)
		return c, err
	}, `SELECT r.id::text, COALESCE(r.treatment_id, vt.id)::text, COALESCE(t.name, vt.name), r.variant_id::text, v.name,
	        r.branch_id::text, b.name, r.commission_type, r.value::float8, r.is_active
	   FROM spa.commission_rules r
	   LEFT JOIN spa.treatments t ON t.id = r.treatment_id
	   LEFT JOIN spa.treatment_variants v ON v.id = r.variant_id
	   LEFT JOIN spa.treatments vt ON vt.id = v.treatment_id
	   LEFT JOIN configuration.branches b ON b.id = r.branch_id
	  ORDER BY (r.variant_id IS NULL AND r.treatment_id IS NULL) DESC, COALESCE(t.name, vt.name), v.name, b.name NULLS FIRST`)
}

type ruleInput struct {
	TreatmentID, VariantID, BranchID *string
	Type                             string
	Value                            float64
	IsActive                         bool
}

func ruleConflict(err error) error {
	if database.IsUniqueViolation(err) {
		return httpx.Conflict("Aturan komisi untuk cakupan ini sudah ada")
	}
	return err
}

func (store) insertRule(ctx context.Context, q Q, in ruleInput) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO spa.commission_rules (treatment_id, variant_id, branch_id, commission_type, value, is_active)
	  VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6) RETURNING id::text`,
		in.TreatmentID, in.VariantID, in.BranchID, in.Type, in.Value, in.IsActive).Scan(&id)
	return id, ruleConflict(err)
}

func (store) updateRule(ctx context.Context, q Q, id string, in ruleInput) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE spa.commission_rules SET treatment_id = $2::uuid, variant_id = $3::uuid, branch_id = $4::uuid,
	    commission_type = $5, value = $6, is_active = $7, updated_at = now() WHERE id = $1`,
		id, in.TreatmentID, in.VariantID, in.BranchID, in.Type, in.Value, in.IsActive)
	return tag.RowsAffected() > 0, ruleConflict(err)
}

func (store) deleteRule(ctx context.Context, q Q, id string) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM spa.commission_rules WHERE id = $1`, id)
	return tag.RowsAffected() > 0, err
}

type commissionRow struct {
	TherapistID string
	FullName    string
	NIP         *string
	Line        CommissionLine
}

func (store) commissionLines(ctx context.Context, q Q, start, end time.Time, branchID, therapistID string) ([]commissionRow, error) {
	w := &where{}
	w.add("i.completed_at >= ?", start)
	w.add("i.completed_at < ?", end)
	if branchID != "" {
		w.add("b.branch_id = ?", branchID)
	}
	if therapistID != "" {
		w.add("i.therapist_id = ?", therapistID)
	}
	return many(ctx, q, func(r pgx.Row) (commissionRow, error) {
		var c commissionRow
		var at time.Time
		err := r.Scan(&c.TherapistID, &c.FullName, &c.NIP, &c.Line.ItemID, &c.Line.BookingID, &c.Line.BookingCode,
			&c.Line.BranchName, &at, &c.Line.TreatmentName, &c.Line.VariantName, &c.Line.PriceIDR,
			&c.Line.CommissionType, &c.Line.CommissionValue, &c.Line.CommissionIDR)
		c.Line.CompletedAt = jsTime(at)
		return c, err
	}, `SELECT t.id::text, e.full_name, e.nip, i.id::text, b.id::text, b.booking_code, br.name, i.completed_at,
	        i.treatment_name, i.variant_name, i.price_idr::float8, i.commission_type, i.commission_value::float8,
	        COALESCE(i.commission_idr, 0)::float8
	   FROM spa.booking_items i
	   JOIN spa.bookings b ON b.id = i.booking_id
	   JOIN configuration.branches br ON br.id = b.branch_id
	   JOIN spa.therapists t ON t.id = i.therapist_id
	   JOIN hris.employees e ON e.id = t.employee_id
	  WHERE i.status = 'completed' AND b.payment_status = 'paid' AND `+w.sql()+`
	  ORDER BY e.full_name, i.completed_at`, w.args...)
}

/* ── helpers ─────────────────────────────────────────────────────────── */

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func derefInt(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
