package spa

import (
	"testing"
	"time"

	"nuhabit/backend/internal/modules/spa/domain"
)

func TestBookingInterval(t *testing.T) {
	start := time.Date(2026, 10, 11, 3, 0, 0, 0, time.UTC)
	first := itemRow{DurationMin: 60, Status: domain.ItemAssigned}
	second := itemRow{DurationMin: 30, Status: domain.ItemAssigned}
	iv, err := bookingInterval(start, []itemRow{second, first})
	if err != nil || !iv.Start.Equal(start) || !iv.End.Equal(start.Add(90*time.Minute)) {
		t.Fatalf("booking duration = %+v, %v", iv, err)
	}
	second.Status = domain.ItemCancelled
	iv, err = bookingInterval(start, []itemRow{first, second})
	if err != nil || !iv.End.Equal(start.Add(60*time.Minute)) {
		t.Fatalf("cancelled item changed visit: %+v, %v", iv, err)
	}
	if _, err := bookingInterval(start, []itemRow{second}); err == nil {
		t.Fatal("empty visit accepted")
	}
}

func TestBoardGroupsWholeBookingAndLocksCompletedWork(t *testing.T) {
	start := time.Date(2026, 10, 11, 3, 0, 0, 0, time.UTC)
	a := BoardItem{Item: Item{ID: "a", DurationMin: 60, Status: domain.ItemCompleted, TreatmentName: "Massage", PriceIDR: 200000}, StartsAt: jsTime(start), EndsAt: jsTime(start.Add(90 * time.Minute)), BookingID: "booking", BookingStatus: domain.BookingAssigned}
	b := BoardItem{Item: Item{ID: "b", DurationMin: 30, Status: domain.ItemAssigned, TreatmentName: "Refleksi", PriceIDR: 100000}, StartsAt: jsTime(start), EndsAt: jsTime(start.Add(90 * time.Minute)), BookingID: "booking", BookingStatus: domain.BookingAssigned}
	rows := groupBoardBookings([]BoardItem{b, a})
	if len(rows) != 1 {
		t.Fatalf("got %d cards for one booking", len(rows))
	}
	row := rows[0]
	if row.ID != "booking" || row.TreatmentCount != 2 || row.DurationMin != 90 || row.PriceIDR != 300000 || !row.AssignmentLocked {
		t.Fatalf("card = %+v", row)
	}
}
