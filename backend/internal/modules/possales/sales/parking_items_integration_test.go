package sales

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func spaParkingOrder(t *testing.T, e *env) (string, string) {
	t.Helper()
	order := e.call(true, "POST", "/api/pos/orders/open-bill", map[string]any{
		"items": []any{map[string]any{"product_id": e.fx.prodA, "product_name": "Treatment", "quantity": 1, "unit_price": 100000}},
	}, http.StatusCreated)["data"].(map[string]any)
	orderID := order["id"].(string)
	e.exec(`UPDATE pos.pos_orders SET discount_amount = 20000, total_amount = 80000,
		charges_breakdown = '[{"type":"deposit","label":"DP online","amount":20000}]'::jsonb WHERE id = $1`, orderID)
	e.exec(`INSERT INTO spa.bookings (booking_code, company_id, branch_id, warehouse_id, booking_type,
		customer_name, scheduled_at, ends_at, status, pos_order_id)
		VALUES ($1, $2, $3, $4, 'walk_in', 'Tamu Uji', now(), now() + interval '1 hour', 'completed', $5)`, "PARK-"+testutil.RandomHex(4), e.fx.company, e.fx.branch, e.fx.stallA, orderID)
	category := e.id(`INSERT INTO pos.pos_categories (name) VALUES ('Parkir') RETURNING id::text`)
	master := e.id(`INSERT INTO item.products (kode, nama, kategori, harga_jual, harga_modal, markup_persen,
		company_id, branch_id, warehouse_id, station, production_output_type, is_active)
		VALUES ($1, 'Parkir Mobil', 'Parkir', 10000, 0, 0, $2, $3, $4, 'merchandise', 'FINISHED_GOOD', true)
		RETURNING id::text`, "PARK-"+testutil.RandomHex(4), e.fx.company, e.fx.branch, e.fx.stallA)
	e.exec(`UPDATE pos.pos_products SET name = 'Parkir Mobil', category_id = $1, source_product_id = $2,
		base_price = 10000, station = 'merchandise', is_active = true, is_available = true,
		sales_channels = ARRAY['pos'] WHERE id = $3`, category, master, e.fx.prodA2)
	return orderID, e.fx.prodA2
}

func TestSpaParkingItemChangesUnpaidBillAndPreservesDeposit(t *testing.T) {
	e := setup(t)
	orderID, productID := spaParkingOrder(t, e)
	path := "/api/pos/orders/" + orderID + "/parking-items"
	added := e.call(true, "POST", path, map[string]any{"product_id": productID}, http.StatusCreated)["data"].(map[string]any)
	itemID := added["id"].(string)
	var subtotal, discount, total float64
	e.scalar(&subtotal, `SELECT subtotal::float8 FROM pos.pos_orders WHERE id = $1`, orderID)
	e.scalar(&discount, `SELECT discount_amount::float8 FROM pos.pos_orders WHERE id = $1`, orderID)
	e.scalar(&total, `SELECT total_amount::float8 FROM pos.pos_orders WHERE id = $1`, orderID)
	if subtotal != 110000 || discount != 20000 || total != 90000 {
		t.Fatalf("after add: subtotal=%v discount=%v total=%v", subtotal, discount, total)
	}
	order := e.call(true, "GET", "/api/pos/orders/"+orderID, nil, http.StatusOK)["data"].(map[string]any)
	if len(order["items"].([]any)) != 2 {
		t.Fatalf("order items = %v", order["items"])
	}
	var parkingNote string
	e.scalar(&parkingNote, `SELECT kitchen_notes FROM pos.pos_order_items WHERE id = $1`, itemID)
	if parkingNote != "Parkir booking spa" {
		t.Fatalf("parking marker = %q", parkingNote)
	}
	e.call(true, "DELETE", path+"/"+itemID, nil, http.StatusOK)
	e.scalar(&total, `SELECT total_amount::float8 FROM pos.pos_orders WHERE id = $1`, orderID)
	if total != 80000 {
		t.Fatalf("after removal: total=%v", total)
	}
}

func TestSpaParkingItemRejectsWrongProductAndPaidOrder(t *testing.T) {
	e := setup(t)
	orderID, productID := spaParkingOrder(t, e)
	path := "/api/pos/orders/" + orderID + "/parking-items"
	if out := e.call(true, "POST", path, map[string]any{"product_id": e.fx.prodA}, http.StatusConflict); errorOf(out) == "" {
		t.Fatalf("treatment accepted as parking: %v", out)
	}
	e.exec(`UPDATE pos.pos_orders SET payment_status = 'paid' WHERE id = $1`, orderID)
	if out := e.call(true, "POST", path, map[string]any{"product_id": productID}, http.StatusConflict); errorOf(out) == "" {
		t.Fatalf("paid order changed: %v", out)
	}
}

func TestSpaParkingItemIncludedInSingleSettlement(t *testing.T) {
	e := setup(t)
	orderID, productID := spaParkingOrder(t, e)
	path := "/api/pos/orders/" + orderID
	e.call(true, "POST", path+"/parking-items", map[string]any{"product_id": productID}, http.StatusCreated)
	e.call(true, "PATCH", path, map[string]any{
		"payment_status": "paid", "payment_method": "cash", "amount_paid": 90000,
	}, http.StatusOK)
	var paid string
	var total float64
	e.scalar(&paid, `SELECT payment_status::text FROM pos.pos_orders WHERE id = $1`, orderID)
	e.scalar(&total, `SELECT total_amount::float8 FROM pos.pos_orders WHERE id = $1`, orderID)
	if paid != "paid" || total != 90000 {
		t.Fatalf("settlement: status=%s total=%v", paid, total)
	}
	if out := e.call(true, "POST", path+"/parking-items", map[string]any{"product_id": productID}, http.StatusConflict); errorOf(out) == "" {
		t.Fatalf("parking added after payment: %v", out)
	}
}

func TestSpaParkingItemRejectsOrdinaryPosBill(t *testing.T) {
	e := setup(t)
	_, productID := spaParkingOrder(t, e)
	ordinary := e.call(true, "POST", "/api/pos/orders/open-bill", map[string]any{
		"items": []any{map[string]any{"product_id": e.fx.prodA, "product_name": "Treatment", "quantity": 1, "unit_price": 100000}},
	}, http.StatusCreated)["data"].(map[string]any)
	path := "/api/pos/orders/" + ordinary["id"].(string) + "/parking-items"
	if out := e.call(true, "POST", path, map[string]any{"product_id": productID}, http.StatusConflict); errorOf(out) == "" {
		t.Fatalf("ordinary POS bill changed through Spa endpoint: %v", out)
	}
}
