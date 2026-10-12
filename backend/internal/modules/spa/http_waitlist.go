package spa

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Waitlist handlers (EPIC-053 Fase 3): the front office sees who is waiting
// for a full day and closes entries it handled by phone or by booking.
// Routes are registered in http.go next to the booking routes.

func (h *Handler) listWaitlist(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var f WaitlistFilter
	var err error
	if f.BranchID, err = queryUUID(r, "branch_id", false); err != nil {
		return err
	}
	if f.Status, err = oneOf(r, "status", waitlistStatuses); err != nil {
		return err
	}
	if f.From, err = queryDate(r, "from", false); err != nil {
		return err
	}
	if f.To, err = queryDate(r, "to", false); err != nil {
		return err
	}
	list, err := h.svc.Waitlist(r.Context(), u.ID, f)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, list)
}

func (h *Handler) createWaitlist(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	body, present := validate.ReadBody(r)
	f := validate.New(body, present)
	branch := f.Str("branch_id", validate.Rule{}, validate.StrOpts{Trim: true, Check: validate.UUIDCheck})
	name := f.Str("customer_name", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 120})
	phone := f.Str("customer_phone", validate.Rule{}, validate.StrOpts{Trim: true, Min: 8, Max: 20})
	date := f.Str("visit_date", validate.Rule{}, validate.StrOpts{Trim: true, Min: 10, Max: 10})
	period := f.StrDefault("period", "", validate.StrOpts{Trim: true, Check: validate.EnumCheck([]string{"", "pagi", "siang", "sore", "malam"})})
	one, ten := 1.0, 10.0
	people := f.Int("people", validate.Rule{Optional: true}, validate.NumOpts{Integer: true, Min: &one, Max: &ten})
	note := f.StrDefault("note", "", validate.StrOpts{Trim: true, Max: 500})
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	e, err := h.svc.JoinWaitlist(r.Context(), WaitlistInput{
		BranchID: *branch, CustomerName: *name, CustomerPhone: *phone, VisitDate: *date, Period: period,
		People: valueOr(people, 1), Source: "front_office", Note: note, CreatedBy: u.ID,
	})
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, e)
}

func (h *Handler) waitlistStatus(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return httpx.NotFound("Daftar tunggu tidak ditemukan")
	}
	body, present := validate.ReadBody(r)
	f := validate.New(body, present)
	status := f.Str("status", validate.Rule{}, validate.StrOpts{Trim: true, Check: validate.EnumCheck([]string{WaitlistOpen, WaitlistBooked, WaitlistCancelled})})
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	e, err := h.svc.SetWaitlistStatus(r.Context(), u.ID, id, strings.ToLower(*status))
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, e)
}

func valueOr(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}
