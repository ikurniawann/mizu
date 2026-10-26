package domain

import "testing"

func TestCanChangeRoom(t *testing.T) {
	for _, status := range append(append([]string{}, BookingStatuses...), "unknown") {
		for _, checkedOut := range []bool{false, true} {
			for _, releasing := range []bool{false, true} {
				allowed := !checkedOut && (status == BookingUnassigned || status == BookingAssigned || (status == BookingInTreatment && !releasing))
				if err := CanChangeRoom(status, checkedOut, releasing); (err == nil) != allowed {
					t.Errorf("status=%s checkedOut=%v releasing=%v: %v", status, checkedOut, releasing, err)
				}
			}
		}
	}
}
