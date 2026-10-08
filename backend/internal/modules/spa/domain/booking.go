// Package domain holds the pure spa rules: the treatment item state machine,
// the booking status derived from its items, therapist time overlap, outlet
// opening hours, and commission resolution. No database, no HTTP.
package domain

import (
	"fmt"
	"time"
)

// Item statuses (spa.booking_items.status).
const (
	ItemUnassigned  = "unassigned"
	ItemAssigned    = "assigned"
	ItemInTreatment = "in_treatment"
	ItemCompleted   = "completed"
	ItemCancelled   = "cancelled"
)

// Booking statuses (spa.bookings.status). Expired is only set by the sweep.
const (
	BookingUnassigned  = "unassigned"
	BookingAssigned    = "assigned"
	BookingInTreatment = "in_treatment"
	BookingCompleted   = "completed"
	BookingCancelled   = "cancelled"
	BookingExpired     = "expired"
)

// Payment statuses (spa.bookings.payment_status).
const (
	PaymentUnpaid = "unpaid"
	PaymentPaid   = "paid"
	PaymentVoid   = "void"
)

// BookingStatuses lists every booking status, for filters.
var BookingStatuses = []string{BookingUnassigned, BookingAssigned, BookingInTreatment, BookingCompleted, BookingCancelled, BookingExpired}

// PaymentStatuses lists every payment status, for filters.
var PaymentStatuses = []string{PaymentUnpaid, PaymentPaid, PaymentVoid}

// ExpireGrace is how long after the last item's end an untouched booking
// (unassigned/assigned) stays open before the sweep marks it expired.
const ExpireGrace = 2 * time.Hour

// Actor says who asks for an item transition: front office staff may
// override (complete without start), a therapist may only start/complete
// their own items in order.
type Actor int

const (
	ActorStaff Actor = iota
	ActorTherapist
)

// Item actions.
const (
	ActionAssign     = "assign"
	ActionUnassign   = "unassign"
	ActionStart      = "start"
	ActionComplete   = "complete"
	ActionCancel     = "cancel"
	ActionReschedule = "reschedule"
)

// ItemActions lists the actions of PATCH .../items/{itemId}.
var ItemActions = []string{ActionAssign, ActionUnassign, ActionStart, ActionComplete, ActionCancel, ActionReschedule}

// RuleError is a business rule violation; the HTTP layer maps it to 409.
type RuleError struct{ Msg string }

func (e *RuleError) Error() string { return e.Msg }

func rule(format string, a ...any) error { return &RuleError{Msg: fmt.Sprintf(format, a...)} }

// IsActiveItem reports whether an item still occupies its therapist.
func IsActiveItem(status string) bool { return status == ItemAssigned || status == ItemInTreatment }

// IsOpenBooking reports whether a booking can still change.
func IsOpenBooking(status string) bool {
	return status != BookingCancelled && status != BookingExpired
}

// NextItemStatus validates action on an item in status from and returns the
// new status. bookingStatus and paid guard edits of closed or paid bookings.
func NextItemStatus(action, from, bookingStatus string, paid bool, actor Actor) (string, error) {
	if !IsOpenBooking(bookingStatus) {
		return "", rule("Booking sudah %s, tidak bisa diubah", BookingLabel(bookingStatus))
	}
	switch action {
	case ActionAssign:
		if from != ItemUnassigned && from != ItemAssigned {
			return "", rule("Terapis hanya bisa diganti sebelum treatment dimulai")
		}
		return ItemAssigned, nil
	case ActionUnassign:
		if from != ItemAssigned {
			return "", rule("Treatment belum ditugaskan atau sudah berjalan")
		}
		return ItemUnassigned, nil
	case ActionStart:
		if from != ItemAssigned {
			if from == ItemUnassigned {
				return "", rule("Tugaskan terapis sebelum memulai treatment")
			}
			return "", rule("Treatment sudah %s", ItemLabel(from))
		}
		return ItemInTreatment, nil
	case ActionComplete:
		switch {
		case from == ItemInTreatment:
			return ItemCompleted, nil
		case from == ItemAssigned && actor == ActorStaff:
			return ItemCompleted, nil
		case from == ItemAssigned:
			return "", rule("Mulai treatment terlebih dahulu")
		case from == ItemUnassigned:
			return "", rule("Tugaskan terapis sebelum menyelesaikan treatment")
		}
		return "", rule("Treatment sudah %s", ItemLabel(from))
	case ActionCancel:
		if paid {
			return "", rule("Booking sudah dibayar, treatment tidak bisa dibatalkan")
		}
		if from != ItemUnassigned && from != ItemAssigned {
			return "", rule("Treatment yang sudah dimulai tidak bisa dibatalkan")
		}
		return ItemCancelled, nil
	case ActionReschedule:
		if from != ItemUnassigned && from != ItemAssigned {
			return "", rule("Jadwal hanya bisa diubah sebelum treatment dimulai")
		}
		return from, nil
	}
	return "", rule("Aksi tidak dikenal: %s", action)
}

// DeriveBookingStatus computes the booking status from its item statuses.
// current keeps cancelled/expired sticky.
func DeriveBookingStatus(current string, items []string) string {
	if current == BookingCancelled || current == BookingExpired {
		return current
	}
	active, completed, unassigned, inTreatment := 0, 0, 0, 0
	for _, s := range items {
		if s == ItemCancelled {
			continue
		}
		active++
		switch s {
		case ItemCompleted:
			completed++
		case ItemUnassigned:
			unassigned++
		case ItemInTreatment:
			inTreatment++
		}
	}
	switch {
	case active == 0:
		return BookingCancelled
	case inTreatment > 0:
		return BookingInTreatment
	case completed == active:
		return BookingCompleted
	case unassigned > 0:
		return BookingUnassigned
	}
	return BookingAssigned
}

// CanCancelBooking checks a whole-booking cancel.
func CanCancelBooking(status string, paid bool, items []string) error {
	if !IsOpenBooking(status) {
		return rule("Booking sudah %s", BookingLabel(status))
	}
	if paid {
		return rule("Booking sudah dibayar, tidak bisa dibatalkan")
	}
	for _, s := range items {
		if s == ItemInTreatment || s == ItemCompleted {
			return rule("Ada treatment yang sudah dimulai, booking tidak bisa dibatalkan")
		}
	}
	return nil
}

// CanCheckout checks that a booking may be sent to the cashier.
func CanCheckout(status, payment string, items []string) error {
	if !IsOpenBooking(status) {
		return rule("Booking sudah %s, tidak bisa checkout", BookingLabel(status))
	}
	if payment == PaymentPaid {
		return rule("Booking sudah dibayar")
	}
	active := 0
	for _, s := range items {
		if s == ItemCancelled {
			continue
		}
		active++
		if s == ItemUnassigned {
			return rule("Masih ada treatment yang belum ditugaskan ke terapis")
		}
	}
	if active == 0 {
		return rule("Booking tidak memiliki treatment aktif")
	}
	return nil
}

// CanEditItems reports whether treatments may still be added: not after the
// bill went to the cashier.
func CanEditItems(status, payment string, checkedOut bool) error {
	if !IsOpenBooking(status) {
		return rule("Booking sudah %s", BookingLabel(status))
	}
	if payment == PaymentPaid {
		return rule("Booking sudah dibayar")
	}
	if checkedOut {
		return rule("Booking sudah dikirim ke kasir; batalkan tagihan di POS untuk mengubah treatment")
	}
	return nil
}

// ShouldExpire reports whether the sweep may expire a booking whose last
// item ends at lastEnd.
func ShouldExpire(status string, lastEnd, now time.Time) bool {
	return (status == BookingUnassigned || status == BookingAssigned) && now.After(lastEnd.Add(ExpireGrace))
}

// BookingLabel is the Indonesian label of a booking status.
func BookingLabel(s string) string {
	switch s {
	case BookingUnassigned:
		return "belum ditugaskan"
	case BookingAssigned:
		return "ditugaskan"
	case BookingInTreatment:
		return "berjalan"
	case BookingCompleted:
		return "selesai"
	case BookingCancelled:
		return "dibatalkan"
	case BookingExpired:
		return "kedaluwarsa"
	}
	return s
}

// ItemLabel is the Indonesian label of an item status.
func ItemLabel(s string) string {
	switch s {
	case ItemUnassigned:
		return "belum ditugaskan"
	case ItemAssigned:
		return "ditugaskan"
	case ItemInTreatment:
		return "berjalan"
	case ItemCompleted:
		return "selesai"
	case ItemCancelled:
		return "dibatalkan"
	}
	return s
}
