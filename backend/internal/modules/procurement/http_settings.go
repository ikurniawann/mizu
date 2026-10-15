package procurement

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Pengaturan Pembelian (born in Go, no TypeScript route).
func (h *Handler) settingsRoutes(add addRoute) {
	add("GET /api/purchasing/settings", h.getSettings)
	add("PUT /api/purchasing/settings", h.updateSettings)
}

// getSettings is open to every purchasing user: the PO forms read the rules.
func (h *Handler) getSettings(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	data, err := h.svc.PurchasingSettings(r.Context(), h.svc.db)
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

// updateSettings needs "update" on the Pengaturan Pembelian menu.
func (h *Handler) updateSettings(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuAction(r, "update", iam.ItemsPurchasingSettings...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	patch := PurchasingSettingsPatch{
		PoRequiresPrRawMaterial: f.Bool(SettingPoRequiresPrRawMaterial, validate.Rule{Optional: true}),
		PoRequiresPrProduct:     f.Bool(SettingPoRequiresPrProduct, validate.Rule{Optional: true}),
	}
	if err := firstIssueError(f, "Validasi gagal"); err != nil {
		return err
	}
	if patch.PoRequiresPrRawMaterial == nil && patch.PoRequiresPrProduct == nil {
		return httpx.BadRequest("Tidak ada pengaturan yang diubah")
	}
	data, err := h.svc.UpdatePurchasingSettings(r.Context(), patch, actorAudit(user).WithRequest(r))
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "Pengaturan pembelian disimpan")
}
