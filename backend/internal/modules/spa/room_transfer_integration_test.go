package spa_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/platform/testutil"
)

type roomInvoiceFailure struct{ fakePayments }

func (roomInvoiceFailure) CreateInvoice(context.Context, spa.InvoiceRequest) (spa.Invoice, error) {
	return spa.Invoice{}, errors.New("invoice creation failed")
}

func TestRoomTransferAfterInvoiceFailure(t *testing.T) {
	e, id, _, target := roomTransferFixture(t)
	var token string
	if err := e.tx.QueryRow(e.ctx, `UPDATE spa.bookings SET source='public',public_token=gen_random_uuid() WHERE id=$1 RETURNING public_token::text`, id).Scan(&token); err != nil {
		t.Fatal(err)
	}
	ports := app.SpaPorts()
	ports.Payments = roomInvoiceFailure{}
	svc := spa.NewService(e.tx, ports, testutil.Deps(t, func() time.Time { return fixedNow }))
	if _, err := svc.PublicPay(e.ctx, token); err == nil {
		t.Fatal("issuer failure should be reported")
	}
	e.data(&e.admin, "PUT", "/api/spa/bookings/"+id+"/room", map[string]any{"room_id": target}, http.StatusOK)
}

func TestRoomTransferGroupCheckout(t *testing.T) {
	e, id, origin, target := roomTransferFixture(t)
	b := e.data(&e.admin, "GET", "/api/spa/bookings/"+id, nil, http.StatusOK)
	variant := b["items"].([]any)[0].(map[string]any)["variant_id"]
	member := func(name, at string, room any) map[string]any {
		return map[string]any{"branch_id": e.org.BranchID, "booking_type": "reservation", "customer_name": name, "scheduled_at": at, "therapist_id": b["therapist_id"], "room_id": room, "items": []any{map[string]any{"variant_id": variant}}}
	}
	g := e.data(&e.admin, "POST", "/api/spa/booking-groups", map[string]any{"branch_id": e.org.BranchID, "payer_name": "Group", "payer_phone": "081234560009", "bookings": []any{member("One", "2026-10-08T05:00:00Z", origin), member("Two", "2026-10-08T07:00:00Z", nil)}}, http.StatusCreated)
	bookings := g["bookings"].([]any)
	firstID := bookings[0].(map[string]any)["id"].(string)
	e.data(&e.admin, "PUT", "/api/spa/bookings/"+firstID+"/room", map[string]any{"room_id": target}, http.StatusOK)
	ratings := []any{}
	for _, raw := range bookings {
		bid := raw.(map[string]any)["id"].(string)
		e.data(&e.admin, "POST", "/api/spa/bookings/"+bid+"/status", map[string]any{"action": "start"}, http.StatusOK)
		e.data(&e.admin, "POST", "/api/spa/bookings/"+bid+"/status", map[string]any{"action": "complete"}, http.StatusOK)
		ratings = append(ratings, map[string]any{"booking_id": bid, "therapist_rating": 5})
	}
	co := e.data(&e.admin, "POST", "/api/spa/booking-groups/"+g["id"].(string)+"/checkout", map[string]any{"ratings": ratings}, http.StatusOK)
	var total float64
	var count int
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*),sum(unit_price*quantity)::float8 FROM pos.pos_order_items WHERE order_id=$1`, co["order_id"]).Scan(&count, &total); err != nil {
		t.Fatal(err)
	}
	if count != 3 || total != 500000 {
		t.Fatalf("group room missing/duplicated: lines %d total %v", count, total)
	}
}

func TestRoomTransferSharedPublicRoom(t *testing.T) {
	e, id, origin, target := roomTransferFixture(t)
	e.data(&e.admin, "PUT", "/api/spa/rooms/"+origin, map[string]any{"name": "Shared Public", "capacity": 2, "price_idr": 25000}, http.StatusOK)
	e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.scheduledEmployee("Extra group therapist", nil), "home_branch_id": e.org.BranchID}, http.StatusCreated)
	b := e.data(&e.admin, "GET", "/api/spa/bookings/"+id, nil, http.StatusOK)
	variant := b["items"].([]any)[0].(map[string]any)["variant_id"].(string)
	svc := spa.NewService(e.tx, app.SpaPorts(), testutil.Deps(t, func() time.Time { return fixedNow }))
	guest := spa.PublicGuest{VariantIDs: []string{variant}, ScheduledAt: fixedNow.Add(26 * time.Hour)}
	group, err := svc.PublicBookGroup(e.ctx, spa.PublicGroupInput{BranchID: e.org.BranchID, CustomerName: "Shared", CustomerPhone: "081234560008", TherapistGenderPref: "any", PaymentMethod: "outlet", Source: "whatsapp", RoomID: origin, Guests: []spa.PublicGuest{guest, guest}})
	if err != nil {
		t.Fatal(err)
	}
	if group[0].RoomPriceIDR != 25000 || group[1].RoomPriceIDR != 0 {
		t.Fatal("initial shared room should charge once")
	}
	var secondID string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM spa.bookings WHERE booking_code=$1`, group[1].BookingCode).Scan(&secondID); err != nil {
		t.Fatal(err)
	}
	path := "/api/spa/bookings/" + secondID + "/room"
	unchanged := e.data(&e.admin, "PUT", path, map[string]any{"room_id": origin}, http.StatusOK)
	if unchanged["room_price_idr"] != float64(0) {
		t.Fatal("retry removed automatic shared-room exemption")
	}
	moved := e.data(&e.admin, "PUT", path, map[string]any{"room_id": target}, http.StatusOK)
	if moved["room_price_idr"] != float64(100000) {
		t.Fatal("moving guest must pay full destination tariff")
	}
}

func TestRoomCategories(t *testing.T) {
	e, _, _, _ := roomTransferFixture(t)
	for _, category := range []string{"public", "private"} {
		room := e.data(&e.admin, "POST", "/api/spa/rooms", map[string]any{
			"branch_id": e.org.BranchID, "name": "Category " + category, "category": category, "price_idr": 25000,
		}, http.StatusCreated)
		if room["category"] != category {
			t.Fatalf("category = %v, want %s", room["category"], category)
		}
		id := room["id"].(string)
		room = e.data(&e.admin, "PUT", "/api/spa/rooms/"+id, map[string]any{"name": "Category " + category, "price_idr": 0}, http.StatusOK)
		if room["category"] != category || room["price_idr"] != float64(0) {
			t.Fatalf("legacy update lost category or zero price: %v", room)
		}
		room = e.data(&e.admin, "PUT", "/api/spa/rooms/"+id, map[string]any{"name": "Category " + category, "category": "private"}, http.StatusOK)
		if room["category"] != "private" {
			t.Fatalf("update category = %v", room["category"])
		}
	}
	for _, category := range []any{"vip", "", nil} {
		e.call(&e.admin, "POST", "/api/spa/rooms", map[string]any{"branch_id": e.org.BranchID, "name": "Invalid", "category": category}, http.StatusBadRequest)
	}
}

func roomTransferFixture(t *testing.T) (*env, string, string, string) {
	t.Helper()
	e := setup(t)
	// Keep this explicit: read access alone must not authorize room changes.
	_, err := testutil.DB(t).Exec(e.ctx, `UPDATE iam.role_menu_permissions SET granted_actions='["read","update"]'::jsonb
	 WHERE role_id=$1 AND menu_id IN (SELECT id FROM iam.menus WHERE code='spa.bookings')`, e.admin.RoleID)
	if err != nil {
		t.Fatal(err)
	}
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id=$1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	e.data(&e.admin, "PUT", "/api/spa/outlets/"+e.org.BranchID, map[string]any{"warehouse_id": warehouse, "open_time": "09:00", "close_time": "22:00", "slot_minutes": 30, "is_active": true, "public_booking": true}, http.StatusOK)
	room := func(name string, price int) string {
		r := e.data(&e.admin, "POST", "/api/spa/rooms", map[string]any{"branch_id": e.org.BranchID, "name": name, "price_idr": price, "category": "public"}, http.StatusCreated)
		return r["id"].(string)
	}
	origin, target := room("Public", 25000), room("VIP", 100000)
	e.data(&e.admin, "PUT", "/api/spa/rooms/"+target, map[string]any{"name": "VIP", "category": "private", "price_idr": 100000}, http.StatusOK)
	tr := e.data(&e.admin, "POST", "/api/spa/treatments", map[string]any{"code": "MOVE" + testutil.RandomHex(3), "name": "Massage", "variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 200000}}}, http.StatusCreated)
	variant := tr["variants"].([]any)[0].(map[string]any)["id"]
	therapist := e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.scheduledEmployee("Room therapist", nil), "home_branch_id": e.org.BranchID}, http.StatusCreated)
	b := e.data(&e.admin, "POST", "/api/spa/bookings", map[string]any{"branch_id": e.org.BranchID, "booking_type": "walk_in", "customer_name": "Room transfer", "room_id": origin, "therapist_id": therapist["id"], "scheduled_at": "2026-10-08T03:00:00Z", "items": []any{map[string]any{"variant_id": variant}}}, http.StatusCreated)
	return e, b["id"].(string), origin, target
}

func TestRoomTransferPricing(t *testing.T) {
	e, id, _, target := roomTransferFixture(t)
	path := "/api/spa/bookings/" + id
	before := e.data(&e.admin, "POST", path+"/status", map[string]any{"action": "start"}, http.StatusOK)
	after := e.data(&e.admin, "PUT", path+"/room", map[string]any{"room_id": target}, http.StatusOK)
	if after["room_price_idr"] != float64(100000) || after["total_idr"] != float64(300000) || after["status"] != "in_treatment" {
		t.Fatalf("transfer must charge full destination: %v", after)
	}
	oldItem := before["items"].([]any)[0].(map[string]any)
	newItem := after["items"].([]any)[0].(map[string]any)
	if oldItem["started_at"] != newItem["started_at"] || before["ends_at"] != after["ends_at"] {
		t.Fatal("transfer restarted treatment")
	}
	e.call(&e.admin, "PUT", path+"/room", map[string]any{"room_id": nil}, http.StatusConflict)
	for _, field := range []string{"price_idr", "room_price_idr", "waive_price", "charge"} {
		e.call(&e.admin, "PUT", path+"/room", map[string]any{"room_id": target, field: 0}, http.StatusBadRequest)
	}
	e.data(&e.admin, "PUT", "/api/spa/rooms/"+target, map[string]any{"name": "VIP", "price_idr": 150000}, http.StatusOK)
	e.data(&e.admin, "POST", path+"/status", map[string]any{"action": "complete"}, http.StatusOK)
	e.call(&e.admin, "PUT", path+"/room", map[string]any{"room_id": target}, http.StatusConflict)
	co := e.data(&e.admin, "POST", path+"/checkout", map[string]any{"therapist_rating": 5}, http.StatusOK)
	var total float64
	var count int
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*), sum(unit_price * quantity)::float8 FROM pos.pos_order_items WHERE order_id=$1`, co["order_id"]).Scan(&count, &total); err != nil {
		t.Fatal(err)
	}
	if count != 2 || total != 300000 {
		t.Fatalf("checkout lines=%d total=%v", count, total)
	}
}

func TestRoomTransferRetry(t *testing.T) {
	e, id, origin, target := roomTransferFixture(t)
	path := "/api/spa/bookings/" + id + "/room"
	first := e.data(&e.admin, "PUT", path, map[string]any{"room_id": target}, http.StatusOK)
	e.data(&e.admin, "PUT", "/api/spa/rooms/"+target, map[string]any{"name": "VIP", "price_idr": 150000}, http.StatusOK)
	again := e.data(&e.admin, "PUT", path, map[string]any{"room_id": target}, http.StatusOK)
	if again["room_price_idr"] != float64(100000) || len(first["events"].([]any)) != len(again["events"].([]any)) {
		t.Fatal("retry changed snapshot or added event")
	}
	e.data(&e.admin, "PUT", "/api/spa/rooms/"+origin, map[string]any{"name": "Public", "price_idr": 0}, http.StatusOK)
	free := e.data(&e.admin, "PUT", path, map[string]any{"room_id": origin}, http.StatusOK)
	if free["room_price_idr"] != float64(0) || free["total_idr"] != float64(200000) {
		t.Fatal("free room charged")
	}
}

func TestRoomTransferAccess(t *testing.T) {
	e, id, _, target := roomTransferFixture(t)
	path := "/api/spa/bookings/" + id + "/room"
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"spa.bookings": {"read"}}})
	e.call(&reader, "PUT", path, map[string]any{"room_id": target}, http.StatusForbidden)
	// Grant update to a therapist deliberately: identity still denies transfer.
	therapist := e.therapist
	testutil.GrantMenu(t, reader.RoleID, "spa.book-order", []string{"read", "update"})
	if _, err := testutil.DB(t).Exec(e.ctx, `INSERT INTO iam.user_roles(user_id,role_id) VALUES($1,$2)`, therapist.UserID, reader.RoleID); err != nil {
		t.Fatal(err)
	}
	employee := e.scheduledEmployee("Denied therapist", &therapist.UserID)
	e.data(&e.admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": employee, "home_branch_id": e.org.BranchID}, http.StatusCreated)
	e.call(&therapist, "PUT", path, map[string]any{"room_id": target}, http.StatusForbidden)
	for _, tc := range []struct {
		user    *testutil.Staff
		allowed bool
	}{{&e.admin, true}, {&reader, true}, {&therapist, false}} {
		b := e.data(tc.user, "GET", "/api/spa/bookings/"+id, nil, http.StatusOK)
		if b["can_change_room"] != tc.allowed {
			t.Fatalf("room capability = %v, want %v", b["can_change_room"], tc.allowed)
		}
	}
}

func TestRoomTransferDepositAndPayment(t *testing.T) {
	e, id, origin, target := roomTransferFixture(t)
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.bookings SET deposit_idr=100000,deposit_status='paid',deposit_paid_at=now() WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	path := "/api/spa/bookings/" + id + "/room"
	b := e.data(&e.admin, "PUT", path, map[string]any{"room_id": target}, http.StatusOK)
	dp := b["deposit"].(map[string]any)
	if dp["remaining_idr"] != float64(200000) || dp["deposit_idr"] != float64(100000) || dp["deposit_status"] != "paid" {
		t.Fatalf("wrong remaining/deposit: %v", dp)
	}
	// A full-payment invoice already issued must not silently become stale.
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.bookings SET xendit_invoice_id='test-full-invoice',invoice_amount_idr=200000 WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	e.call(&e.admin, "PUT", path, map[string]any{"room_id": origin}, http.StatusConflict)
	if _, err := e.tx.Exec(e.ctx, `UPDATE spa.bookings SET xendit_invoice_id=NULL,invoice_amount_idr=NULL,payment_status='paid' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	e.call(&e.admin, "PUT", path, map[string]any{"room_id": origin}, http.StatusConflict)
	// A move at the same price is safe even after full online payment.
	e.data(&e.admin, "PUT", "/api/spa/rooms/"+origin, map[string]any{"name": "Public", "price_idr": 100000}, http.StatusOK)
	e.data(&e.admin, "PUT", path, map[string]any{"room_id": origin}, http.StatusOK)
}

func TestRoomTransferCapacityAndStatus(t *testing.T) {
	e, id, _, target := roomTransferFixture(t)
	path := "/api/spa/bookings/" + id + "/room"
	other := testutil.CreateOrg(t, e.tx)
	var foreignRoom string
	if err := e.tx.QueryRow(e.ctx, `INSERT INTO spa.rooms(branch_id,name) VALUES($1,'Other outlet') RETURNING id::text`, other.BranchID).Scan(&foreignRoom); err != nil {
		t.Fatal(err)
	}
	e.call(&e.admin, "PUT", path, map[string]any{"room_id": foreignRoom}, http.StatusBadRequest)
	e.data(&e.admin, "PUT", "/api/spa/rooms/"+target, map[string]any{"name": "VIP", "is_active": false}, http.StatusOK)
	e.call(&e.admin, "PUT", path, map[string]any{"room_id": target}, http.StatusConflict)
	e.data(&e.admin, "PUT", "/api/spa/rooms/"+target, map[string]any{"name": "VIP", "is_active": true}, http.StatusOK)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO spa.bookings(booking_code,branch_id,warehouse_id,booking_type,customer_name,scheduled_at,ends_at,room_id,status)
	SELECT $2,branch_id,warehouse_id,booking_type,'Other',scheduled_at,ends_at,$3,'unassigned' FROM spa.bookings WHERE id=$1`, id, "FULL-"+testutil.RandomHex(4), target); err != nil {
		t.Fatal(err)
	}
	e.call(&e.admin, "PUT", path, map[string]any{"room_id": target}, http.StatusConflict)
	for _, status := range []string{"completed", "cancelled", "expired"} {
		if _, err := e.tx.Exec(e.ctx, `UPDATE spa.bookings SET status=$2 WHERE id=$1`, id, status); err != nil {
			t.Fatal(err)
		}
		e.call(&e.admin, "PUT", path, map[string]any{"room_id": nil}, http.StatusConflict)
	}
}
