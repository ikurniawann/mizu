// Package domain holds the WhatsApp booking bot's pure logic: the session
// state a conversation carries between messages, the reading of a
// customer's reply (menu numbers, keywords, Indonesian dates and times) and
// the Indonesian reply templates. Nothing here touches the database or the
// network, so it is unit-tested directly. EPIC-053.
package domain

import "time"

// Steps of the booking conversation, in order. A step is "the next thing
// the bot needs"; a message may fill several steps at once.
const (
	StepOutlet    = "outlet"
	StepPeople    = "people"
	StepTreatment = "treatment"
	StepDate      = "date"
	StepTime      = "time"
	StepTherapist = "therapist"
	StepName      = "name"
	StepConfirm   = "confirm"
	StepPayment   = "payment"
	StepDone      = "done"
)

// MaxPeople is the most guests one chat booking covers (also the public
// per-phone open-booking cap).
const MaxPeople = 3

// MaxMisses is how many consecutive non-understood replies the bot allows
// before it hands the conversation to an agent.
const MaxMisses = 3

// VariantOpt is one bookable treatment variant of the chosen outlet (the
// menu the bot offers and the vocabulary the extractor matches against).
type VariantOpt struct {
	VariantID   string  `json:"variant_id"`
	Treatment   string  `json:"treatment"`
	Variant     string  `json:"variant"`
	Category    string  `json:"category"`
	DurationMin int     `json:"duration_min"`
	Price       float64 `json:"price"`
}

// Label is "Balinese Massage · 60 menit".
func (v VariantOpt) Label() string { return v.Treatment + " · " + v.Variant }

// Person is one guest's chosen variant. SlotISO is set only when the group
// is staggered (this guest starts at a different time than the first).
type Person struct {
	VariantID   string  `json:"variant_id"`
	Label       string  `json:"label"`
	DurationMin int     `json:"duration_min"`
	Price       float64 `json:"price"`
	SlotISO     string  `json:"slot_iso,omitempty"`
}

// MenuOption is one numbered choice the bot last offered; Value carries
// the id / ISO time / enum the choice stands for.
type MenuOption struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Value string `json:"value"`
}

// BookingRef is a booking the bot created in this conversation. When is the
// start clock ("15.00"), shown when guests are staggered.
type BookingRef struct {
	Code      string `json:"code"`
	Token     string `json:"token"`
	StatusURL string `json:"status_url"`
	PayURL    string `json:"pay_url,omitempty"`
	Customer  string `json:"customer"`
	Paid      bool   `json:"paid,omitempty"`
	When      string `json:"when,omitempty"`
}

// OutletOpt is an outlet open for online booking.
type OutletOpt struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	OpenTime  string `json:"open_time"`
	CloseTime string `json:"close_time"`
}

// Session is the state stored per conversation (crm.wa_bot_sessions.state).
type Session struct {
	Step          string       `json:"step"`
	Outlets       []OutletOpt  `json:"outlets,omitempty"`
	OutletID      string       `json:"outlet_id,omitempty"`
	OutletName    string       `json:"outlet_name,omitempty"`
	Catalog       []VariantOpt `json:"catalog,omitempty"`
	People        int          `json:"people,omitempty"`
	Persons       []Person     `json:"persons,omitempty"`
	Date          string       `json:"date,omitempty"`
	Period        string       `json:"period,omitempty"` // pagi|siang|sore|malam
	WantedTime    string       `json:"wanted_time,omitempty"`
	SlotISO       string       `json:"slot_iso,omitempty"`
	Pref          string       `json:"pref,omitempty"` // any|male|female
	TherapistID   string       `json:"therapist_id,omitempty"`
	TherapistName string       `json:"therapist_name,omitempty"`
	SystemPick    bool         `json:"system_pick,omitempty"`
	Name          string       `json:"name,omitempty"`
	PayMethod     string       `json:"pay_method,omitempty"`
	Bookings      []BookingRef `json:"bookings,omitempty"`
	Menu          []MenuOption `json:"menu,omitempty"`
	MenuStep      string       `json:"menu_step,omitempty"`
	Misses        int          `json:"misses,omitempty"`
	OnlinePay     bool         `json:"online_pay,omitempty"`
	Greeted       bool         `json:"greeted,omitempty"`
	// WaitlistID is the guest's open waitlist entry; FromWaitlist marks a
	// session the watcher refilled after telling the guest a slot is free.
	WaitlistID   string `json:"waitlist_id,omitempty"`
	FromWaitlist bool   `json:"from_waitlist,omitempty"`
	// PendingTreatments were named before the outlet was known.
	PendingTreatments []string `json:"pending_treatments,omitempty"`
}

// NewSession starts at the outlet step.
func NewSession() *Session { return &Session{Step: StepOutlet, Pref: "any"} }

// ResetBooking keeps what identifies the guest and starts a new booking.
func (s *Session) ResetBooking() {
	name, wl := s.Name, s.WaitlistID
	*s = Session{Step: StepOutlet, Pref: "any", Name: name, Greeted: true, WaitlistID: wl}
}

// Staggered reports whether some guest starts at another time than the first.
func (s *Session) Staggered() bool {
	for _, p := range s.Persons {
		if p.SlotISO != "" && p.SlotISO != s.SlotISO {
			return true
		}
	}
	return false
}

// SlotOf is guest i's start (their own, else the common one).
func (s *Session) SlotOf(i int) string {
	if i < len(s.Persons) && s.Persons[i].SlotISO != "" {
		return s.Persons[i].SlotISO
	}
	return s.SlotISO
}

// ClearSlot forgets the chosen time(s).
func (s *Session) ClearSlot() {
	s.SlotISO = ""
	for i := range s.Persons {
		s.Persons[i].SlotISO = ""
	}
}

// SetMenu remembers the numbered options the bot just offered.
func (s *Session) SetMenu(step string, options []MenuOption) {
	s.MenuStep, s.Menu = step, options
}

// ClearMenu forgets the last menu (a free-text prompt is pending).
func (s *Session) ClearMenu() { s.MenuStep, s.Menu = "", nil }

// NextStep is the first step still missing data; StepDone when none.
func (s *Session) NextStep() string {
	switch {
	case s.OutletID == "":
		return StepOutlet
	case s.People == 0:
		return StepPeople
	case len(s.Persons) < s.People:
		return StepTreatment
	case s.Date == "":
		return StepDate
	case s.SlotISO == "":
		return StepTime
	case s.People == 1 && s.TherapistID == "" && !s.SystemPick:
		return StepTherapist
	case s.Name == "":
		return StepName
	case len(s.Bookings) == 0:
		return StepConfirm
	case s.PayMethod == "":
		return StepPayment
	}
	return StepDone
}

// TotalPrice and TotalDuration sum the chosen variants.
func (s *Session) TotalPrice() float64 {
	t := 0.0
	for _, p := range s.Persons {
		t += p.Price
	}
	return t
}

func (s *Session) TotalDuration() int {
	d := 0
	for _, p := range s.Persons {
		if p.DurationMin > d {
			d = p.DurationMin
		}
	}
	return d
}

// VariantIDs of the first guest (the slot search is per therapist; every
// guest needs their own therapist at the same time).
func (s *Session) FirstVariantIDs() []string {
	if len(s.Persons) == 0 {
		return nil
	}
	return []string{s.Persons[0].VariantID}
}

// Slot is an offered start time.
type Slot struct {
	ISO  string
	At   time.Time
	Free int // therapists free (0 = unknown / not checked)
}
