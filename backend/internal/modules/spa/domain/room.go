package domain

// CanChangeRoom is deliberately stricter than IsOpenBooking: a completed
// treatment cannot move, even when the guest has not reached the cashier.
func CanChangeRoom(status string, checkedOut, releasing bool) error {
	if checkedOut {
		return rule("Booking sudah dikirim ke kasir; room tidak bisa diubah")
	}
	switch status {
	case BookingUnassigned, BookingAssigned:
		return nil
	case BookingInTreatment:
		if !releasing {
			return nil
		}
		return rule("Treatment sedang berjalan; pilih room tujuan, bukan tanpa room")
	default:
		return rule("Booking sudah %s; room tidak bisa diubah", BookingLabel(status))
	}
}
