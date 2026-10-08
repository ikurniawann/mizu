// Package spa is the spa (Mizu) bounded context: spa outlets, treatments and
// their duration variants, therapists with loans to other outlets, bookings
// whose treatments are assigned to therapists, checkout into a POS open bill,
// and therapist commissions. EPIC-052.
//
// Staff and therapists use /api/spa, guests book through /api/public/spa.
package spa

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/outbox"
)

// Name is the MODULES key.
const Name = "spa"

// Subscriber names are contracts: renaming one drops its pending deliveries.
const (
	subscriberSalePaid    = "spa.booking-paid-on-pos-sale"
	subscriberOrdersVoids = "spa.booking-void-on-pos-void"
)

type spaModule struct{ routes []module.Route }

func (spaModule) Name() string             { return Name }
func (m spaModule) Routes() []module.Route { return m.routes }

// New mounts the module on the shared pool.
func New(deps module.Deps, ports Ports) module.Module { return NewOn(deps, deps.DB, ports) }

// NewOn mounts the module on db: the pool in production, a rolled-back
// transaction in tests.
func NewOn(deps module.Deps, db database.DB, ports Ports) module.Module {
	svc := NewService(db, ports, deps)
	Subscribe(deps.Events, svc)
	h := &Handler{svc: svc, auth: deps.Auth}
	return spaModule{routes: h.Routes()}
}

// NewService builds the service; tests drive it directly.
func NewService(db database.DB, ports Ports, deps module.Deps) *Service {
	return &Service{db: db, ports: ports, now: deps.Now, log: deps.Log}
}

// Subscribe registers the POS payment subscribers: a paid order marks its
// booking paid, a void of a paid order flags it void.
func Subscribe(bus *outbox.Bus, svc *Service) {
	if bus == nil {
		return
	}
	bus.Subscribe(possales.TopicSaleCompleted, subscriberSalePaid, func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var ev possales.SaleCompleted
		if err := e.Decode(&ev); err != nil {
			return err
		}
		return svc.OrderPaid(ctx, tx, ev.OrderID)
	})
	bus.Subscribe(possales.TopicOrdersVoided, subscriberOrdersVoids, func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var ev possales.OrdersVoided
		if err := e.Decode(&ev); err != nil {
			return err
		}
		return svc.OrdersVoided(ctx, tx, ev.OrderIDs)
	})
}
