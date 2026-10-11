package insights

import (
	"fmt"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

const salesTargetMenu = "report.sales-vs-target"

func salesStaff(t *testing.T, actions ...string) testutil.Staff {
	return testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{salesTargetMenu: actions}})
}

func salesRequest(h *harness, staff testutil.Staff, method, path string, body any, status int) map[string]any {
	h.t.Helper()
	c := h.do(testutil.AsStaff(testutil.Request(method, path, body), staff))
	if c.status != status {
		h.t.Fatalf("%s %s: got %d, want %d: %s", method, path, c.status, status, c.raw)
	}
	return c.obj(h.t)
}

func TestMonthlySalesTargetCRUD(t *testing.T) {
	staff := salesStaff(t, "read", "create", "update", "delete")
	h := newTxHarness(t)
	org := testutil.CreateOrg(t, h.tx)
	body := map[string]any{"branch_id": org.BranchID, "month": "2031-01", "amount": 1000000}
	created := salesRequest(h, staff, "POST", "/api/reports/sales-targets", body, 201)["data"].(map[string]any)
	id := created["id"].(string)
	salesRequest(h, staff, "POST", "/api/reports/sales-targets", body, 409)
	body["amount"] = 2000000
	updated := salesRequest(h, staff, "PATCH", "/api/reports/sales-targets/"+id, body, 200)["data"].(map[string]any)
	if updated["amount"] != float64(2000000) || updated["month"] != "2031-01" {
		t.Fatal(updated)
	}
	list := salesRequest(h, staff, "GET", "/api/reports/sales-targets?year=2031&branch_id="+org.BranchID, nil, 200)["data"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["id"] != id {
		t.Fatal(list)
	}
	salesRequest(h, staff, "DELETE", "/api/reports/sales-targets/"+id, nil, 200)
	salesRequest(h, staff, "DELETE", "/api/reports/sales-targets/"+id, nil, 404)
	list = salesRequest(h, staff, "GET", "/api/reports/sales-targets?year=2031&branch_id="+org.BranchID, nil, 200)["data"].([]any)
	if len(list) != 0 {
		t.Fatal(list)
	}
}

func TestSalesVsTargetPaidOrdersAndWIB(t *testing.T) {
	staff := salesStaff(t, "read", "create")
	h := newTxHarness(t)
	org := testutil.CreateOrg(t, h.tx)
	other := testutil.CreateOrg(t, h.tx)
	for i, fixture := range []struct {
		date, payment, status, branch string
		amount                        int
	}{
		{"2030-12-31T17:00:00Z", "paid", "completed", org.BranchID, 150},
		{"2031-01-31T17:00:00Z", "paid", "completed", org.BranchID, 50},
		{"2031-01-01T02:00:00Z", "unpaid", "completed", org.BranchID, 900},
		{"2031-01-01T02:00:00Z", "paid", "cancelled", org.BranchID, 900},
		{"2031-01-01T02:00:00Z", "paid", "voided", org.BranchID, 900},
		{"2031-01-01T02:00:00Z", "paid", "merged", org.BranchID, 900},
		{"2030-12-31T16:59:59Z", "paid", "completed", org.BranchID, 900},
		{"2031-12-31T17:00:00Z", "paid", "completed", org.BranchID, 900},
		{"2031-01-01T02:00:00Z", "paid", "completed", other.BranchID, 900},
	} {
		h.exec(`INSERT INTO pos.pos_orders (order_number,cashier_id,branch_id,total_amount,ordered_at,created_at,payment_status,status)
		 VALUES ($1,$2,$3,$4,$5,$5,$6,$7)`, fmt.Sprintf("SVT-%s-%d", testutil.RandomHex(4), i), staff.UserID, fixture.branch, fixture.amount, fixture.date, fixture.payment, fixture.status)
	}
	salesRequest(h, staff, "POST", "/api/reports/sales-targets", map[string]any{"branch_id": org.BranchID, "month": "2031-01", "amount": 100}, 201)
	data := salesRequest(h, staff, "GET", "/api/reports/sales-vs-target?year=2031&branch_id="+org.BranchID, nil, 200)["data"].(map[string]any)
	months := data["months"].([]any)
	if len(months) != 12 {
		t.Fatal(months)
	}
	jan, feb := months[0].(map[string]any), months[1].(map[string]any)
	if jan["sales"] != float64(150) || jan["target"] != float64(100) || feb["sales"] != float64(50) || feb["target"] != nil {
		t.Fatal(data)
	}
	if months[11].(map[string]any)["sales"] != float64(0) {
		t.Fatal(months)
	}
}

func TestSalesTargetsScopePermissionsAndValidation(t *testing.T) {
	admin := salesStaff(t, "read", "create", "update", "delete")
	reader := salesStaff(t, "read")
	writer := salesStaff(t, "update")
	h := newTxHarness(t)
	org := testutil.CreateOrg(t, h.tx)
	other := testutil.CreateOrg(t, h.tx)
	body := map[string]any{"branch_id": other.BranchID, "month": "2031-02", "amount": 100}
	id := salesRequest(h, admin, "POST", "/api/reports/sales-targets", body, 201)["data"].(map[string]any)["id"].(string)
	for _, level := range []string{"branch", "company", "holding"} {
		h.exec(`UPDATE configuration.users SET business_scope=$2,company_id=$3,branch_id=$4,holding_id=$5 WHERE id=$1`, admin.UserID, level, org.CompanyID, org.BranchID, org.HoldingID)
		for _, path := range []string{"sales-vs-target", "sales-targets"} {
			salesRequest(h, admin, "GET", "/api/reports/"+path+"?year=2031&branch_id="+other.BranchID, nil, 403)
		}
		salesRequest(h, admin, "POST", "/api/reports/sales-targets", body, 403)
		salesRequest(h, admin, "PATCH", "/api/reports/sales-targets/"+id, body, 404)
		salesRequest(h, admin, "DELETE", "/api/reports/sales-targets/"+id, nil, 404)
		list := salesRequest(h, admin, "GET", "/api/reports/sales-targets?year=2031", nil, 200)["data"].([]any)
		if len(list) != 0 {
			t.Fatal("target outside scope leaked", list)
		}
	}
	body["branch_id"] = org.BranchID
	salesRequest(h, reader, "POST", "/api/reports/sales-targets", body, 403)
	salesRequest(h, reader, "PATCH", "/api/reports/sales-targets/"+id, body, 403)
	salesRequest(h, reader, "DELETE", "/api/reports/sales-targets/"+id, nil, 403)
	salesRequest(h, writer, "GET", "/api/reports/sales-vs-target?year=2031", nil, 403)
	for _, amount := range []any{0, -1, 100000000001, "abc", nil} {
		body["amount"] = amount
		salesRequest(h, admin, "POST", "/api/reports/sales-targets", body, 400)
	}
	body["amount"] = 100
	body["month"] = "2031-13"
	salesRequest(h, admin, "POST", "/api/reports/sales-targets", body, 400)
	for _, query := range []string{"?year=bad", "?year=1999", "?year=2031&branch_id=bad"} {
		salesRequest(h, admin, "GET", "/api/reports/sales-vs-target"+query, nil, 400)
	}
}

func targetCell(branch string, month int, amount, previous any) map[string]any {
	return map[string]any{"branch_id": branch, "month": month, "amount": amount, "previous": previous}
}

func TestSalesTargetYearPivotAndCRUD(t *testing.T) {
	staff := salesStaff(t, "read", "create", "update", "delete")
	h := newTxHarness(t)
	org := testutil.CreateOrg(t, h.tx)
	other := testutil.CreateOrg(t, h.tx)
	branch2 := h.scalar(`INSERT INTO configuration.branches(company_id,name,code) VALUES ($1,'Outlet 2',$2) RETURNING id::text`, org.CompanyID, "PIV"+testutil.RandomHex(4))
	h.exec(`UPDATE configuration.users SET business_scope='company',company_id=$2 WHERE id=$1`, staff.UserID, org.CompanyID)
	h.exec(`INSERT INTO configuration.monthly_sales_targets(branch_id,month,amount) VALUES ($1,'2037-01-01',9000)`, other.BranchID)
	body := map[string]any{"changes": []any{targetCell(org.BranchID, 1, 100, nil), targetCell(branch2, 1, 200, nil), targetCell(branch2, 12, 50, nil)}}
	salesRequest(h, staff, "PUT", "/api/reports/sales-target-years/2037", body, 200)
	salesRequest(h, staff, "PUT", "/api/reports/sales-target-years/2038", map[string]any{"changes": []any{targetCell(org.BranchID, 2, 1000, nil)}}, 200)
	data := salesRequest(h, staff, "GET", "/api/reports/sales-target-years", nil, 200)["data"].(map[string]any)
	years := data["years"].([]any)
	if len(data["outlets"].([]any)) != 2 || len(years) != 2 || years[0].(map[string]any)["year"] != float64(2038) {
		t.Fatal(data)
	}
	year := years[1].(map[string]any)
	months := year["months"].([]any)
	if len(months) != 12 || months[0] != float64(300) || months[1] != float64(0) || months[11] != float64(50) || year["total"] != float64(350) {
		t.Fatal(year)
	}
	body["changes"] = []any{targetCell(org.BranchID, 1, 150, 100), targetCell(branch2, 12, nil, 50)}
	salesRequest(h, staff, "PUT", "/api/reports/sales-target-years/2037", body, 200)
	rows := salesRequest(h, staff, "GET", "/api/reports/sales-targets?year=2037", nil, 200)["data"].([]any)
	if len(rows) != 2 || h.scalar(`SELECT sum(amount)::text FROM configuration.monthly_sales_targets WHERE branch_id=ANY($1::uuid[]) AND extract(year FROM month)=2037`, []string{org.BranchID, branch2}) != "350.00" {
		t.Fatal(rows)
	}
	salesRequest(h, staff, "DELETE", "/api/reports/sales-target-years/2037", nil, 200)
	if h.scalar(`SELECT count(*)::text FROM configuration.monthly_sales_targets WHERE branch_id=$1 AND extract(year FROM month)=2037`, other.BranchID) != "1" {
		t.Fatal("year delete removed another company's target")
	}
	salesRequest(h, staff, "DELETE", "/api/reports/sales-target-years/2037", nil, 404)
}

func TestSalesTargetYearAtomicValidationAndPermissions(t *testing.T) {
	admin := salesStaff(t, "read", "create", "update", "delete")
	creator := salesStaff(t, "read", "create")
	updater := salesStaff(t, "read", "update")
	reader := salesStaff(t, "read")
	h := newTxHarness(t)
	org := testutil.CreateOrg(t, h.tx)
	other := testutil.CreateOrg(t, h.tx)
	h.exec(`UPDATE configuration.users SET business_scope='branch',branch_id=$2 WHERE id=$1`, admin.UserID, org.BranchID)
	h.exec(`INSERT INTO configuration.monthly_sales_targets(branch_id,month,amount) VALUES ($1,'2037-02-01',200)`, org.BranchID)
	for _, tc := range []struct {
		staff  testutil.Staff
		cell   map[string]any
		status int
	}{
		{admin, targetCell(other.BranchID, 2, 300, nil), 403},
		{admin, targetCell(org.BranchID, 2, 300, 199), 409},
		{admin, targetCell(org.BranchID, 13, 300, nil), 400},
		{admin, targetCell(org.BranchID, 2, -1, 200), 400},
		{admin, targetCell(org.BranchID, 2, 100000000001, 200), 400},
		{creator, targetCell(org.BranchID, 2, 300, 200), 403},
		{creator, targetCell(org.BranchID, 2, nil, 200), 403},
		{reader, targetCell(org.BranchID, 2, 300, 200), 403},
	} {
		body := map[string]any{"changes": []any{targetCell(org.BranchID, 1, 100, nil), tc.cell}}
		salesRequest(h, tc.staff, "PUT", "/api/reports/sales-target-years/2037", body, tc.status)
		if h.scalar(`SELECT count(*)::text FROM configuration.monthly_sales_targets WHERE branch_id=$1 AND month='2037-01-01'`, org.BranchID) != "0" || h.scalar(`SELECT amount::text FROM configuration.monthly_sales_targets WHERE branch_id=$1 AND month='2037-02-01'`, org.BranchID) != "200.00" {
			t.Fatal("failed grid save partially changed targets")
		}
	}
	salesRequest(h, updater, "PUT", "/api/reports/sales-target-years/2037", map[string]any{"changes": []any{targetCell(org.BranchID, 1, 100, nil)}}, 403)
	salesRequest(h, updater, "PUT", "/api/reports/sales-target-years/2037", map[string]any{"changes": []any{targetCell(org.BranchID, 2, 300, 200)}}, 200)
	salesRequest(h, reader, "DELETE", "/api/reports/sales-target-years/2037", nil, 403)
	for _, year := range []string{"1999", "2101", "bad"} {
		salesRequest(h, admin, "PUT", "/api/reports/sales-target-years/"+year, map[string]any{"changes": []any{targetCell(org.BranchID, 1, 100, nil)}}, 400)
	}
	salesRequest(h, admin, "PUT", "/api/reports/sales-target-years/2037", map[string]any{"changes": []any{targetCell(org.BranchID, 1, 100, nil), targetCell(org.BranchID, 1, 200, nil)}}, 400)
}
