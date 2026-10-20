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
	StepLang      = "lang"
	StepOutlet    = "outlet"
	StepPeople    = "people"
	StepTreatment = "treatment"
	StepDate      = "date"
	StepTime      = "time"
	StepTherapist = "therapist"
	StepRoom      = "room"
	StepName      = "name"
	StepConfirm   = "confirm"
	StepPayment   = "payment"
	StepDone      = "done"
)

// MaxPeople is the most guests one chat booking covers (a group/rombongan;
// spa.MaxPublicGroup). Larger parties are arranged by an admin.
const MaxPeople = 10

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
	// Deposit (DP) that holds the slot: amount, status, link and deadline.
	DepositIDR    float64 `json:"deposit_idr,omitempty"`
	DepositStatus string  `json:"deposit_status,omitempty"`
	DepositURL    string  `json:"deposit_url,omitempty"`
	DepositUntil  string  `json:"deposit_until,omitempty"` // "17.30"
}

// NeedsDeposit: at least one booking still waits for its DP.
func (s *Session) NeedsDeposit() bool {
	for _, b := range s.Bookings {
		if b.DepositStatus == "pending" {
			return true
		}
	}
	return false
}

// DepositTotal sums the pending/paid deposits of the bookings.
func (s *Session) DepositTotal() float64 {
	t := 0.0
	for _, b := range s.Bookings {
		if b.DepositStatus == "pending" || b.DepositStatus == "paid" {
			t += b.DepositIDR
		}
	}
	return t
}

// OutletOpt is an outlet open for online booking.
type OutletOpt struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	OpenTime  string `json:"open_time"`
	CloseTime string `json:"close_time"`
	Address   string `json:"address,omitempty"`
	City      string `json:"city,omitempty"`
	Phone     string `json:"phone,omitempty"`
	// LastOrder is the latest start ("20:30"); "" = treatments end by close.
	LastOrder   string `json:"last_order,omitempty"`
	Description string `json:"description,omitempty"`
}

// Session is the state stored per conversation (crm.wa_bot_sessions.state).
type Session struct {
	Step          string       `json:"step"`
	Lang          L            `json:"lang,omitempty"`
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
	// PendingTreatments were named before the outlet was known; PendingAll
	// says they are for every guest ("semua thai massage").
	PendingTreatments []string `json:"pending_treatments,omitempty"`
	PendingAll        bool     `json:"pending_all,omitempty"`
	// Room the guest chose (revisi R6): RoomDone once answered or skipped
	// (no room free); RoomAsked when the menu was actually shown. RoomPrice
	// is charged once for the party.
	RoomID    string  `json:"room_id,omitempty"`
	RoomName  string  `json:"room_name,omitempty"`
	RoomPrice float64 `json:"room_price,omitempty"`
	RoomDone  bool    `json:"room_done,omitempty"`
	RoomAsked bool    `json:"room_asked,omitempty"`
	// Gift is a gift voucher being bought in this chat (kept across bookings
	// until its code is sent).
	Gift *GiftDraft `json:"gift,omitempty"`
}

// NewSession starts at the outlet step.
func NewSession() *Session { return &Session{Step: StepLang, Pref: "any"} }

// ResetBooking keeps what identifies the guest (language, name) and starts
// a new booking.
func (s *Session) ResetBooking() {
	name, wl, lang, gift := s.Name, s.WaitlistID, s.Lang, s.Gift
	*s = Session{Step: StepLang, Pref: "any", Name: name, Greeted: true, WaitlistID: wl, Lang: lang}
	if gift.AwaitingPayment() {
		s.Gift = gift // the link sent stays checkable
	}
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

// ClearSlot forgets the chosen time(s) and the room (it depends on the time).
func (s *Session) ClearSlot() {
	s.SlotISO = ""
	for i := range s.Persons {
		s.Persons[i].SlotISO = ""
	}
	s.ClearRoom()
}

// ClearRoom forgets the room choice so the room step asks again.
func (s *Session) ClearRoom() {
	s.RoomID, s.RoomName, s.RoomPrice, s.RoomDone, s.RoomAsked = "", "", 0, false, false
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
	case s.Lang == "":
		return StepLang
	case s.Name == "":
		return StepName
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
	case len(s.Bookings) == 0 && !s.RoomDone:
		return StepRoom
	case len(s.Bookings) == 0:
		return StepConfirm
	case s.PayMethod == "":
		return StepPayment
	}
	return StepDone
}

// TotalPrice is what the guest pays: the chosen variants plus the room
// (once); TotalDuration is the longest treatment.
func (s *Session) TotalPrice() float64 {
	t := s.RoomPrice
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

// Back forgets the most recent choice so the previous question is asked
// again; false when there is nothing to go back to (nothing chosen yet, or
// bookings already made).
func (s *Session) Back() bool {
	switch s.NextStep() {
	case StepLang, StepName, StepPayment, StepDone:
		return false
	case StepOutlet:
		return false
	case StepPeople:
		if len(s.Outlets) <= 1 {
			return false // the only outlet is picked automatically: nothing before this
		}
		s.OutletID, s.OutletName, s.Catalog = "", "", nil
	case StepTreatment:
		if len(s.Persons) > 0 {
			s.Persons = s.Persons[:len(s.Persons)-1]
		} else {
			s.People = 0
		}
	case StepDate:
		s.Persons = s.Persons[:len(s.Persons)-1] // re-ask the last guest's treatment
	case StepTime:
		s.Date, s.Period, s.WantedTime = "", "", ""
	case StepTherapist:
		s.ClearSlot()
	case StepRoom:
		if s.People == 1 && (s.TherapistID != "" || s.SystemPick) {
			s.TherapistID, s.TherapistName, s.SystemPick = "", "", false
		} else {
			s.ClearSlot()
		}
	case StepConfirm:
		if s.RoomAsked {
			s.ClearRoom()
		} else if s.People == 1 && (s.TherapistID != "" || s.SystemPick) {
			s.TherapistID, s.TherapistName, s.SystemPick = "", "", false
		} else {
			s.ClearSlot()
		}
	}
	s.ClearMenu()
	return true
}
