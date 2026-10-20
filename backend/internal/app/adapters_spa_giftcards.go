package app

import (
	"context"
	"log/slog"
	"time"

	"nuhabit/backend/internal/modules/spa"
	"nuhabit/backend/internal/modules/storedvalue/giftcards"
	gcdomain "nuhabit/backend/internal/modules/storedvalue/giftcards/domain"
)

// spaGiftCards issues the gift card of a gift voucher bought online (spa →
// stored value); every call runs on the spa transaction's querier.
type spaGiftCards struct{ svc *giftcards.Service }

var _ spa.GiftCards = spaGiftCards{}

func newSpaGiftCards() spaGiftCards {
	// The methods used here take the caller's querier; no pool is needed.
	return spaGiftCards{svc: giftcards.NewService(nil, giftcards.Ports{Settings: appSettings{}, Catalog: posCatalog{}}, time.Now, slog.Default())}
}

func (g spaGiftCards) Config(ctx context.Context, q spa.Q) (spa.GiftConfig, error) {
	cfg, err := g.svc.LoadConfig(ctx, q)
	if err != nil {
		return spa.GiftConfig{}, err
	}
	return spa.GiftConfig{Presets: cfg.Presets, AllowCustom: cfg.AllowCustom, ExpiryMonths: cfg.ExpiryMonths,
		Rejection: gcdomain.NominalRejection(cfg)}, nil
}

func (g spaGiftCards) Allowed(cfg spa.GiftConfig, nominal float64) bool {
	return gcdomain.IsAllowedNominal(gcdomain.Config{Presets: cfg.Presets, AllowCustom: cfg.AllowCustom, ExpiryMonths: cfg.ExpiryMonths}, nominal)
}

func (g spaGiftCards) Issue(ctx context.Context, q spa.Q, in spa.GiftIssue) (spa.GiftIssued, error) {
	card, err := g.svc.IssueForInvoice(ctx, q, giftcards.InvoiceIssueInput{
		Scope: giftcards.Scope{CompanyID: in.CompanyID, BranchID: in.BranchID}, SourceID: in.OrderID, Nominal: in.Nominal,
		BuyerName: optional(in.BuyerName), BuyerPhone: optional(in.BuyerPhone), Note: in.Note,
	})
	if err != nil {
		return spa.GiftIssued{}, err
	}
	out := spa.GiftIssued{ID: card.ID, Code: card.Code}
	if card.ExpiresAt != nil {
		t := time.Time(*card.ExpiresAt)
		out.ExpiresAt = &t
	}
	return out, nil
}
