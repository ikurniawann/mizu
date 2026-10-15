package procurement

import (
	"context"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/database"
)

// Pengaturan Pembelian: the purchasing rules stored in
// configuration.app_settings. A missing key keeps the behaviour the app had
// before the rule became configurable.
const (
	// SettingPoRequiresPrRawMaterial: a raw-material PO must come from an
	// approved PR (default true).
	SettingPoRequiresPrRawMaterial = "po_requires_pr_raw_material"
	// SettingPoRequiresPrProduct: a product PO must come from an approved PR
	// (default false).
	SettingPoRequiresPrProduct = "po_requires_pr_product"
)

var purchasingSettingKeys = []string{SettingPoRequiresPrRawMaterial, SettingPoRequiresPrProduct}

// PurchasingSettings is the GET/PUT /api/purchasing/settings body.
type PurchasingSettings struct {
	PoRequiresPrRawMaterial bool `json:"po_requires_pr_raw_material"`
	PoRequiresPrProduct     bool `json:"po_requires_pr_product"`
}

// DefaultPurchasingSettings is the behaviour before the rules were stored:
// raw-material POs need a PR, product POs do not.
func DefaultPurchasingSettings() PurchasingSettings {
	return PurchasingSettings{PoRequiresPrRawMaterial: true, PoRequiresPrProduct: false}
}

// RequiresPr reports whether a PO of moduleType must name an approved PR.
// General (operational goods) POs are not governed by these rules.
func (p PurchasingSettings) RequiresPr(moduleType string) bool {
	switch moduleType {
	case "raw_material":
		return p.PoRequiresPrRawMaterial
	case "product":
		return p.PoRequiresPrProduct
	}
	return false
}

// PurchasingSettingsPatch is a PUT body; nil fields were not sent.
type PurchasingSettingsPatch struct {
	PoRequiresPrRawMaterial *bool
	PoRequiresPrProduct     *bool
}

// settingBool reads a stored flag; a missing or unreadable value keeps def.
func settingBool(v *string, def bool) bool {
	if v == nil {
		return def
	}
	switch strings.ToLower(strings.TrimSpace(*v)) {
	case "true", "1", "yes", "on":
		return true
	case "false", "0", "no", "off":
		return false
	}
	return def
}

// PurchasingSettings reads the rules on q (the pool, or the caller's tx).
func (s *Service) PurchasingSettings(ctx context.Context, q database.Querier) (PurchasingSettings, error) {
	out := DefaultPurchasingSettings()
	if s.ports.Settings == nil {
		return out, nil
	}
	stored, err := s.ports.Settings.GetMany(ctx, q, purchasingSettingKeys)
	if err != nil {
		return out, err
	}
	out.PoRequiresPrRawMaterial = settingBool(stored[SettingPoRequiresPrRawMaterial], out.PoRequiresPrRawMaterial)
	out.PoRequiresPrProduct = settingBool(stored[SettingPoRequiresPrProduct], out.PoRequiresPrProduct)
	return out, nil
}

// UpdatePurchasingSettings stores the sent rules and writes the audit entry
// (before/after) in the same transaction.
func (s *Service) UpdatePurchasingSettings(ctx context.Context, patch PurchasingSettingsPatch, entry audit.Entry) (PurchasingSettings, error) {
	var after PurchasingSettings
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		before, err := s.PurchasingSettings(ctx, tx)
		if err != nil {
			return err
		}
		after = before
		if patch.PoRequiresPrRawMaterial != nil {
			after.PoRequiresPrRawMaterial = *patch.PoRequiresPrRawMaterial
		}
		if patch.PoRequiresPrProduct != nil {
			after.PoRequiresPrProduct = *patch.PoRequiresPrProduct
		}
		if s.ports.Settings == nil {
			return nil
		}
		values := map[string]bool{
			SettingPoRequiresPrRawMaterial: after.PoRequiresPrRawMaterial,
			SettingPoRequiresPrProduct:     after.PoRequiresPrProduct,
		}
		for _, key := range purchasingSettingKeys {
			v := strconv.FormatBool(values[key])
			if err := s.ports.Settings.Put(ctx, tx, key, &v); err != nil {
				return err
			}
		}
		if before == after {
			return nil
		}
		label := "Pengaturan Pembelian"
		entry.Action, entry.Entity, entry.EntityLabel = "purchasing_settings.update", "purchasing_settings", &label
		entry.Before, entry.After = before, after
		return audit.Write(ctx, tx, entry)
	})
	return after, err
}

// poRequiresPrMessage is the 400 when a PO without PR breaks the rule.
func poRequiresPrMessage(moduleType string) string {
	if moduleType == "product" {
		return "PO produk harus dibuat dari purchase request yang disetujui (aturan di Pengaturan Pembelian)"
	}
	return "PO bahan baku harus dibuat dari purchase request yang disetujui (aturan di Pengaturan Pembelian)"
}
