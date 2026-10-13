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
	if banned, err := e.ports.Spa.PhoneBanned(ctx, conv.Phone); err != nil {
		e.log.Warn("[wabot] cek status member", "error", err)
	} else {
		t.banned = banned
	}
	replies := t.run(ctx, text)
	if sender == nil {
		sender = e.ports.Sender
	}
	menuSender, _ := sender.(MenuSender)
	for i, r := range replies {
		var err error
		// The last reply carries this turn's menu: offer it as buttons/list
		// where the provider supports it (Meta), text elsewhere.
		if menuSender != nil && i == len(replies)-1 && len(sess.Menu) > 0 {
			err = menuSender.SendMenu(ctx, db, conv.Phone, conv.ID, r, sess.Menu)
		} else {
			err = sender.Send(ctx, db, conv.Phone, conv.ID, r)
		}
		if err != nil {
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
	// stagger holds two-wave seatings found while listing the day's slots.
	stagger []staggerOption
	// banned: the member is blocked; every day looks full and no
	// alternatives/waitlist are offered (revisi R8).
	banned bool
}

func (t *turn) run(ctx context.Context, text string) []string {
	s := t.sess
	var out []string
	// Language first: a menu answer, an explicit choice, or a clearly
	// English/Indonesian message decides; anything else gets the menu.
	if s.Lang == "" {
		if nums := domain.MenuNumbers(text); nums != nil && s.MenuStep == domain.StepLang {
			if nums[0] == 2 {
				s.Lang = domain.LangEN
			} else {
				s.Lang = domain.LangID
			}
			s.Greeted = true
			s.ClearMenu()
			return append([]string{domain.Greeting(s.Lang, t.settings.Name, t.settings.Greeting)}, t.prompt(ctx)...)
		}
		// A stated choice or a clearly English message decides; an Indonesian
		// message that already carries a booking or a question continues in
		// Indonesian; a bare greeting gets the language question once.
		lang := domain.DetectLang(text)
		carries := t.localExtract(ctx, text).useful() || domain.DetectQuestion(text) != domain.QuestionNone
		switch {
		case domain.ExplicitLang(text) != "" || lang == domain.LangEN:
			s.Lang = lang
		case s.MenuStep == domain.StepLang:
			s.Lang = domain.LangID // asked once; an unclear answer means Indonesian
		case lang == domain.LangID && carries:
			s.Lang = domain.LangID
		default:
			s.SetMenu(domain.StepLang, domain.LangMenu())
			return []string{domain.AskLang(t.settings.Name)}
		}
		s.ClearMenu()
	}
	l := s.Lang
	greet := func() {
		if !s.Greeted {
			s.Greeted = true
			out = append(out, domain.Greeting(l, t.settings.Name, t.settings.Greeting))
		}
	}
	intent := domain.DetectIntent(text, t.settings.HandoverKeywords)
	switch intent {
	case domain.IntentAdmin:
		t.handedOver = "customer"
		return []string{domain.Handover(l, t.settings.Name)}
	case domain.IntentBack:
		greet()
		if !s.Back() {
			return append(out, domain.BackNone(l))
		}
		prompts := t.prompt(ctx)
		if len(prompts) > 0 {
			prompts[0] = domain.BackOK(l) + " " + prompts[0]
		}
		return append(out, prompts...)
	case domain.IntentRestart:
		if strings.Contains(domain.Normalize(text), "daftar tunggu") && s.WaitlistID != "" {
			t.cancelWaitlist(ctx)
			s.WaitlistID = ""
			return []string{domain.WaitlistCancelled(l)}
		}
		s.ResetBooking()
		return append(out, t.prompt(ctx)...)
	case domain.IntentStatus:
		return []string{domain.StatusOf(l, s.Bookings)}
	case domain.IntentHelp:
		greet()
		return append(out, t.prompt(ctx)...)
	case domain.IntentOutlet:
		greet()
		t.switchOutlet()
		return append(out, t.prompt(ctx)...)
	case domain.IntentWaitlist:
		greet()
		n := domain.Normalize(text)
		if strings.Contains(n, "batal") && s.WaitlistID != "" {
			t.cancelWaitlist(ctx)
			return append(out, domain.WaitlistCancelled(l))
		}
		if s.OutletID == "" || s.Date == "" {
			return append(out, domain.WaitlistNeedsDate(l))
		}
		return append(out, t.joinWaitlist(ctx, s.Date))
	}
	if s.FromWaitlist && (intent == domain.IntentNo || intent == domain.IntentRestart) {
		t.cancelWaitlist(ctx)
		s.ResetBooking()
		s.WaitlistID = ""
		return append(out, domain.WaitlistCancelled(l))
	}
	if s.NextStep() == domain.StepDone {
		if kind := domain.DetectQuestion(text); kind != domain.QuestionNone && !(kind == domain.QuestionOther && t.localExtract(ctx, text).bookingShaped()) {
			if answer := t.answer(ctx, kind, text); answer != "" {
				return []string{answer}
			}
		}
		n := domain.Normalize(text)
		if strings.Contains(n, "bayar") || strings.Contains(n, "lunas") || strings.Contains(n, "transfer") || strings.Contains(n, "paid") || strings.Contains(n, "payment") {
			return []string{t.paymentCheck(ctx)}
		}
		// "booking", "mau booking", "book", "reservasi": the Done message tells
		// the guest to type *booking* for a new one, so start it.
		if domain.WantsNewBooking(text) {
			s.ResetBooking()
			// "booking besok jam 3 di Kemang": keep the details given.
			if len(strings.Fields(text)) > 2 {
				if ext := t.extract(ctx, text); ext != nil {
					t.apply(ctx, ext)
				}
			}
			return t.prompt(ctx)
		}
		if intent == domain.IntentGreeting || intent == domain.IntentYes {
			return []string{domain.Done(l, t.settings.Name)}
		}
		// Anything else after a finished booking: let the AI decide if it is a new booking.
		if ext := t.extract(ctx, text); ext != nil && (ext.Outlet != "" || ext.Date != "" || len(ext.Treatments) > 0 || ext.People > 0) {
			s.ResetBooking()
			t.apply(ctx, ext)
			return t.prompt(ctx)
		}
		return []string{domain.Done(l, t.settings.Name)}
	}
	greet()
	if intent == domain.IntentGreeting && len(strings.Fields(text)) <= 3 {
		return append(out, t.prompt(ctx)...)
	}
	// Questions (address, hours, prices, …) are answered from system data
	// without touching the draft; the pending booking question follows.
	if kind := domain.DetectQuestion(text); kind != domain.QuestionNone && !(kind == domain.QuestionOther && t.localExtract(ctx, text).bookingShaped()) {
		if answer := t.answer(ctx, kind, text); answer != "" {
			prompts := t.prompt(ctx)
			if len(prompts) > 0 {
				prompts[0] = domain.ContinuePrompt(l, prompts[0])
			}
			return append(append(out, answer), prompts...)
		}
	}
	applied := false
	if s.NextStep() == domain.StepName {
		// The name is asked before anything else: option 1 = profile name.
		if nums := domain.MenuNumbers(text); nums != nil && nums[0] == 1 && looksLikeName(t.conv.DisplayName) {
			s.Name = t.conv.DisplayName
			applied = true
		} else if name := strings.TrimSpace(strings.Trim(text, ".!")); looksLikeName(name) && domain.MenuNumbers(text) == nil &&
			len([]rune(name)) >= 3 && intent == domain.IntentNone && domain.DetectQuestion(text) == domain.QuestionNone {
			s.Name = titleCase(name)
			applied = true
		}
		if applied {
			s.Misses = 0
			return append(out, t.prompt(ctx)...)
		}
	}
	if nums := domain.MenuNumbers(text); nums != nil && len(s.Menu) > 0 {
		applied = t.applyMenu(ctx, nums)
	} else {
		ext := t.localExtract(ctx, text)
		// The AI reads what the local parser missed: always for a message
		// it could not read, and for free-form sentences it read only partly.
		if t.e.ports.Extractor != nil && (!ext.useful() || domain.FreeForm(text)) {
			if ai := t.extract(ctx, text); ai != nil {
				ext = mergeExtraction(ext, sanitizeAI(text, *ai))
			}
		}
		if ext.WantAdmin {
			t.handedOver = "customer"
			return append(out, domain.Handover(l, t.settings.Name))
		}
		applied = t.apply(ctx, &ext)
	}
	if !applied {
		// Off-script: let the AI name the intent or answer briefly before
		// this counts as "not understood".
		if msgs, ok := t.converse(ctx, text, out); ok {
			return msgs
		}
		s.Misses++
		if s.Misses >= domain.MaxMisses {
			t.handedOver = "lost"
			return append(out, domain.Handover(l, t.settings.Name))
		}
		prompts := t.prompt(ctx)
		if len(prompts) > 0 {
			prompts[0] = domain.NotUnderstood(l, prompts[0], s.Misses)
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

// bookingShaped: the message asks for a visit (where/who/what/when), not
// merely mentions a preference ("terapisnya ada yang pria?").
func (x Extraction) bookingShaped() bool {
	return x.Outlet != "" || x.People > 0 || len(x.Treatments) > 0 || x.Date != "" || x.Time != "" || x.Period != ""
}

func (x Extraction) useful() bool {
	return x.Outlet != "" || x.People > 0 || len(x.Treatments) > 0 || x.Date != "" || x.Time != "" || x.Period != "" ||
		x.Therapist != "" || x.GenderPref != "" || x.SystemPick || x.Confirm != "" || x.Payment != "" || x.Name != "" || x.WantAdmin
}

// localExtract reads what the deterministic parsers can, without AI.
func (t *turn) localExtract(ctx context.Context, text string) Extraction {
	s := t.sess
	var x Extraction
	n := domain.Normalize(text)
	if len(s.Outlets) == 0 {
		t.loadOutlets(ctx) // outlet names are needed to read "di signature" (and for the AI's context)
	}
	treatmentText := text
	if i := domain.MatchName(text, outletNames(s.Outlets)); i >= 0 {
		x.Outlet = s.Outlets[i].Name
		// "di Signature" names the outlet, not the "Signature Ritual" treatment.
		treatmentText = domain.StripWords(text, s.Outlets[i].Name)
	}
	x.People = domain.ParsePeople(text)
	vocab := s.Catalog
	if len(vocab) == 0 && len(s.Outlets) > 0 {
		// No outlet yet: treatment names are shared, so any outlet's catalog
		// serves as vocabulary ("mau reflexology" before "di Signature").
		vocab, _ = t.e.catalogFor(ctx, s.Outlets[0].ID)
	}
	if len(vocab) > 0 {
		if i := domain.MatchName(treatmentText, catalogLabels(vocab)); i >= 0 {
			x.Treatments = []string{vocab[i].Label()}
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
	started := time.Now()
	x, err := t.e.ports.Extractor.Extract(ctx, t.db, text, ec)
	if err != nil {
		t.e.log.Warn("[wabot] ekstraksi AI gagal, lanjut mode menu", "error", err)
		return nil
	}
	t.e.log.Info("[wabot] ekstraksi AI", "ms", time.Since(started).Milliseconds(), "outlet", x.Outlet, "people", x.People,
		"treatments", x.Treatments, "date", x.Date, "time", x.Time, "period", x.Period, "confirm", x.Confirm, "admin", x.WantAdmin)
	return x
}

// converse is the last resort for a message nobody could read: the AI names
// a command (restart/back/status/admin) or writes a short grounded reply;
// the pending booking question follows. ok=false leaves the miss handling.
func (t *turn) converse(ctx context.Context, text string, out []string) ([]string, bool) {
	s := t.sess
	l := s.Lang
	c, ok := t.e.ports.Extractor.(Converser)
	if !ok {
		return nil, false
	}
	pending := ""
	if prompts := t.promptPreview(ctx); len(prompts) > 0 {
		pending = prompts[0]
	}
	cctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	started := time.Now()
	res, err := c.Converse(cctx, t.db, text, t.facts(ctx), map[domain.L]string{domain.LangEN: "English", domain.LangID: "Bahasa Indonesia"}[l], pending)
	if err != nil {
		t.e.log.Warn("[wabot] percakapan AI gagal", "error", err)
		return nil, false
	}
	t.e.log.Info("[wabot] percakapan AI", "ms", time.Since(started).Milliseconds(), "intent", res.Intent, "reply", res.Reply != "")
	switch res.Intent {
	case "restart":
		s.ResetBooking()
		return append(out, t.prompt(ctx)...), true
	case "back":
		if s.Back() {
			prompts := t.prompt(ctx)
			if len(prompts) > 0 {
				prompts[0] = domain.BackOK(l) + " " + prompts[0]
			}
			return append(out, prompts...), true
		}
	case "status":
		return append(out, domain.StatusOf(l, s.Bookings)), true
	case "admin":
		t.handedOver = "customer"
		return append(out, domain.Handover(l, t.settings.Name)), true
	}
	if res.Reply == "" {
		return nil, false
	}
	s.Misses = 0
	prompts := t.prompt(ctx)
	if len(prompts) > 0 && s.NextStep() != domain.StepDone {
		prompts[0] = domain.ContinuePrompt(l, prompts[0])
		return append(append(out, res.Reply), prompts...), true
	}
	return append(out, res.Reply), true
}

// promptPreview renders the pending question without changing the menu
// state (the real prompt runs afterwards).
func (t *turn) promptPreview(ctx context.Context) []string {
	menu, step, failure := t.sess.Menu, t.sess.MenuStep, t.failure
	prompts := t.promptSteps(ctx)
	t.sess.Menu, t.sess.MenuStep, t.failure = menu, step, failure
	return prompts
}

// answer replies to an information question from system data; a free
// question goes to the AI with the same facts. "" = not a question after all.
func (t *turn) answer(ctx context.Context, kind domain.QuestionKind, text string) string {
	s := t.sess
	l := s.Lang
	if len(s.Outlets) == 0 {
		t.loadOutlets(ctx)
	}
	// The outlet the question names, else the chosen one, else all.
	chosen := s.OutletID
	if i := domain.MatchName(text, outletNames(s.Outlets)); i >= 0 {
		chosen = s.Outlets[i].ID
	}
	switch kind {
	case domain.QuestionAddress:
		return domain.AnswerAddress(l, s.Outlets, chosen)
	case domain.QuestionHours:
		return domain.AnswerHours(l, s.Outlets, chosen)
	case domain.QuestionPrice:
		outletID, outletName := chosen, ""
		if outletID == "" && len(s.Outlets) > 0 {
			outletID = s.Outlets[0].ID
		}
		for _, o := range s.Outlets {
			if o.ID == outletID {
				outletName = o.Name
			}
		}
		catalog := s.Catalog
		if outletID != s.OutletID || len(catalog) == 0 {
			catalog, _ = t.e.catalogFor(ctx, outletID)
		}
		return domain.AnswerPrices(l, outletName, catalog)
	case domain.QuestionPayment:
		return domain.AnswerPayment(l, t.e.ports.Spa.OnlinePayment())
	case domain.QuestionReschedule:
		return domain.AnswerReschedule(l)
	}
	if answerer, ok := t.e.ports.Extractor.(Answerer); ok {
		ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		started := time.Now()
		reply, err := answerer.Answer(ctx, t.db, text, t.facts(ctx)+"\nBAHASA JAWABAN: "+map[domain.L]string{domain.LangEN: "English", domain.LangID: "Bahasa Indonesia"}[l])
		if err != nil {
			t.e.log.Warn("[wabot] jawaban AI gagal", "error", err)
		} else {
			t.e.log.Info("[wabot] jawaban AI", "ms", time.Since(started).Milliseconds(), "known", reply != "")
		}
		if reply != "" {
			return reply
		}
	}
	return domain.AnswerUnknown(l)
}

// facts is what the AI may answer from: outlets, the catalog, policies.
func (t *turn) facts(ctx context.Context) string {
	s := t.sess
	var b strings.Builder
	b.WriteString("OUTLET:\n")
	for _, o := range s.Outlets {
		b.WriteString("- " + o.Name + ": " + firstNonBlank(o.Address, "alamat belum tercantum"))
		if o.City != "" {
			b.WriteString(", " + o.City)
		}
		b.WriteString("; buka setiap hari " + hhmm(o.OpenTime) + "–" + hhmm(o.CloseTime) + " WIB")
		if o.Phone != "" {
			b.WriteString("; telp " + o.Phone)
		}
		b.WriteString("\n")
	}
	catalog := s.Catalog
	outlet := s.OutletName
	if len(catalog) == 0 && len(s.Outlets) > 0 {
		catalog, _ = t.e.catalogFor(ctx, s.Outlets[0].ID)
		outlet = s.Outlets[0].Name
	}
	if len(catalog) > 0 {
		b.WriteString("TREATMENT & HARGA (" + outlet + "):\n")
		for _, v := range catalog {
			b.WriteString("- " + v.Label() + " (" + strconv.Itoa(v.DurationMin) + " menit): " + domain.Rupiah(v.Price) + "\n")
		}
	}
	b.WriteString("KEBIJAKAN:\n- Booking lewat chat maksimal " + strconv.Itoa(domain.MaxPeople) + " orang per booking, untuk 60 hari ke depan.\n")
	if amount, hold, enabled := t.e.ports.Spa.DepositPolicy(ctx); enabled {
		b.WriteString("- Booking online memerlukan DP " + domain.Rupiah(amount) + " per booking, dibayar lewat link dalam " + strconv.Itoa(hold) + " menit agar jadwal terkunci; sisa harga dibayar di outlet setelah treatment. DP tidak dikembalikan bila booking dibatalkan sepihak (tanya admin untuk pengecualian).\n")
	}
	_, _, depositOn := t.e.ports.Spa.DepositPolicy(ctx)
	switch {
	case depositOn:
		b.WriteString("- Sisa harga setelah DP dibayar di outlet setelah treatment (tunai/QRIS/kartu).\n")
	case t.e.ports.Spa.OnlinePayment():
		b.WriteString("- Pembayaran di outlet setelah treatment (tunai/QRIS/kartu) atau online lewat link (VA, QRIS, e-wallet, kartu); tanpa DP.\n")
	default:
		b.WriteString("- Pembayaran di outlet setelah treatment (tunai/QRIS/kartu); tanpa DP.\n")
	}
	b.WriteString("- Jadwal bisa diubah/dibatalkan sendiri lewat link status booking sampai 1 jam sebelum kunjungan; setelah itu lewat admin.\n")
	b.WriteString("- Terapis bisa dipilih sendiri (yang kosong di jam itu) atau dipilihkan Mizu; ada terapis wanita dan pria.\n")
	b.WriteString("- Untuk hal lain (parkir, fasilitas, promo, grup lebih dari " + strconv.Itoa(domain.MaxPeople) + " orang) pelanggan diminta ketik admin.\n")
	return b.String()
}

// sanitizeAI drops AI fields the message gives no cue for (a model may
// guess an outlet, a date or a party size that was never said).
func sanitizeAI(text string, x Extraction) Extraction {
	if x.Outlet != "" && domain.MatchName(text, []string{x.Outlet}) < 0 {
		x.Outlet = ""
	}
	if x.Date != "" && !domain.MentionsDate(text) {
		x.Date = ""
	}
	if (x.Time != "" || x.Period != "") && !domain.MentionsTime(text) {
		x.Time, x.Period = "", ""
	}
	if x.People > 0 && !domain.MentionsPeople(text) {
		x.People = 0
	}
	return x
}

// mergeExtraction keeps the local reading and fills its gaps from the AI.
func mergeExtraction(local, ai Extraction) Extraction {
	out := local
	if out.Outlet == "" {
		out.Outlet = ai.Outlet
	}
	if out.People == 0 {
		out.People = ai.People
	}
	if len(out.Treatments) == 0 {
		out.Treatments = ai.Treatments
	}
	if out.Date == "" {
		out.Date = ai.Date
	}
	if out.Time == "" {
		out.Time = ai.Time
	}
	if out.Period == "" {
		out.Period = ai.Period
	}
	if out.Therapist == "" {
		out.Therapist = ai.Therapist
	}
	if out.GenderPref == "" {
		out.GenderPref = ai.GenderPref
	}
	out.SystemPick = out.SystemPick || ai.SystemPick
	if out.Confirm == "" {
		out.Confirm = ai.Confirm
	}
	if out.Payment == "" {
		out.Payment = ai.Payment
	}
	if out.Name == "" {
		out.Name = ai.Name
	}
	out.WantAdmin = out.WantAdmin || ai.WantAdmin
	out.OffTopic = out.OffTopic || ai.OffTopic
	return out
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
			s.ClearSlot()
		}
		applied = true
	}
	if len(x.Treatments) > 0 && s.OutletID == "" {
		// Named before the outlet ("thai massage dua-duanya"): matched once
		// the outlet's catalog is known.
		s.PendingTreatments = x.Treatments
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
			s.ClearSlot()
			applied = true
		}
	}
	if x.Date != "" && x.Date != s.Date {
		if _, err := time.ParseInLocation("2006-01-02", x.Date, domain.WIB); err == nil {
			s.Date = x.Date
			s.ClearSlot()
			applied = true
		}
	}
	if x.Time != "" {
		s.WantedTime = x.Time
		s.ClearSlot()
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
				s.ClearSlot()
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
		return t.applyDateChoice(ctx, o.Value)
	case domain.StepTime:
		o := pick(nums[0])
		if o == nil {
			return false
		}
		s.ClearSlot()
		s.WantedTime, s.TherapistID, s.TherapistName = "", "", ""
		if isos, ok := strings.CutPrefix(o.Value, "stagger:"); ok {
			parts := strings.Split(isos, ",")
			for i := range s.Persons {
				if i < len(parts) {
					s.Persons[i].SlotISO = parts[i]
				}
			}
			if len(parts) > 0 {
				s.SlotISO = parts[0]
			}
			return true
		}
		s.SlotISO = o.Value
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
	case domain.StepRoom:
		o := pick(nums[0])
		if o == nil {
			return false
		}
		s.RoomDone = true
		if o.Value == "none" {
			s.RoomID, s.RoomName, s.RoomPrice = "", "", 0
			return true
		}
		// Value is "id|price"; the label starts with the room name.
		id, price, _ := strings.Cut(o.Value, "|")
		s.RoomID, s.RoomName = id, strings.SplitN(o.Label, " · ", 2)[0]
		s.RoomPrice, _ = strconv.ParseFloat(price, 64)
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
		opt := domain.OutletOpt{ID: o.BranchID, Name: o.Name, OpenTime: o.OpenTime, CloseTime: o.CloseTime}
		if o.Address != nil {
			opt.Address = strings.TrimSpace(*o.Address)
		}
		if o.City != nil {
			opt.City = strings.TrimSpace(*o.City)
		}
		if o.Phone != nil {
			opt.Phone = strings.TrimSpace(*o.Phone)
		}
		t.sess.Outlets = append(t.sess.Outlets, opt)
	}
}

func (t *turn) setOutlet(ctx context.Context, o domain.OutletOpt) {
	s := t.sess
	s.OutletID, s.OutletName = o.ID, o.Name
	s.Catalog, s.Persons, s.SlotISO, s.TherapistID, s.TherapistName = nil, nil, "", "", ""
	t.loadCatalog(ctx)
	if len(s.PendingTreatments) > 0 {
		pending := s.PendingTreatments
		s.PendingTreatments = nil
		t.apply(ctx, &Extraction{Treatments: pending})
	}
}

func (t *turn) loadCatalog(ctx context.Context) {
	catalog, err := t.e.catalogFor(ctx, t.sess.OutletID)
	if err != nil {
		t.e.log.Error("[wabot] treatment", "error", err)
		return
	}
	t.sess.Catalog = catalog
}

// catalogFor lists an outlet's bookable variants.
func (e *Engine) catalogFor(ctx context.Context, outletID string) ([]domain.VariantOpt, error) {
	list, err := e.ports.Spa.Treatments(ctx, outletID)
	if err != nil {
		return nil, err
	}
	var out []domain.VariantOpt
	for _, tr := range list {
		for _, v := range tr.Variants {
			out = append(out, domain.VariantOpt{VariantID: v.ID, Treatment: tr.Name, Variant: v.Name, Category: tr.Category, DurationMin: v.DurationMin, Price: v.PriceIDR})
		}
	}
	return out, nil
}

// switchOutlet forgets the outlet but keeps the party size and date; the
// treatments are re-matched against the new outlet's catalog.
func (t *turn) switchOutlet() {
	s := t.sess
	s.OutletID, s.OutletName, s.Catalog = "", "", nil
	s.ClearSlot()
	s.TherapistID, s.TherapistName = "", ""
	s.ClearMenu()
}

// applyDateChoice reads a date-menu value: a plain date, "outlet:<id>:<date>"
// (another outlet the same day) or "waitlist:<date>".
func (t *turn) applyDateChoice(ctx context.Context, value string) bool {
	s := t.sess
	if date, ok := strings.CutPrefix(value, "waitlist:"); ok {
		s.Date = date
		t.failure = t.joinWaitlist(ctx, date)
		return true
	}
	if rest, ok := strings.CutPrefix(value, "outlet:"); ok {
		id, date, found := strings.Cut(rest, ":")
		if !found {
			return false
		}
		for _, o := range s.Outlets {
			if o.ID == id {
				persons := s.Persons
				t.setOutlet(ctx, o)
				s.Persons = t.rematch(persons)
				s.Date = date
				s.ClearSlot()
				return true
			}
		}
		return false
	}
	s.Date = value
	s.ClearSlot()
	return true
}

// rematch keeps guests whose variant exists in the (new) catalog.
func (t *turn) rematch(persons []domain.Person) []domain.Person {
	var out []domain.Person
	for _, p := range persons {
		for _, v := range t.sess.Catalog {
			if v.VariantID == p.VariantID {
				out = append(out, personOf(v))
				break
			}
		}
	}
	if len(out) != len(persons) {
		return nil
	}
	return out
}

// slots lists the day's free starts (every guest needs a free therapist).
func (t *turn) slots(ctx context.Context, date string) ([]domain.Slot, error) {
	s := t.sess
	if t.banned {
		return nil, nil
	}
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
	var ok, checked []domain.Slot
	for i, sl := range out {
		if i >= 10 {
			break
		}
		free, err := t.e.ports.Spa.Therapists(ctx, s.OutletID, sl.At, s.FirstVariantIDs(), s.Pref)
		if err != nil {
			return nil, err
		}
		sl.Free = len(free)
		checked = append(checked, sl)
		if len(free) >= s.People {
			ok = append(ok, sl)
		}
	}
	sort.Slice(ok, func(i, j int) bool { return ok[i].At.Before(ok[j].At) })
	if len(ok) == 0 && date == s.Date {
		t.stagger = staggerOptions(checked, s.People, s.TotalDuration())
	}
	return ok, nil
}

// staggerOption is a way to seat a group in two waves: Firsts guests at
// First, the rest at Second (after the longest treatment has ended).
type staggerOption struct {
	First, Second domain.Slot
	Firsts        int
}

// staggerOptions finds up to three two-wave seatings from the checked
// slots (each with its free-therapist count).
func staggerOptions(slots []domain.Slot, people, durationMin int) []staggerOption {
	if people < 2 {
		return nil
	}
	byTime := append([]domain.Slot(nil), slots...)
	sort.Slice(byTime, func(i, j int) bool { return byTime[i].At.Before(byTime[j].At) })
	var out []staggerOption
	for _, a := range byTime {
		if a.Free == 0 {
			continue
		}
		firsts := a.Free
		if firsts > people-1 {
			firsts = people - 1
		}
		for _, b := range byTime {
			if b.At.Before(a.At.Add(time.Duration(durationMin)*time.Minute)) || b.Free < people-firsts {
				continue
			}
			out = append(out, staggerOption{First: a, Second: b, Firsts: firsts})
			break
		}
		if len(out) >= 3 {
			break
		}
	}
	return out
}

// value is the time-menu value: one ISO start per guest, in order.
func (o staggerOption) value(people int) string {
	parts := make([]string, people)
	for i := range parts {
		if i < o.Firsts {
			parts[i] = o.First.ISO
		} else {
			parts[i] = o.Second.ISO
		}
	}
	return "stagger:" + strings.Join(parts, ",")
}

func (o staggerOption) label(l domain.L, people int) string {
	return domain.StaggerLabel(l, domain.Clock(o.First.At), o.Firsts, domain.Clock(o.Second.At), people-o.Firsts)
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
	l := s.Lang
	for guard := 0; guard < 6; guard++ {
		switch s.NextStep() {
		case domain.StepLang:
			s.SetMenu(domain.StepLang, domain.LangMenu())
			return []string{domain.AskLang(t.settings.Name)}
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
				return []string{domain.Handover(l, t.settings.Name)}
			}
			opts := make([]domain.MenuOption, len(s.Outlets))
			for i, o := range s.Outlets {
				opts[i] = domain.MenuOption{Key: strconv.Itoa(i + 1), Label: o.Name + " (" + openWord(l) + " " + hhmm(o.OpenTime) + "–" + hhmm(o.CloseTime) + ")", Value: o.ID}
			}
			s.SetMenu(domain.StepOutlet, opts)
			return []string{domain.AskOutlet(l, opts)}
		case domain.StepPeople:
			opts := make([]domain.MenuOption, domain.MaxPeople)
			for i := range opts {
				opts[i] = domain.MenuOption{Key: strconv.Itoa(i + 1), Label: domain.PeopleLabel(l, i+1), Value: strconv.Itoa(i + 1)}
			}
			s.SetMenu(domain.StepPeople, opts)
			return []string{domain.AskPeople(l)}
		case domain.StepTreatment:
			if len(s.Catalog) == 0 {
				t.loadCatalog(ctx)
			}
			if len(s.Catalog) == 0 {
				t.handedOver = "no_catalog"
				return []string{domain.Handover(l, t.settings.Name)}
			}
			var opts []domain.MenuOption
			for i, v := range s.Catalog {
				if i >= 15 {
					break
				}
				opts = append(opts, domain.MenuOption{Key: strconv.Itoa(i + 1), Label: v.Label() + " — " + domain.Rupiah(v.Price), Value: v.VariantID})
			}
			s.SetMenu(domain.StepTreatment, opts)
			return []string{domain.AskTreatment(l, s.OutletName, s.People, opts)}
		case domain.StepDate:
			today := t.at.In(domain.WIB)
			labels := domain.DayLabels(l)
			opts := make([]domain.MenuOption, 3)
			for i := range opts {
				d := today.AddDate(0, 0, i).Format("2006-01-02")
				opts[i] = domain.MenuOption{Key: strconv.Itoa(i + 1), Label: labels[i] + " (" + domain.LongDate(l, d) + ")", Value: d}
			}
			s.SetMenu(domain.StepDate, opts)
			return []string{domain.AskDate(l, opts)}
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
		case domain.StepRoom:
			msg, done := t.promptRoom(ctx)
			if done {
				continue
			}
			return []string{msg}
		case domain.StepName:
			profile := ""
			if looksLikeName(t.conv.DisplayName) {
				profile = t.conv.DisplayName
				s.SetMenu(domain.StepName, []domain.MenuOption{{Key: "1", Label: profile, Value: profile}})
			} else {
				s.ClearMenu()
			}
			return []string{domain.AskName(l, profile)}
		case domain.StepConfirm:
			yes, change := domain.ConfirmLabels(l)
			s.SetMenu(domain.StepConfirm, []domain.MenuOption{{Key: "1", Label: yes, Value: "yes"}, {Key: "2", Label: change, Value: "no"}})
			depositEach := 0.0
			if amount, _, enabled := t.e.ports.Spa.DepositPolicy(ctx); enabled {
				depositEach = amount
			}
			return []string{domain.Summary(l, s, depositEach)}
		case domain.StepPayment:
			if s.NeedsDeposit() {
				// The DP link is the payment step: nothing to choose.
				s.PayMethod = "deposit"
				t.justBooked = true
				continue
			}
			s.OnlinePay = t.e.ports.Spa.OnlinePayment()
			if !s.OnlinePay {
				// Nothing to choose: paying at the outlet is the only way.
				t.setPayment(ctx, "outlet")
				continue
			}
			payOutlet, payOnline := domain.PaymentLabels(l)
			opts := []domain.MenuOption{{Key: "1", Label: payOutlet, Value: "outlet"}, {Key: "2", Label: payOnline, Value: "online"}}
			s.SetMenu(domain.StepPayment, opts)
			return []string{domain.AskPayment(l, s.TotalPrice(), true)}
		default:
			s.ClearMenu()
			if t.justBooked {
				t.justBooked = false
				return []string{domain.Confirmed(l, s, t.settings.Name)}
			}
			return []string{domain.Done(l, t.settings.Name)}
		}
	}
	return nil
}

// promptTime offers the day's free slots, auto-picking an exactly requested
// free time; done=true when a slot was chosen without asking.
func (t *turn) promptTime(ctx context.Context) (string, bool) {
	s := t.sess
	l := s.Lang
	slots, err := t.slots(ctx, s.Date)
	if err != nil {
		t.e.log.Error("[wabot] slot", "error", err)
		if l == domain.LangEN {
			return "Sorry, I can't check the schedule right now. Please try again shortly, or type *admin*.", false
		}
		return "Maaf, jadwal sedang tidak bisa dicek. Coba lagi sebentar, atau ketik *admin*.", false
	}
	if len(slots) == 0 {
		if len(t.stagger) > 0 {
			opts := make([]domain.MenuOption, len(t.stagger))
			for i, o := range t.stagger {
				opts[i] = domain.MenuOption{Key: strconv.Itoa(i + 1), Label: o.label(l, s.People), Value: o.value(s.People)}
			}
			s.SetMenu(domain.StepTime, opts)
			return domain.AskTimeStaggered(l, s.Date, s.People, opts), false
		}
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
		label := domain.Clock(sl.At) + " (" + domain.PeriodLabel(l, domain.PeriodOf(domain.ClockMinute(sl.At))) + ")"
		opts[i] = domain.MenuOption{Key: strconv.Itoa(i + 1), Label: label, Value: sl.ISO}
	}
	requested := ""
	if s.WantedTime != "" {
		requested = strings.Replace(s.WantedTime, ":", ".", 1)
		s.WantedTime = ""
	}
	s.SetMenu(domain.StepTime, opts)
	return domain.AskTime(l, s.Date, opts, requested), false
}

// noSlots offers the next days with room, the other outlets the same day
// and the waitlist.
func (t *turn) noSlots(ctx context.Context) string {
	s := t.sess
	l := s.Lang
	if t.banned {
		s.SetMenu(domain.StepDate, nil)
		return domain.NoSlotsClosed(l, s.Date, s.People)
	}
	day, _ := time.ParseInLocation("2006-01-02", s.Date, domain.WIB)
	var opts []domain.MenuOption
	add := func(label, value string) {
		opts = append(opts, domain.MenuOption{Key: strconv.Itoa(len(opts) + 1), Label: label, Value: value})
	}
	days := 0
	for i := 1; i <= 7 && days < 3; i++ {
		d := day.AddDate(0, 0, i).Format("2006-01-02")
		slots, err := t.slots(ctx, d)
		if err != nil {
			break
		}
		if len(slots) > 0 {
			add(domain.SlotsAvailableLabel(l, d, len(slots)), d)
			days++
		}
	}
	if len(s.Outlets) == 0 {
		t.loadOutlets(ctx)
	}
	for _, o := range s.Outlets {
		if o.ID == s.OutletID {
			continue
		}
		n := t.e.countSlots(ctx, o.ID, s.Date, s.FirstVariantIDs(), s.Pref, s.People, t.at)
		if n > 0 {
			add(domain.OtherOutletLabel(l, o.Name, n), "outlet:"+o.ID+":"+s.Date)
		}
	}
	if s.WaitlistID == "" {
		add(domain.WaitlistOptionLabel(l, s.Date), "waitlist:"+s.Date)
	}
	s.SetMenu(domain.StepDate, opts)
	return domain.NoSlots(l, s.Date, opts, s.People)
}

// countSlots is how many starts an outlet has on a day for a party (the
// first ten nearest are checked for groups, like slots()).
func (e *Engine) countSlots(ctx context.Context, outletID, date string, variantIDs []string, pref string, people int, after time.Time) int {
	raw, err := e.ports.Spa.Slots(ctx, outletID, date, variantIDs, pref)
	if err != nil {
		return 0
	}
	n := 0
	for i, r := range raw {
		at := time.Time(r.StartsAt)
		if !at.After(after) {
			continue
		}
		if people <= 1 {
			n++
			continue
		}
		if i >= 10 {
			break
		}
		free, err := e.ports.Spa.Therapists(ctx, outletID, at, variantIDs, pref)
		if err == nil && len(free) >= people {
			n++
		}
	}
	return n
}

// joinWaitlist records the wish for date and tells the guest.
func (t *turn) joinWaitlist(ctx context.Context, date string) string {
	s := t.sess
	l := s.Lang
	ids := make([]string, 0, len(s.Persons))
	labels := make([]string, 0, len(s.Persons))
	for _, p := range s.Persons {
		ids = append(ids, p.VariantID)
		labels = append(labels, p.Label)
	}
	people := s.People
	if people == 0 {
		people = 1
	}
	name := s.Name
	if name == "" && looksLikeName(t.conv.DisplayName) {
		name = t.conv.DisplayName
	}
	e, err := t.e.ports.Spa.JoinWaitlist(ctx, spa.WaitlistInput{
		BranchID: s.OutletID, CustomerName: name, CustomerPhone: t.conv.Phone, ConversationID: t.conv.ID,
		VisitDate: date, Period: s.Period, People: people, VariantIDs: ids, VariantLabels: labels, Source: "whatsapp",
	})
	if err != nil {
		t.e.log.Warn("[wabot] daftar tunggu gagal", "error", err)
		if l == domain.LangEN {
			return "Sorry, I can't add you to the waitlist right now. Please try again shortly, or type *admin*."
		}
		return "Maaf, daftar tunggu sedang tidak bisa dicatat. Coba lagi sebentar, atau ketik *admin*."
	}
	s.WaitlistID = e.ID
	// The draft stays (outlet, guests, treatments); only the day is open again.
	s.Date, s.Period = "", ""
	s.ClearSlot()
	s.ClearMenu()
	return domain.WaitlistJoined(l, s.OutletName, date, people, e.Period)
}

func (t *turn) cancelWaitlist(ctx context.Context) {
	s := t.sess
	if s.WaitlistID == "" {
		return
	}
	if err := t.e.ports.Spa.CancelWaitlist(ctx, s.WaitlistID); err != nil {
		t.e.log.Warn("[wabot] batal daftar tunggu gagal", "error", err)
	}
	s.WaitlistID, s.FromWaitlist = "", false
}

func (t *turn) promptTherapist(ctx context.Context) (string, bool) {
	s := t.sess
	l := s.Lang
	at, err := domain.ParseISO(s.SlotISO)
	if err != nil {
		s.ClearSlot()
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
	opts := []domain.MenuOption{{Key: "0", Label: domain.SystemPickLabel(l), Value: "system"}}
	for i, th := range list {
		if i >= 8 {
			break
		}
		label := th.Name
		if th.Gender != nil {
			label += domain.GenderSuffix(l, *th.Gender)
		}
		opts = append(opts, domain.MenuOption{Key: strconv.Itoa(i + 1), Label: label, Value: th.ID})
	}
	s.SetMenu(domain.StepTherapist, opts)
	return domain.AskTherapist(l, opts, s.Pref), false
}

// promptRoom offers the rooms free for the whole party's time (skipped
// when the outlet has none free, or rooms cannot be read).
func (t *turn) promptRoom(ctx context.Context) (string, bool) {
	s := t.sess
	l := s.Lang
	start, err := domain.ParseISO(s.SlotISO)
	if err != nil {
		s.ClearSlot()
		return "", true
	}
	end := start
	for i, p := range s.Persons {
		at := start
		if v, err := domain.ParseISO(s.SlotOf(i)); err == nil {
			at = v
		}
		if e := at.Add(time.Duration(p.DurationMin) * time.Minute); e.After(end) {
			end = e
		}
	}
	people := s.People
	if people < 1 {
		people = 1
	}
	rooms, err := t.e.ports.Spa.Rooms(ctx, s.OutletID, start, end, people)
	if err != nil {
		t.e.log.Warn("[wabot] daftar room gagal", "error", err)
	}
	if err != nil || len(rooms) == 0 {
		s.RoomDone = true
		return "", true
	}
	opts := []domain.MenuOption{{Key: "0", Label: domain.NoRoomLabel(l), Value: "none"}}
	for i, r := range rooms {
		if i >= 8 {
			break
		}
		opts = append(opts, domain.MenuOption{Key: strconv.Itoa(i + 1), Label: domain.RoomLabel(l, r.Name, r.Capacity, r.PriceIDR),
			Value: r.ID + "|" + strconv.FormatFloat(r.PriceIDR, 'f', -1, 64)})
	}
	s.RoomAsked = true
	s.SetMenu(domain.StepRoom, opts)
	return domain.AskRoom(l, opts, people), false
}

/* ── actions ─────────────────────────────────────────────────────────── */

// createBookings books the guest, or the whole group in one go (all or
// nothing, each guest at their own start when staggered).
func (t *turn) createBookings(ctx context.Context) {
	s := t.sess
	at, err := domain.ParseISO(s.SlotISO)
	if err != nil {
		s.ClearSlot()
		return
	}
	notes := "Booking lewat chat WhatsApp (" + t.settings.Name + ")"
	if len(s.Persons) == 1 {
		in := spa.PublicBookingInput{
			BranchID: s.OutletID, ScheduledAt: at, CustomerName: s.Name, CustomerPhone: t.conv.Phone,
			TherapistGenderPref: s.Pref, Notes: notes, VariantIDs: []string{s.Persons[0].VariantID},
			PaymentMethod: "outlet", Source: "whatsapp", TherapistID: s.TherapistID, RoomID: s.RoomID,
		}
		res, err := t.e.ports.Spa.Book(ctx, in)
		if err != nil {
			t.bookingFailed(err, nil)
			return
		}
		s.Bookings = []domain.BookingRef{t.refOf(res, in.CustomerName, at)}
		t.justBooked = true
		return
	}
	in := spa.PublicGroupInput{
		BranchID: s.OutletID, CustomerName: s.Name, CustomerPhone: t.conv.Phone, TherapistGenderPref: s.Pref,
		Notes: notes, PaymentMethod: "outlet", Source: "whatsapp", RoomID: s.RoomID,
	}
	starts := make([]time.Time, len(s.Persons))
	for i, p := range s.Persons {
		starts[i] = at
		if p.SlotISO != "" {
			if own, err := domain.ParseISO(p.SlotISO); err == nil {
				starts[i] = own
			}
		}
		in.Guests = append(in.Guests, spa.PublicGuest{VariantIDs: []string{p.VariantID}, ScheduledAt: starts[i]})
	}
	results, err := t.e.ports.Spa.BookGroup(ctx, in)
	if err != nil {
		t.bookingFailed(err, nil)
		return
	}
	s.Bookings = s.Bookings[:0]
	for i, res := range results {
		s.Bookings = append(s.Bookings, t.refOf(res, s.Name+" ("+strconv.Itoa(i+1)+")", starts[i]))
	}
	t.justBooked = true
}

func (t *turn) refOf(res *spa.PublicBookingResult, customer string, at time.Time) domain.BookingRef {
	ref := domain.BookingRef{Code: res.BookingCode, Token: res.AccessToken, Customer: customer, When: domain.Clock(at),
		StatusURL: strings.TrimRight(t.e.ports.AppURL, "/") + "/booking/spa/status/" + res.AccessToken}
	if res.Deposit.Status == "pending" || res.Deposit.Status == "paid" {
		ref.DepositIDR, ref.DepositStatus = res.Deposit.AmountIDR, res.Deposit.Status
		if res.Deposit.InvoiceURL != nil {
			ref.DepositURL = *res.Deposit.InvoiceURL
		}
		if res.Deposit.HoldUntil != nil {
			ref.DepositUntil = domain.Clock(time.Time(*res.Deposit.HoldUntil))
		}
	}
	return ref
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
	case strings.Contains(msg, "terlalu banyak"):
		// Not a handover: the guest can free a slot (cancel via the status
		// link) or ask for an admin; the bot keeps answering.
		if s.Lang == domain.LangEN {
			msg = "This number already has too many active bookings. Cancel the ones you no longer need via the status link, or type *status* / *admin*."
		} else {
			msg += " Ketik *status* untuk melihat booking terakhir Anda, atau *admin* untuk dibantu tim Mizu."
		}
	case strings.Contains(msg, "Terapis pilihanmu"):
		s.TherapistID, s.TherapistName = "", ""
	case strings.Contains(msg, "penuh") || strings.Contains(msg, "lewat"):
		s.ClearSlot()
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
	l := s.Lang
	remaining := 0.0
	for i, b := range s.Bookings {
		res, err := t.e.ports.Spa.Booking(ctx, b.Token)
		if err != nil {
			continue
		}
		if res.PaymentStatus == "paid" {
			s.Bookings[i].Paid = true
		}
		if b.DepositStatus != "" {
			s.Bookings[i].DepositStatus = res.Deposit.Status
			remaining += res.Deposit.RemainingIDR
		}
	}
	if len(s.Bookings) == 0 {
		return domain.StatusOf(l, nil)
	}
	if s.PayMethod == "deposit" {
		allPaid := true
		for _, b := range s.Bookings {
			allPaid = allPaid && b.DepositStatus == "paid"
		}
		return domain.DepositSeen(l, allPaid, s.Bookings[0].Code, remaining)
	}
	allPaid := true
	for _, b := range s.Bookings {
		allPaid = allPaid && b.Paid
	}
	return domain.PaymentSeen(l, allPaid, s.Bookings[0].Code)
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

func openWord(l domain.L) string {
	if l == domain.LangEN {
		return "open"
	}
	return "buka"
}
