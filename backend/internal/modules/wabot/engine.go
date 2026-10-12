package wabot

import (
	"context"
	"errors"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/modules/wabot/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Engine runs one bot turn per customer message.
type Engine struct {
	ports Ports
	st    store
	log   *slog.Logger
	now   func() time.Time
}

// NewEngine builds the engine; deps.Now may be nil.
func NewEngine(ports Ports, log *slog.Logger, now func() time.Time) *Engine {
	if log == nil {
		log = slog.Default()
	}
	if now == nil {
		now = time.Now
	}
	return &Engine{ports: ports, log: log, now: now}
}

// Handle answers one customer message. handled=false means the bot does
// not own this conversation (disabled, taken over by an agent, no phone),
// so the usual CS rules apply instead.
func (e *Engine) Handle(ctx context.Context, db database.DB, conversationID, text string, at time.Time, sender Sender) (bool, error) {
	started := time.Now()
	settings, err := e.st.settings(ctx, db)
	if err != nil || !settings.Enabled {
		return false, err
	}
	conv, err := e.st.conversation(ctx, db, conversationID)
	if err != nil || conv == nil || conv.Phone == "" {
		return false, err
	}
	if conv.HandoverAt != nil && !conv.BotActive {
		return false, nil
	}
	if !conv.BotActive {
		if err := e.st.activate(ctx, db, conv.ID); err != nil {
			return false, err
		}
	}
	row, err := e.st.session(ctx, db, conv.ID)
	if err != nil {
		return false, err
	}
	sess := domain.NewSession()
	if row != nil {
		sess = row.Session
	}
	t := &turn{e: e, db: db, conv: conv, sess: sess, settings: settings, at: at}
	replies := t.run(ctx, text)
	if sender == nil {
		sender = e.ports.Sender
	}
	for _, r := range replies {
		if err := sender.Send(ctx, db, conv.Phone, conv.ID, r); err != nil {
			e.log.Error("[wabot] balasan gagal dikirim", "conversation", conv.ID, "error", err)
		}
	}
	if t.handedOver != "" {
		if err := e.st.handover(ctx, db, conv.ID, t.handedOver, at); err != nil {
			return true, err
		}
	}
	if err := e.st.saveSession(ctx, db, conv.ID, conv.Phone, sess, at, e.now(), time.Since(started)); err != nil {
		return true, err
	}
	return true, e.st.afterBotReply(ctx, db, conv.ID)
}

// turn is the work of one message.
type turn struct {
	e          *Engine
	db         database.DB
	conv       *Conversation
	sess       *domain.Session
	settings   Settings
	at         time.Time
	handedOver string
	justBooked bool
	// failure is a refusal (full slot, taken therapist) shown before the next prompt.
	failure string
}

func (t *turn) run(ctx context.Context, text string) []string {
	s := t.sess
	var out []string
	greet := func() {
		if !s.Greeted {
			s.Greeted = true
			out = append(out, domain.Greeting(t.settings.Name, t.settings.Greeting))
		}
	}
	intent := domain.DetectIntent(text, t.settings.HandoverKeywords)
	switch intent {
	case domain.IntentAdmin:
		t.handedOver = "customer"
		return []string{domain.Handover(t.settings.Name)}
	case domain.IntentRestart:
		s.ResetBooking()
		return append(out, t.prompt(ctx)...)
	case domain.IntentStatus:
		return []string{domain.StatusOf(s.Bookings)}
	case domain.IntentHelp:
		greet()
		return append(out, t.prompt(ctx)...)
	}
	if s.NextStep() == domain.StepDone {
		n := domain.Normalize(text)
		if strings.Contains(n, "bayar") || strings.Contains(n, "lunas") || strings.Contains(n, "transfer") {
			return []string{t.paymentCheck(ctx)}
		}
		if intent == domain.IntentGreeting || intent == domain.IntentYes {
			return []string{domain.Done(t.settings.Name)}
		}
		// Anything else after a finished booking: let the AI decide if it is a new booking.
		if ext := t.extract(ctx, text); ext != nil && (ext.Outlet != "" || ext.Date != "" || len(ext.Treatments) > 0 || ext.People > 0) {
			s.ResetBooking()
			t.apply(ctx, ext)
			return t.prompt(ctx)
		}
		return []string{domain.Done(t.settings.Name)}
	}
	greet()
	if intent == domain.IntentGreeting && len(strings.Fields(text)) <= 3 {
		return append(out, t.prompt(ctx)...)
	}
	applied := false
	if nums := domain.MenuNumbers(text); nums != nil && len(s.Menu) > 0 {
		applied = t.applyMenu(ctx, nums)
	} else {
		ext := t.localExtract(text)
		if !ext.useful() && t.e.ports.Extractor != nil {
			if ai := t.extract(ctx, text); ai != nil {
				ext = *ai
			}
		}
		if ext.WantAdmin {
			t.handedOver = "customer"
			return append(out, domain.Handover(t.settings.Name))
		}
		applied = t.apply(ctx, &ext)
	}
	if !applied {
		s.Misses++
		if s.Misses >= domain.MaxMisses {
			t.handedOver = "lost"
			return append(out, domain.Handover(t.settings.Name))
		}
		prompts := t.prompt(ctx)
		if len(prompts) > 0 {
			prompts[0] = domain.NotUnderstood(prompts[0], s.Misses)
		}
		return append(out, prompts...)
	}
	s.Misses = 0
	return append(out, t.prompt(ctx)...)
}

// prompt wraps promptSteps so a refusal explains the re-ask.
func (t *turn) prompt(ctx context.Context) []string {
	msgs := t.promptSteps(ctx)
	if t.failure != "" && len(msgs) > 0 {
		msgs[0] = t.failure + "\n\n" + msgs[0]
		t.failure = ""
	}
	return msgs
}

/* ── understanding ───────────────────────────────────────────────────── */

func (x Extraction) useful() bool {
	return x.Outlet != "" || x.People > 0 || len(x.Treatments) > 0 || x.Date != "" || x.Time != "" || x.Period != "" ||
		x.Therapist != "" || x.GenderPref != "" || x.SystemPick || x.Confirm != "" || x.Payment != "" || x.Name != "" || x.WantAdmin
}

// localExtract reads what the deterministic parsers can, without AI.
func (t *turn) localExtract(text string) Extraction {
	s := t.sess
	var x Extraction
	n := domain.Normalize(text)
	if i := domain.MatchName(text, outletNames(s.Outlets)); i >= 0 {
		x.Outlet = s.Outlets[i].Name
	}
	x.People = domain.ParsePeople(text)
	if len(s.Catalog) > 0 {
		if i := domain.MatchName(text, catalogLabels(s.Catalog)); i >= 0 {
			x.Treatments = []string{s.Catalog[i].Label()}
		}
	}
	x.Date = domain.ParseDate(text, t.at)
	x.Time = domain.ParseTime(text)
	x.Period = domain.ParsePeriod(text)
	if g := domain.ParseGender(text); g != "" {
		if g == "any" {
			x.SystemPick = true
		} else {
			x.GenderPref = g
		}
	}
	step := s.NextStep()
	if step == domain.StepTherapist && s.MenuStep == domain.StepTherapist {
		if i := domain.MatchName(text, menuLabels(s.Menu)); i >= 0 && s.Menu[i].Value != "system" {
			x.Therapist = s.Menu[i].Label
		}
	}
	intent := domain.DetectIntent(text, nil)
	if step == domain.StepConfirm {
		switch {
		case intent == domain.IntentYes:
			x.Confirm = "yes"
		case intent == domain.IntentNo || strings.Contains(n, "ubah") || strings.Contains(n, "ganti"):
			x.Confirm = "no"
		}
	}
	if step == domain.StepPayment {
		switch {
		case strings.Contains(n, "outlet") || strings.Contains(n, "tempat") || strings.Contains(n, "tunai") || strings.Contains(n, "cash") || strings.Contains(n, "nanti"):
			x.Payment = "outlet"
		case strings.Contains(n, "online") || strings.Contains(n, "transfer") || strings.Contains(n, "qris") || strings.Contains(n, "link") || strings.Contains(n, "sekarang") || strings.Contains(n, "bayar dulu"):
			x.Payment = "online"
		}
	}
	if step == domain.StepName && intent == domain.IntentNone && x.Date == "" && x.Time == "" && x.People == 0 && looksLikeName(text) {
		x.Name = titleCase(text)
	}
	return x
}

// extract asks the AI; nil when unavailable or on error (menu mode goes on).
func (t *turn) extract(ctx context.Context, text string) *Extraction {
	if t.e.ports.Extractor == nil {
		return nil
	}
	s := t.sess
	ec := ExtractContext{Today: t.at.In(domain.WIB).Format("2006-01-02"), Step: s.NextStep(), Outlets: outletNames(s.Outlets),
		Treatments: catalogLabels(s.Catalog), People: s.People}
	if s.MenuStep == domain.StepTherapist {
		ec.Therapists = menuLabels(s.Menu)
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	x, err := t.e.ports.Extractor.Extract(ctx, t.db, text, ec)
	if err != nil {
		t.e.log.Warn("[wabot] ekstraksi AI gagal, lanjut mode menu", "error", err)
		return nil
	}
	return x
}

// apply writes an extraction into the session; false when nothing fit.
func (t *turn) apply(ctx context.Context, x *Extraction) bool {
	s := t.sess
	applied := false
	if x.Outlet != "" {
		if len(s.Outlets) == 0 {
			t.loadOutlets(ctx)
		}
		if i := domain.MatchName(x.Outlet, outletNames(s.Outlets)); i >= 0 && s.Outlets[i].ID != s.OutletID {
			t.setOutlet(ctx, s.Outlets[i])
			applied = true
		}
	}
	if x.People > 0 && x.People != s.People {
		if x.People > domain.MaxPeople {
			// Keep the draft; prompt explains the cap.
			s.People = 0
		} else {
			s.People = x.People
			if len(s.Persons) > s.People {
				s.Persons = s.Persons[:s.People]
			}
			s.SlotISO = ""
		}
		applied = true
	}
	if len(x.Treatments) > 0 && s.OutletID != "" {
		if len(s.Catalog) == 0 {
			t.loadCatalog(ctx)
		}
		var persons []domain.Person
		for _, name := range x.Treatments {
			if i := domain.MatchName(name, catalogLabels(s.Catalog)); i >= 0 {
				persons = append(persons, personOf(s.Catalog[i]))
			}
		}
		if len(persons) > 0 {
			if s.People == 0 && len(persons) > 1 {
				s.People = len(persons)
			}
			if s.People == 0 {
				s.People = 1
			}
			if len(persons) == 1 && s.People > 1 {
				for len(persons) < s.People {
					persons = append(persons, persons[0])
				}
			}
			if len(persons) > s.People {
				persons = persons[:s.People]
			}
			s.Persons = persons
			s.SlotISO = ""
			applied = true
		}
	}
	if x.Date != "" && x.Date != s.Date {
		if _, err := time.ParseInLocation("2006-01-02", x.Date, domain.WIB); err == nil {
			s.Date, s.SlotISO = x.Date, ""
			applied = true
		}
	}
	if x.Time != "" {
		s.WantedTime, s.SlotISO = x.Time, ""
		applied = true
	}
	if x.Period != "" {
		s.Period = x.Period
		applied = true
	}
	if x.GenderPref == "male" || x.GenderPref == "female" {
		if x.GenderPref != s.Pref {
			s.Pref, s.TherapistID, s.TherapistName = x.GenderPref, "", ""
			// Choosing a gender while picking a therapist keeps the slot (the
			// list is re-filtered); earlier it changes which slots are free.
			if s.MenuStep != domain.StepTherapist {
				s.SlotISO = ""
			}
		}
		applied = true
	}
	if x.SystemPick {
		s.SystemPick, s.TherapistID, s.TherapistName = true, "", ""
		applied = true
	}
	if x.Therapist != "" && s.MenuStep == domain.StepTherapist {
		if i := domain.MatchName(x.Therapist, menuLabels(s.Menu)); i >= 0 && s.Menu[i].Value != "system" {
			s.TherapistID, s.TherapistName, s.SystemPick = s.Menu[i].Value, s.Menu[i].Label, false
			applied = true
		}
	}
	if x.Name != "" && s.NextStep() == domain.StepName {
		s.Name = strings.TrimSpace(x.Name)
		applied = true
	}
	if x.Confirm != "" && s.NextStep() == domain.StepConfirm {
		applied = true
		if x.Confirm == "yes" {
			t.createBookings(ctx)
		} else {
			s.ResetBooking()
		}
	}
	if x.Payment != "" && s.NextStep() == domain.StepPayment {
		t.setPayment(ctx, x.Payment)
		applied = true
	}
	return applied
}

// applyMenu resolves numbered replies against the last menu.
func (t *turn) applyMenu(ctx context.Context, nums []int) bool {
	s := t.sess
	pick := func(n int) *domain.MenuOption {
		for i := range s.Menu {
			if s.Menu[i].Key == strconv.Itoa(n) {
				return &s.Menu[i]
			}
		}
		return nil
	}
	switch s.MenuStep {
	case domain.StepOutlet:
		o := pick(nums[0])
		if o == nil {
			return false
		}
		for _, out := range s.Outlets {
			if out.ID == o.Value {
				t.setOutlet(ctx, out)
				return true
			}
		}
	case domain.StepPeople:
		o := pick(nums[0])
		if o == nil {
			return false
		}
		n, _ := strconv.Atoi(o.Value)
		return t.apply(ctx, &Extraction{People: n})
	case domain.StepTreatment:
		var persons []domain.Person
		for _, n := range nums {
			o := pick(n)
			if o == nil {
				return false
			}
			for _, v := range s.Catalog {
				if v.VariantID == o.Value {
					persons = append(persons, personOf(v))
				}
			}
		}
		if len(persons) == 0 {
			return false
		}
		if len(persons) == 1 && s.People > 1 {
			for len(persons) < s.People {
				persons = append(persons, persons[0])
			}
		}
		if len(persons) > s.People {
			persons = persons[:s.People]
		}
		s.Persons, s.SlotISO = persons, ""
		return true
	case domain.StepDate:
		o := pick(nums[0])
		if o == nil {
			return false
		}
		s.Date, s.SlotISO = o.Value, ""
		return true
	case domain.StepTime:
		o := pick(nums[0])
		if o == nil {
			return false
		}
		s.SlotISO, s.WantedTime, s.TherapistID, s.TherapistName = o.Value, "", "", ""
		return true
	case domain.StepTherapist:
		o := pick(nums[0])
		if o == nil {
			return false
		}
		if o.Value == "system" {
			s.SystemPick, s.TherapistID, s.TherapistName = true, "", ""
		} else {
			s.TherapistID, s.TherapistName, s.SystemPick = o.Value, o.Label, false
		}
		return true
	case domain.StepConfirm:
		if nums[0] == 1 {
			t.createBookings(ctx)
			return true
		}
		if nums[0] == 2 {
			s.ResetBooking()
			return true
		}
	case domain.StepPayment:
		switch nums[0] {
		case 1:
			t.setPayment(ctx, "outlet")
			return true
		case 2:
			if s.OnlinePay {
				t.setPayment(ctx, "online")
				return true
			}
		}
	}
	return false
}

/* ── data loading ────────────────────────────────────────────────────── */

func (t *turn) loadOutlets(ctx context.Context) {
	list, err := t.e.ports.Spa.Outlets(ctx)
	if err != nil {
		t.e.log.Error("[wabot] outlet", "error", err)
		return
	}
	t.sess.Outlets = t.sess.Outlets[:0]
	for _, o := range list {
		t.sess.Outlets = append(t.sess.Outlets, domain.OutletOpt{ID: o.BranchID, Name: o.Name, OpenTime: o.OpenTime, CloseTime: o.CloseTime})
	}
}

func (t *turn) setOutlet(ctx context.Context, o domain.OutletOpt) {
	s := t.sess
	s.OutletID, s.OutletName = o.ID, o.Name
	s.Catalog, s.Persons, s.SlotISO, s.TherapistID, s.TherapistName = nil, nil, "", "", ""
	t.loadCatalog(ctx)
}

func (t *turn) loadCatalog(ctx context.Context) {
	list, err := t.e.ports.Spa.Treatments(ctx, t.sess.OutletID)
	if err != nil {
		t.e.log.Error("[wabot] treatment", "error", err)
		return
	}
	t.sess.Catalog = nil
	for _, tr := range list {
		for _, v := range tr.Variants {
			t.sess.Catalog = append(t.sess.Catalog, domain.VariantOpt{VariantID: v.ID, Treatment: tr.Name, Variant: v.Name, Category: tr.Category, DurationMin: v.DurationMin, Price: v.PriceIDR})
		}
	}
}

// slots lists the day's free starts (every guest needs a free therapist).
func (t *turn) slots(ctx context.Context, date string) ([]domain.Slot, error) {
	s := t.sess
	raw, err := t.e.ports.Spa.Slots(ctx, s.OutletID, date, s.FirstVariantIDs(), s.Pref)
	if err != nil {
		return nil, err
	}
	var out []domain.Slot
	for _, r := range raw {
		at := time.Time(r.StartsAt)
		if !at.After(t.at) {
			continue
		}
		out = append(out, domain.Slot{ISO: at.UTC().Format(httpx.JSTimeLayout), At: at})
	}
	if s.People <= 1 {
		return out, nil
	}
	// A group needs People free therapists at once: check the nearest candidates only.
	sort.SliceStable(out, func(i, j int) bool { return t.distance(out[i].At) < t.distance(out[j].At) })
	var ok []domain.Slot
	for i, sl := range out {
		if i >= 10 {
			break
		}
		free, err := t.e.ports.Spa.Therapists(ctx, s.OutletID, sl.At, s.FirstVariantIDs(), s.Pref)
		if err != nil {
			return nil, err
		}
		if len(free) >= s.People {
			sl.Free = len(free)
			ok = append(ok, sl)
		}
	}
	sort.Slice(ok, func(i, j int) bool { return ok[i].At.Before(ok[j].At) })
	return ok, nil
}

// distance ranks a slot by closeness to what the guest asked for.
func (t *turn) distance(at time.Time) int {
	m := domain.ClockMinute(at)
	if t.sess.WantedTime != "" {
		h, _ := strconv.Atoi(t.sess.WantedTime[:2])
		mi, _ := strconv.Atoi(t.sess.WantedTime[3:])
		return abs(m - (h*60 + mi))
	}
	if t.sess.Period != "" && domain.PeriodOf(m) != t.sess.Period {
		return 1000 + m
	}
	return m
}

/* ── prompting (the next thing the bot needs) ─────────────────────────── */

func (t *turn) promptSteps(ctx context.Context) []string {
	s := t.sess
	for guard := 0; guard < 6; guard++ {
		switch s.NextStep() {
		case domain.StepOutlet:
			if len(s.Outlets) == 0 {
				t.loadOutlets(ctx)
			}
			if len(s.Outlets) == 1 {
				t.setOutlet(ctx, s.Outlets[0])
				continue
			}
			if len(s.Outlets) == 0 {
				t.handedOver = "no_outlet"
				return []string{domain.Handover(t.settings.Name)}
			}
			opts := make([]domain.MenuOption, len(s.Outlets))
			for i, o := range s.Outlets {
				opts[i] = domain.MenuOption{Key: strconv.Itoa(i + 1), Label: o.Name + " (buka " + hhmm(o.OpenTime) + "–" + hhmm(o.CloseTime) + ")", Value: o.ID}
			}
			s.SetMenu(domain.StepOutlet, opts)
			return []string{domain.AskOutlet(opts)}
		case domain.StepPeople:
			opts := make([]domain.MenuOption, domain.MaxPeople)
			for i := range opts {
				opts[i] = domain.MenuOption{Key: strconv.Itoa(i + 1), Label: strconv.Itoa(i+1) + " orang", Value: strconv.Itoa(i + 1)}
			}
			s.SetMenu(domain.StepPeople, opts)
			return []string{domain.AskPeople()}
		case domain.StepTreatment:
			if len(s.Catalog) == 0 {
				t.loadCatalog(ctx)
			}
			if len(s.Catalog) == 0 {
				t.handedOver = "no_catalog"
				return []string{domain.Handover(t.settings.Name)}
			}
			var opts []domain.MenuOption
			for i, v := range s.Catalog {
				if i >= 15 {
					break
				}
				opts = append(opts, domain.MenuOption{Key: strconv.Itoa(i + 1), Label: v.Label() + " — " + domain.Rupiah(v.Price), Value: v.VariantID})
			}
			s.SetMenu(domain.StepTreatment, opts)
			return []string{domain.AskTreatment(s.OutletName, s.People, opts)}
		case domain.StepDate:
			today := t.at.In(domain.WIB)
			labels := []string{"Hari ini", "Besok", "Lusa"}
			opts := make([]domain.MenuOption, 3)
			for i := range opts {
				d := today.AddDate(0, 0, i).Format("2006-01-02")
				opts[i] = domain.MenuOption{Key: strconv.Itoa(i + 1), Label: labels[i] + " (" + domain.LongDate(d) + ")", Value: d}
			}
			s.SetMenu(domain.StepDate, opts)
			return []string{domain.AskDate(opts)}
		case domain.StepTime:
			msg, done := t.promptTime(ctx)
			if done {
				continue
			}
			return []string{msg}
		case domain.StepTherapist:
			msg, done := t.promptTherapist(ctx)
			if done {
				continue
			}
			return []string{msg}
		case domain.StepName:
			if s.Name == "" && t.conv.DisplayName != "" && looksLikeName(t.conv.DisplayName) {
				s.Name = t.conv.DisplayName
				continue
			}
			s.ClearMenu()
			return []string{domain.AskName()}
		case domain.StepConfirm:
			s.SetMenu(domain.StepConfirm, []domain.MenuOption{{Key: "1", Label: "Ya, buat booking", Value: "yes"}, {Key: "2", Label: "Ubah", Value: "no"}})
			return []string{domain.Summary(s)}
		case domain.StepPayment:
			s.OnlinePay = t.e.ports.Spa.OnlinePayment()
			if !s.OnlinePay {
				// Nothing to choose: paying at the outlet is the only way.
				t.setPayment(ctx, "outlet")
				continue
			}
			opts := []domain.MenuOption{{Key: "1", Label: "Bayar di outlet", Value: "outlet"}, {Key: "2", Label: "Bayar online", Value: "online"}}
			s.SetMenu(domain.StepPayment, opts)
			return []string{domain.AskPayment(s.TotalPrice(), true)}
		default:
			s.ClearMenu()
			if t.justBooked {
				t.justBooked = false
				return []string{domain.Confirmed(s, t.settings.Name)}
			}
			return []string{domain.Done(t.settings.Name)}
		}
	}
	return nil
}

// promptTime offers the day's free slots, auto-picking an exactly requested
// free time; done=true when a slot was chosen without asking.
func (t *turn) promptTime(ctx context.Context) (string, bool) {
	s := t.sess
	slots, err := t.slots(ctx, s.Date)
	if err != nil {
		t.e.log.Error("[wabot] slot", "error", err)
		return "Maaf, jadwal sedang tidak bisa dicek. Coba lagi sebentar, atau ketik *admin*.", false
	}
	if len(slots) == 0 {
		return t.noSlots(ctx), false
	}
	if s.WantedTime != "" {
		for _, sl := range slots {
			if sl.At.In(domain.WIB).Format("15:04") == s.WantedTime {
				s.SlotISO, s.WantedTime = sl.ISO, ""
				return "", true
			}
		}
	}
	ranked := append([]domain.Slot(nil), slots...)
	if s.Period != "" {
		// "besok sore": offer only that part of the day when it has enough room.
		var same []domain.Slot
		for _, sl := range ranked {
			if domain.PeriodOf(domain.ClockMinute(sl.At)) == s.Period {
				same = append(same, sl)
			}
		}
		if len(same) >= 3 {
			ranked = same
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool { return t.distance(ranked[i].At) < t.distance(ranked[j].At) })
	if len(ranked) > 8 {
		ranked = ranked[:8]
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].At.Before(ranked[j].At) })
	opts := make([]domain.MenuOption, len(ranked))
	for i, sl := range ranked {
		label := domain.Clock(sl.At) + " (" + domain.PeriodOf(domain.ClockMinute(sl.At)) + ")"
		opts[i] = domain.MenuOption{Key: strconv.Itoa(i + 1), Label: label, Value: sl.ISO}
	}
	requested := ""
	if s.WantedTime != "" {
		requested = strings.Replace(s.WantedTime, ":", ".", 1)
		s.WantedTime = ""
	}
	s.SetMenu(domain.StepTime, opts)
	return domain.AskTime(s.Date, opts, requested), false
}

// noSlots looks for the next days with room and another outlet.
func (t *turn) noSlots(ctx context.Context) string {
	s := t.sess
	day, _ := time.ParseInLocation("2006-01-02", s.Date, domain.WIB)
	var alt []domain.MenuOption
	for i := 1; i <= 7 && len(alt) < 3; i++ {
		d := day.AddDate(0, 0, i).Format("2006-01-02")
		slots, err := t.slots(ctx, d)
		if err != nil {
			break
		}
		if len(slots) > 0 {
			alt = append(alt, domain.MenuOption{Key: strconv.Itoa(len(alt) + 1), Label: domain.LongDate(d) + " (" + strconv.Itoa(len(slots)) + " jam tersedia)", Value: d})
		}
	}
	other := ""
	for _, o := range s.Outlets {
		if o.ID != s.OutletID {
			other = o.Name
			break
		}
	}
	s.SetMenu(domain.StepDate, alt)
	return domain.NoSlotsToday(s.Date, alt, other)
}

func (t *turn) promptTherapist(ctx context.Context) (string, bool) {
	s := t.sess
	at, err := domain.ParseISO(s.SlotISO)
	if err != nil {
		s.SlotISO = ""
		return "", true
	}
	list, err := t.e.ports.Spa.Therapists(ctx, s.OutletID, at, s.FirstVariantIDs(), s.Pref)
	if err != nil {
		t.e.log.Warn("[wabot] daftar terapis gagal", "error", err)
	}
	if err != nil || len(list) == 0 {
		s.SystemPick = true
		return "", true
	}
	opts := []domain.MenuOption{{Key: "0", Label: "Pilihkan oleh Mizu", Value: "system"}}
	for i, th := range list {
		if i >= 8 {
			break
		}
		label := th.Name
		if th.Gender != nil {
			if *th.Gender == "female" {
				label += " (wanita)"
			} else if *th.Gender == "male" {
				label += " (pria)"
			}
		}
		opts = append(opts, domain.MenuOption{Key: strconv.Itoa(i + 1), Label: label, Value: th.ID})
	}
	s.SetMenu(domain.StepTherapist, opts)
	return domain.AskTherapist(opts, s.Pref), false
}

/* ── actions ─────────────────────────────────────────────────────────── */

// createBookings makes one booking per guest at the chosen slot.
func (t *turn) createBookings(ctx context.Context) {
	s := t.sess
	at, err := domain.ParseISO(s.SlotISO)
	if err != nil {
		s.SlotISO = ""
		return
	}
	var made []domain.BookingRef
	for i, p := range s.Persons {
		in := spa.PublicBookingInput{
			BranchID: s.OutletID, ScheduledAt: at, CustomerName: s.Name, CustomerPhone: t.conv.Phone,
			TherapistGenderPref: s.Pref, Notes: "Booking lewat chat WhatsApp (" + t.settings.Name + ")",
			VariantIDs: []string{p.VariantID}, PaymentMethod: "outlet", Source: "whatsapp",
		}
		if i == 0 && s.TherapistID != "" {
			in.TherapistID = s.TherapistID
		}
		if s.People > 1 {
			in.CustomerName = s.Name + " (" + strconv.Itoa(i+1) + ")"
		}
		res, err := t.e.ports.Spa.Book(ctx, in)
		if err != nil {
			t.bookingFailed(err, made)
			return
		}
		made = append(made, domain.BookingRef{Code: res.BookingCode, Token: res.AccessToken, Customer: in.CustomerName,
			StatusURL: strings.TrimRight(t.e.ports.AppURL, "/") + "/booking/spa/status/" + res.AccessToken})
	}
	s.Bookings = made
	t.justBooked = true
}

// bookingFailed turns a refused booking into the next prompt.
func (t *turn) bookingFailed(err error, made []domain.BookingRef) {
	s := t.sess
	var he *httpx.Error
	msg := "Booking belum berhasil dibuat."
	if errors.As(err, &he) {
		msg = he.Message
	}
	t.e.log.Warn("[wabot] booking ditolak", "error", err)
	s.Bookings = made
	switch {
	case strings.Contains(msg, "Terapis pilihanmu"):
		s.TherapistID, s.TherapistName = "", ""
	case strings.Contains(msg, "penuh") || strings.Contains(msg, "lewat"):
		s.SlotISO = ""
	case strings.Contains(msg, "terlalu banyak"):
		t.handedOver = "limit"
	}
	t.failure = msg
}

func (t *turn) setPayment(ctx context.Context, method string) {
	s := t.sess
	s.PayMethod = method
	if method != "online" {
		t.justBooked = true
		return
	}
	for i := range s.Bookings {
		pay, err := t.e.ports.Spa.Pay(ctx, s.Bookings[i].Token)
		if err != nil {
			t.e.log.Warn("[wabot] link bayar gagal", "error", err)
			s.PayMethod = "outlet"
			t.failure = "Link pembayaran online sedang tidak bisa dibuat, jadi pembayaran dilakukan di outlet ya."
			break
		}
		s.Bookings[i].PayURL = pay.InvoiceURL
	}
	t.justBooked = true
}

func (t *turn) paymentCheck(ctx context.Context) string {
	s := t.sess
	for i, b := range s.Bookings {
		res, err := t.e.ports.Spa.Booking(ctx, b.Token)
		if err == nil && res.PaymentStatus == "paid" {
			s.Bookings[i].Paid = true
		}
	}
	if len(s.Bookings) == 0 {
		return domain.StatusOf(nil)
	}
	allPaid := true
	for _, b := range s.Bookings {
		allPaid = allPaid && b.Paid
	}
	return domain.PaymentSeen(allPaid, s.Bookings[0].Code)
}

/* ── small helpers ───────────────────────────────────────────────────── */

func outletNames(list []domain.OutletOpt) []string {
	out := make([]string, len(list))
	for i, o := range list {
		out[i] = o.Name
	}
	return out
}

func catalogLabels(list []domain.VariantOpt) []string {
	out := make([]string, len(list))
	for i, v := range list {
		out[i] = v.Label()
	}
	return out
}

func menuLabels(list []domain.MenuOption) []string {
	out := make([]string, len(list))
	for i, o := range list {
		out[i] = o.Label
	}
	return out
}

func personOf(v domain.VariantOpt) domain.Person {
	return domain.Person{VariantID: v.VariantID, Label: v.Label(), DurationMin: v.DurationMin, Price: v.Price}
}

func hhmm(clock string) string {
	if len(clock) >= 5 {
		return strings.Replace(clock[:5], ":", ".", 1)
	}
	return clock
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// looksLikeName accepts 2–40 letters/spaces, no digits.
func looksLikeName(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) < 2 || len(s) > 40 {
		return false
	}
	for _, r := range s {
		if !(r == ' ' || r == '\'' || r == '.' || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || r > 127) {
			return false
		}
	}
	return true
}

func titleCase(s string) string {
	words := strings.Fields(strings.ToLower(strings.TrimSpace(s)))
	for i, w := range words {
		words[i] = strings.ToUpper(w[:1]) + w[1:]
	}
	return strings.Join(words, " ")
}
