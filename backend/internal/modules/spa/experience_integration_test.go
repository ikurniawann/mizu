package spa_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func caseDesign(layout string, stickers ...[2]string) map[string]any {
	list := make([]any, len(stickers))
	for i, s := range stickers {
		list[i] = map[string]any{"theme": s[0], "code": s[1]}
	}
	return map[string]any{"brand": "apple", "model": "iphone 15 pro", "layout": layout, "stickers": list,
		"background": "black-sky", "name": "Kai", "font": "daydream"}
}

// Paddy Experience custom case: the website requires a valid design for a
// customizable service, staff may book without one and fill it in later,
// and the design travels to the POS order line.
func TestCustomCaseDesign(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}
	e := setup(t)
	admin := &e.admin
	var warehouse string
	if err := e.tx.QueryRow(e.ctx, `SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 LIMIT 1`, e.org.BranchID).Scan(&warehouse); err != nil {
		t.Fatal(err)
	}
	branch := e.org.BranchID
	e.data(admin, "PUT", "/api/spa/outlets/"+branch, map[string]any{"warehouse_id": warehouse, "open_time": "10:00", "close_time": "22:00",
		"slot_minutes": 30, "is_active": true, "public_booking": true}, http.StatusOK)
	tr := e.data(admin, "POST", "/api/spa/treatments", map[string]any{"code": "CC" + testutil.RandomHex(3), "name": "Custom Case",
		"customizable": true, "variants": []any{map[string]any{"name": "Sesi desain", "duration_min": 30, "price_idr": 119000}}}, http.StatusCreated)
	if tr["customizable"] != true {
		t.Fatalf("treatment customizable = %v", tr["customizable"])
	}
	variant := tr["variants"].([]any)[0].(map[string]any)["id"].(string)
	plain := e.data(admin, "POST", "/api/spa/treatments", map[string]any{"code": "PL" + testutil.RandomHex(3), "name": "Pasang Glass",
		"variants": []any{map[string]any{"name": "15 menit", "duration_min": 15, "price_idr": 25000}}}, http.StatusCreated)
	plainVariant := plain["variants"].([]any)[0].(map[string]any)["id"].(string)
	crew := e.data(admin, "POST", "/api/spa/therapists", map[string]any{"employee_id": e.employee("Crew Desain", nil), "home_branch_id": branch}, http.StatusCreated)

	// The catalog is public.
	catalog := e.data(nil, "GET", "/api/public/spa/experience-catalog", nil, http.StatusOK)
	if catalog["price"] != float64(119000) || len(catalog["themes"].([]any)) != 16 {
		t.Fatalf("catalog = %v", catalog["price"])
	}
	treatments := e.list(nil, "/api/public/spa/outlets/"+branch+"/treatments")
	found := false
	for _, x := range treatments {
		if m := x.(map[string]any); m["id"] == tr["id"] {
			found = m["customizable"] == true
		}
	}
	if !found {
		t.Fatal("public treatment does not report customizable")
	}

	good := caseDesign("3", [2]string{"baking-pals", "baking-pals-a"}, [2]string{"picnic-day", "picnic-day-b"}, [2]string{"now-playing", "now-playing-c"})
	public := func(designs []any, status int) map[string]any {
		body := map[string]any{"branch_id": branch, "scheduled_at": "2026-10-09T05:00:00.000Z", "customer_name": "Kai",
			"customer_phone": "0813 5555 0101", "variant_ids": []any{variant}}
		if designs != nil {
			body["designs"] = designs
		}
		return e.call(nil, "POST", "/api/public/spa/bookings", body, status)
	}
	// Website: a customizable service needs a valid design.
	public(nil, http.StatusBadRequest)
	public([]any{nil}, http.StatusBadRequest)
	public([]any{caseDesign("3", [2]string{"baking-pals", "baking-pals-a"})}, http.StatusBadRequest)                                         // slots
	public([]any{caseDesign("2", [2]string{"baking-pals", "picnic-day-a"}, [2]string{"picnic-day", "picnic-day-b"})}, http.StatusBadRequest) // theme mismatch
	public([]any{good, good}, http.StatusBadRequest)                                                                                         // count
	res := public([]any{good}, http.StatusCreated)["data"].(map[string]any)
	item := res["items"].([]any)[0].(map[string]any)
	design, _ := item["design"].(map[string]any)
	if item["customizable"] != true || design["model"] != "Iphone 15 Pro" || design["background_name"] != "Black Sky" || design["font_name"] != "Daydream" {
		t.Fatalf("public booking design = %v", item)
	}
	status := e.data(nil, "GET", "/api/public/spa/bookings/"+res["access_token"].(string), nil, http.StatusOK)
	if d, _ := status["items"].([]any)[0].(map[string]any)["design"].(map[string]any); d["brand_name"] != "Apple" {
		t.Fatalf("status page design = %v", status["items"])
	}

	// Staff: no design needed; a design on a non-customizable service is refused.
	e.call(admin, "POST", "/api/spa/bookings", map[string]any{"branch_id": branch, "booking_type": "walk_in", "customer_name": "Salah",
		"scheduled_at": "2026-10-08T05:00:00Z", "items": []any{map[string]any{"variant_id": plainVariant, "design": good}}}, http.StatusBadRequest)
	booking := e.data(admin, "POST", "/api/spa/bookings", map[string]any{"branch_id": branch, "booking_type": "walk_in", "customer_name": "Tamu Toko",
		"therapist_id": crew["id"], "scheduled_at": "2026-10-08T03:00:00Z",
		"items": []any{map[string]any{"variant_id": variant}, map[string]any{"variant_id": plainVariant}}}, http.StatusCreated)
	path := "/api/spa/bookings/" + booking["id"].(string)
	caseItem, glassItem := items(booking)[0], items(booking)[1]
	if caseItem["customizable"] != true || caseItem["design"] != nil || glassItem["customizable"] != false {
		t.Fatalf("staff booking items = %v", items(booking))
	}
	// The crew fills the design in store; invalid ones and non-custom items are refused.
	e.call(admin, "PUT", path+"/items/"+glassItem["id"].(string)+"/design", map[string]any{"design": good}, http.StatusBadRequest)
	e.call(admin, "PUT", path+"/items/"+caseItem["id"].(string)+"/design", map[string]any{}, http.StatusBadRequest)
	bad := caseDesign("2", [2]string{"baking-pals", "baking-pals-a"}, [2]string{"baking-pals", "baking-pals-b"})
	bad["font"] = ""
	e.call(admin, "PUT", path+"/items/"+caseItem["id"].(string)+"/design", map[string]any{"design": bad}, http.StatusBadRequest)
	saved := e.data(admin, "PUT", path+"/items/"+caseItem["id"].(string)+"/design", map[string]any{"design": good}, http.StatusOK)
	if d, _ := items(saved)[0]["design"].(map[string]any); d["layout"] != "3" || len(d["stickers"].([]any)) != 3 {
		t.Fatalf("saved design = %v", items(saved)[0]["design"])
	}
	// The board shows it too.
	board := e.data(admin, "GET", "/api/spa/board?branch_id="+branch+"&date=2026-10-08", nil, http.StatusOK)
	if !strings.Contains(strings.ToLower(jsonString(t, board)), "black sky") {
		t.Fatal("board does not carry the design")
	}

	// Checkout: the POS order line carries the design summary.
	e.data(admin, "POST", path+"/status", map[string]any{"action": "start"}, http.StatusOK)
	e.data(admin, "POST", path+"/status", map[string]any{"action": "complete"}, http.StatusOK)
	out := e.data(admin, "POST", path+"/checkout", map[string]any{"therapist_rating": 5}, http.StatusOK)
	var note string
	if err := e.tx.QueryRow(e.ctx, `SELECT kitchen_notes FROM pos.pos_order_items WHERE order_id = $1 AND product_name LIKE 'Custom Case%'`,
		out["order_id"]).Scan(&note); err != nil {
		t.Fatal(err)
	}
	want := "Desain: Iphone 15 Pro · Black Sky · 3 stiker: Baking Pals A, Picnic Day B, Now Playing C · Nama: Kai (Daydream) · Crew: Crew Desain"
	if note != want {
		t.Fatalf("POS note = %q, want %q", note, want)
	}
	// Paid or sent to the cashier: still editable until paid; clearing works.
	cleared := e.data(admin, "PUT", path+"/items/"+caseItem["id"].(string)+"/design", map[string]any{"design": nil}, http.StatusOK)
	if items(cleared)[0]["design"] != nil {
		t.Fatalf("cleared design = %v", items(cleared)[0]["design"])
	}
}

func jsonString(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
