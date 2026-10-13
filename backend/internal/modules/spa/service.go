package spa

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
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
	if _, err := s.ExpireDeposits(ctx); err != nil {
		s.warn("spa: deposit sweep failed", err)
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
	branches, err := s.reportBranchIDs(ctx, userID, "")
	if err != nil {
		return nil, err
	}
	all, err := s.st.outlets(ctx, s.db)
	if err != nil {
		return nil, err
	}
	out := make([]Outlet, 0, len(all))
	for _, o := range all {
		if slices.Contains(branches, o.BranchID) {
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
		if in.Category != nil && *in.Category != "" {
			if _, err = q.Exec(ctx, `INSERT INTO spa.treatment_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, *in.Category); err != nil {
				return err
			}
		}
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
		if in.Category != nil && *in.Category != "" {
			if _, err := q.Exec(ctx, `INSERT INTO spa.treatment_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, *in.Category); err != nil {
				return err
			}
		}
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
func (s *Service) SetPrices(ctx context.Context, userID, id string, prices []priceInput) (*Treatment, error) {
	outlets, err := s.Outlets(ctx, userID)
	if err != nil {
		return nil, err
	}
	allowed := make(map[string]bool)
	for _, outlet := range outlets {
		allowed[outlet.BranchID] = outlet.Configured
	}
	for _, price := range prices {
		if !allowed[price.BranchID] {
			return nil, httpx.Forbidden("Outlet di luar akses Anda atau belum dikonfigurasi sebagai outlet spa")
		}
	}
	err = s.tx(ctx, func(q Q) error {
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

// CustomerDirectory lists the same active POS customers used by booking search.
func (s *Service) CustomerDirectory(ctx context.Context, term string, page, limit int) ([]CustomerRef, int, error) {
	return s.ports.Customers.Page(ctx, s.db, term, page, limit)
}

// CustomerDetail combines the customer profile with completed spa treatments.
func (s *Service) CustomerDetail(ctx context.Context, id string, page, limit int) (*CustomerProfile, []CustomerTreatment, int, error) {
	profile, err := s.ports.Customers.Detail(ctx, s.db, id)
	if err != nil {
		return nil, nil, 0, err
	}
	if profile == nil {
		return nil, nil, 0, httpx.NotFound("Customer tidak ditemukan")
	}
	history, total, err := s.ports.Customers.Treatments(ctx, s.db, id, page, limit)
	return profile, history, total, err
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
	if b != nil {
		total := 0.0
		for _, it := range b.Items {
			if it.Status != domain.ItemCancelled {
				total += it.PriceIDR
			}
		}
		if info, derr := s.st.depositInfo(ctx, s.db, id, total, s.clock()); derr == nil {
			b.Deposit = info
		}
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
	TherapistID         string
	BranchID            string
	BookingType         string
	CustomerID          string
	CustomerName        string
	CustomerPhone       string
	CustomerGender      string
	TherapistGenderPref string
	Notes               string
	ScheduledAt         time.Time
	Items               []itemRequest
}

// planItems resolves variants; planning times are transient, never item data.
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
		if r.StartsAt != nil {
			return nil, httpx.BadRequest("Jadwal hanya dapat diatur pada booking")
		}
		v, ok := variants[r.VariantID]
		if !ok || !v.IsActive || !v.TreatmentOn {
			return nil, httpx.BadRequest("Treatment tidak ditemukan atau tidak aktif")
		}
		out[i] = newItem{Variant: v, StartsAt: cursor, Status: domain.ItemUnassigned, SortOrder: i}
		cursor = cursor.Add(time.Duration(v.DurationMin) * time.Minute)
	}
	return out, nil
}

// CreateBooking records a front-office booking (walk-in or reservation).
func (s *Service) CreateBooking(ctx context.Context, userID string, in createBookingInput) (*Booking, error) {
	// Older clients may still send an item-level therapist. Accept only one
	// consistent value, and apply it once to the entire booking.
	for _, item := range in.Items {
		if item.TherapistID == "" {
			continue
		}
		if in.TherapistID != "" && in.TherapistID != item.TherapistID {
			return nil, httpx.BadRequest("Satu booking hanya dapat ditugaskan ke satu terapis")
		}
		in.TherapistID = item.TherapistID
	}
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
		if customerID != nil && in.CustomerGender != "" {
			if err := s.ports.Customers.SetGender(ctx, q, *customerID, in.CustomerGender); err != nil {
				return err
			}
		}
		id, err = s.st.insertBooking(ctx, q, newBooking{
			Code: domain.BookingCode(s.clock()), CompanyID: o.CompanyID, BranchID: o.BranchID, WarehouseID: o.WarehouseID,
			BookingType: in.BookingType, Source: "front_office", CustomerID: customerID, CustomerName: in.CustomerName,
			CustomerPhone: phone, TherapistGenderPref: in.TherapistGenderPref, Notes: in.Notes,
			ScheduledAt: in.ScheduledAt, EndsAt: items[len(items)-1].StartsAt.Add(time.Duration(items[len(items)-1].Variant.DurationMin) * time.Minute), CreatedBy: userID,
		})
		if err != nil {
			return err
		}
		if err := s.st.event(ctx, q, id, nil, "create", nil, ptr(domain.BookingUnassigned), userID, ""); err != nil {
			return err
		}
		for i := range items {
			items[i].BookingID = id
			_, err := s.st.insertItem(ctx, q, items[i])
			if err != nil {
				return err
			}
		}
		stored, err := s.st.itemRows(ctx, q, id, true)
		if err != nil {
			return err
		}
		if _, err := bookingInterval(in.ScheduledAt, stored); err != nil {
			return err
		}
		if in.TherapistID != "" {
			b, err := s.st.bookingRow(ctx, q, id, true)
			if err != nil {
				return err
			}
			return s.assignBooking(ctx, q, userID, b, in.TherapistID)
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
		if p.GenderPref != nil {
			b.GenderPref = *p.GenderPref
		}
		if p.ScheduledAt != nil {
			if b.Status != domain.BookingUnassigned && b.Status != domain.BookingAssigned {
				return httpx.Conflict("Jadwal booking tidak dapat diubah setelah booking dimulai")
			}
			items, err := s.st.itemRows(ctx, q, id, true)
			if err != nil {
				return err
			}
			for _, item := range items {
				if item.Status == domain.ItemInTreatment || item.Status == domain.ItemCompleted {
					return httpx.Conflict("Jadwal booking tidak dapat diubah setelah treatment dimulai")
				}
			}
			if err := domain.CanReschedule(b.Status, b.PosOrderID != nil && s.orderLive(ctx, q, *b.PosOrderID)); err != nil {
				return ruleErr(err)
			}
			interval, err := bookingInterval(*p.ScheduledAt, items)
			if err != nil {
				return err
			}
			b.ScheduledAt = interval.Start
			if b.TherapistID != nil {
				if _, err := s.checkBookingTherapist(ctx, q, b, items, *b.TherapistID); err != nil {
					return err
				}
			}
			if err := s.st.setBookingWindow(ctx, q, id, interval.Start, interval.End); err != nil {
				return err
			}
			if err := s.st.event(ctx, q, id, nil, "reschedule", nil, nil, userID, interval.Start.In(domain.WIB).Format("02/01 15:04")+" WIB"); err != nil {
				return err
			}
		} else if p.GenderPref != nil && b.TherapistID != nil {
			items, err := s.st.itemRows(ctx, q, id, true)
			if err != nil {
				return err
			}
			if _, err := s.checkBookingTherapist(ctx, q, b, items, *b.TherapistID); err != nil {
				return err
			}
		}
		if err := s.st.patchBooking(ctx, q, id, p); err != nil {
			return err
		}
		if p.CustomerName == nil && p.CustomerPhone == nil && p.Notes == nil && p.GenderPref == nil {
			return nil
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
		if b.Status != domain.BookingUnassigned && b.Status != domain.BookingAssigned {
			return httpx.Conflict("Treatment tidak dapat ditambah setelah booking dimulai")
		}
		if req.TherapistID != "" && req.TherapistID != deref(b.TherapistID) {
			return httpx.BadRequest("Treatment mengikuti terapis booking; ubah penugasan pada booking")
		}
		start := b.EndsAt
		items, err := s.planItems(ctx, q, b.BranchID, start, []itemRequest{req})
		if err != nil {
			return err
		}
		items[0].BookingID, items[0].SortOrder = id, len(existing)
		items[0].TherapistID = b.TherapistID
		if b.TherapistID != nil {
			items[0].Status = domain.ItemAssigned
		}
		itemID, err := s.st.insertItem(ctx, q, items[0])
		if err != nil {
			return err
		}
		if err := s.st.event(ctx, q, id, &itemID, "add_item", nil, &items[0].Status, userID, productName(items[0].Variant)); err != nil {
			return err
		}
		updated, err := s.st.itemRows(ctx, q, id, true)
		if err != nil {
			return err
		}
		interval, err := bookingInterval(b.ScheduledAt, updated)
		if err != nil {
			return err
		}
		if err := s.st.setBookingWindow(ctx, q, id, interval.Start, interval.End); err != nil {
			return err
		}
		if b.TherapistID != nil {
			if _, err := s.checkBookingTherapist(ctx, q, b, updated, *b.TherapistID); err != nil {
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

// BookingAction starts or completes every active treatment in one transaction.
func (s *Service) BookingAction(ctx context.Context, userID, id, action string) (*Booking, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	err = s.tx(ctx, func(q Q) error {
		b, err := s.lockBooking(ctx, q, sc, id)
		if err != nil {
			return err
		}
		if action != domain.ActionStart && action != domain.ActionComplete {
			return httpx.BadRequest("Aksi booking tidak dikenal")
		}
		if action == domain.ActionStart && b.Status != domain.BookingAssigned ||
			action == domain.ActionComplete && b.Status != domain.BookingInTreatment {
			return httpx.Conflict("Status booking tidak sesuai untuk aksi ini")
		}
		items, err := s.st.itemRows(ctx, q, id, true)
		if err != nil {
			return err
		}
		changed := 0
		now := s.clock()
		for _, item := range items {
			if item.Status == domain.ItemCancelled || item.Status == domain.ItemCompleted {
				continue
			}
			next, err := domain.NextItemStatus(action, item.Status, b.Status, b.PaymentStatus == domain.PaymentPaid, domain.ActorStaff)
			if err != nil {
				return ruleErr(err)
			}
			if err := s.st.setItemStatus(ctx, q, item.ID, next, now); err != nil {
				return err
			}
			if action == domain.ActionComplete {
				if err := s.freezeCommission(ctx, q, b.BranchID, item); err != nil {
					return err
				}
			}
			changed++
		}
		if changed == 0 {
			return httpx.Conflict("Booking tidak memiliki treatment yang dapat diproses")
		}
		if err := s.syncStatus(ctx, q, id, userID); err != nil {
			return err
		}
		event := "start_booking"
		if action == domain.ActionComplete {
			event = "complete_booking"
		}
		return s.st.event(ctx, q, id, nil, event, &b.Status, nil, userID, "")
	})
	if err != nil {
		return nil, err
	}
	return s.visibleBooking(ctx, nil, id)
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
	if ch.Action == domain.ActionAssign || ch.Action == domain.ActionUnassign {
		if actor != domain.ActorStaff {
			return httpx.Forbidden("Penugasan hanya dapat diubah staf")
		}
		if it.Status == domain.ItemCancelled {
			return httpx.Conflict("Treatment sudah dibatalkan")
		}
		therapistID := ch.TherapistID
		if ch.Action == domain.ActionUnassign {
			therapistID = ""
		}
		return s.assignBooking(ctx, q, userID, b, therapistID)
	}
	next, err := domain.NextItemStatus(ch.Action, it.Status, b.Status, b.PaymentStatus == domain.PaymentPaid, actor)
	if err != nil {
		return ruleErr(err)
	}
	now := s.clock()
	note := ""
	switch ch.Action {
	case domain.ActionCancel:
		if b.Status != domain.BookingUnassigned && b.Status != domain.BookingAssigned {
			return httpx.Conflict("Treatment tidak dapat dihapus setelah booking dimulai")
		}
		checkedOut := b.PosOrderID != nil && s.orderLive(ctx, q, *b.PosOrderID)
		if err := domain.CanEditItems(b.Status, b.PaymentStatus, checkedOut); err != nil {
			return ruleErr(err)
		}
		if err := s.st.setItemStatus(ctx, q, it.ID, next, now); err != nil {
			return err
		}
		items[idx].Status = next
		interval, err := bookingInterval(b.ScheduledAt, items)
		if err != nil {
			return httpx.Conflict("Treatment terakhir tidak dapat dihapus; batalkan booking")
		}
		if err := s.st.setBookingWindow(ctx, q, bookingID, interval.Start, interval.End); err != nil {
			return err
		}
	case domain.ActionStart:
		for _, other := range items {
			if other.ID != it.ID && other.Status == domain.ItemInTreatment {
				return httpx.Conflict("Selesaikan treatment yang sedang berjalan sebelum memulai treatment berikutnya")
			}
		}
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
func (s *Service) Checkout(ctx context.Context, userID, id string, rating *int) (*CheckoutResult, error) {
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
		if b.TherapistID == nil {
			return httpx.Conflict("Terapis booking belum ditugaskan")
		}
		if rating == nil && b.TherapistRating == nil {
			return httpx.BadRequest("Rating terapis 1–5 bintang wajib diisi sebelum checkout")
		}
		if rating != nil && b.TherapistRating != nil && *rating != *b.TherapistRating {
			return httpx.Conflict("Rating terapis sudah tercatat untuk booking ini")
		}
		if rating == nil {
			rating = b.TherapistRating
		}
		if b.PosOrderID != nil {
			if b.TherapistRating == nil {
				if err := s.st.setTherapistRating(ctx, q, id, *rating); err != nil {
					return err
				}
			}
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
		prepaid, err := s.st.paidDeposit(ctx, q, id)
		if err != nil {
			return err
		}
		notes := "Booking spa " + b.Code
		if prepaid > 0 {
			notes += " · DP " + domainRupiah(prepaid) + " sudah dibayar online"
		}
		ref, err = s.ports.POS.OpenBill(ctx, q, Bill{
			CompanyID: b.CompanyID, BranchID: b.BranchID, WarehouseID: b.WarehouseID, CustomerID: b.CustomerID,
			CashierUserID: userID, ContactName: b.CustomerName, ContactPhone: b.CustomerPhone,
			Notes: notes, Lines: lines, Prepaid: prepaid, PrepaidNote: "DP booking " + b.Code,
		})
		if err != nil {
			return err
		}
		if err := s.st.setCheckout(ctx, q, id, ref.ID, s.clock(), *rating); err != nil {
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
func (s *Service) Availability(ctx context.Context, userID, branchID string, start, end time.Time, excludeItemID, bookingID string) ([]Availability, error) {
	sc, err := s.scope(ctx, userID)
	if err != nil {
		return nil, err
	}
	if _, err := s.outletIn(ctx, s.db, sc, branchID); err != nil {
		return nil, err
	}
	if bookingID == "" && excludeItemID != "" {
		bookingID, err = s.st.bookingIDOfItem(ctx, s.db, excludeItemID)
		if err != nil {
			return nil, err
		}
	}
	if bookingID != "" {
		b, err := s.visibleBooking(ctx, sc, bookingID)
		if err != nil {
			return nil, err
		}
		if b.BranchID != branchID {
			return nil, httpx.BadRequest("Outlet booking tidak sesuai")
		}
		items, err := s.st.itemRows(ctx, s.db, bookingID, false)
		if err != nil {
			return nil, err
		}
		iv, err := bookingInterval(time.Time(b.ScheduledAt), items)
		if err != nil {
			return nil, err
		}
		start, end = iv.Start, iv.End
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
	conflicts, err := s.st.bookingConflicts(ctx, s.db, ids, start, end, bookingID)
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
	for _, it := range groupBoardBookings(items) {
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

// tooManyOpenBookings is the per-phone cap message (the bot keys on "terlalu banyak").
const tooManyOpenBookings = "Nomor ini sudah memiliki terlalu banyak booking aktif. Batalkan booking yang tidak jadi lewat link status, atau hubungi outlet."

// PublicOutlets lists outlets open for online booking.
func (s *Service) PublicOutlets(ctx context.Context) ([]PublicOutlet, error) {
	list, err := s.st.publicOutlets(ctx, s.db)
	online := s.onlinePaymentReady()
	deposit, _ := s.depositSettings(ctx, s.db)
	for i := range list {
		list[i].OnlinePayment = online
		if deposit.Enabled {
			list[i].DepositIDR, list[i].DepositHoldMins = deposit.AmountIDR, deposit.HoldMinutes
		}
	}
	return list, err
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

// publicCapacity checks assigned work and reservations that have not yet been assigned.
// The booking write repeats this check under an outlet lock because a displayed slot can age.
func (s *Service) publicCapacity(ctx context.Context, q Q, branchID string, items []newItem, pref string) (bool, error) {
	rows := make([]itemRow, len(items))
	for i, item := range items {
		rows[i] = itemRow{DurationMin: item.Variant.DurationMin, Status: item.Status}
	}
	interval, err := bookingInterval(items[0].StartsAt, rows)
	if err != nil {
		return false, err
	}
	eligible, err := s.st.eligibleTherapists(ctx, q, branchID, domain.WIBDate(interval.Start))
	if err != nil {
		return false, err
	}
	ids := make([]string, 0, len(eligible))
	employees := make([]string, 0, len(eligible))
	for _, therapist := range eligible {
		if pref != "any" && (therapist.Gender == nil || *therapist.Gender != pref) {
			continue
		}
		ids = append(ids, therapist.ID)
		employees = append(employees, therapist.EmployeeID)
	}
	if len(ids) == 0 {
		return false, nil
	}
	rosters, err := s.ports.People.Rosters(ctx, q, employees, domain.WIBDate(interval.Start))
	if err != nil {
		return false, err
	}
	conflicts, err := s.st.bookingConflicts(ctx, q, ids, interval.Start, interval.End, "")
	if err != nil {
		return false, err
	}
	reserved, err := s.st.unassignedOverlaps(ctx, q, branchID, interval.Start, interval.End)
	if err != nil {
		return false, err
	}
	free := 0
	for _, therapist := range eligible {
		if pref != "any" && (therapist.Gender == nil || *therapist.Gender != pref) {
			continue
		}
		roster := rosters[therapist.EmployeeID]
		if !roster.OnLeave && !roster.DayOff && len(conflicts[therapist.ID]) == 0 {
			free++
		}
	}
	if free <= reserved {
		return false, nil
	}
	return true, nil
}

// PublicSlots only returns times with capacity at the moment of the read.
func (s *Service) PublicSlots(ctx context.Context, branchID, date string, variantIDs []string, pref string) ([]PublicSlot, error) {
	outlet, err := s.publicOutlet(ctx, s.db, branchID)
	if err != nil {
		return nil, err
	}
	day, _, valid := domain.DayBounds(date)
	if !valid {
		return nil, httpx.BadRequest("Tanggal tidak valid")
	}
	open, openOK := domain.ClockMinutes(outlet.OpenTime)
	closeAt, closeOK := domain.ClockMinutes(outlet.CloseTime)
	if !openOK || !closeOK || outlet.SlotMinutes <= 0 {
		return []PublicSlot{}, nil
	}
	reqs := make([]itemRequest, len(variantIDs))
	for i, id := range variantIDs {
		reqs[i] = itemRequest{VariantID: id}
	}
	baseItems, err := s.planItems(ctx, s.db, branchID, day, reqs)
	if err != nil {
		return nil, err
	}
	duration := 0
	for _, item := range baseItems {
		duration += item.Variant.DurationMin
	}
	now := s.clock()
	slots := []PublicSlot{}
	for minute := open; minute+duration <= closeAt; minute += outlet.SlotMinutes {
		at := day.Add(time.Duration(minute) * time.Minute)
		if !at.After(now) || at.After(now.AddDate(0, 0, 30)) {
			continue
		}
		items := make([]newItem, len(baseItems))
		for i, item := range baseItems {
			items[i] = item
			items[i].StartsAt = item.StartsAt.Add(at.Sub(day))
		}
		available, err := s.publicCapacity(ctx, s.db, branchID, items, pref)
		if err != nil {
			return nil, err
		}
		if available {
			slots = append(slots, PublicSlot{StartsAt: jsTime(at)})
		}
	}
	return slots, nil
}

func (s *Service) PublicBooking(ctx context.Context, token string) (*PublicBookingResult, error) {
	s.syncOnlinePayment(ctx, token)
	result, err := s.st.publicBookingByToken(ctx, s.db, token, s.clock())
	if result != nil {
		result.OnlinePayment = s.onlinePaymentReady()
		if info, derr := s.st.depositInfo(ctx, s.db, result.bookingID, result.TotalIDR, s.clock()); derr == nil {
			result.Deposit = info
		}
	}
	return result, err
}

func (s *Service) BookingFunnel(ctx context.Context, from, to string) ([]BookingFunnelStage, error) {
	start, end, ok := domain.RangeBounds(from, to)
	if !ok {
		return nil, httpx.BadRequest("Periode tidak valid")
	}
	return s.st.publicBookingFunnel(ctx, s.db, start, end)
}

// PublicChangeBooking applies one verified cancellation or time change.
// The grant is scoped to one booking, lasts 15 minutes and is consumed on success.
func (s *Service) PublicChangeBooking(ctx context.Context, token, grant, action string, newAt time.Time) (*PublicBookingResult, error) {
	if action != "cancel" && action != "reschedule" {
		return nil, httpx.BadRequest("Aksi tidak valid")
	}
	now := s.clock()
	if action == "reschedule" && (newAt.Before(now.Add(PublicRescheduleCutoff)) || newAt.After(now.AddDate(0, 0, 30))) {
		return nil, httpx.BadRequest("Pilih jam baru minimal 1 jam dari sekarang dan maksimal 30 hari ke depan")
	}
	digest := sha256.Sum256([]byte(grant))
	grantHash := hex.EncodeToString(digest[:])
	err := s.tx(ctx, func(q Q) error {
		id, err := s.st.publicBookingID(ctx, q, token)
		if err != nil {
			return err
		}
		b, err := s.st.bookingRow(ctx, q, id, true)
		if err != nil {
			return err
		}
		if b == nil {
			return httpx.NotFound("Booking tidak ditemukan")
		}
		if action == "reschedule" {
			if why := rescheduleBlocked(b, now); why != "" {
				return httpx.Conflict(why)
			}
		} else if b.ScheduledAt.Sub(now) < PublicCancelCutoff || (b.Status != domain.BookingUnassigned && b.Status != domain.BookingAssigned) || b.PaymentStatus != domain.PaymentUnpaid || b.PosOrderID != nil {
			return httpx.Conflict("Pembatalan mandiri hanya tersedia sampai 24 jam sebelum kunjungan untuk booking yang belum dibayar")
		}
		if err := s.st.lockPublicBookingBranch(ctx, q, b.BranchID); err != nil {
			return err
		}
		used, err := s.st.usePublicChangeGrant(ctx, q, id, grantHash)
		if err != nil {
			return err
		}
		if !used {
			return httpx.Forbidden("Verifikasi kedaluwarsa. Minta kode baru")
		}
		items, err := s.st.itemRows(ctx, q, id, true)
		if err != nil {
			return err
		}
		activeItems := make([]itemRow, 0, len(items))
		for _, item := range items {
			if item.Status != domain.ItemCancelled {
				activeItems = append(activeItems, item)
			}
		}
		items = activeItems
		if len(items) == 0 {
			return httpx.Conflict("Booking tidak memiliki treatment aktif")
		}
		statuses := make([]string, len(items))
		for i, item := range items {
			statuses[i] = item.Status
		}
		if err := domain.CanCancelBooking(b.Status, false, statuses); err != nil {
			return ruleErr(err)
		}
		if action == "cancel" {
			if err := s.st.cancelBooking(ctx, q, id, "Dibatalkan pelanggan melalui tautan booking", now); err != nil {
				return err
			}
			return s.st.event(ctx, q, id, nil, "cancel", &b.Status, ptr(domain.BookingCancelled), "", "Dibatalkan pelanggan setelah verifikasi nomor HP")
		}
		o, err := s.publicOutlet(ctx, q, b.BranchID)
		if err != nil {
			return err
		}
		total := 0
		for _, item := range items {
			total += item.DurationMin
		}
		if err := domain.WithinHours(newAt, total, o.OpenTime, o.CloseTime); err != nil {
			return ruleErr(err)
		}
		open, ok := domain.ClockMinutes(o.OpenTime)
		if !ok || o.SlotMinutes <= 0 || (newAt.In(domain.WIB).Hour()*60+newAt.In(domain.WIB).Minute()-open)%o.SlotMinutes != 0 {
			return httpx.BadRequest("Pilih jam dari daftar yang tersedia")
		}
		if _, err := q.Exec(ctx, `UPDATE spa.bookings SET therapist_id = NULL WHERE id = $1`, id); err != nil {
			return err
		}
		if err := s.st.releasePublicItemsForReschedule(ctx, q, id); err != nil {
			return err
		}
		ids := make([]string, len(items))
		for i, item := range items {
			ids[i] = item.VariantID
		}
		variants, err := s.st.variants(ctx, q, ids, b.BranchID)
		if err != nil {
			return err
		}
		planned := make([]newItem, len(items))
		cursor := newAt
		for i, item := range items {
			variant, exists := variants[item.VariantID]
			if !exists {
				return httpx.Conflict("Treatment booking tidak ditemukan")
			}
			variant.DurationMin = item.DurationMin
			planned[i] = newItem{Variant: variant, StartsAt: cursor, Status: domain.ItemUnassigned, SortOrder: i}
			cursor = cursor.Add(time.Duration(item.DurationMin) * time.Minute)
		}
		available, err := s.publicCapacity(ctx, q, b.BranchID, planned, b.GenderPref)
		if err != nil {
			return err
		}
		if !available {
			return httpx.Conflict("Jam ini sudah penuh. Pilih jam lain")
		}
		for _, item := range items {
			if err := s.st.movePublicItem(ctx, q, item.ID); err != nil {
				return err
			}
		}
		if err := s.st.setPublicBookingTime(ctx, q, id, newAt, cursor); err != nil {
			return err
		}
		return s.st.event(ctx, q, id, nil, "reschedule", &b.Status, ptr(domain.BookingUnassigned), "", "Diubah pelanggan setelah verifikasi nomor HP")
	})
	if err != nil {
		return nil, err
	}
	return s.PublicBooking(ctx, token)
}

type publicBookingInput struct {
	BranchID            string
	ScheduledAt         time.Time
	CustomerName        string
	CustomerPhone       string
	TherapistGenderPref string
	Notes               string
	VariantIDs          []string
	// TherapistID is the guest's pick ("" = the outlet assigns).
	TherapistID string
	// PaymentMethod is outlet (default) or online.
	PaymentMethod string
	// Source is public (website, default) or whatsapp (chatbot).
	Source string
	// skipCap: the group path checked the per-phone cap once for the whole party.
	skipCap bool
}

// PublicBookingInput is the self-service booking request for other
// contexts (the WhatsApp bot).
type PublicBookingInput = publicBookingInput

// PublicBook records an online booking, unassigned, for the front office.
func (s *Service) PublicBook(ctx context.Context, in publicBookingInput) (*PublicBookingResult, error) {
	now := s.clock()
	if err := publicBookingChecks(&in, now, s.onlinePaymentReady()); err != nil {
		return nil, err
	}
	var token string
	err := s.tx(ctx, func(q Q) error {
		result, err := s.publicBookIn(ctx, q, in, now)
		if err != nil {
			return err
		}
		token = result.AccessToken
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.prepareDeposit(ctx, token)
	return s.PublicBooking(ctx, token)
}

// prepareDeposit makes the DP invoice right after booking so the guest gets
// the link at once; a failure here is not fatal (the status page retries).
func (s *Service) prepareDeposit(ctx context.Context, token string) {
	var status string
	if err := s.db.QueryRow(ctx, `SELECT deposit_status FROM spa.bookings WHERE public_token = $1::uuid`, token).Scan(&status); err != nil || status != DepositPending {
		return
	}
	if _, err := s.PublicPayDeposit(ctx, token); err != nil {
		s.warn("spa: deposit invoice", err)
	}
}

// publicBookingChecks validates one public booking request before the
// transaction (time window, phone, payment method, default source).
func publicBookingChecks(in *publicBookingInput, now time.Time, onlineReady bool) error {
	if !in.ScheduledAt.After(now) {
		return httpx.BadRequest("Pilih waktu yang belum lewat")
	}
	if in.ScheduledAt.After(now.AddDate(0, 0, 60)) {
		return httpx.BadRequest("Booking online maksimal 60 hari ke depan")
	}
	if domain.NormalizePhone(in.CustomerPhone) == "" {
		return httpx.BadRequest("Nomor HP tidak valid")
	}
	if in.PaymentMethod == "" {
		in.PaymentMethod = PaymentAtOutlet
	}
	if in.PaymentMethod == PaymentOnline && !onlineReady {
		return httpx.BadRequest("Pembayaran online belum tersedia. Pilih bayar di outlet.")
	}
	if in.Source == "" {
		in.Source = "public"
	}
	if in.TherapistGenderPref == "" {
		in.TherapistGenderPref = "any"
	}
	return nil
}

// publicBookIn creates one public booking inside q (also used per guest by
// PublicBookGroup, so a group is all-or-nothing).
func (s *Service) publicBookIn(ctx context.Context, q Q, in publicBookingInput, now time.Time) (*PublicBookingResult, error) {
	phone := domain.NormalizePhone(in.CustomerPhone)
	var result *PublicBookingResult
	err := func() error {
		o, err := s.publicOutlet(ctx, q, in.BranchID)
		if err != nil {
			return err
		}
		if err := s.st.lockPublicBookingBranch(ctx, q, in.BranchID); err != nil {
			return err
		}
		if !in.skipCap {
			open, err := s.st.openPublicBookings(ctx, q, phone, now)
			if err != nil {
				return err
			}
			if open >= MaxPublicOpenBookings {
				return httpx.TooManyRequests(tooManyOpenBookings)
			}
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
		available, err := s.publicCapacity(ctx, q, o.BranchID, items, in.TherapistGenderPref)
		if err != nil {
			return err
		}
		if !available {
			return httpx.Conflict("Jam ini sudah penuh. Silakan pilih jam lain atau hubungi outlet.")
		}
		customerID, err := s.ports.Customers.FindOrCreate(ctx, q, in.CustomerName, phone)
		if err != nil {
			return err
		}
		code := domain.BookingCode(now)
		id, err := s.st.insertBooking(ctx, q, newBooking{
			Code: code, CompanyID: o.CompanyID, BranchID: o.BranchID, WarehouseID: o.WarehouseID,
			BookingType: "reservation", Source: in.Source, CustomerID: &customerID, CustomerName: in.CustomerName,
			CustomerPhone: phone, TherapistGenderPref: in.TherapistGenderPref, Notes: in.Notes, ScheduledAt: in.ScheduledAt,
			EndsAt: in.ScheduledAt.Add(time.Duration(total) * time.Minute),
		})
		if err != nil {
			return err
		}
		if err := s.st.event(ctx, q, id, nil, "create", nil, ptr(domain.BookingUnassigned), "", "Booking online"); err != nil {
			return err
		}
		// A booking fulfils the guest's waitlist wish for that outlet and day.
		if err := s.resolveWaitlistIn(ctx, q, o.BranchID, phone, domain.WIBDate(in.ScheduledAt)); err != nil {
			return err
		}
		// Online bookings hold their slot against a deposit (DP).
		if err := s.applyDeposit(ctx, q, id, now); err != nil {
			return err
		}
		result = &PublicBookingResult{BookingCode: code, BranchID: o.BranchID, ScheduledAt: jsTime(in.ScheduledAt), BranchName: o.BranchName, Items: []PublicItem{}}
		result.Status = domain.BookingUnassigned
		result.PaymentStatus = domain.PaymentUnpaid
		result.GenderPref = in.TherapistGenderPref
		result.CanManage = in.ScheduledAt.Sub(now) >= 24*time.Hour
		result.AccessToken, err = s.st.publicToken(ctx, q, id)
		if err != nil {
			return err
		}
		for i := range items {
			items[i].BookingID = id
			if _, err := s.st.insertItem(ctx, q, items[i]); err != nil {
				return err
			}
			v := items[i].Variant
			result.Items = append(result.Items, PublicItem{VariantID: v.ID, TreatmentName: v.TreatmentName, VariantName: v.Name,
				DurationMin: v.DurationMin, PriceIDR: v.Price})
			result.TotalIDR += v.Price
		}
		if in.PaymentMethod == PaymentOnline {
			if _, err := q.Exec(ctx, `UPDATE spa.bookings SET payment_method = 'online' WHERE id = $1`, id); err != nil {
				return err
			}
		}
		if in.TherapistID == "" {
			return nil
		}
		// The guest's pick goes through the same checks as a front-office
		// assignment (duty, shift, gender, overlap) under the booking lock.
		b, err := s.st.bookingRow(ctx, q, id, true)
		if err != nil {
			return err
		}
		if err := s.assignBooking(ctx, q, "", b, in.TherapistID); err != nil {
			var rule *httpx.Error
			if errors.As(err, &rule) && rule.Status == http.StatusConflict {
				return httpx.Conflict("Terapis pilihanmu baru saja terisi. Pilih terapis lain, atau biarkan Mizu memilihkan.")
			}
			return err
		}
		return nil
	}()
	if err != nil {
		return nil, err
	}
	return result, nil
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
