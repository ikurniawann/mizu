package spa

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

/* ── day-off booking (revisi R5) ─────────────────────────────────────── */

func (h *Handler) myDayOffs(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	m, err := h.svc.MyDayOffs(r.Context(), u.ID, strings.TrimSpace(r.URL.Query().Get("month")))
	if err != nil {
		return err
	}
	return ok(w, m)
}

func (h *Handler) bookMyDayOff(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	f := body(r)
	date := str(f.Str("date", req, dateOpts))
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	d, err := h.svc.BookDayOff(r.Context(), u.ID, date)
	if err != nil {
		return err
	}
	return created(w, d)
}

func (h *Handler) cancelMyDayOff(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	d, err := h.svc.CancelMyDayOff(r.Context(), u.ID, id)
	if err != nil {
		return err
	}
	return ok(w, d)
}

func (h *Handler) outletDayOffs(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	branchID := strings.TrimSpace(r.URL.Query().Get("branch_id"))
	if branchID == "" {
		return httpx.BadRequest("branch_id wajib diisi")
	}
	m, err := h.svc.OutletDayOffs(r.Context(), u.ID, branchID, strings.TrimSpace(r.URL.Query().Get("month")))
	if err != nil {
		return err
	}
	return ok(w, m)
}

func (h *Handler) saveDayOffQuota(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	branchID, err := pathUUID(r, "branchId")
	if err != nil {
		return err
	}
	f := body(r)
	in := DayOffQuota{BranchID: branchID, MaxPerWeek: DefaultMaxPerWeek}
	count := validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)}
	if n := f.Int("min_female", req, count); n != nil {
		in.MinFemale = *n
	}
	if n := f.Int("min_male", req, count); n != nil {
		in.MinMale = *n
	}
	if n := f.Int("max_per_week", opt, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(7)}); n != nil {
		in.MaxPerWeek = *n
	}
	if err := f.ErrAtPath("Kuota tidak valid"); err != nil {
		return err
	}
	q, err := h.svc.SaveDayOffQuota(r.Context(), u.ID, in)
	if err != nil {
		return err
	}
	return ok(w, q)
}

func (h *Handler) cancelDayOff(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	reason := f.StrDefault("reason", "", validate.StrOpts{Trim: true, Max: 300})
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	d, err := h.svc.CancelDayOff(r.Context(), u.ID, id, reason)
	if err != nil {
		return err
	}
	return ok(w, d)
}
