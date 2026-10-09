package spa

import "nuhabit/backend/internal/platform/httpx"

// Wire types: the JSON contract of EPIC-052 (docs/epics/EPIC-052-*.md).

// WarehouseRef is a stall option of an outlet.
type WarehouseRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Code string `json:"code"`
}

// Outlet is a branch and its spa configuration.
type Outlet struct {
	BranchID      string         `json:"branch_id"`
	BranchName    string         `json:"branch_name"`
	CompanyID     *string        `json:"company_id"`
	Configured    bool           `json:"configured"`
	WarehouseID   *string        `json:"warehouse_id"`
	WarehouseName *string        `json:"warehouse_name"`
	OpenTime      string         `json:"open_time"`
	CloseTime     string         `json:"close_time"`
	SlotMinutes   int            `json:"slot_minutes"`
	PublicBooking bool           `json:"public_booking"`
	IsActive      bool           `json:"is_active"`
	Warehouses    []WarehouseRef `json:"warehouses"`
}

// OutletPrice is a variant's price override at one outlet.
type OutletPrice struct {
	BranchID string  `json:"branch_id"`
	PriceIDR float64 `json:"price_idr"`
}

// Variant is a duration option of a treatment.
type Variant struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	DurationMin  int           `json:"duration_min"`
	BufferMin    int           `json:"buffer_min"`
	PriceIDR     float64       `json:"price_idr"`
	IsActive     bool          `json:"is_active"`
	SortOrder    int           `json:"sort_order"`
	OutletPrices []OutletPrice `json:"outlet_prices"`
}

// Treatment is a catalog entry with its variants.
type Treatment struct {
	ID          string    `json:"id"`
	Code        string    `json:"code"`
	Name        string    `json:"name"`
	Category    string    `json:"category"`
	Description string    `json:"description"`
	IsActive    bool      `json:"is_active"`
	SortOrder   int       `json:"sort_order"`
	Variants    []Variant `json:"variants"`
}

// Therapist is a therapist with the employee's display data.
type Therapist struct {
	ID             string  `json:"id"`
	EmployeeID     string  `json:"employee_id"`
	FullName       string  `json:"full_name"`
	NIP            *string `json:"nip"`
	Phone          *string `json:"phone"`
	PhotoURL       *string `json:"photo_url"`
	HomeBranchID   string  `json:"home_branch_id"`
	HomeBranchName string  `json:"home_branch_name"`
	Gender         *string `json:"gender"`
	IsActive       bool    `json:"is_active"`
}

// EmployeeCandidate is an employee that can become a therapist or PIC.
type EmployeeCandidate struct {
	ID            string  `json:"id"`
	FullName      string  `json:"full_name"`
	NIP           *string `json:"nip"`
	PositionTitle *string `json:"position_title"`
	IsTherapist   bool    `json:"is_therapist"`
}

// Assist is a therapist lent to another outlet for a date range.
type Assist struct {
	ID            string `json:"id"`
	TherapistID   string `json:"therapist_id"`
	TherapistName string `json:"therapist_name"`
	BranchID      string `json:"branch_id"`
	BranchName    string `json:"branch_name"`
	StartDate     string `json:"start_date"`
	EndDate       string `json:"end_date"`
	Note          string `json:"note"`
}

// OutletPIC is an outlet's person in charge.
type OutletPIC struct {
	BranchID   string `json:"branch_id"`
	BranchName string `json:"branch_name"`
	EmployeeID string `json:"employee_id"`
	FullName   string `json:"full_name"`
}

// CustomerRef is a POS customer found by search.
type CustomerRef struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Phone string  `json:"phone"`
	Email *string `json:"email"`
}

// BookingSummary is one row of the booking list.
type BookingSummary struct {
	ID             string       `json:"id"`
	BookingCode    string       `json:"booking_code"`
	BranchID       string       `json:"branch_id"`
	BranchName     string       `json:"branch_name"`
	BookingType    string       `json:"booking_type"`
	Source         string       `json:"source"`
	CustomerName   string       `json:"customer_name"`
	CustomerPhone  string       `json:"customer_phone"`
	ScheduledAt    httpx.JSTime `json:"scheduled_at"`
	Status         string       `json:"status"`
	PaymentStatus  string       `json:"payment_status"`
	ItemCount      int          `json:"item_count"`
	TotalIDR       float64      `json:"total_idr"`
	TherapistNames []string     `json:"therapist_names"`
	PosOrderID     *string      `json:"pos_order_id"`
	CreatedAt      httpx.JSTime `json:"created_at"`
}

// Item is one treatment of a booking.
type Item struct {
	ID            string        `json:"id"`
	VariantID     string        `json:"variant_id"`
	TreatmentName string        `json:"treatment_name"`
	VariantName   string        `json:"variant_name"`
	DurationMin   int           `json:"duration_min"`
	BufferMin     int           `json:"buffer_min"`
	PriceIDR      float64       `json:"price_idr"`
	TherapistID   *string       `json:"therapist_id"`
	TherapistName *string       `json:"therapist_name"`
	StartsAt      httpx.JSTime  `json:"starts_at"`
	EndsAt        httpx.JSTime  `json:"ends_at"`
	Status        string        `json:"status"`
	StartedAt     *httpx.JSTime `json:"started_at"`
	CompletedAt   *httpx.JSTime `json:"completed_at"`
	CommissionIDR *float64      `json:"commission_idr"`
}

// Event is one line of a booking's history.
type Event struct {
	ID         string       `json:"id"`
	ItemID     *string      `json:"item_id"`
	Action     string       `json:"action"`
	FromStatus *string      `json:"from_status"`
	ToStatus   *string      `json:"to_status"`
	ActorName  *string      `json:"actor_name"`
	Note       string       `json:"note"`
	CreatedAt  httpx.JSTime `json:"created_at"`
}

// Booking is the full booking detail.
type Booking struct {
	BookingSummary
	CompanyID           *string       `json:"company_id"`
	WarehouseID         string        `json:"warehouse_id"`
	CustomerID          *string       `json:"customer_id"`
	TherapistGenderPref string        `json:"therapist_gender_pref"`
	Notes               string        `json:"notes"`
	CheckedOutAt        *httpx.JSTime `json:"checked_out_at"`
	PaidAt              *httpx.JSTime `json:"paid_at"`
	CancelledAt         *httpx.JSTime `json:"cancelled_at"`
	CancelReason        *string       `json:"cancel_reason"`
	PosOrderNumber      *string       `json:"pos_order_number"`
	Items               []Item        `json:"items"`
	Events              []Event       `json:"events"`
}

// BoardItem is an item with its booking context, for the board and the
// therapist's own list.
type BoardItem struct {
	Item
	BookingID     string `json:"booking_id"`
	BookingCode   string `json:"booking_code"`
	BranchID      string `json:"branch_id"`
	BranchName    string `json:"branch_name"`
	CustomerName  string `json:"customer_name"`
	BookingStatus string `json:"booking_status"`
	PaymentStatus string `json:"payment_status"`
}

// ShiftInfo is a therapist's scheduled shift that day.
type ShiftInfo struct {
	Name      string `json:"name"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

// Conflict is an item that blocks an assignment.
type Conflict struct {
	ItemID      string       `json:"item_id"`
	BookingCode string       `json:"booking_code"`
	StartsAt    httpx.JSTime `json:"starts_at"`
	EndsAt      httpx.JSTime `json:"ends_at"`
}

// Availability is a therapist's availability for a time window.
type Availability struct {
	Therapist Therapist  `json:"therapist"`
	Available bool       `json:"available"`
	Conflicts []Conflict `json:"conflicts"`
	OnLeave   bool       `json:"on_leave"`
	Shift     *ShiftInfo `json:"shift"`
	DayOff    bool       `json:"day_off"`
	Assisting bool       `json:"assisting"`
}

// BoardTherapist is one therapist lane of the board.
type BoardTherapist struct {
	Therapist Therapist   `json:"therapist"`
	Shift     *ShiftInfo  `json:"shift"`
	OnLeave   bool        `json:"on_leave"`
	DayOff    bool        `json:"day_off"`
	Assisting bool        `json:"assisting"`
	Items     []BoardItem `json:"items"`
}

// Board is the daily book-order view of an outlet.
type Board struct {
	Date       string           `json:"date"`
	BranchID   string           `json:"branch_id"`
	Therapists []BoardTherapist `json:"therapists"`
	Unassigned []BoardItem      `json:"unassigned"`
}

// CommissionRuleView is a commission rule with display names.
type CommissionRuleView struct {
	ID             string  `json:"id"`
	TreatmentID    *string `json:"treatment_id"`
	TreatmentName  *string `json:"treatment_name"`
	VariantID      *string `json:"variant_id"`
	VariantName    *string `json:"variant_name"`
	BranchID       *string `json:"branch_id"`
	BranchName     *string `json:"branch_name"`
	CommissionType string  `json:"commission_type"`
	Value          float64 `json:"value"`
	IsActive       bool    `json:"is_active"`
}

// CommissionLine is one completed, paid treatment in a commission report.
type CommissionLine struct {
	ItemID          string       `json:"item_id"`
	BookingID       string       `json:"booking_id"`
	BookingCode     string       `json:"booking_code"`
	BranchName      string       `json:"branch_name"`
	CompletedAt     httpx.JSTime `json:"completed_at"`
	TreatmentName   string       `json:"treatment_name"`
	VariantName     string       `json:"variant_name"`
	PriceIDR        float64      `json:"price_idr"`
	CommissionType  *string      `json:"commission_type"`
	CommissionValue *float64     `json:"commission_value"`
	CommissionIDR   float64      `json:"commission_idr"`
}

// TherapistCommission groups a therapist's lines.
type TherapistCommission struct {
	TherapistID    string           `json:"therapist_id"`
	FullName       string           `json:"full_name"`
	NIP            *string          `json:"nip"`
	TreatmentCount int              `json:"treatment_count"`
	RevenueIDR     float64          `json:"revenue_idr"`
	CommissionIDR  float64          `json:"commission_idr"`
	Lines          []CommissionLine `json:"lines"`
}

// CommissionReport is GET /api/spa/commissions.
type CommissionReport struct {
	From       string                `json:"from"`
	To         string                `json:"to"`
	TotalIDR   float64               `json:"total_idr"`
	Therapists []TherapistCommission `json:"therapists"`
}

// CheckoutResult is POST /api/spa/bookings/{id}/checkout.
type CheckoutResult struct {
	Booking     *Booking `json:"booking"`
	OrderID     string   `json:"order_id"`
	OrderNumber string   `json:"order_number"`
}

// PublicOutlet is an outlet open for online booking.
type PublicOutlet struct {
	BranchID    string  `json:"branch_id"`
	Slug        string  `json:"slug"`
	Name        string  `json:"name"`
	Address     *string `json:"address"`
	City        *string `json:"city"`
	Phone       *string `json:"phone"`
	OpenTime    string  `json:"open_time"`
	CloseTime   string  `json:"close_time"`
	SlotMinutes int     `json:"slot_minutes"`
}

// PublicVariant is a bookable variant with the outlet price.
type PublicVariant struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	DurationMin int     `json:"duration_min"`
	PriceIDR    float64 `json:"price_idr"`
}

// PublicTreatment is a treatment on the public booking page.
type PublicTreatment struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Category    string          `json:"category"`
	Description string          `json:"description"`
	Variants    []PublicVariant `json:"variants"`
}

// PublicItem is a booked treatment in the public confirmation.
type PublicItem struct {
	VariantID     string  `json:"variant_id"`
	TreatmentName string  `json:"treatment_name"`
	VariantName   string  `json:"variant_name"`
	DurationMin   int     `json:"duration_min"`
	PriceIDR      float64 `json:"price_idr"`
}

// PublicSlot is a start time with enough therapist capacity for the request.
type PublicSlot struct {
	StartsAt httpx.JSTime `json:"starts_at"`
}

type BookingFunnelStage struct {
	Step      string `json:"step"`
	Reached   int    `json:"reached"`
	Abandoned int    `json:"abandoned"`
}

// PublicBookingResult is POST /api/public/spa/bookings.
type PublicBookingResult struct {
	AccessToken   string       `json:"access_token"`
	BranchID      string       `json:"branch_id"`
	BookingCode   string       `json:"booking_code"`
	ScheduledAt   httpx.JSTime `json:"scheduled_at"`
	BranchName    string       `json:"branch_name"`
	BranchPhone   *string      `json:"branch_phone"`
	GenderPref    string       `json:"therapist_gender_pref"`
	Status        string       `json:"status"`
	PaymentStatus string       `json:"payment_status"`
	CanManage     bool         `json:"can_manage"`
	Items         []PublicItem `json:"items"`
	TotalIDR      float64      `json:"total_idr"`
}

// MeResult is GET /api/spa/me.
type MeResult struct {
	Therapist *Therapist `json:"therapist"`
}
