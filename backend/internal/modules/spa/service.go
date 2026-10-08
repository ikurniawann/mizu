package spa

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/spa/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/scope"
)

// Service holds the spa use cases.
type Service struct {
	db    database.DB
	st    store
	ports Ports
	now   func() time.Time
	log   *slog.Logger
}

func (s *Service) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

func (s *Service) tx(ctx context.Context, fn func(q Q) error) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error { return fn(tx) })
}

// ruleErr maps a domain rule violation to 409; other errors pass through.
func ruleErr(err error) error {
	var re *domain.RuleError
	if errors.As(err, &re) {
		return httpx.Conflict(re.Msg)
	}
	return err
}

/* ── scope ───────────────────────────────────────────────────────────── */

func (s *Service) scope(ctx context.Context, userID string) (*scope.Scope, error) {
	return scope.Load(ctx, s.db, userID)
}

func inScope(sc *scope.Scope, companyID *string, branchID string) bool {
	return scope.OperationalRowInScope(sc, companyID, &branchID)
}

// branchFilter narrows a list to the user's branch; an explicit branch
// outside a branch-scoped user's branch is refused.
func branchFilter(sc *scope.Scope, requested string) (string, error) {
	own := scope.BranchFilter(sc)
	if own == nil {
		return requested, nil
	}
	if requested != "" && requested != *own {
		return "", httpx.Forbidden("Outlet di luar akses Anda")
	}
	return *own, nil
}

/* ── maintenance ─────────────────────────────────────────────────────── */

// maintain expires stale bookings and pulls payment state of open bills from
// POS. The outbox subscriber marks payments too; this keeps reads right when
// an event is still queued. Failures are logged, never fatal for a read.
func (s *Service) maintain(ctx context.Context) {
	now := s.clock()
	if err := s.tx(ctx, func(q Q) error { return s.st.expire(ctx, q, now.Add(-domain.ExpireGrace)) }); err != nil {
		s.warn("spa: expire sweep failed", err)
	}
	pending, err := s.st.pendingPayments(ctx, s.db)
	if err != nil || len(pending) == 0 {
		if err != nil {
			s.warn("spa: pending payments read failed", err)
		}
		return
	}
	orders := make([]string, 0, len(pending))
	for _, o := range pending {
		orders = append(orders, o)
	}
	states, err := s.ports.POS.OrderStates(ctx, s.db, orders)
	if err != nil {
		s.warn("spa: order states read failed", err)
		return
	}
	for _, order := range orders {
		if st, ok := states[order]; ok && st.Paid() {
			if err := s.markPaid(ctx, s.db, order); err != nil {
				s.warn("spa: mark paid failed", err)
			}
		}
	}
}

func (s *Service) warn(msg string, err error) {
	if s.log != nil {
		s.log.Warn(msg, "error", err)
	}
}

func (s *Service) markPaid(ctx context.Context, q Q, orderID string) error {
	return database.WithTx(ctx, txBeginner(q, s.db), func(tx pgx.Tx) error {
		ids, err := s.st.markPaid(ctx, tx, orderID, s.clock())
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err := s.st.event(ctx, tx, id, nil, "paid", ptr(domain.PaymentUnpaid), ptr(domain.PaymentPaid), "", "Dibayar di kasir POS"); err != nil {
				return err
			}
		}
		return nil
	})
}

// txBeginner prefers q when it can open a (nested) transaction.
func txBeginner(q Q, fallback database.DB) database.TxBeginner {
	if b, ok := q.(database.TxBeginner); ok {
		return b
	}
	return fallback
}

func ptr[T any](v T) *T { return &v }

/* ── outlets ─────────────────────────────────────────────────────────── */

// Outlets lists every active branch with its spa configuration, limited to
// the user's business scope.
func (s *Service) Outlets(ctx context.Context, userID string) ([]Outlet, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	all, err := s.st.outlets(ctx, s.db)
	if err != nil {
		return nil, err
	}
	out := make([]Outlet, 0, len(all))
	for _, o := range all {
		if inScope(sc, o.CompanyID, o.BranchID) {
			out = append(out, o)
		}
	}
	return out, nil
}

func (s *Service) outletIn(ctx context.Context, q Q, sc *scope.Scope, branchID string) (*outletRow, error) {
	o, err := s.st.outlet(ctx, q, branchID)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, httpx.BadRequest("Outlet belum dikonfigurasi sebagai outlet spa")
	}
	if sc != nil && !inScope(sc, o.CompanyID, o.BranchID) {
		return nil, httpx.Forbidden("Outlet di luar akses Anda")
	}
	return o, nil
}

// PutOutlet configures a branch as a spa outlet.
func (s *Service) PutOutlet(ctx context.Context, userID, branchID string, in outletInput) (*Outlet, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	open, _ := domain.ClockMinutes(in.OpenTime)
	closeAt, _ := domain.ClockMinutes(in.CloseTime)
	if closeAt <= open {
		return nil, httpx.BadRequest("Jam tutup harus setelah jam buka")
	}
	err = s.tx(ctx, func(q Q) error {
		ok, err := s.st.branchExists(ctx, q, branchID)
		if err != nil {
			return err
		}
		if !ok {
			return httpx.NotFound("Outlet tidak ditemukan")
		}
		ok, err = s.st.warehouseOfBranch(ctx, q, in.WarehouseID, branchID)
		if err != nil {
			return err
		}
		if !ok {
			return httpx.BadRequest("Stall tidak berada di outlet ini")
		}
		return s.st.upsertOutlet(ctx, q, branchID, in)
	})
	if err != nil {
		return nil, err
	}
	list, err := s.st.outlets(ctx, s.db)
	if err != nil {
		return nil, err
	}
	for _, o := range list {
		if o.BranchID == branchID {
			if !inScope(sc, o.CompanyID, o.BranchID) {
				return nil, httpx.Forbidden("Outlet di luar akses Anda")
			}
			return &o, nil
		}
	}
	return nil, httpx.NotFound("Outlet tidak ditemukan")
}

// SyncPOS creates or refreshes the POS product of every active variant at
// an outlet, so treatments also show in the POS catalog.
func (s *Service) SyncPOS(ctx context.Context, userID, branchID string) (int, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return 0, err
	}
	n := 0
	err = s.tx(ctx, func(q Q) error {
		o, err := s.outletIn(ctx, q, sc, branchID)
		if err != nil {
			return err
		}
		ids, err := s.st.activeVariantIDs(ctx, q)
		if err != nil {
			return err
		}
		variants, err := s.st.variants(ctx, q, ids, branchID)
		if err != nil {
			return err
		}
		for _, id := range ids {
			if _, err := s.ensureProduct(ctx, q, o, variants[id]); err != nil {
				return err
			}
			n++
		}
		return nil
	})
	return n, err
}

func productName(v variantRow) string { return v.TreatmentName + " (" + v.Name + ")" }

func (s *Service) ensureProduct(ctx context.Context, q Q, o *outletRow, v variantRow) (string, error) {
	variant := strings.ToUpper(strings.ReplaceAll(v.ID, "-", ""))
	branch := strings.ToUpper(strings.ReplaceAll(o.BranchID, "-", ""))[:6]
	// item.products.kode is varchar(20), unique per stall; the POS SKU
	// (varchar(50), unique) adds the treatment code and the outlet.
	code := "SPA-" + variant[:12]
	name := productName(v)
	if r := []rune(name); len(r) > 100 {
		name = string(r[:100])
	}
	id, err := s.ports.POS.EnsureTreatmentProduct(ctx, q, TreatmentProduct{
		CompanyID: o.CompanyID, BranchID: o.BranchID, WarehouseID: o.WarehouseID, ExistingID: deref(v.PosProductID),
		Code: code, SKU: "SPA-" + v.TreatmentCode + "-" + variant[:8] + "-" + branch, Name: name, Category: "Spa Treatment",
		Price: v.Price, Active: v.IsActive && v.TreatmentOn,
	})
	if err != nil {
		return "", err
	}
	return id, s.st.mapPosProduct(ctx, q, v.ID, o.BranchID, id)
}

/* ── treatments ──────────────────────────────────────────────────────── */

// Treatments lists the catalog.
func (s *Service) Treatments(ctx context.Context, activeOnly bool) ([]Treatment, error) {
	return s.st.treatments(ctx, s.db, activeOnly, "")
}

func codeTaken(err error) error {
	if database.IsUniqueViolation(err) {
		return httpx.Conflict("Kode treatment sudah dipakai")
	}
	return err
}

// CreateTreatment adds a treatment with its variants.
func (s *Service) CreateTreatment(ctx context.Context, in treatmentInput) (*Treatment, error) {
	var id string
	err := s.tx(ctx, func(q Q) error {
		var err error
		if id, err = s.st.insertTreatment(ctx, q, in); err != nil {
			return codeTaken(err)
		}
		return s.st.replaceVariants(ctx, q, id, in.Variants)
	})
	if err != nil {
		return nil, err
	}
	return s.st.treatment(ctx, s.db, id)
}

// UpdateTreatment patches a treatment; a sent variant list replaces the set.
func (s *Service) UpdateTreatment(ctx context.Context, id string, in treatmentInput) (*Treatment, error) {
	err := s.tx(ctx, func(q Q) error {
		found, err := s.st.updateTreatment(ctx, q, id, in)
		if err != nil {
			return codeTaken(err)
		}
		if !found {
			return httpx.NotFound("Treatment tidak ditemukan")
		}
		if in.Variants != nil {
			return s.st.replaceVariants(ctx, q, id, in.Variants)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.st.treatment(ctx, s.db, id)
}

type priceInput struct {
	VariantID, BranchID string
	Price               *float64
}

// SetPrices sets or clears per-outlet prices of a treatment's variants.
func (s *Service) SetPrices(ctx context.Context, id string, prices []priceInput) (*Treatment, error) {
	err := s.tx(ctx, func(q Q) error {
		t, err := s.st.treatment(ctx, q, id)
		if err != nil {
			return err
		}
		if t == nil {
			return httpx.NotFound("Treatment tidak ditemukan")
		}
		for _, p := range prices {
			if err := s.st.setPrice(ctx, q, id, p.VariantID, p.BranchID, p.Price); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.st.treatment(ctx, s.db, id)
}

/* ── therapists ──────────────────────────────────────────────────────── */

// Therapists lists therapists, optionally of one home outlet.
func (s *Service) Therapists(ctx context.Context, branchID string, activeOnly bool) ([]Therapist, error) {
	return s.st.therapists(ctx, s.db, branchID, activeOnly)
}

// Employees searches employees to register as therapist or PIC.
func (s *Service) Employees(ctx context.Context, term string) ([]EmployeeCandidate, error) {
	list, err := s.ports.People.SearchEmployees(ctx, s.db, term, 20)
	if err != nil {
		return nil, err
	}
	for i := range list {
		t, err := s.st.therapistByEmployee(ctx, s.db, list[i].ID)
		if err != nil {
			return nil, err
		}
		list[i].IsTherapist = t != nil
	}
	return list, nil
}

// CreateTherapist registers an employee as therapist.
func (s *Service) CreateTherapist(ctx context.Context, employeeID, branchID string, gender *string, active bool) (*Therapist, error) {
	var id string
	err := s.tx(ctx, func(q Q) error {
		ok, err := s.ports.People.EmployeeExists(ctx, q, employeeID)
		if err != nil {
			return err
		}
		if !ok {
			return httpx.BadRequest("Karyawan tidak ditemukan")
		}
		if ok, err = s.st.branchExists(ctx, q, branchID); err != nil || !ok {
			if err == nil {
				err = httpx.BadRequest("Outlet tidak ditemukan")
			}
			return err
		}
		id, err = s.st.insertTherapist(ctx, q, employeeID, branchID, gender, active)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.st.therapist(ctx, s.db, id)
}

// UpdateTherapist changes a therapist's outlet, gender or status.
func (s *Service) UpdateTherapist(ctx context.Context, id string, branchID, gender *string, genderSent bool, active *bool) (*Therapist, error) {
	if branchID != nil {
		ok, err := s.st.branchExists(ctx, s.db, *branchID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, httpx.BadRequest("Outlet tidak ditemukan")
		}
	}
	err := s.tx(ctx, func(q Q) error {
		found, err := s.st.updateTherapist(ctx, q, id, branchID, gender, genderSent, active)
		if err == nil && !found {
			err = httpx.NotFound("Terapis tidak ditemukan")
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.st.therapist(ctx, s.db, id)
}

// Assists lists therapist loans.
func (s *Service) Assists(ctx context.Context, branchID, from, to string) ([]Assist, error) {
	return s.st.assists(ctx, s.db, branchID, from, to)
}

// CreateAssist lends a therapist to another outlet.
func (s *Service) CreateAssist(ctx context.Context, userID, therapistID, branchID, start, end, note string) (*Assist, error) {
	t, err := s.st.therapist(ctx, s.db, therapistID)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, httpx.BadRequest("Terapis tidak ditemukan")
	}
	if t.HomeBranchID == branchID {
		return nil, httpx.BadRequest("Perbantuan harus ke outlet selain outlet asal terapis")
	}
	if end < start {
		return nil, httpx.BadRequest("Tanggal selesai harus sama atau setelah tanggal mulai")
	}
	if ok, err := s.st.branchExists(ctx, s.db, branchID); err != nil || !ok {
		if err == nil {
			err = httpx.BadRequest("Outlet tidak ditemukan")
		}
		return nil, err
	}
	var id string
	if err := s.tx(ctx, func(q Q) error {
		var err error
		id, err = s.st.insertAssist(ctx, q, therapistID, branchID, start, end, note, userID)
		return err
	}); err != nil {
		return nil, err
	}
	list, err := s.st.assists(ctx, s.db, branchID, start, end)
	if err != nil {
		return nil, err
	}
	for _, a := range list {
		if a.ID == id {
			return &a, nil
		}
	}
	return nil, httpx.NotFound("Perbantuan tidak ditemukan")
}

// DeleteAssist removes a loan.
func (s *Service) DeleteAssist(ctx context.Context, id string) error {
	return s.tx(ctx, func(q Q) error {
		found, err := s.st.deleteAssist(ctx, q, id)
		if err == nil && !found {
			err = httpx.NotFound("Perbantuan tidak ditemukan")
		}
		return err
	})
}

// PICs lists outlet PICs.
func (s *Service) PICs(ctx context.Context, branchID string) ([]OutletPIC, error) {
	return s.st.pics(ctx, s.db, branchID)
}

// AddPIC maps an employee as an outlet PIC.
func (s *Service) AddPIC(ctx context.Context, branchID, employeeID string) ([]OutletPIC, error) {
	ok, err := s.ports.People.EmployeeExists(ctx, s.db, employeeID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, httpx.BadRequest("Karyawan tidak ditemukan")
	}
	if ok, err = s.st.branchExists(ctx, s.db, branchID); err != nil || !ok {
		if err == nil {
			err = httpx.BadRequest("Outlet tidak ditemukan")
		}
		return nil, err
	}
	if err := s.tx(ctx, func(q Q) error { return s.st.insertPIC(ctx, q, branchID, employeeID) }); err != nil {
		return nil, err
	}
	return s.st.pics(ctx, s.db, branchID)
}

// RemovePIC unmaps an outlet PIC.
func (s *Service) RemovePIC(ctx context.Context, branchID, employeeID string) error {
	return s.tx(ctx, func(q Q) error {
		found, err := s.st.deletePIC(ctx, q, branchID, employeeID)
		if err == nil && !found {
			err = httpx.NotFound("PIC tidak ditemukan")
		}
		return err
	})
}

// Customers searches POS customers.
func (s *Service) Customers(ctx context.Context, term string) ([]CustomerRef, error) {
	return s.ports.Customers.Search(ctx, s.db, term, 20)
}

/* ── bookings ────────────────────────────────────────────────────────── */

// Bookings lists bookings in the user's scope.
func (s *Service) Bookings(ctx context.Context, userID string, f bookingFilter) ([]BookingSummary, int, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	if f.BranchID, err = branchFilter(sc, f.BranchID); err != nil {
		return nil, 0, err
	}
	s.maintain(ctx)
	return s.st.bookings(ctx, s.db, f)
}

// Booking reads one booking the user may see.
func (s *Service) Booking(ctx context.Context, userID, id string) (*Booking, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.maintain(ctx)
	return s.visibleBooking(ctx, sc, id)
}

func (s *Service) visibleBooking(ctx context.Context, sc *scope.Scope, id string) (*Booking, error) {
	b, err := s.st.bookingDetail(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if b == nil || (sc != nil && !inScope(sc, b.CompanyID, b.BranchID)) {
		return nil, httpx.NotFound("Booking tidak ditemukan")
	}
	if b.PosOrderID != nil {
		if states, err := s.ports.POS.OrderStates(ctx, s.db, []string{*b.PosOrderID}); err == nil {
			if st, ok := states[*b.PosOrderID]; ok {
				b.PosOrderNumber = &st.Number
			}
		}
	}
	return b, nil
}

type itemRequest struct {
	VariantID   string
	StartsAt    *time.Time
	TherapistID string
}

type createBookingInput struct {
	BranchID            string
	BookingType         string
	CustomerID          string
	CustomerName        string
	CustomerPhone       string
	TherapistGenderPref string
	Notes               string
	ScheduledAt         time.Time
	Items               []itemRequest
}

// planItems resolves variants and start times: an item without starts_at
// follows the previous one (one guest, consecutive treatments).
func (s *Service) planItems(ctx context.Context, q Q, branchID string, start time.Time, reqs []itemRequest) ([]newItem, error) {
	ids := make([]string, len(reqs))
	for i, r := range reqs {
		ids[i] = r.VariantID
	}
	variants, err := s.st.variants(ctx, q, ids, branchID)
	if err != nil {
		return nil, err
	}
	cursor := start
	out := make([]newItem, len(reqs))
	for i, r := range reqs {
		v, ok := variants[r.VariantID]
		if !ok || !v.IsActive || !v.TreatmentOn {
			return nil, httpx.BadRequest("Treatment tidak ditemukan atau tidak aktif")
		}
		at := cursor
		if r.StartsAt != nil {
			at = *r.StartsAt
		}
		out[i] = newItem{Variant: v, StartsAt: at, Status: domain.ItemUnassigned, SortOrder: i}
		cursor = at.Add(time.Duration(v.DurationMin) * time.Minute)
	}
	return out, nil
}

// CreateBooking records a front-office booking (walk-in or reservation).
func (s *Service) CreateBooking(ctx context.Context, userID string, in createBookingInput) (*Booking, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	var id string
	err = s.tx(ctx, func(q Q) error {
		o, err := s.outletIn(ctx, q, sc, in.BranchID)
		if err != nil {
			return err
		}
		if !o.IsActive {
			return httpx.BadRequest("Outlet spa sedang tidak aktif")
		}
		items, err := s.planItems(ctx, q, o.BranchID, in.ScheduledAt, in.Items)
		if err != nil {
			return err
		}
		customerID, phone, err := s.customer(ctx, q, in.CustomerID, in.CustomerName, in.CustomerPhone)
		if err != nil {
			return err
		}
		id, err = s.st.insertBooking(ctx, q, newBooking{
			Code: domain.BookingCode(s.clock()), CompanyID: o.CompanyID, BranchID: o.BranchID, WarehouseID: o.WarehouseID,
			BookingType: in.BookingType, Source: "front_office", CustomerID: customerID, CustomerName: in.CustomerName,
			CustomerPhone: phone, TherapistGenderPref: in.TherapistGenderPref, Notes: in.Notes,
			ScheduledAt: items[0].StartsAt, CreatedBy: userID,
		})
		if err != nil {
			return err
		}
		if err := s.st.event(ctx, q, id, nil, "create", nil, ptr(domain.BookingUnassigned), userID, ""); err != nil {
			return err
		}
		for i := range items {
			items[i].BookingID = id
			itemID, err := s.st.insertItem(ctx, q, items[i])
			if err != nil {
				return err
			}
			if t := in.Items[i].TherapistID; t != "" {
				if err := s.itemAction(ctx, q, userID, id, itemID, itemChange{Action: domain.ActionAssign, TherapistID: t}, domain.ActorStaff); err != nil {
					return err
				}
			}
		}
		return s.syncStatus(ctx, q, id, userID)
	})
	if err != nil {
		return nil, err
	}
	return s.visibleBooking(ctx, nil, id)
}

// customer resolves the POS customer: the chosen one, else find-or-create
// by phone. A booking without phone keeps no customer link.
func (s *Service) customer(ctx context.Context, q Q, customerID, name, rawPhone string) (*string, string, error) {
	phone := ""
	if strings.TrimSpace(rawPhone) != "" {
		if phone = domain.NormalizePhone(rawPhone); phone == "" {
			return nil, "", httpx.BadRequest("Nomor HP tidak valid")
		}
	}
	if customerID != "" {
		return &customerID, phone, nil
	}
	if phone == "" {
		return nil, "", nil
	}
	id, err := s.ports.Customers.FindOrCreate(ctx, q, name, phone)
	if err != nil {
		return nil, "", err
	}
	return &id, phone, nil
}

// PatchBooking edits the customer contact and notes.
func (s *Service) PatchBooking(ctx context.Context, userID, id string, p bookingPatch) (*Booking, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if p.CustomerPhone != nil && strings.TrimSpace(*p.CustomerPhone) != "" {
		phone := domain.NormalizePhone(*p.CustomerPhone)
		if phone == "" {
			return nil, httpx.BadRequest("Nomor HP tidak valid")
		}
		p.CustomerPhone = &phone
	}
	err = s.tx(ctx, func(q Q) error {
		b, err := s.lockBooking(ctx, q, sc, id)
		if err != nil {
			return err
		}
		if !domain.IsOpenBooking(b.Status) {
			return httpx.Conflict("Booking sudah " + domain.BookingLabel(b.Status))
		}
		if err := s.st.patchBooking(ctx, q, id, p); err != nil {
			return err
		}
		return s.st.event(ctx, q, id, nil, "update", nil, nil, userID, "Data booking diubah")
	})
	if err != nil {
		return nil, err
	}
	return s.visibleBooking(ctx, nil, id)
}

func (s *Service) lockBooking(ctx context.Context, q Q, sc *scope.Scope, id string) (*bookingRow, error) {
	b, err := s.st.bookingRow(ctx, q, id, true)
	if err != nil {
		return nil, err
	}
	if b == nil || (sc != nil && !inScope(sc, b.CompanyID, b.BranchID)) {
		return nil, httpx.NotFound("Booking tidak ditemukan")
	}
	return b, nil
}

// AddItem adds a treatment to an open booking.
func (s *Service) AddItem(ctx context.Context, userID, id string, req itemRequest) (*Booking, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	err = s.tx(ctx, func(q Q) error {
		b, err := s.lockBooking(ctx, q, sc, id)
		if err != nil {
			return err
		}
		if err := domain.CanEditItems(b.Status, b.PaymentStatus, b.PosOrderID != nil && s.orderLive(ctx, q, *b.PosOrderID)); err != nil {
			return ruleErr(err)
		}
		existing, err := s.st.itemRows(ctx, q, id, true)
		if err != nil {
			return err
		}
		start := b.ScheduledAt
		for _, it := range existing {
			if it.Status == domain.ItemCancelled {
				continue
			}
			if end := it.StartsAt.Add(time.Duration(it.DurationMin) * time.Minute); end.After(start) {
				start = end
			}
		}
		items, err := s.planItems(ctx, q, b.BranchID, start, []itemRequest{req})
		if err != nil {
			return err
		}
		items[0].BookingID, items[0].SortOrder = id, len(existing)
		itemID, err := s.st.insertItem(ctx, q, items[0])
		if err != nil {
			return err
		}
		if err := s.st.event(ctx, q, id, &itemID, "add_item", nil, ptr(domain.ItemUnassigned), userID, productName(items[0].Variant)); err != nil {
			return err
		}
		if req.TherapistID != "" {
			if err := s.itemAction(ctx, q, userID, id, itemID, itemChange{Action: domain.ActionAssign, TherapistID: req.TherapistID}, domain.ActorStaff); err != nil {
				return err
			}
		}
		return s.syncStatus(ctx, q, id, userID)
	})
	if err != nil {
		return nil, err
	}
	return s.visibleBooking(ctx, nil, id)
}

func (s *Service) orderLive(ctx context.Context, q Q, orderID string) bool {
	states, err := s.ports.POS.OrderStates(ctx, q, []string{orderID})
	if err != nil {
		return true // fail closed: treat the bill as standing
	}
	st, ok := states[orderID]
	return ok && st.Live()
}

type itemChange struct {
	Action      string
	TherapistID string
	StartsAt    *time.Time
}

// ItemAction runs one staff action on an item.
func (s *Service) ItemAction(ctx context.Context, userID, bookingID, itemID string, ch itemChange) (*Booking, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	err = s.tx(ctx, func(q Q) error {
		if _, err := s.lockBooking(ctx, q, sc, bookingID); err != nil {
			return err
		}
		if err := s.itemAction(ctx, q, userID, bookingID, itemID, ch, domain.ActorStaff); err != nil {
			return err
		}
		return s.syncStatus(ctx, q, bookingID, userID)
	})
	if err != nil {
		return nil, err
	}
	return s.visibleBooking(ctx, nil, bookingID)
}

// itemAction applies ch to an item of a locked booking; the caller syncs the
// booking status afterwards.
func (s *Service) itemAction(ctx context.Context, q Q, userID, bookingID, itemID string, ch itemChange, actor domain.Actor) error {
	b, err := s.st.bookingRow(ctx, q, bookingID, false)
	if err != nil {
		return err
	}
	items, err := s.st.itemRows(ctx, q, bookingID, true)
	if err != nil {
		return err
	}
	idx := slices.IndexFunc(items, func(it itemRow) bool { return it.ID == itemID })
	if b == nil || idx < 0 {
		return httpx.NotFound("Treatment tidak ditemukan")
	}
	it := items[idx]
	next, err := domain.NextItemStatus(ch.Action, it.Status, b.Status, b.PaymentStatus == domain.PaymentPaid, actor)
	if err != nil {
		return ruleErr(err)
	}
	now := s.clock()
	note := ""
	switch ch.Action {
	case domain.ActionAssign:
		t, err := s.checkAssign(ctx, q, b, it, it.StartsAt, ch.TherapistID)
		if err != nil {
			return err
		}
		if err := s.st.setItemTherapist(ctx, q, it.ID, &t.ID, next); err != nil {
			return err
		}
		note = t.FullName
	case domain.ActionUnassign:
		if err := s.st.setItemTherapist(ctx, q, it.ID, nil, next); err != nil {
			return err
		}
	case domain.ActionReschedule:
		if ch.StartsAt == nil {
			return httpx.BadRequest("Waktu mulai wajib diisi")
		}
		if it.TherapistID != nil {
			if _, err := s.checkAssign(ctx, q, b, it, *ch.StartsAt, *it.TherapistID); err != nil {
				return err
			}
		}
		if err := s.st.rescheduleItem(ctx, q, it.ID, *ch.StartsAt, it.DurationMin); err != nil {
			return err
		}
		note = ch.StartsAt.In(domain.WIB).Format("02/01 15:04") + " WIB"
		if err := s.st.syncScheduledAt(ctx, q, bookingID); err != nil {
			return err
		}
	case domain.ActionCancel:
		checkedOut := b.PosOrderID != nil && s.orderLive(ctx, q, *b.PosOrderID)
		if err := domain.CanEditItems(b.Status, b.PaymentStatus, checkedOut); err != nil {
			return ruleErr(err)
		}
		if err := s.st.setItemStatus(ctx, q, it.ID, next, now); err != nil {
			return err
		}
	case domain.ActionStart:
		if err := s.st.setItemStatus(ctx, q, it.ID, next, now); err != nil {
			return err
		}
	case domain.ActionComplete:
		if err := s.st.setItemStatus(ctx, q, it.ID, next, now); err != nil {
			return err
		}
		if err := s.freezeCommission(ctx, q, b.BranchID, it); err != nil {
			return err
		}
	}
	from := it.Status
	return s.st.event(ctx, q, bookingID, &it.ID, ch.Action, &from, &next, userID, note)
}

// checkAssign verifies the therapist works at the outlet that day and has
// no overlapping active item, under a per-therapist lock.
func (s *Service) checkAssign(ctx context.Context, q Q, b *bookingRow, it itemRow, start time.Time, therapistID string) (*Therapist, error) {
	if err := s.st.lockTherapist(ctx, q, therapistID); err != nil {
		return nil, err
	}
	eligible, err := s.st.eligibleTherapists(ctx, q, b.BranchID, domain.WIBDate(start))
	if err != nil {
		return nil, err
	}
	idx := slices.IndexFunc(eligible, func(t eligibleTherapist) bool { return t.ID == therapistID })
	if idx < 0 {
		return nil, httpx.Conflict("Terapis tidak bertugas di outlet ini pada tanggal tersebut")
	}
	iv := domain.ItemInterval(start, it.DurationMin, it.BufferMin)
	conflicts, err := s.st.conflicts(ctx, q, []string{therapistID}, iv.Start, iv.End, it.ID)
	if err != nil {
		return nil, err
	}
	if c := conflicts[therapistID]; len(c) > 0 {
		first := c[0]
		return nil, httpx.Conflict(fmt.Sprintf("Terapis bentrok dengan booking %s (%s–%s WIB)", first.BookingCode,
			time.Time(first.StartsAt).In(domain.WIB).Format("15:04"), time.Time(first.EndsAt).In(domain.WIB).Format("15:04")))
	}
	return &eligible[idx].Therapist, nil
}

// freezeCommission stores the commission of a completed item with the rule
// in force now; later rule edits do not rewrite history.
func (s *Service) freezeCommission(ctx context.Context, q Q, branchID string, it itemRow) error {
	rules, err := s.st.activeRules(ctx, q)
	if err != nil {
		return err
	}
	r, ok := domain.ResolveCommission(rules, it.TreatmentID, it.VariantID, branchID)
	if !ok {
		return s.st.setItemCommission(ctx, q, it.ID, nil, nil, 0)
	}
	return s.st.setItemCommission(ctx, q, it.ID, &r.Type, &r.Value, domain.CommissionAmount(r, it.Price))
}

// syncStatus re-derives the booking status from its items.
func (s *Service) syncStatus(ctx context.Context, q Q, bookingID, userID string) error {
	b, err := s.st.bookingRow(ctx, q, bookingID, false)
	if err != nil || b == nil {
		return err
	}
	items, err := s.st.itemRows(ctx, q, bookingID, false)
	if err != nil {
		return err
	}
	statuses := make([]string, len(items))
	for i, it := range items {
		statuses[i] = it.Status
	}
	next := domain.DeriveBookingStatus(b.Status, statuses)
	if next == b.Status {
		return nil
	}
	if err := s.st.setBookingStatus(ctx, q, bookingID, next); err != nil {
		return err
	}
	from := b.Status
	return s.st.event(ctx, q, bookingID, nil, "status", &from, &next, userID, "")
}

// CancelBooking cancels a booking whose treatments have not started.
func (s *Service) CancelBooking(ctx context.Context, userID, id, reason string) (*Booking, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	err = s.tx(ctx, func(q Q) error {
		b, err := s.lockBooking(ctx, q, sc, id)
		if err != nil {
			return err
		}
		items, err := s.st.itemRows(ctx, q, id, true)
		if err != nil {
			return err
		}
		statuses := make([]string, len(items))
		for i, it := range items {
			statuses[i] = it.Status
		}
		if err := domain.CanCancelBooking(b.Status, b.PaymentStatus == domain.PaymentPaid, statuses); err != nil {
			return ruleErr(err)
		}
		if b.PosOrderID != nil && s.orderLive(ctx, q, *b.PosOrderID) {
			return httpx.Conflict("Tagihan booking ini masih terbuka di kasir; batalkan tagihan di POS terlebih dahulu")
		}
		if err := s.st.cancelBooking(ctx, q, id, reason, s.clock()); err != nil {
			return err
		}
		from := b.Status
		return s.st.event(ctx, q, id, nil, "cancel", &from, ptr(domain.BookingCancelled), userID, reason)
	})
	if err != nil {
		return nil, err
	}
	return s.visibleBooking(ctx, nil, id)
}

// Checkout opens (or reopens) the POS bill of a booking.
func (s *Service) Checkout(ctx context.Context, userID, id string) (*CheckoutResult, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	var ref OrderRef
	err = s.tx(ctx, func(q Q) error {
		b, err := s.lockBooking(ctx, q, sc, id)
		if err != nil {
			return err
		}
		items, err := s.st.itemRows(ctx, q, id, true)
		if err != nil {
			return err
		}
		statuses := make([]string, len(items))
		for i, it := range items {
			statuses[i] = it.Status
		}
		if err := domain.CanCheckout(b.Status, b.PaymentStatus, statuses); err != nil {
			return ruleErr(err)
		}
		if b.PosOrderID != nil {
			states, err := s.ports.POS.OrderStates(ctx, q, []string{*b.PosOrderID})
			if err != nil {
				return err
			}
			if st, ok := states[*b.PosOrderID]; ok && st.Live() {
				if st.Paid() {
					return s.markPaid(ctx, q, *b.PosOrderID)
				}
				ref = OrderRef{ID: *b.PosOrderID, Number: st.Number}
				return nil
			}
		}
		o, err := s.outletIn(ctx, q, nil, b.BranchID)
		if err != nil {
			return err
		}
		detail, err := s.st.items(ctx, q, id)
		if err != nil {
			return err
		}
		ids := make([]string, 0, len(detail))
		for _, it := range detail {
			ids = append(ids, it.VariantID)
		}
		variants, err := s.st.variants(ctx, q, ids, b.BranchID)
		if err != nil {
			return err
		}
		products := map[string]string{}
		lines := []BillLine{}
		for _, it := range detail {
			if it.Status == domain.ItemCancelled {
				continue
			}
			v := variants[it.VariantID]
			pid, ok := products[v.ID]
			if !ok {
				if pid, err = s.ensureProduct(ctx, q, o, v); err != nil {
					return err
				}
				products[v.ID] = pid
			}
			note := ""
			if it.TherapistName != nil {
				note = "Terapis: " + *it.TherapistName
			}
			lines = append(lines, BillLine{ProductID: pid, Name: it.TreatmentName + " (" + it.VariantName + ")",
				SKU: "SPA-" + v.TreatmentCode, UnitPrice: it.PriceIDR, Note: note})
		}
		ref, err = s.ports.POS.OpenBill(ctx, q, Bill{
			CompanyID: b.CompanyID, BranchID: b.BranchID, WarehouseID: b.WarehouseID, CustomerID: b.CustomerID,
			CashierUserID: userID, ContactName: b.CustomerName, ContactPhone: b.CustomerPhone,
			Notes: "Booking spa " + b.Code, Lines: lines,
		})
		if err != nil {
			return err
		}
		if err := s.st.setCheckout(ctx, q, id, ref.ID, s.clock()); err != nil {
			return err
		}
		return s.st.event(ctx, q, id, nil, "checkout", nil, nil, userID, "Tagihan POS "+ref.Number)
	})
	if err != nil {
		return nil, err
	}
	booking, err := s.visibleBooking(ctx, nil, id)
	if err != nil {
		return nil, err
	}
	if ref.ID == "" && booking.PosOrderID != nil { // already paid: nothing to collect
		return nil, httpx.Conflict("Booking sudah dibayar")
	}
	return &CheckoutResult{Booking: booking, OrderID: ref.ID, OrderNumber: ref.Number}, nil
}

/* ── availability and board ──────────────────────────────────────────── */

// Availability rates every therapist of the outlet for a time window.
func (s *Service) Availability(ctx context.Context, userID, branchID string, start, end time.Time, excludeItemID string) ([]Availability, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if _, err := s.outletIn(ctx, s.db, sc, branchID); err != nil {
		return nil, err
	}
	date := domain.WIBDate(start)
	eligible, err := s.st.eligibleTherapists(ctx, s.db, branchID, date)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(eligible))
	employees := make([]string, len(eligible))
	for i, t := range eligible {
		ids[i], employees[i] = t.ID, t.EmployeeID
	}
	conflicts, err := s.st.conflicts(ctx, s.db, ids, start, end, excludeItemID)
	if err != nil {
		return nil, err
	}
	rosters, err := s.ports.People.Rosters(ctx, s.db, employees, date)
	if err != nil {
		return nil, err
	}
	out := make([]Availability, len(eligible))
	for i, t := range eligible {
		r := rosters[t.EmployeeID]
		c := conflicts[t.ID]
		if c == nil {
			c = []Conflict{}
		}
		out[i] = Availability{Therapist: t.Therapist, Available: len(c) == 0, Conflicts: c, OnLeave: r.OnLeave,
			Shift: r.Shift, DayOff: r.DayOff, Assisting: t.Assisting}
	}
	return out, nil
}

// Board is the outlet's day: every therapist lane and the unassigned items.
func (s *Service) Board(ctx context.Context, userID, branchID, date string) (*Board, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if _, err := s.outletIn(ctx, s.db, sc, branchID); err != nil {
		return nil, err
	}
	start, end, ok := domain.DayBounds(date)
	if !ok {
		return nil, httpx.BadRequest("Tanggal tidak valid")
	}
	s.maintain(ctx)
	eligible, err := s.st.eligibleTherapists(ctx, s.db, branchID, date)
	if err != nil {
		return nil, err
	}
	items, err := s.st.dayItems(ctx, s.db, branchID, start, end)
	if err != nil {
		return nil, err
	}
	board := &Board{Date: date, BranchID: branchID, Therapists: []BoardTherapist{}, Unassigned: []BoardItem{}}
	lane := map[string]int{}
	for _, t := range eligible {
		lane[t.ID] = len(board.Therapists)
		board.Therapists = append(board.Therapists, BoardTherapist{Therapist: t.Therapist, Assisting: t.Assisting, Items: []BoardItem{}})
	}
	for _, it := range items {
		if it.TherapistID == nil || it.Status == domain.ItemUnassigned {
			if domain.IsOpenBooking(it.BookingStatus) {
				board.Unassigned = append(board.Unassigned, it)
			}
			continue
		}
		i, ok := lane[*it.TherapistID]
		if !ok { // assigned earlier, no longer eligible: still show the lane
			t, err := s.st.therapist(ctx, s.db, *it.TherapistID)
			if err != nil {
				return nil, err
			}
			if t == nil {
				continue
			}
			i = len(board.Therapists)
			lane[t.ID] = i
			board.Therapists = append(board.Therapists, BoardTherapist{Therapist: *t, Items: []BoardItem{}})
		}
		board.Therapists[i].Items = append(board.Therapists[i].Items, it)
	}
	employees := make([]string, len(board.Therapists))
	for i, t := range board.Therapists {
		employees[i] = t.Therapist.EmployeeID
	}
	rosters, err := s.ports.People.Rosters(ctx, s.db, employees, date)
	if err != nil {
		return nil, err
	}
	for i := range board.Therapists {
		r := rosters[board.Therapists[i].Therapist.EmployeeID]
		board.Therapists[i].Shift, board.Therapists[i].OnLeave, board.Therapists[i].DayOff = r.Shift, r.OnLeave, r.DayOff
	}
	return board, nil
}

/* ── therapist self-service ──────────────────────────────────────────── */

// Me resolves the logged-in user's therapist record (nil when none).
func (s *Service) Me(ctx context.Context, userID string) (*Therapist, error) {
	employeeID, err := s.ports.People.EmployeeIDByUser(ctx, s.db, userID)
	if err != nil || employeeID == "" {
		return nil, err
	}
	return s.st.therapistByEmployee(ctx, s.db, employeeID)
}

func (s *Service) requireMe(ctx context.Context, userID string) (*Therapist, error) {
	t, err := s.Me(ctx, userID)
	if err != nil {
		return nil, err
	}
	if t == nil || !t.IsActive {
		return nil, httpx.Forbidden("Akun Anda belum terdaftar sebagai terapis aktif")
	}
	return t, nil
}

// MyAssignments lists the therapist's items of a day.
func (s *Service) MyAssignments(ctx context.Context, userID, date string) ([]BoardItem, error) {
	t, err := s.requireMe(ctx, userID)
	if err != nil {
		return nil, err
	}
	start, end, ok := domain.DayBounds(date)
	if !ok {
		return nil, httpx.BadRequest("Tanggal tidak valid")
	}
	s.maintain(ctx)
	return s.st.therapistItems(ctx, s.db, t.ID, start, end)
}

// MyAction lets a therapist start or complete their own item.
func (s *Service) MyAction(ctx context.Context, userID, itemID, action string) (*BoardItem, error) {
	t, err := s.requireMe(ctx, userID)
	if err != nil {
		return nil, err
	}
	if action != domain.ActionStart && action != domain.ActionComplete {
		return nil, httpx.BadRequest("Aksi tidak valid")
	}
	bookingID, err := s.st.bookingIDOfItem(ctx, s.db, itemID)
	if err != nil {
		return nil, err
	}
	if bookingID == "" {
		return nil, httpx.NotFound("Tugas tidak ditemukan")
	}
	err = s.tx(ctx, func(q Q) error {
		if _, err := s.lockBooking(ctx, q, nil, bookingID); err != nil {
			return err
		}
		item, err := s.st.boardItem(ctx, q, itemID)
		if err != nil {
			return err
		}
		if item == nil || item.TherapistID == nil || *item.TherapistID != t.ID {
			return httpx.NotFound("Tugas tidak ditemukan")
		}
		if err := s.itemAction(ctx, q, userID, bookingID, itemID, itemChange{Action: action}, domain.ActorTherapist); err != nil {
			return err
		}
		return s.syncStatus(ctx, q, bookingID, userID)
	})
	if err != nil {
		return nil, err
	}
	return s.st.boardItem(ctx, s.db, itemID)
}

// MyCommissions is the therapist's own commission lines of a month.
func (s *Service) MyCommissions(ctx context.Context, userID, month string) (*CommissionReport, error) {
	t, err := s.requireMe(ctx, userID)
	if err != nil {
		return nil, err
	}
	start, end, ok := domain.MonthBounds(month)
	if !ok {
		return nil, httpx.BadRequest("Bulan tidak valid")
	}
	return s.report(ctx, start, end, "", t.ID)
}

/* ── commissions ─────────────────────────────────────────────────────── */

// Rules lists commission rules.
func (s *Service) Rules(ctx context.Context) ([]CommissionRuleView, error) {
	return s.st.rules(ctx, s.db)
}

func (s *Service) rule(ctx context.Context, id string) (*CommissionRuleView, error) {
	list, err := s.st.rules(ctx, s.db)
	if err != nil {
		return nil, err
	}
	for _, r := range list {
		if r.ID == id {
			return &r, nil
		}
	}
	return nil, httpx.NotFound("Aturan komisi tidak ditemukan")
}

// CreateRule adds a commission rule.
func (s *Service) CreateRule(ctx context.Context, in ruleInput) (*CommissionRuleView, error) {
	var id string
	if err := s.tx(ctx, func(q Q) error {
		var err error
		id, err = s.st.insertRule(ctx, q, in)
		return err
	}); err != nil {
		return nil, err
	}
	return s.rule(ctx, id)
}

// UpdateRule replaces a commission rule.
func (s *Service) UpdateRule(ctx context.Context, id string, in ruleInput) (*CommissionRuleView, error) {
	if err := s.tx(ctx, func(q Q) error {
		found, err := s.st.updateRule(ctx, q, id, in)
		if err == nil && !found {
			err = httpx.NotFound("Aturan komisi tidak ditemukan")
		}
		return err
	}); err != nil {
		return nil, err
	}
	return s.rule(ctx, id)
}

// DeleteRule removes a commission rule.
func (s *Service) DeleteRule(ctx context.Context, id string) error {
	return s.tx(ctx, func(q Q) error {
		found, err := s.st.deleteRule(ctx, q, id)
		if err == nil && !found {
			err = httpx.NotFound("Aturan komisi tidak ditemukan")
		}
		return err
	})
}

// Report is the commission report of [from, to] (WIB dates).
func (s *Service) Report(ctx context.Context, userID, from, to, branchID, therapistID string) (*CommissionReport, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if branchID, err = branchFilter(sc, branchID); err != nil {
		return nil, err
	}
	start, end, ok := domain.RangeBounds(from, to)
	if !ok {
		return nil, httpx.BadRequest("Periode tidak valid")
	}
	s.maintain(ctx)
	return s.report(ctx, start, end, branchID, therapistID)
}

func (s *Service) report(ctx context.Context, start, end time.Time, branchID, therapistID string) (*CommissionReport, error) {
	rows, err := s.st.commissionLines(ctx, s.db, start, end, branchID, therapistID)
	if err != nil {
		return nil, err
	}
	rep := &CommissionReport{From: domain.WIBDate(start), To: domain.WIBDate(end.Add(-time.Second)), Therapists: []TherapistCommission{}}
	index := map[string]int{}
	for _, r := range rows {
		i, ok := index[r.TherapistID]
		if !ok {
			i = len(rep.Therapists)
			index[r.TherapistID] = i
			rep.Therapists = append(rep.Therapists, TherapistCommission{TherapistID: r.TherapistID, FullName: r.FullName,
				NIP: r.NIP, Lines: []CommissionLine{}})
		}
		tc := &rep.Therapists[i]
		tc.Lines = append(tc.Lines, r.Line)
		tc.TreatmentCount++
		tc.RevenueIDR += r.Line.PriceIDR
		tc.CommissionIDR += r.Line.CommissionIDR
		rep.TotalIDR += r.Line.CommissionIDR
	}
	return rep, nil
}

/* ── public booking ──────────────────────────────────────────────────── */

// MaxPublicOpenBookings caps a phone's open future online bookings.
const MaxPublicOpenBookings = 3

// PublicOutlets lists outlets open for online booking.
func (s *Service) PublicOutlets(ctx context.Context) ([]PublicOutlet, error) {
	return s.st.publicOutlets(ctx, s.db)
}

func (s *Service) publicOutlet(ctx context.Context, q Q, branchID string) (*outletRow, error) {
	o, err := s.st.outlet(ctx, q, branchID)
	if err != nil {
		return nil, err
	}
	if o == nil || !o.IsActive || !o.PublicBooking {
		return nil, httpx.NotFound("Outlet tidak tersedia untuk booking online")
	}
	return o, nil
}

// PublicTreatments lists an outlet's bookable treatments with its prices.
func (s *Service) PublicTreatments(ctx context.Context, branchID string) ([]PublicTreatment, error) {
	if _, err := s.publicOutlet(ctx, s.db, branchID); err != nil {
		return nil, err
	}
	return s.st.publicTreatments(ctx, s.db, branchID)
}

type publicBookingInput struct {
	BranchID            string
	ScheduledAt         time.Time
	CustomerName        string
	CustomerPhone       string
	TherapistGenderPref string
	Notes               string
	VariantIDs          []string
}

// PublicBook records an online booking, unassigned, for the front office.
func (s *Service) PublicBook(ctx context.Context, in publicBookingInput) (*PublicBookingResult, error) {
	now := s.clock()
	if !in.ScheduledAt.After(now) {
		return nil, httpx.BadRequest("Pilih waktu yang belum lewat")
	}
	if in.ScheduledAt.After(now.AddDate(0, 0, 60)) {
		return nil, httpx.BadRequest("Booking online maksimal 60 hari ke depan")
	}
	phone := domain.NormalizePhone(in.CustomerPhone)
	if phone == "" {
		return nil, httpx.BadRequest("Nomor HP tidak valid")
	}
	var result *PublicBookingResult
	err := s.tx(ctx, func(q Q) error {
		o, err := s.publicOutlet(ctx, q, in.BranchID)
		if err != nil {
			return err
		}
		open, err := s.st.openPublicBookings(ctx, q, phone, now)
		if err != nil {
			return err
		}
		if open >= MaxPublicOpenBookings {
			return httpx.TooManyRequests("Nomor ini sudah memiliki terlalu banyak booking aktif. Hubungi outlet untuk bantuan.")
		}
		reqs := make([]itemRequest, len(in.VariantIDs))
		for i, v := range in.VariantIDs {
			reqs[i] = itemRequest{VariantID: v}
		}
		items, err := s.planItems(ctx, q, o.BranchID, in.ScheduledAt, reqs)
		if err != nil {
			return err
		}
		total := 0
		for _, it := range items {
			total += it.Variant.DurationMin
		}
		if err := domain.WithinHours(in.ScheduledAt, total, o.OpenTime, o.CloseTime); err != nil {
			return ruleErr(err)
		}
		customerID, err := s.ports.Customers.FindOrCreate(ctx, q, in.CustomerName, phone)
		if err != nil {
			return err
		}
		code := domain.BookingCode(now)
		id, err := s.st.insertBooking(ctx, q, newBooking{
			Code: code, CompanyID: o.CompanyID, BranchID: o.BranchID, WarehouseID: o.WarehouseID,
			BookingType: "reservation", Source: "public", CustomerID: &customerID, CustomerName: in.CustomerName,
			CustomerPhone: phone, TherapistGenderPref: in.TherapistGenderPref, Notes: in.Notes, ScheduledAt: in.ScheduledAt,
		})
		if err != nil {
			return err
		}
		if err := s.st.event(ctx, q, id, nil, "create", nil, ptr(domain.BookingUnassigned), "", "Booking online"); err != nil {
			return err
		}
		result = &PublicBookingResult{BookingCode: code, ScheduledAt: jsTime(in.ScheduledAt), BranchName: o.BranchName, Items: []PublicItem{}}
		for i := range items {
			items[i].BookingID = id
			if _, err := s.st.insertItem(ctx, q, items[i]); err != nil {
				return err
			}
			v := items[i].Variant
			result.Items = append(result.Items, PublicItem{TreatmentName: v.TreatmentName, VariantName: v.Name,
				DurationMin: v.DurationMin, PriceIDR: v.Price})
			result.TotalIDR += v.Price
		}
		return nil
	})
	return result, err
}

/* ── POS events ──────────────────────────────────────────────────────── */

// OrderPaid marks bookings of a paid POS order.
func (s *Service) OrderPaid(ctx context.Context, q Q, orderID string) error {
	return s.markPaid(ctx, q, orderID)
}

// OrdersVoided flags paid bookings whose POS order was voided.
func (s *Service) OrdersVoided(ctx context.Context, q Q, orderIDs []string) error {
	ids, err := s.st.markVoid(ctx, q, orderIDs)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := s.st.event(ctx, q, id, nil, "void", ptr(domain.PaymentPaid), ptr(domain.PaymentVoid), "", "Transaksi POS di-void"); err != nil {
			return err
		}
	}
	return nil
}
