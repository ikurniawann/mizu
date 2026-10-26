package spa

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

/* ── rooms (revisi R6/R9) ────────────────────────────────────────────── */

func (h *Handler) listRooms(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	branchID := strings.TrimSpace(r.URL.Query().Get("branch_id"))
	if branchID == "" {
		return httpx.BadRequest("branch_id wajib diisi")
	}
	list, err := h.svc.Rooms(r.Context(), u.ID, branchID, r.URL.Query().Get("active") == "true")
	if err != nil {
		return err
	}
	return ok(w, list)
}

func roomFields(f *validate.Form, withBranch bool) roomInput {
	in := roomInput{
		Category:    str(f.Enum("category", opt, []string{"public", "private"})),
		Name:        f.StrDefault("name", "", validate.StrOpts{Trim: true, Max: 80}),
		Description: f.StrDefault("description", "", validate.StrOpts{Trim: true, Max: 500}),
		IsActive:    f.BoolDefault("is_active", true),
	}
	if withBranch {
		in.BranchID = str(f.Str("branch_id", req, uuidOpts))
	}
	if n := f.Int("capacity", opt, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(10)}); n != nil {
		in.Capacity = *n
	}
	if p := f.Num("price_idr", opt, moneyOpts); p != nil {
		in.PriceIDR = *p
	}
	if n := f.Int("sort_order", opt, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(9999)}); n != nil {
		in.SortOrder = *n
	}
	return in
}

func (h *Handler) createRoom(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	f := body(r)
	in := roomFields(f, true)
	if err := f.ErrAtPath("Data room tidak valid"); err != nil {
		return err
	}
	room, err := h.svc.SaveRoom(r.Context(), u.ID, "", in)
	if err != nil {
		return err
	}
	return created(w, room)
}

func (h *Handler) updateRoom(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	in := roomFields(f, false)
	if err := f.ErrAtPath("Data room tidak valid"); err != nil {
		return err
	}
	room, err := h.svc.SaveRoom(r.Context(), u.ID, id, in)
	if err != nil {
		return err
	}
	return ok(w, room)
}

func (h *Handler) deleteRoom(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteRoom(r.Context(), u.ID, id); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

// setBookingRoom: {"room_id": "<uuid>"} puts the booking in a room, null releases it.
func (h *Handler) setBookingRoom(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if _, err := h.auth.RequireMenuAction(r, "update", iam.SpaBookings...); err != nil {
		return err
	}
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	for key := range f.Fields() {
		if key != "room_id" {
			f.Fail(key, "custom", "Biaya room dihitung otomatis; hanya room_id yang boleh dikirim")
		}
	}
	roomID := strings.ToLower(str(f.Str("room_id", validate.Rule{Nullable: true}, uuidOpts)))
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	b, err := h.svc.SetBookingRoom(r.Context(), u.ID, id, roomID)
	if err != nil {
		return err
	}
	b.CanChangeRoom = ptr(true)
	return ok(w, b)
}

func (h *Handler) roomBoard(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	branchID := strings.TrimSpace(r.URL.Query().Get("branch_id"))
	if branchID == "" {
		return httpx.BadRequest("branch_id wajib diisi")
	}
	board, err := h.svc.RoomBoard(r.Context(), u.ID, branchID)
	if err != nil {
		return err
	}
	return ok(w, board)
}
