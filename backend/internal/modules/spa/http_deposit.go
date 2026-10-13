package spa

import (
	"net/http"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Deposit (DP) handlers: the guest's DP invoice and mock payment, the front
// office's manual actions, and the global policy.

func (h *Handler) publicPayDeposit(w http.ResponseWriter, r *http.Request) error {
	token, err := pathUUID(r, "token")
	if err != nil {
		return err
	}
	pay, err := h.svc.PublicPayDeposit(r.Context(), token)
	if err != nil {
		return err
	}
	return ok(w, pay)
}

func (h *Handler) publicMockPayDeposit(w http.ResponseWriter, r *http.Request) error {
	token, err := pathUUID(r, "token")
	if err != nil {
		return err
	}
	result, err := h.svc.PublicMockPayDeposit(r.Context(), token)
	if err != nil {
		return err
	}
	return ok(w, result)
}

// POST /api/spa/bookings/{id}/deposit {action: paid|waive, note?}
func (h *Handler) bookingDeposit(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	action := str(f.Str("action", req, validate.StrOpts{Trim: true, Check: validate.EnumCheck([]string{"paid", "waive"})}))
	note := f.StrDefault("note", "", validate.StrOpts{Trim: true, Max: 300})
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	b, err := h.svc.SetDepositStatus(r.Context(), u.ID, id, action, note)
	if err != nil {
		return err
	}
	return ok(w, b)
}

func (h *Handler) getDepositSettings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	cfg, err := h.svc.DepositSettings(r.Context())
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, cfg)
}

func (h *Handler) putDepositSettings(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	f := body(r)
	zero, maxAmount, minHold, maxHold := 0.0, 10000000.0, 10.0, 1440.0
	amount := f.Num("amount_idr", req, validate.NumOpts{Min: &zero, Max: &maxAmount})
	hold := f.Int("hold_minutes", req, validate.NumOpts{Integer: true, Min: &minHold, Max: &maxHold})
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	cfg, err := h.svc.SetDepositSettings(r.Context(), u.ID, DepositSettings{AmountIDR: *amount, HoldMinutes: *hold})
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, cfg)
}
