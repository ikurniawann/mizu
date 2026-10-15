package payroll

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
)

// Entities that pay salaries and run payroll (configuration.companies).

type entityRow struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	HoldingName string `json:"holding_name"`
}

// GET /api/hris/payroll/entities
func (h *handler) listEntities(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...); err != nil {
		return err
	}
	all, err := h.svc.ports.Entities.List(r.Context(), h.svc.db)
	if err != nil {
		return opaque(err)
	}
	out := []entityRow{}
	for _, e := range all {
		if e.IsActive {
			out = append(out, entityRow{e.ID, e.Code, e.Name, e.HoldingName})
		}
	}
	return writeJSON(w, dataBody{out})
}

// entityByID is the active entity with this id; a 400 when id is empty,
// unknown or inactive.
func (s *service) entityByID(ctx context.Context, id string) (*Entity, error) {
	if id == "" {
		return nil, httpx.BadRequest("Entitas wajib dipilih")
	}
	all, err := s.ports.Entities.List(ctx, s.db)
	if err != nil {
		return nil, opaque(err)
	}
	for _, e := range all {
		if e.ID == id && e.IsActive {
			return &e, nil
		}
	}
	return nil, httpx.BadRequest("Entitas tidak ditemukan atau tidak aktif")
}

// attachCompanies sets "company" on each row from its company_id:
// {id, name}, nil when the row has none.
func (s *service) attachCompanies(ctx context.Context, rows []*obj) error {
	all, err := s.ports.Entities.List(ctx, s.db)
	if err != nil {
		return opaque(err)
	}
	names := map[string]string{}
	for _, e := range all {
		names[e.ID] = e.Name
	}
	for _, row := range rows {
		if id := row.Str("company_id"); id != "" {
			row.Set("company", object("id", id, "name", names[id]))
		} else {
			row.Set("company", nil)
		}
	}
	return nil
}
