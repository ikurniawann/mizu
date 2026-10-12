package wabot

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/modules/wabot/domain"
	"nuhabit/backend/internal/platform/database"
)

// WaitlistEvery is how often open waitlist entries are re-checked.
const WaitlistEvery = 10 * time.Minute

// WatchWaitlist re-checks open entries until ctx ends.
func (e *Engine) WatchWaitlist(ctx context.Context, db database.DB, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if n, err := e.NotifyWaitlist(ctx, db); err != nil {
				e.log.Error("[wabot] daftar tunggu", "error", err)
			} else if n > 0 {
				e.log.Info("[wabot] daftar tunggu dikabari", "count", n)
			}
		}
	}
}

// NotifyWaitlist tells every waiting guest whose day now has room, refills
// their bot session so "ambil" continues at the time step, and marks the
// entry notified. It returns how many guests were told.
func (e *Engine) NotifyWaitlist(ctx context.Context, db database.DB) (int, error) {
	entries, err := e.ports.Spa.OpenWaitlist(ctx)
	if err != nil {
		return 0, err
	}
	settings, err := e.st.settings(ctx, db)
	if err != nil {
		return 0, err
	}
	now := e.now()
	told := 0
	for _, entry := range entries {
		if entry.ConversationID == nil || !settings.Enabled {
			continue // front-office entries are handled by staff
		}
		ids := entry.VariantIDs
		if len(ids) > 1 {
			ids = ids[:1]
		}
		clocks := e.freeClocks(ctx, entry, ids, now)
		if len(clocks) == 0 {
			continue
		}
		conv, err := e.st.conversation(ctx, db, *entry.ConversationID)
		if err != nil || conv == nil || conv.Phone == "" {
			continue
		}
		if err := e.refillSession(ctx, db, conv, entry, now); err != nil {
			e.log.Warn("[wabot] sesi daftar tunggu", "error", err)
			continue
		}
		outlet := entry.BranchName
		if outlet == "" {
			outlet = "Mizu"
		}
		msg := domain.WaitlistAvailable(entry.CustomerName, outlet, entry.VisitDate, clocks)
		if err := e.ports.Sender.Send(ctx, db, conv.Phone, conv.ID, msg); err != nil {
			e.log.Warn("[wabot] kabar daftar tunggu gagal dikirim", "error", err)
			continue
		}
		if err := e.ports.Spa.MarkWaitlistNotified(ctx, entry.ID); err != nil {
			return told, err
		}
		_ = e.st.afterBotReply(ctx, db, conv.ID)
		told++
	}
	return told, nil
}

// freeClocks lists up to four free starts for the entry (period and party
// size respected); empty when the day is still full.
func (e *Engine) freeClocks(ctx context.Context, entry spa.WaitlistEntry, variantIDs []string, now time.Time) []string {
	raw, err := e.ports.Spa.Slots(ctx, entry.BranchID, entry.VisitDate, variantIDs, "any")
	if err != nil {
		return nil
	}
	var clocks []string
	checked := 0
	for _, r := range raw {
		at := time.Time(r.StartsAt)
		if !at.After(now) {
			continue
		}
		if entry.Period != "" && domain.PeriodOf(domain.ClockMinute(at)) != entry.Period {
			continue
		}
		if entry.People > 1 {
			if checked >= 10 {
				break
			}
			checked++
			free, err := e.ports.Spa.Therapists(ctx, entry.BranchID, at, variantIDs, "any")
			if err != nil || len(free) < entry.People {
				continue
			}
		}
		clocks = append(clocks, domain.Clock(at))
		if len(clocks) >= 4 {
			break
		}
	}
	return clocks
}

// refillSession rebuilds the draft from the entry so the guest's "ambil"
// lands on the time question.
func (e *Engine) refillSession(ctx context.Context, db database.DB, conv *Conversation, entry spa.WaitlistEntry, now time.Time) error {
	row, err := e.st.session(ctx, db, conv.ID)
	if err != nil {
		return err
	}
	sess := domain.NewSession()
	if row != nil {
		sess = row.Session
	}
	sess.ResetBooking()
	sess.Greeted = true
	sess.WaitlistID, sess.FromWaitlist = entry.ID, true
	sess.OutletID, sess.OutletName = entry.BranchID, entry.BranchName
	if sess.Name == "" {
		sess.Name = entry.CustomerName
	}
	catalog, err := e.catalogFor(ctx, entry.BranchID)
	if err != nil {
		return err
	}
	sess.Catalog = catalog
	sess.People = entry.People
	for _, id := range entry.VariantIDs {
		for _, v := range catalog {
			if v.VariantID == id {
				sess.Persons = append(sess.Persons, personOf(v))
				break
			}
		}
	}
	if len(sess.Persons) == 0 {
		sess.People = 0 // the bot asks again
	} else if sess.People < len(sess.Persons) {
		sess.People = len(sess.Persons)
	}
	sess.Date, sess.Period = entry.VisitDate, entry.Period
	if conv.HandoverAt == nil && !conv.BotActive {
		_ = e.st.activate(ctx, db, conv.ID)
	}
	return e.st.saveSession(ctx, db, conv.ID, conv.Phone, sess, now, now, 0)
}
