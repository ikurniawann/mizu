package spa

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/validate"
)

/* ── therapist payroll (revisi R1) ───────────────────────────────────── */

func (h *Handler) paySettings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	cfg, err := h.svc.PaySettings(r.Context())
	if err != nil {
		return err
	}
	return ok(w, cfg)
}

func (h *Handler) savePaySettings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	f := body(r)
	in := PaySettings{}
	day := validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(31)}
	if n := f.Int("commission_day", req, day); n != nil {
		in.CommissionDay = *n
	}
	if n := f.Int("salary_day", req, day); n != nil {
		in.SalaryDay = *n
	}
	in.SalaryViaHRIS = f.BoolDefault("salary_via_hris", true)
	if err := f.ErrAtPath("Tanggal gajian tidak valid"); err != nil {
		return err
	}
	cfg, err := h.svc.SavePaySettings(r.Context(), in)
	if err != nil {
		return err
	}
	return ok(w, cfg)
}

func (h *Handler) therapistPays(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.TherapistPays(r.Context())
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) setPayType(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	payType := str(f.Enum("pay_type", req, []string{PaySalaryCommission, PayCommissionOnly}))
	if err := f.ErrAtPath("Tipe gaji tidak valid"); err != nil {
		return err
	}
	if err := h.svc.SetPayType(r.Context(), id, payType); err != nil {
		return err
	}
	return ok(w, map[string]string{"therapist_id": id, "pay_type": payType})
}

func (h *Handler) listPayRuns(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.PayRuns(r.Context(), strings.TrimSpace(r.URL.Query().Get("year")))
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) createPayRun(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	f := body(r)
	month := str(f.Str("month", req, validate.StrOpts{Trim: true, Min: 7, Max: 7}))
	kind := str(f.Enum("kind", req, []string{PayRunCommission, PayRunRegular}))
	if err := f.ErrAtPath("Data payroll tidak valid"); err != nil {
		return err
	}
	run, err := h.svc.CreatePayRun(r.Context(), u.ID, month, kind)
	if err != nil {
		return err
	}
	return created(w, run)
}

func (h *Handler) getPayRun(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	run, err := h.svc.PayRunDetail(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, run)
}

func (h *Handler) recalcPayRun(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	run, err := h.svc.RecalculatePayRun(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, run)
}

func (h *Handler) payRunAction(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	action := str(f.Enum("action", req, []string{"approve", "pay", "reopen"}))
	if err := f.ErrAtPath("Aksi tidak valid"); err != nil {
		return err
	}
	run, err := h.svc.PayRunAction(r.Context(), u.ID, id, action)
	if err != nil {
		return err
	}
	return ok(w, run)
}

func (h *Handler) deletePayRun(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeletePayRun(r.Context(), id); err != nil {
		return err
	}
	return ok(w, map[string]bool{"deleted": true})
}

func (h *Handler) updatePayLine(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	var bonus, deduction float64
	if n := f.Num("bonus_idr", opt, moneyOpts); n != nil {
		bonus = *n
	}
	if n := f.Num("deduction_idr", opt, moneyOpts); n != nil {
		deduction = *n
	}
	note := f.StrDefault("note", "", validate.StrOpts{Trim: true, Max: 300})
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	run, err := h.svc.UpdatePayLine(r.Context(), id, bonus, deduction, note)
	if err != nil {
		return err
	}
	return ok(w, run)
}

func (h *Handler) myPay(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	list, err := h.svc.MyPay(r.Context(), u.ID)
	if err != nil {
		return err
	}
	if list == nil {
		return ok(w, []PayLine{})
	}
	return ok(w, list)
}
