package spa

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// Ports are what spa needs from other contexts; internal/app adapts them.
// Every method takes the caller's querier so it joins the spa transaction.
type Ports struct {
	POS       POS
	Customers Customers
	People    People
}

// TreatmentProduct asks POS for the product that sells a variant at an
// outlet stall.
type TreatmentProduct struct {
	CompanyID   *string
	BranchID    string
	WarehouseID string
	// ExistingID is the POS product mapped earlier ("" for none); the adapter
	// refreshes it when it still exists.
	ExistingID string
	Code       string // master product code, unique per stall
	SKU        string // POS SKU, unique
	Name       string
	Category   string
	Price      float64
	Active     bool
}

// BillLine is one treatment line of an open bill.
type BillLine struct {
	ProductID string
	Name      string
	SKU       string
	UnitPrice float64
	Note      string
}

// Bill is an unpaid POS order opened for a booking.
type Bill struct {
	CompanyID     *string
	BranchID      string
	WarehouseID   string
	CustomerID    *string
	CashierUserID string
	ContactName   string
	ContactPhone  string
	Notes         string
	Lines         []BillLine
}

// OrderRef identifies a POS order.
type OrderRef struct {
	ID     string
	Number string
}

// OrderState is the POS view of an order.
type OrderState struct {
	Number        string
	Status        string
	PaymentStatus string
}

// Live reports whether the order still stands (not cancelled, voided or
// merged away).
func (s OrderState) Live() bool {
	return s.Status != "cancelled" && s.Status != "voided" && s.Status != "merged"
}

// Paid reports whether the order is settled.
func (s OrderState) Paid() bool { return s.Live() && s.PaymentStatus == "paid" }

// POS is the pos-ops / pos-sales side: products and open bills.
type POS interface {
	EnsureTreatmentProduct(ctx context.Context, q database.Querier, p TreatmentProduct) (string, error)
	OpenBill(ctx context.Context, q database.Querier, b Bill) (OrderRef, error)
	OrderStates(ctx context.Context, q database.Querier, ids []string) (map[string]OrderState, error)
}

// Customers is the POS customer directory.
type Customers interface {
	Search(ctx context.Context, q database.Querier, term string, limit int) ([]CustomerRef, error)
	// FindOrCreate returns the customer with phone, creating it with name.
	FindOrCreate(ctx context.Context, q database.Querier, name, phone string) (string, error)
}

// Roster is an employee's working status on a date.
type Roster struct {
	OnLeave bool
	DayOff  bool
	Shift   *ShiftInfo
}

// People is the HRIS side.
type People interface {
	SearchEmployees(ctx context.Context, q database.Querier, term string, limit int) ([]EmployeeCandidate, error)
	EmployeeExists(ctx context.Context, q database.Querier, id string) (bool, error)
	EmployeeIDByUser(ctx context.Context, q database.Querier, userID string) (string, error)
	Rosters(ctx context.Context, q database.Querier, employeeIDs []string, date string) (map[string]Roster, error)
}
