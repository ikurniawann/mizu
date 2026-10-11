package spa_test

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func TestTreatmentCategoriesCRUD(t *testing.T) {
	e := setup(t)
	name := "Kategori " + testutil.RandomHex(6)
	created := e.data(&e.admin, "POST", "/api/spa/treatment-categories", map[string]any{"name": name}, http.StatusCreated)
	id := created["id"].(string)
	path := "/api/spa/treatment-categories/" + id
	e.call(&e.admin, "POST", "/api/spa/treatment-categories", map[string]any{"name": name}, http.StatusConflict)
	e.call(&e.admin, "POST", "/api/spa/treatment-categories", map[string]any{"name": " "}, http.StatusBadRequest)

	treatment := e.data(&e.admin, "POST", "/api/spa/treatments", map[string]any{
		"code": "CAT" + testutil.RandomHex(4), "name": "Category test", "category": name,
		"variants": []any{map[string]any{"name": "60 menit", "duration_min": 60, "price_idr": 100000}},
	}, http.StatusCreated)
	renamed := name + " baru"
	e.data(&e.admin, "PATCH", path, map[string]any{"name": renamed}, http.StatusOK)
	var stored string
	if err := e.tx.QueryRow(e.ctx, `SELECT category FROM spa.treatments WHERE id = $1`, treatment["id"]).Scan(&stored); err != nil || stored != renamed {
		t.Fatalf("category after rename = %q, err = %v", stored, err)
	}
	e.call(&e.admin, "DELETE", path, nil, http.StatusConflict)
	e.data(&e.admin, "PATCH", "/api/spa/treatments/"+treatment["id"].(string), map[string]any{"category": ""}, http.StatusOK)
	e.call(&e.admin, "DELETE", path, nil, http.StatusOK)
	e.call(&e.admin, "DELETE", path, nil, http.StatusNotFound)
}
