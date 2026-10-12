// Package wabot is the WhatsApp booking chatbot (EPIC-053): it answers a
// customer's WhatsApp messages with the spa's real outlets, treatments,
// free slots and therapists, creates the booking after an explicit yes and
// hands the conversation to an agent when asked or when lost. The bot only
// understands; every figure in a reply comes from the spa service.
package wabot

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/modules/wabot/domain"
	"nuhabit/backend/internal/platform/database"
)

// Spa is the public booking surface the bot drives (the same rules as the
// website's /api/public/spa).
type Spa interface {
	Outlets(ctx context.Context) ([]spa.PublicOutlet, error)
	Treatments(ctx context.Context, branchID string) ([]spa.PublicTreatment, error)
	Slots(ctx context.Context, branchID, date string, variantIDs []string, pref string) ([]spa.PublicSlot, error)
	Therapists(ctx context.Context, branchID string, startsAt time.Time, variantIDs []string, pref string) ([]spa.PublicTherapist, error)
	Book(ctx context.Context, in spa.PublicBookingInput) (*spa.PublicBookingResult, error)
	Pay(ctx context.Context, token string) (*spa.PublicPayment, error)
	Booking(ctx context.Context, token string) (*spa.PublicBookingResult, error)
	// OnlinePayment reports whether Xendit payment links can be made.
	OnlinePayment() bool
}

// Sender delivers one bot reply to the customer and logs it on the
// conversation (message_type "bot").
type Sender interface {
	Send(ctx context.Context, db database.DB, phone, conversationID, text string) error
}

// Recorder stores a customer message on its conversation (the simulator's
// stand-in for the gateway webhook).
type Recorder interface {
	RecordInbound(ctx context.Context, db database.DB, phone, pushName, text string, at time.Time) (conversationID string, err error)
}

// Extraction is what the language model reads out of a free-text message.
// Every field is optional; the engine applies what it can.
type Extraction struct {
	Outlet     string   `json:"outlet"`
	People     int      `json:"people"`
	Treatments []string `json:"treatments"`
	Date       string   `json:"date"`
	Time       string   `json:"time"`
	Period     string   `json:"period"`
	Therapist  string   `json:"therapist"`
	GenderPref string   `json:"gender_pref"`
	SystemPick bool     `json:"system_pick"`
	Confirm    string   `json:"confirm"`
	Payment    string   `json:"payment"`
	Name       string   `json:"name"`
	WantAdmin  bool     `json:"want_admin"`
	OffTopic   bool     `json:"off_topic"`
}

// ExtractContext is what the model is told about the conversation.
type ExtractContext struct {
	Today      string // YYYY-MM-DD (WIB)
	Step       string
	Outlets    []string
	Treatments []string
	Therapists []string
	People     int
}

// Extractor turns a free-text message into an Extraction. A nil Extractor
// means menu-only mode.
type Extractor interface {
	Extract(ctx context.Context, q database.Querier, text string, ec ExtractContext) (*Extraction, error)
}

// Ports are what wabot needs from other contexts.
type Ports struct {
	Spa       Spa
	Sender    Sender
	Recorder  Recorder
	Extractor Extractor // optional
	// AppURL is the public site origin for status links.
	AppURL string
}

// Settings are the bot's crm_settings keys.
type Settings struct {
	Enabled          bool
	Name             string
	Greeting         string
	HandoverKeywords []string
}

// Conversation is the inbox row the bot reads.
type Conversation struct {
	ID             string
	Phone          string
	DisplayName    string
	BotActive      bool
	HandoverAt     *time.Time
	HandoverReason string
}

// SessionView is the inbox's read of a bot session.
type SessionView struct {
	Active         bool                `json:"active"`
	HandoverAt     *time.Time          `json:"handover_at"`
	HandoverReason string              `json:"handover_reason"`
	Step           string              `json:"step"`
	Summary        []string            `json:"summary"`
	Bookings       []domain.BookingRef `json:"bookings"`
	LastBotAt      *time.Time          `json:"last_bot_at"`
	LastLatencyMs  *int                `json:"last_latency_ms"`
}
