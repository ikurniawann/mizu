package spa

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
)

/* ── arrival queue & auto-assign (revisi R3) ─────────────────────────── */

func (h *Handler) arrivalQueue(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	branchID := strings.TrimSpace(r.URL.Query().Get("branch_id"))
	date := strings.TrimSpace(r.URL.Query().Get("date"))
	if branchID == "" || date == "" {
		return httpx.BadRequest("branch_id dan date wajib diisi")
	}
	q, err := h.svc.ArrivalQueue(r.Context(), u.ID, branchID, date)
	if err != nil {
		return err
	}
	return ok(w, q)
}

// autoAssign: {"branch_id", "date"} assigns every unassigned booking of the day from the queue.
func (h *Handler) autoAssign(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	f := body(r)
	branchID := str(f.Str("branch_id", req, uuidOpts))
	date := str(f.Str("date", req, dateOpts))
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	res, err := h.svc.AutoAssign(r.Context(), u.ID, branchID, date)
	if err != nil {
		return err
	}
	return ok(w, res)
}
