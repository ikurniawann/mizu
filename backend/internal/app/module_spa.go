package app

import (
	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/platform/module"
)

// spa (Mizu): outlets, treatments, therapists, bookings with checkout into a
// POS open bill, and therapist commissions (EPIC-052).
func init() {
	Register(spa.Name, func(deps module.Deps) module.Module {
		return spa.New(deps, SpaPorts())
	})
}
