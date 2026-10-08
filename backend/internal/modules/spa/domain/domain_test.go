package domain

import (
	"errors"
	"testing"
	"time"
)

func TestNextItemStatus(t *testing.T) {
	cases := []struct {
		name, action, from, booking string
		paid                        bool
		actor                       Actor
		want                        string
		wantErr                     bool
	}{
		{"assign unassigned", ActionAssign, ItemUnassigned, BookingUnassigned, false, ActorStaff, ItemAssigned, false},
		{"reassign assigned", ActionAssign, ItemAssigned, BookingAssigned, false, ActorStaff, ItemAssigned, false},
		{"assign running", ActionAssign, ItemInTreatment, BookingInTreatment, false, ActorStaff, "", true},
		{"unassign", ActionUnassign, ItemAssigned, BookingAssigned, false, ActorStaff, ItemUnassigned, false},
		{"unassign unassigned", ActionUnassign, ItemUnassigned, BookingUnassigned, false, ActorStaff, "", true},
		{"start", ActionStart, ItemAssigned, BookingAssigned, false, ActorTherapist, ItemInTreatment, false},
		{"start unassigned", ActionStart, ItemUnassigned, BookingUnassigned, false, ActorStaff, "", true},
		{"start completed", ActionStart, ItemCompleted, BookingCompleted, false, ActorStaff, "", true},
		{"complete running", ActionComplete, ItemInTreatment, BookingInTreatment, false, ActorTherapist, ItemCompleted, false},
		{"staff override complete", ActionComplete, ItemAssigned, BookingAssigned, false, ActorStaff, ItemCompleted, false},
		{"therapist cannot skip start", ActionComplete, ItemAssigned, BookingAssigned, false, ActorTherapist, "", true},
		{"complete twice", ActionComplete, ItemCompleted, BookingCompleted, false, ActorStaff, "", true},
		{"cancel assigned", ActionCancel, ItemAssigned, BookingAssigned, false, ActorStaff, ItemCancelled, false},
		{"cancel running", ActionCancel, ItemInTreatment, BookingInTreatment, false, ActorStaff, "", true},
		{"cancel paid", ActionCancel, ItemAssigned, BookingAssigned, true, ActorStaff, "", true},
		{"reschedule keeps status", ActionReschedule, ItemAssigned, BookingAssigned, false, ActorStaff, ItemAssigned, false},
		{"reschedule running", ActionReschedule, ItemInTreatment, BookingInTreatment, false, ActorStaff, "", true},
		{"closed booking", ActionAssign, ItemUnassigned, BookingCancelled, false, ActorStaff, "", true},
		{"expired booking", ActionStart, ItemAssigned, BookingExpired, false, ActorStaff, "", true},
		{"unknown", "dance", ItemAssigned, BookingAssigned, false, ActorStaff, "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := NextItemStatus(c.action, c.from, c.booking, c.paid, c.actor)
			if (err != nil) != c.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, c.wantErr)
			}
			var re *RuleError
			if err != nil && !errors.As(err, &re) {
				t.Fatalf("err %T is not a RuleError", err)
			}
			if got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestDeriveBookingStatus(t *testing.T) {
	cases := []struct {
		current string
		items   []string
		want    string
	}{
		{BookingUnassigned, []string{ItemUnassigned}, BookingUnassigned},
		{BookingUnassigned, []string{ItemAssigned, ItemUnassigned}, BookingUnassigned},
		{BookingUnassigned, []string{ItemAssigned, ItemAssigned}, BookingAssigned},
		{BookingAssigned, []string{ItemAssigned, ItemInTreatment}, BookingInTreatment},
		{BookingInTreatment, []string{ItemCompleted, ItemInTreatment}, BookingInTreatment},
		{BookingInTreatment, []string{ItemCompleted, ItemAssigned}, BookingAssigned},
		{BookingInTreatment, []string{ItemCompleted, ItemCompleted}, BookingCompleted},
		{BookingAssigned, []string{ItemCompleted, ItemCancelled}, BookingCompleted},
		{BookingAssigned, []string{ItemCancelled, ItemCancelled}, BookingCancelled},
		{BookingCancelled, []string{ItemAssigned}, BookingCancelled},
		{BookingExpired, []string{ItemAssigned}, BookingExpired},
		{BookingUnassigned, nil, BookingCancelled},
	}
	for _, c := range cases {
		if got := DeriveBookingStatus(c.current, c.items); got != c.want {
			t.Errorf("DeriveBookingStatus(%s, %v) = %s, want %s", c.current, c.items, got, c.want)
		}
	}
}

func TestCanCheckoutAndCancel(t *testing.T) {
	if err := CanCheckout(BookingAssigned, PaymentUnpaid, []string{ItemAssigned, ItemCancelled}); err != nil {
		t.Fatalf("checkout assigned: %v", err)
	}
	if err := CanCheckout(BookingUnassigned, PaymentUnpaid, []string{ItemAssigned, ItemUnassigned}); err == nil {
		t.Fatal("checkout with unassigned item must fail")
	}
	if err := CanCheckout(BookingCompleted, PaymentPaid, []string{ItemCompleted}); err == nil {
		t.Fatal("checkout paid must fail")
	}
	if err := CanCheckout(BookingCancelled, PaymentUnpaid, []string{ItemCancelled}); err == nil {
		t.Fatal("checkout cancelled must fail")
	}
	if err := CanCheckout(BookingAssigned, PaymentUnpaid, []string{ItemCancelled}); err == nil {
		t.Fatal("checkout without active items must fail")
	}
	if err := CanCancelBooking(BookingAssigned, false, []string{ItemAssigned}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if err := CanCancelBooking(BookingInTreatment, false, []string{ItemInTreatment}); err == nil {
		t.Fatal("cancel running must fail")
	}
	if err := CanCancelBooking(BookingCompleted, true, []string{ItemCompleted}); err == nil {
		t.Fatal("cancel paid must fail")
	}
	if err := CanEditItems(BookingAssigned, PaymentUnpaid, true); err == nil {
		t.Fatal("edit after checkout must fail")
	}
	if err := CanEditItems(BookingAssigned, PaymentUnpaid, false); err != nil {
		t.Fatalf("edit: %v", err)
	}
}

func TestIntervalOverlap(t *testing.T) {
	base := time.Date(2026, 10, 8, 3, 0, 0, 0, time.UTC) // 10:00 WIB
	a := ItemInterval(base, 60, 15)                      // 10:00–11:15
	cases := []struct {
		start time.Time
		dur   int
		want  bool
	}{
		{base.Add(75 * time.Minute), 60, false}, // starts exactly at buffer end
		{base.Add(74 * time.Minute), 60, true},
		{base.Add(-60 * time.Minute), 60, false}, // ends exactly at a.Start
		{base.Add(-59 * time.Minute), 60, true},
		{base.Add(30 * time.Minute), 10, true}, // inside
	}
	for _, c := range cases {
		b := ItemInterval(c.start, c.dur, 0)
		if got := a.Overlaps(b); got != c.want {
			t.Errorf("overlap(%v,%v) = %v, want %v", a, b, got, c.want)
		}
		if got := b.Overlaps(a); got != c.want {
			t.Errorf("overlap symmetric(%v,%v) = %v, want %v", b, a, got, c.want)
		}
	}
}

func TestWithinHours(t *testing.T) {
	at := func(h, m int) time.Time { return time.Date(2026, 10, 8, h, m, 0, 0, WIB) }
	if err := WithinHours(at(10, 0), 60, "10:00:00", "22:00:00"); err != nil {
		t.Fatalf("opening slot: %v", err)
	}
	if err := WithinHours(at(21, 0), 60, "10:00", "22:00"); err != nil {
		t.Fatalf("last slot: %v", err)
	}
	if err := WithinHours(at(21, 30), 60, "10:00", "22:00"); err == nil {
		t.Fatal("ends after close must fail")
	}
	if err := WithinHours(at(9, 30), 60, "10:00", "22:00"); err == nil {
		t.Fatal("before open must fail")
	}
}

func TestBoundsAndCodes(t *testing.T) {
	start, end, ok := DayBounds("2026-10-08")
	if !ok || start.UTC().Format(time.RFC3339) != "2026-10-07T17:00:00Z" || end.Sub(start) != 24*time.Hour {
		t.Fatalf("DayBounds = %v %v %v", start, end, ok)
	}
	if _, _, ok := RangeBounds("2026-10-09", "2026-10-08"); ok {
		t.Fatal("reversed range must fail")
	}
	ms, me, ok := MonthBounds("2026-02")
	if !ok || WIBDate(ms) != "2026-02-01" || WIBDate(me) != "2026-03-01" {
		t.Fatalf("MonthBounds = %v %v", ms, me)
	}
	if Weekday(time.Date(2026, 10, 11, 20, 0, 0, 0, time.UTC)) != 1 { // Sun 20:00 UTC = Mon 03:00 WIB
		t.Fatal("weekday must follow WIB")
	}
	code := BookingCode(time.Date(2026, 10, 7, 18, 0, 0, 0, time.UTC))
	if len(code) != 14 || code[:10] != "MZ-261008-" {
		t.Fatalf("BookingCode = %s", code)
	}
	if HHMM("09:05:00") != "09:05" {
		t.Fatal("HHMM")
	}
}

func TestResolveCommission(t *testing.T) {
	rules := []CommissionRule{
		{ID: "default", Type: CommissionPercent, Value: 10},
		{ID: "default-b1", BranchID: "b1", Type: CommissionPercent, Value: 12},
		{ID: "treat", TreatmentID: "t1", Type: CommissionFixed, Value: 30000},
		{ID: "treat-b2", TreatmentID: "t1", BranchID: "b2", Type: CommissionFixed, Value: 35000},
		{ID: "var", VariantID: "v90", Type: CommissionPercent, Value: 25},
		{ID: "var-b1", VariantID: "v90", BranchID: "b1", Type: CommissionPercent, Value: 30},
	}
	cases := []struct{ treatment, variant, branch, want string }{
		{"t1", "v90", "b1", "var-b1"},
		{"t1", "v90", "b2", "var"},
		{"t1", "v60", "b2", "treat-b2"},
		{"t1", "v60", "b1", "treat"},
		{"t2", "v30", "b1", "default-b1"},
		{"t2", "v30", "b3", "default"},
	}
	for _, c := range cases {
		got, ok := ResolveCommission(rules, c.treatment, c.variant, c.branch)
		if !ok || got.ID != c.want {
			t.Errorf("resolve(%s,%s,%s) = %s, want %s", c.treatment, c.variant, c.branch, got.ID, c.want)
		}
	}
	if _, ok := ResolveCommission(rules[2:4], "t9", "v9", "b1"); ok {
		t.Fatal("no default rule: must not match")
	}
	if CommissionAmount(CommissionRule{Type: CommissionPercent, Value: 12.5}, 250000) != 31250 {
		t.Fatal("percent amount")
	}
	if CommissionAmount(CommissionRule{Type: CommissionFixed, Value: 40000}, 250000) != 40000 {
		t.Fatal("fixed amount")
	}
	if !ShouldExpire(BookingAssigned, time.Unix(0, 0), time.Unix(0, 0).Add(3*time.Hour)) ||
		ShouldExpire(BookingInTreatment, time.Unix(0, 0), time.Unix(0, 0).Add(3*time.Hour)) ||
		ShouldExpire(BookingAssigned, time.Unix(0, 0), time.Unix(0, 0).Add(time.Hour)) {
		t.Fatal("ShouldExpire")
	}
}
