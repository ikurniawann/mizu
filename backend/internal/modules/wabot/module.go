package wabot

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/wabot/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Name is the MODULES key.
const Name = "wabot"

type wabotModule struct{ routes []module.Route }

func (wabotModule) Name() string             { return Name }
func (m wabotModule) Routes() []module.Route { return m.routes }

// Handler serves /api/wa-bot for the inbox (session view, bot on/off) and
// the staff simulator.
type Handler struct {
	engine *Engine
	db     database.DB
	auth   *auth.Service
	now    func() time.Time
}

// New mounts the module on the shared pool.
func New(deps module.Deps, ports Ports) module.Module {
	engine := NewEngine(ports, deps.Log, deps.Now)
	if ports.Spa != nil && ports.Sender != nil {
		// Watcher: waitlist (slot freed) and visit reminders.
		go engine.Watch(context.Background(), deps.DB, WaitlistEvery)
		// Payment confirmations ride the outbox.
		engine.Subscribe(deps.Events, deps.DB)
	}
	h := &Handler{engine: engine, db: deps.DB, auth: deps.Auth, now: deps.Now}
	if h.now == nil {
		h.now = time.Now
	}
	return wabotModule{routes: h.Routes()}
}

// Engine exposes the engine for the webhook adapter.
func (h *Handler) Engine() *Engine { return h.engine }

type staffFunc func(w http.ResponseWriter, r *http.Request, user *auth.User) error

// Routes lists the module's routes (inbox menu permission).
func (h *Handler) Routes() []module.Route {
	staff := func(pattern string, fn staffFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			user, err := h.auth.RequireMenuPrefix(r, iam.CrmInbox...)
			if err != nil {
				return err
			}
			return fn(w, r, user)
		})}
	}
	return []module.Route{
		staff("GET /api/wa-bot/conversations/{id}", h.session),
		staff("POST /api/wa-bot/conversations/{id}/bot", h.toggle),
		staff("POST /api/wa-bot/simulate", h.simulate),
	}
}

func (h *Handler) view(ctx context.Context, conversationID string) (*SessionView, error) {
	conv, err := h.engine.st.conversation(ctx, h.db, conversationID)
	if err != nil {
		return nil, err
	}
	if conv == nil {
		return nil, httpx.NotFound("Percakapan tidak ditemukan")
	}
	v := &SessionView{Active: conv.BotActive, HandoverAt: conv.HandoverAt, HandoverReason: conv.HandoverReason, Summary: []string{}, Bookings: []domain.BookingRef{}}
	row, err := h.engine.st.session(ctx, h.db, conversationID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return v, nil
	}
	s := row.Session
	v.Step, v.LastBotAt, v.LastLatencyMs = s.NextStep(), row.LastBotAt, row.LatencyMs
	if s.OutletName != "" {
		v.Summary = append(v.Summary, "Toko: "+s.OutletName)
	}
	if s.People > 0 {
		v.Summary = append(v.Summary, strings.TrimSpace(strings.Repeat(" ", 0)+itoa(s.People)+" orang"))
	}
	for _, p := range s.Persons {
		v.Summary = append(v.Summary, "Layanan: "+p.Label+" — "+domain.Rupiah(p.Price))
	}
	if s.Date != "" {
		line := "Tanggal: " + domain.LongDate(domain.LangID, s.Date)
		if s.SlotISO != "" {
			if at, err := domain.ParseISO(s.SlotISO); err == nil {
				line += " " + domain.Clock(at) + " WIB"
			}
		}
		v.Summary = append(v.Summary, line)
	}
	switch {
	case s.TherapistName != "":
		v.Summary = append(v.Summary, "Crew: "+s.TherapistName)
	case s.SystemPick:
		v.Summary = append(v.Summary, "Crew: dipilihkan Paddy")
	}
	if s.Name != "" {
		v.Summary = append(v.Summary, "Nama: "+s.Name)
	}
	if s.PayMethod != "" {
		v.Summary = append(v.Summary, "Bayar: "+s.PayMethod)
	}
	if s.Bookings != nil {
		v.Bookings = s.Bookings
	}
	return v, nil
}

func (h *Handler) session(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return httpx.NotFound("Percakapan tidak ditemukan")
	}
	v, err := h.view(r.Context(), id)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, v)
}

// toggle turns the bot on or off for one conversation (an agent's call).
func (h *Handler) toggle(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return httpx.NotFound("Percakapan tidak ditemukan")
	}
	body, present := validate.ReadBody(r)
	f := validate.New(body, present)
	active := f.Bool("active", validate.Rule{})
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	ctx := r.Context()
	var err error
	if active != nil && *active {
		err = h.engine.st.resume(ctx, h.db, id)
	} else {
		err = h.engine.st.handover(ctx, h.db, id, "agent:"+user.ID, h.now())
	}
	if err != nil {
		return err
	}
	v, err := h.view(ctx, id)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, v)
}

// simulate feeds one customer message as if it came from WhatsApp and
// returns the bot's replies; nothing is sent, replies are logged as
// provider "simulasi". `reset` clears the phone's bot session first.
func (h *Handler) simulate(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	body, present := validate.ReadBody(r)
	f := validate.New(body, present)
	phone := f.Str("phone", validate.Rule{}, validate.StrOpts{Trim: true, Min: 8, Max: 20})
	text := f.Str("text", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 1000})
	name := f.StrDefault("name", "", validate.StrOpts{Trim: true, Max: 60})
	reset := f.BoolDefault("reset", false)
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	if h.engine.ports.Recorder == nil {
		return httpx.Status(http.StatusServiceUnavailable, "Simulator belum tersambung ke inbox")
	}
	ctx, at := r.Context(), h.now()
	digits := strings.Map(func(c rune) rune {
		if c >= '0' && c <= '9' {
			return c
		}
		return -1
	}, *phone)
	if strings.HasPrefix(digits, "0") {
		digits = "62" + digits[1:]
	}
	conversationID, err := h.engine.ports.Recorder.RecordInbound(ctx, h.db, digits, name, *text, at)
	if err != nil {
		return err
	}
	if reset {
		if err := h.engine.st.deleteSession(ctx, h.db, conversationID); err != nil {
			return err
		}
		if err := h.engine.st.resume(ctx, h.db, conversationID); err != nil {
			return err
		}
	}
	rec := &recordingSender{st: h.engine.st, at: at}
	handled, err := h.engine.Handle(ctx, h.db, conversationID, *text, at, rec)
	if err != nil {
		return err
	}
	v, err := h.view(ctx, conversationID)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		ConversationID string       `json:"conversation_id"`
		Handled        bool         `json:"handled"`
		Replies        []string     `json:"replies"`
		Session        *SessionView `json:"session"`
		SimulatedBy    string       `json:"simulated_by"`
	}{conversationID, handled, rec.replies, v, user.ID})
}

// recordingSender logs replies instead of sending them.
type recordingSender struct {
	st      store
	at      time.Time
	replies []string
}

func (r *recordingSender) Send(ctx context.Context, db database.DB, phone, conversationID, text string) error {
	r.replies = append(r.replies, text)
	return r.st.recordBotMessage(ctx, db, conversationID, phone, text, r.at)
}

func itoa(n int) string { return strconv.Itoa(n) }
