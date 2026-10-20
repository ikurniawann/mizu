package sales

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/validate"
)

// Parking can be sold on a Spa treatment bill before payment, or as a normal
// separate POS sale. Only this endpoint changes an already-created Spa bill.
func (h *Handler) addParkingItem(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	body, err := readObj(r)
	if err != nil {
		return h.writeOutcome(w, nil, err, "Add parking item")
	}
	productID := body.Str("product_id")
	if !validate.IsUUID(productID) {
		return h.writeOutcome(w, nil, fail(400, "Produk parkir tidak valid"), "Add parking item")
	}
	var itemID string
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		order, err := h.lockSpaParkingOrder(r.Context(), tx, user, r.PathValue("id"))
		if err != nil {
			return err
		}
		var name, sku string
		var price, cost float64
		err = tx.QueryRow(r.Context(), `SELECT p.name, p.sku, p.base_price::float8, COALESCE(p.cost_price, 0)::float8
			FROM pos.pos_products p JOIN pos.pos_categories c ON c.id = p.category_id
			JOIN item.products source ON source.id = p.source_product_id
			WHERE p.id = $1 AND lower(c.name) = 'parkir' AND c.is_active = true
			AND p.is_active = true AND p.is_available = true AND source.is_active = true
			AND source.deleted_at IS NULL AND source.warehouse_id = $2
			AND 'pos' = ANY(p.sales_channels)`, productID, order.warehouseID).Scan(&name, &sku, &price, &cost)
		if database.IsNoRows(err) {
			return fail(409, "Produk parkir tidak tersedia di outlet tagihan")
		}
		if err != nil {
			return err
		}
		if price < 0 {
			return fail(409, "Harga produk parkir tidak valid")
		}
		if err := tx.QueryRow(r.Context(), `INSERT INTO pos.pos_order_items
			(order_id, product_id, product_name, product_sku, quantity, unit_price, subtotal, total_amount,
			station, kitchen_status, kitchen_notes, inventory_deducted, cost_price, cost_total, gross_profit, gross_margin_pct)
			VALUES ($1, $2, $3, $4, 1, $5, $5, $5, 'merchandise', 'served', 'Parkir booking spa', false, $6, $6,
			$5::numeric - $6::numeric, CASE WHEN $5::numeric > 0 THEN (($5::numeric - $6::numeric) / $5::numeric) * 100 ELSE 0 END)
			RETURNING id::text`, r.PathValue("id"), productID, name, sku, price, cost).Scan(&itemID); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `UPDATE pos.pos_orders SET subtotal = subtotal + $2,
			total_amount = total_amount + $2, updated_at = now() WHERE id = $1`, r.PathValue("id"), price)
		return err
	})
	if err != nil {
		return h.writeOutcome(w, nil, err, "Add parking item")
	}
	return h.writeOutcome(w, &response{status: 201, body: map[string]any{"success": true, "data": map[string]any{"id": itemID}}}, nil, "Add parking item")
}

func (h *Handler) removeParkingItem(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	itemID := r.PathValue("itemId")
	if !validate.IsUUID(itemID) {
		return h.writeOutcome(w, nil, fail(400, "Item parkir tidak valid"), "Remove parking item")
	}
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		if _, err := h.lockSpaParkingOrder(r.Context(), tx, user, r.PathValue("id")); err != nil {
			return err
		}
		var amount float64
		err := tx.QueryRow(r.Context(), `DELETE FROM pos.pos_order_items i
			USING pos.pos_products p, pos.pos_categories c
			WHERE i.id = $1 AND i.order_id = $2 AND i.product_id = p.id
			AND p.category_id = c.id AND lower(c.name) = 'parkir' AND i.kitchen_notes = 'Parkir booking spa'
			RETURNING i.total_amount::float8`, itemID, r.PathValue("id")).Scan(&amount)
		if database.IsNoRows(err) {
			return fail(404, "Item parkir tidak ditemukan")
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `UPDATE pos.pos_orders SET subtotal = subtotal - $2,
			total_amount = total_amount - $2, updated_at = now() WHERE id = $1`, r.PathValue("id"), amount)
		return err
	})
	if err != nil {
		return h.writeOutcome(w, nil, err, "Remove parking item")
	}
	return h.writeOutcome(w, &response{status: 200, body: map[string]any{"success": true, "data": map[string]any{"id": itemID}}}, nil, "Remove parking item")
}

type parkingOrder struct{ warehouseID string }

// Lock the POS order first, matching settlement's lock order, so an item can
// never be added while another tab is settling the same bill.
func (h *Handler) lockSpaParkingOrder(ctx context.Context, tx pgx.Tx, user *auth.User, orderID string) (*parkingOrder, error) {
	if !validate.IsUUID(orderID) {
		return nil, fail(400, "Tagihan tidak valid")
	}
	var companyID, branchID, warehouseID, payment, status string
	var amountPaid float64
	var qrID, externalID *string
	err := tx.QueryRow(ctx, `SELECT company_id::text, branch_id::text, warehouse_id::text,
		payment_status::text, status::text, amount_paid::float8, xendit_qr_id, xendit_external_id
		FROM pos.pos_orders WHERE id = $1 FOR UPDATE`, orderID).
		Scan(&companyID, &branchID, &warehouseID, &payment, &status, &amountPaid, &qrID, &externalID)
	if database.IsNoRows(err) {
		return nil, fail(404, "Tagihan tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	sc, err := scope.Load(ctx, tx, user.ID)
	if err != nil {
		return nil, err
	}
	if !scope.RowInScope(sc, &companyID, &branchID) {
		return nil, fail(403, "Tagihan di luar outlet Anda")
	}
	var spaBill bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM spa.bookings WHERE pos_order_id = $1)`, orderID).Scan(&spaBill); err != nil {
		return nil, err
	}
	if !spaBill {
		return nil, fail(409, "Tagihan ini bukan booking Spa")
	}
	if payment != "unpaid" || amountPaid != 0 || status == "cancelled" || status == "voided" || status == "merged" || qrID != nil || externalID != nil {
		return nil, fail(409, "Tagihan sudah dibayar atau proses pembayaran dimulai")
	}
	return &parkingOrder{warehouseID: warehouseID}, nil
}
