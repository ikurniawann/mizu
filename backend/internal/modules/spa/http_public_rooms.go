package spa

import (
	"net/http"
	"time"

	"nuhabit/backend/internal/platform/httpx"
)

// publicRooms: GET /api/public/spa/outlets/{branchId}/rooms?starts_at=…&variant_ids=…
// lists the rooms a guest may choose for that start (revisi R6 lanjutan).
func (h *Handler) publicRooms(w http.ResponseWriter, r *http.Request) error {
	branchID, err := pathUUID(r, "branchId")
	if err != nil {
		return err
	}
	at, err := time.Parse(time.RFC3339, r.URL.Query().Get("starts_at"))
	if err != nil {
		return httpx.BadRequest("Jam mulai tidak valid")
	}
	ids, _, err := publicSlotQuery(r)
	if err != nil {
		return err
	}
	list, err := h.svc.PublicRooms(r.Context(), branchID, at, ids)
	if err != nil {
		return err
	}
	return ok(w, list)
}
