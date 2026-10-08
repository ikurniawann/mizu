package spa

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Handler serves /api/spa (staff and therapists) and /api/public/spa.
type Handler struct {
	svc  *Service
	auth *auth.Service
}

const (
	staffPrefix  = "/api/spa"
	publicPrefix = "/api/public/spa"
)

type staffFunc func(w http.ResponseWriter, r *http.Request, user *auth.User) error

// Routes lists every route of the module.
func (h *Handler) Routes() []module.Route {
	staff := func(pattern string, prefixes []string, fn staffFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			user, err := h.auth.RequireMenuPrefix(r, prefixes...)
			if err != nil {
				return err
			}
			return fn(w, r, user)
		})}
	}
	self := func(pattern string, fn staffFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			user, err := h.auth.RequireUser(r)
			if err != nil {
				return err
			}
			return fn(w, r, user)
		})}
	}
	public := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	p := staffPrefix
	return []module.Route{
		staff("GET "+p+"/outlets", iam.Spa, h.listOutlets),
		staff("PUT "+p+"/outlets/{branchId}", iam.SpaOutlets, h.putOutlet),
		staff("POST "+p+"/outlets/{branchId}/sync-pos", iam.SpaOutlets, h.syncPOS),

		staff("GET "+p+"/treatments", iam.Spa, h.listTreatments),
		staff("POST "+p+"/treatments", iam.SpaTreatments, h.createTreatment),
		staff("PATCH "+p+"/treatments/{id}", iam.SpaTreatments, h.updateTreatment),
		staff("PUT "+p+"/treatments/{id}/prices", iam.SpaTreatments, h.setPrices),

		staff("GET "+p+"/therapists", iam.Spa, h.listTherapists),
		staff("POST "+p+"/therapists", iam.SpaTherapists, h.createTherapist),
		staff("PATCH "+p+"/therapists/{id}", iam.SpaTherapists, h.updateTherapist),
		staff("GET "+p+"/employees", iam.SpaTherapists, h.listEmployees),
		staff("GET "+p+"/assists", iam.Spa, h.listAssists),
		staff("POST "+p+"/assists", iam.SpaTherapists, h.createAssist),
		staff("DELETE "+p+"/assists/{id}", iam.SpaTherapists, h.deleteAssist),
		staff("GET "+p+"/outlet-pics", iam.Spa, h.listPICs),
		staff("POST "+p+"/outlet-pics", iam.SpaTherapists, h.addPIC),
		staff("DELETE "+p+"/outlet-pics", iam.SpaTherapists, h.removePIC),

		staff("GET "+p+"/customers", iam.SpaBookings, h.listCustomers),
		staff("GET "+p+"/bookings", iam.SpaBookings, h.listBookings),
		staff("POST "+p+"/bookings", iam.SpaBookings, h.createBooking),
		staff("GET "+p+"/bookings/{id}", iam.SpaBookings, h.getBooking),
		staff("PATCH "+p+"/bookings/{id}", iam.SpaBookings, h.patchBooking),
		staff("POST "+p+"/bookings/{id}/items", iam.SpaBookings, h.addItem),
		staff("PATCH "+p+"/bookings/{id}/items/{itemId}", iam.SpaBookings, h.itemAction),
		staff("POST "+p+"/bookings/{id}/cancel", iam.SpaBookings, h.cancelBooking),
		staff("POST "+p+"/bookings/{id}/checkout", iam.SpaBookings, h.checkout),
		staff("GET "+p+"/availability", iam.SpaBookings, h.availability),
		staff("GET "+p+"/board", iam.SpaBookings, h.board),

		staff("GET "+p+"/commission-rules", iam.SpaCommissions, h.listRules),
		staff("POST "+p+"/commission-rules", iam.SpaCommissions, h.createRule),
		staff("PATCH "+p+"/commission-rules/{id}", iam.SpaCommissions, h.updateRule),
		staff("DELETE "+p+"/commission-rules/{id}", iam.SpaCommissions, h.deleteRule),
		staff("GET "+p+"/commissions", iam.SpaCommissions, h.report),

		self("GET "+p+"/me", h.me),
		self("GET "+p+"/me/assignments", h.myAssignments),
		self("PATCH "+p+"/me/assignments/{itemId}", h.myAction),
		self("GET "+p+"/me/commissions", h.myCommissions),

		public("GET "+publicPrefix+"/outlets", h.publicOutlets),
		public("GET "+publicPrefix+"/outlets/{branchId}/treatments", h.publicTreatments),
		public("POST "+publicPrefix+"/bookings", h.publicBook),
	}
}

func ok(w http.ResponseWriter, data any) error { return httpx.Data(w, http.StatusOK, data) }

func created(w http.ResponseWriter, data any) error { return httpx.Data(w, http.StatusCreated, data) }

func pathUUID(r *http.Request, name string) (string, error) {
	id := r.PathValue(name)
	if !validate.IsUUID(id) {
		return "", httpx.BadRequest("ID tidak valid")
	}
	return id, nil
}

func queryUUID(r *http.Request, name string, required bool) (string, error) {
	v := strings.TrimSpace(r.URL.Query().Get(name))
	if v == "" {
		if required {
			return "", httpx.BadRequest(name + " wajib diisi")
		}
		return "", nil
	}
	if !validate.IsUUID(v) {
		return "", httpx.BadRequest(name + " tidak valid")
	}
	return v, nil
}

var datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func queryDate(r *http.Request, name string, required bool) (string, error) {
	v := strings.TrimSpace(r.URL.Query().Get(name))
	if v == "" && !required {
		return "", nil
	}
	if _, _, ok := domain.DayBounds(v); !ok || !datePattern.MatchString(v) {
		return "", httpx.BadRequest("Tanggal " + name + " tidak valid (YYYY-MM-DD)")
	}
	return v, nil
}

func queryTime(r *http.Request, name string) (time.Time, error) {
	t, ok := validate.ParseJSDate(strings.TrimSpace(r.URL.Query().Get(name)))
	if !ok {
		return time.Time{}, httpx.BadRequest(name + " tidak valid")
	}
	return t, nil
}

func body(r *http.Request) *validate.Form { return validate.New(validate.ReadBody(r)) }

var (
	req      = validate.Rule{}
	opt      = validate.Rule{Optional: true}
	optNull  = validate.Rule{Optional: true, Nullable: true}
	uuidOpts = validate.StrOpts{Check: validate.UUIDCheck}
	dateOpts = validate.StrOpts{Check: func(s string) (string, string, bool) {
		_, _, ok := domain.DayBounds(s)
		return "invalid_format", "Format tanggal YYYY-MM-DD", ok && datePattern.MatchString(s)
	}}
	clockOpts = validate.StrOpts{Check: func(s string) (string, string, bool) {
		_, ok := domain.ClockMinutes(s)
		return "invalid_format", "Format jam HH:MM", ok
	}}
	datetimeOpts = validate.StrOpts{Check: validate.DatetimeCheck}
	moneyOpts    = validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1e12)}
)

func parseTime(s *string) *time.Time {
	if s == nil {
		return nil
	}
	t, ok := validate.ParseJSDate(*s)
	if !ok {
		return nil
	}
	return &t
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

/* ── outlets ─────────────────────────────────────────────────────────── */

func (h *Handler) listOutlets(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	list, err := h.svc.Outlets(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) putOutlet(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	branchID, err := pathUUID(r, "branchId")
	if err != nil {
		return err
	}
	f := body(r)
	in := outletInput{
		WarehouseID:   str(f.Str("warehouse_id", req, uuidOpts)),
		OpenTime:      str(f.Str("open_time", req, clockOpts)),
		CloseTime:     str(f.Str("close_time", req, clockOpts)),
		PublicBooking: f.BoolDefault("public_booking", true),
		IsActive:      f.BoolDefault("is_active", true),
	}
	if n := f.Int("slot_minutes", req, validate.NumOpts{Min: validate.Bound(5), Max: validate.Bound(240)}); n != nil {
		in.SlotMinutes = *n
	}
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	o, err := h.svc.PutOutlet(r.Context(), u.ID, branchID, in)
	if err != nil {
		return err
	}
	return ok(w, o)
}

func (h *Handler) syncPOS(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	branchID, err := pathUUID(r, "branchId")
	if err != nil {
		return err
	}
	n, err := h.svc.SyncPOS(r.Context(), u.ID, branchID)
	if err != nil {
		return err
	}
	return ok(w, struct {
		Synced int `json:"synced"`
	}{n})
}

/* ── treatments ──────────────────────────────────────────────────────── */

var codePattern = regexp.MustCompile(`^[A-Z0-9][A-Z0-9-]{0,19}$`)

func (h *Handler) listTreatments(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.Treatments(r.Context(), r.URL.Query().Get("active") == "true")
	if err != nil {
		return err
	}
	return ok(w, list)
}

func treatmentFields(f *validate.Form, partial bool) treatmentInput {
	rule := req
	if partial {
		rule = opt
	}
	in := treatmentInput{
		Code: f.Str("code", rule, validate.StrOpts{Trim: true, Check: func(s string) (string, string, bool) {
			return "invalid_format", "Kode 1–20 karakter huruf, angka atau tanda hubung", codePattern.MatchString(strings.ToUpper(s))
		}}),
		Name:        f.Str("name", rule, validate.StrOpts{Trim: true, Min: 1, Max: 120}),
		Category:    f.Str("category", opt, validate.StrOpts{Trim: true, Max: 60}),
		Description: f.Str("description", opt, validate.StrOpts{Trim: true, Max: 2000}),
		IsActive:    f.Bool("is_active", opt),
		SortOrder:   f.Int("sort_order", opt, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(9999)}),
	}
	if in.Code != nil {
		upper := strings.ToUpper(*in.Code)
		in.Code = &upper
	}
	variantRule := req
	if partial {
		variantRule = opt
	}
	list := f.List("variants", variantRule, 20, func(items *validate.Form, i int, v any) {
		item := items.Item(i, v)
		vi := variantInput{
			ID:       str(item.Str("id", opt, uuidOpts)),
			Name:     str(item.Str("name", req, validate.StrOpts{Trim: true, Min: 1, Max: 60})),
			IsActive: item.BoolDefault("is_active", true),
		}
		if n := item.Int("duration_min", req, validate.NumOpts{Min: validate.Bound(5), Max: validate.Bound(600)}); n != nil {
			vi.DurationMin = *n
		}
		if n := item.Int("buffer_min", opt, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(120)}); n != nil {
			vi.BufferMin = *n
		}
		if p := item.Num("price_idr", req, moneyOpts); p != nil {
			vi.PriceIDR = *p
		}
		if n := item.Int("sort_order", opt, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(9999)}); n != nil {
			vi.SortOrder = *n
		} else {
			vi.SortOrder = i
		}
		in.Variants = append(in.Variants, vi)
	})
	if list != nil && in.Variants == nil {
		in.Variants = []variantInput{}
	}
	if !partial && len(in.Variants) == 0 {
		f.Fail("variants", "too_small", "Minimal satu varian durasi")
	}
	return in
}

func (h *Handler) createTreatment(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	f := body(r)
	in := treatmentFields(f, false)
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	t, err := h.svc.CreateTreatment(r.Context(), in)
	if err != nil {
		return err
	}
	return created(w, t)
}

func (h *Handler) updateTreatment(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	in := treatmentFields(f, true)
	if in.Variants != nil && len(in.Variants) == 0 {
		f.Fail("variants", "too_small", "Minimal satu varian durasi")
	}
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	t, err := h.svc.UpdateTreatment(r.Context(), id, in)
	if err != nil {
		return err
	}
	return ok(w, t)
}

func (h *Handler) setPrices(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	var prices []priceInput
	f.List("prices", req, 500, func(items *validate.Form, i int, v any) {
		item := items.Item(i, v)
		prices = append(prices, priceInput{
			VariantID: str(item.Str("variant_id", req, uuidOpts)),
			BranchID:  str(item.Str("branch_id", req, uuidOpts)),
			Price:     item.Num("price_idr", validate.Rule{Nullable: true, Optional: true}, moneyOpts),
		})
	})
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	t, err := h.svc.SetPrices(r.Context(), id, prices)
	if err != nil {
		return err
	}
	return ok(w, t)
}

/* ── therapists ──────────────────────────────────────────────────────── */

var genders = []string{"male", "female"}

func (h *Handler) listTherapists(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	branchID, err := queryUUID(r, "branch_id", false)
	if err != nil {
		return err
	}
	list, err := h.svc.Therapists(r.Context(), branchID, r.URL.Query().Get("active") == "true")
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) listEmployees(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.Employees(r.Context(), strings.TrimSpace(r.URL.Query().Get("q")))
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) createTherapist(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	f := body(r)
	employeeID := str(f.Str("employee_id", req, uuidOpts))
	branchID := str(f.Str("home_branch_id", req, uuidOpts))
	gender := f.Enum("gender", optNull, genders)
	active := f.BoolDefault("is_active", true)
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	t, err := h.svc.CreateTherapist(r.Context(), employeeID, branchID, gender, active)
	if err != nil {
		return err
	}
	return created(w, t)
}

func (h *Handler) updateTherapist(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	branchID := f.Str("home_branch_id", opt, uuidOpts)
	_, genderSent := f.Fields()["gender"]
	gender := f.Enum("gender", optNull, genders)
	active := f.Bool("is_active", opt)
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	t, err := h.svc.UpdateTherapist(r.Context(), id, branchID, gender, genderSent, active)
	if err != nil {
		return err
	}
	return ok(w, t)
}

func (h *Handler) listAssists(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	branchID, err := queryUUID(r, "branch_id", false)
	if err != nil {
		return err
	}
	from, err := queryDate(r, "from", false)
	if err != nil {
		return err
	}
	to, err := queryDate(r, "to", false)
	if err != nil {
		return err
	}
	list, err := h.svc.Assists(r.Context(), branchID, from, to)
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) createAssist(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	f := body(r)
	therapistID := str(f.Str("therapist_id", req, uuidOpts))
	branchID := str(f.Str("branch_id", req, uuidOpts))
	start := str(f.Str("start_date", req, dateOpts))
	end := str(f.Str("end_date", req, dateOpts))
	note := f.StrDefault("note", "", validate.StrOpts{Trim: true, Max: 500})
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	a, err := h.svc.CreateAssist(r.Context(), u.ID, therapistID, branchID, start, end, note)
	if err != nil {
		return err
	}
	return created(w, a)
}

func (h *Handler) deleteAssist(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteAssist(r.Context(), id); err != nil {
		return err
	}
	return ok(w, struct {
		ID string `json:"id"`
	}{id})
}

func (h *Handler) listPICs(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	branchID, err := queryUUID(r, "branch_id", false)
	if err != nil {
		return err
	}
	list, err := h.svc.PICs(r.Context(), branchID)
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) addPIC(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	f := body(r)
	branchID := str(f.Str("branch_id", req, uuidOpts))
	employeeID := str(f.Str("employee_id", req, uuidOpts))
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	list, err := h.svc.AddPIC(r.Context(), branchID, employeeID)
	if err != nil {
		return err
	}
	return created(w, list)
}

func (h *Handler) removePIC(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	branchID, err := queryUUID(r, "branch_id", true)
	if err != nil {
		return err
	}
	employeeID, err := queryUUID(r, "employee_id", true)
	if err != nil {
		return err
	}
	if err := h.svc.RemovePIC(r.Context(), branchID, employeeID); err != nil {
		return err
	}
	return ok(w, struct {
		BranchID   string `json:"branch_id"`
		EmployeeID string `json:"employee_id"`
	}{branchID, employeeID})
}

/* ── bookings ────────────────────────────────────────────────────────── */

type paginated struct {
	Success    bool           `json:"success"`
	Data       any            `json:"data"`
	Pagination paginationInfo `json:"pagination"`
}

type paginationInfo struct {
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	Total      int `json:"total"`
	TotalPages int `json:"totalPages"`
}

func readPage(r *http.Request) (int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	return page, limit
}

func (h *Handler) listCustomers(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	term := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(term) < 2 {
		return ok(w, []CustomerRef{})
	}
	list, err := h.svc.Customers(r.Context(), term)
	if err != nil {
		return err
	}
	return ok(w, list)
}

func oneOf(r *http.Request, name string, options []string) (string, error) {
	v := strings.TrimSpace(r.URL.Query().Get(name))
	if v == "" {
		return "", nil
	}
	for _, o := range options {
		if o == v {
			return v, nil
		}
	}
	return "", httpx.BadRequest(name + " tidak valid")
}

func (h *Handler) listBookings(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	f := bookingFilter{Search: strings.TrimSpace(r.URL.Query().Get("q"))}
	var err error
	if f.BranchID, err = queryUUID(r, "branch_id", false); err != nil {
		return err
	}
	from, err := queryDate(r, "from", false)
	if err != nil {
		return err
	}
	to, err := queryDate(r, "to", false)
	if err != nil {
		return err
	}
	if from != "" {
		start, _, _ := domain.DayBounds(from)
		f.From = &start
	}
	if to != "" {
		_, end, _ := domain.DayBounds(to)
		f.To = &end
	}
	if f.Status, err = oneOf(r, "status", domain.BookingStatuses); err != nil {
		return err
	}
	if f.PaymentStatus, err = oneOf(r, "payment_status", domain.PaymentStatuses); err != nil {
		return err
	}
	f.Page, f.Limit = readPage(r)
	list, total, err := h.svc.Bookings(r.Context(), u.ID, f)
	if err != nil {
		return err
	}
	pages := (total + f.Limit - 1) / f.Limit
	return httpx.JSON(w, http.StatusOK, paginated{Success: true, Data: list,
		Pagination: paginationInfo{Page: f.Page, Limit: f.Limit, Total: total, TotalPages: pages}})
}

var (
	bookingTypes = []string{"walk_in", "reservation"}
	genderPrefs  = []string{"any", "male", "female"}
)

func itemFields(f *validate.Form) []itemRequest {
	var items []itemRequest
	f.List("items", req, 10, func(list *validate.Form, i int, v any) {
		item := list.Item(i, v)
		items = append(items, itemRequest{
			VariantID:   str(item.Str("variant_id", req, uuidOpts)),
			StartsAt:    parseTime(item.Str("starts_at", optNull, datetimeOpts)),
			TherapistID: str(item.Str("therapist_id", optNull, uuidOpts)),
		})
	})
	if len(items) == 0 {
		f.Fail("items", "too_small", "Pilih minimal satu treatment")
	}
	return items
}

func (h *Handler) createBooking(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	f := body(r)
	in := createBookingInput{
		BranchID:            str(f.Str("branch_id", req, uuidOpts)),
		BookingType:         str(f.Enum("booking_type", req, bookingTypes)),
		CustomerID:          str(f.Str("customer_id", optNull, uuidOpts)),
		CustomerName:        str(f.Str("customer_name", req, validate.StrOpts{Trim: true, Min: 1, Max: 120})),
		CustomerPhone:       f.StrDefault("customer_phone", "", validate.StrOpts{Trim: true, Max: 30}),
		TherapistGenderPref: f.StrDefault("therapist_gender_pref", "any", validate.StrOpts{Check: validate.EnumCheck(genderPrefs)}),
		Notes:               f.StrDefault("notes", "", validate.StrOpts{Trim: true, Max: 1000}),
	}
	if at := parseTime(f.Str("scheduled_at", req, datetimeOpts)); at != nil {
		in.ScheduledAt = *at
	}
	in.Items = itemFields(f)
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	b, err := h.svc.CreateBooking(r.Context(), u.ID, in)
	if err != nil {
		return err
	}
	return created(w, b)
}

func (h *Handler) getBooking(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	b, err := h.svc.Booking(r.Context(), u.ID, id)
	if err != nil {
		return err
	}
	return ok(w, b)
}

func (h *Handler) patchBooking(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	p := bookingPatch{
		CustomerName:  f.Str("customer_name", opt, validate.StrOpts{Trim: true, Min: 1, Max: 120}),
		CustomerPhone: f.Str("customer_phone", opt, validate.StrOpts{Trim: true, Max: 30}),
		Notes:         f.Str("notes", opt, validate.StrOpts{Trim: true, Max: 1000}),
		GenderPref:    f.Enum("therapist_gender_pref", opt, genderPrefs),
	}
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	b, err := h.svc.PatchBooking(r.Context(), u.ID, id, p)
	if err != nil {
		return err
	}
	return ok(w, b)
}

func (h *Handler) addItem(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	item := itemRequest{
		VariantID:   str(f.Str("variant_id", req, uuidOpts)),
		StartsAt:    parseTime(f.Str("starts_at", optNull, datetimeOpts)),
		TherapistID: str(f.Str("therapist_id", optNull, uuidOpts)),
	}
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	b, err := h.svc.AddItem(r.Context(), u.ID, id, item)
	if err != nil {
		return err
	}
	return ok(w, b)
}

func (h *Handler) itemAction(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	itemID, err := pathUUID(r, "itemId")
	if err != nil {
		return err
	}
	f := body(r)
	ch := itemChange{Action: str(f.Enum("action", req, domain.ItemActions))}
	switch ch.Action {
	case domain.ActionAssign:
		ch.TherapistID = str(f.Str("therapist_id", req, uuidOpts))
	case domain.ActionReschedule:
		ch.StartsAt = parseTime(f.Str("starts_at", req, datetimeOpts))
	}
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	b, err := h.svc.ItemAction(r.Context(), u.ID, id, itemID, ch)
	if err != nil {
		return err
	}
	return ok(w, b)
}

func (h *Handler) cancelBooking(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	reason := str(f.Str("reason", req, validate.StrOpts{Trim: true, Min: 1, Max: 500}))
	if err := f.ErrAtPath("Alasan pembatalan wajib diisi"); err != nil {
		return err
	}
	b, err := h.svc.CancelBooking(r.Context(), u.ID, id, reason)
	if err != nil {
		return err
	}
	return ok(w, b)
}

func (h *Handler) checkout(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	res, err := h.svc.Checkout(r.Context(), u.ID, id)
	if err != nil {
		return err
	}
	return ok(w, res)
}

func (h *Handler) availability(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	branchID, err := queryUUID(r, "branch_id", true)
	if err != nil {
		return err
	}
	start, err := queryTime(r, "starts_at")
	if err != nil {
		return err
	}
	end, err := queryTime(r, "ends_at")
	if err != nil {
		return err
	}
	if !end.After(start) || end.Sub(start) > 12*time.Hour {
		return httpx.BadRequest("Rentang waktu tidak valid")
	}
	exclude, err := queryUUID(r, "exclude_item_id", false)
	if err != nil {
		return err
	}
	list, err := h.svc.Availability(r.Context(), u.ID, branchID, start, end, exclude)
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) board(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	branchID, err := queryUUID(r, "branch_id", true)
	if err != nil {
		return err
	}
	date, err := queryDate(r, "date", true)
	if err != nil {
		return err
	}
	b, err := h.svc.Board(r.Context(), u.ID, branchID, date)
	if err != nil {
		return err
	}
	return ok(w, b)
}

/* ── commissions ─────────────────────────────────────────────────────── */

func (h *Handler) listRules(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.Rules(r.Context())
	if err != nil {
		return err
	}
	return ok(w, list)
}

func ruleFields(f *validate.Form) ruleInput {
	in := ruleInput{
		TreatmentID: f.Str("treatment_id", optNull, uuidOpts),
		VariantID:   f.Str("variant_id", optNull, uuidOpts),
		BranchID:    f.Str("branch_id", optNull, uuidOpts),
		Type:        str(f.Enum("commission_type", req, domain.CommissionTypes)),
		IsActive:    f.BoolDefault("is_active", true),
	}
	if v := f.Num("value", req, moneyOpts); v != nil {
		in.Value = *v
	}
	if in.TreatmentID != nil && in.VariantID != nil {
		f.Fail("variant_id", "custom", "Pilih treatment atau varian, bukan keduanya")
	}
	if in.Type == domain.CommissionPercent && in.Value > 100 {
		f.Fail("value", "too_big", "Persentase maksimal 100")
	}
	return in
}

func (h *Handler) createRule(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	f := body(r)
	in := ruleFields(f)
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	rule, err := h.svc.CreateRule(r.Context(), in)
	if err != nil {
		return err
	}
	return created(w, rule)
}

func (h *Handler) updateRule(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	f := body(r)
	in := ruleFields(f)
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	rule, err := h.svc.UpdateRule(r.Context(), id, in)
	if err != nil {
		return err
	}
	return ok(w, rule)
}

func (h *Handler) deleteRule(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteRule(r.Context(), id); err != nil {
		return err
	}
	return ok(w, struct {
		ID string `json:"id"`
	}{id})
}

func (h *Handler) report(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	from, err := queryDate(r, "from", true)
	if err != nil {
		return err
	}
	to, err := queryDate(r, "to", true)
	if err != nil {
		return err
	}
	branchID, err := queryUUID(r, "branch_id", false)
	if err != nil {
		return err
	}
	therapistID, err := queryUUID(r, "therapist_id", false)
	if err != nil {
		return err
	}
	rep, err := h.svc.Report(r.Context(), u.ID, from, to, branchID, therapistID)
	if err != nil {
		return err
	}
	return ok(w, rep)
}

/* ── therapist self-service ──────────────────────────────────────────── */

func (h *Handler) me(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	t, err := h.svc.Me(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, MeResult{Therapist: t})
}

func (h *Handler) myAssignments(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	date, err := queryDate(r, "date", false)
	if err != nil {
		return err
	}
	if date == "" {
		date = domain.WIBDate(h.svc.clock())
	}
	list, err := h.svc.MyAssignments(r.Context(), u.ID, date)
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) myAction(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	itemID, err := pathUUID(r, "itemId")
	if err != nil {
		return err
	}
	f := body(r)
	action := str(f.Enum("action", req, []string{domain.ActionStart, domain.ActionComplete}))
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	item, err := h.svc.MyAction(r.Context(), u.ID, itemID, action)
	if err != nil {
		return err
	}
	return ok(w, item)
}

var monthPattern = regexp.MustCompile(`^\d{4}-\d{2}$`)

func (h *Handler) myCommissions(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	month := strings.TrimSpace(r.URL.Query().Get("month"))
	if month == "" {
		month = h.svc.clock().In(domain.WIB).Format("2006-01")
	}
	if !monthPattern.MatchString(month) {
		return httpx.BadRequest("Bulan tidak valid (YYYY-MM)")
	}
	rep, err := h.svc.MyCommissions(r.Context(), u.ID, month)
	if err != nil {
		return err
	}
	return ok(w, rep)
}

/* ── public ──────────────────────────────────────────────────────────── */

func (h *Handler) publicOutlets(w http.ResponseWriter, r *http.Request) error {
	list, err := h.svc.PublicOutlets(r.Context())
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) publicTreatments(w http.ResponseWriter, r *http.Request) error {
	branchID, err := pathUUID(r, "branchId")
	if err != nil {
		return err
	}
	list, err := h.svc.PublicTreatments(r.Context(), branchID)
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) publicBook(w http.ResponseWriter, r *http.Request) error {
	f := body(r)
	in := publicBookingInput{
		BranchID:            str(f.Str("branch_id", req, uuidOpts)),
		CustomerName:        str(f.Str("customer_name", req, validate.StrOpts{Trim: true, Min: 2, Max: 120})),
		CustomerPhone:       str(f.Str("customer_phone", req, validate.StrOpts{Trim: true, Min: 8, Max: 30})),
		TherapistGenderPref: f.StrDefault("therapist_gender_pref", "any", validate.StrOpts{Check: validate.EnumCheck(genderPrefs)}),
		Notes:               f.StrDefault("notes", "", validate.StrOpts{Trim: true, Max: 500}),
		VariantIDs:          f.Strings("variant_ids", req, 5, uuidOpts),
	}
	if at := parseTime(f.Str("scheduled_at", req, datetimeOpts)); at != nil {
		in.ScheduledAt = *at
	}
	if len(in.VariantIDs) == 0 {
		f.Fail("variant_ids", "too_small", "Pilih minimal satu treatment")
	}
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	res, err := h.svc.PublicBook(r.Context(), in)
	if err != nil {
		return err
	}
	return created(w, res)
}
