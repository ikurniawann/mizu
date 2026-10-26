package spa

import (
	"encoding/json"
	"net/http"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
)

func (h *Handler) monthlyRoster(w http.ResponseWriter, r *http.Request, u *auth.User, apply bool) error {
	var in rosterRequest
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	d.DisallowUnknownFields()
	if err := d.Decode(&in); err != nil {
		return httpx.BadRequest("Data jadwal tidak valid")
	}
	if in.BranchID == "" {
		return httpx.BadRequest("Outlet wajib diisi")
	}
	out, err := h.svc.roster(r.Context(), u.ID, in, apply)
	if err != nil {
		return err
	}
	return ok(w, out)
}
func (h *Handler) previewRoster(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	return h.monthlyRoster(w, r, u, false)
}
func (h *Handler) applyRoster(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	return h.monthlyRoster(w, r, u, true)
}
