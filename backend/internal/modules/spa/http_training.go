package spa

import (
	"encoding/json"
	"io"
	"net/http"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

func decodeTrainingBody(r *http.Request, out any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 64<<10))
	if err := decoder.Decode(out); err != nil {
		return httpx.BadRequest("Data training tidak valid")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return httpx.BadRequest("Data training tidak valid")
	}
	return nil
}

func (h *Handler) trainingRoutes() []module.Route {
	action := func(pattern, permission string, fn staffFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			u, err := h.auth.RequireMenuAction(r, permission, "spa.training")
			if err != nil {
				return err
			}
			return fn(w, r, u)
		})}
	}
	return []module.Route{
		action("GET /api/spa/trainings", "read", h.listTrainings),
		action("POST /api/spa/trainings", "create", h.saveTraining),
		action("PUT /api/spa/trainings/{id}", "update", h.saveTraining),
		action("GET /api/spa/trainings/{id}/participants", "read", h.trainingParticipants),
		action("POST /api/spa/trainings/{id}/participants", "create", h.enrollTraining),
		action("GET /api/spa/trainings/{id}/candidates", "read", h.trainingCandidates),
		action("POST /api/spa/training-participants/{id}/status", "update", h.reviewTraining),
		action("GET /api/spa/level-requirements", "read", h.levelRequirements),
		action("PUT /api/spa/level-requirements", "update", h.saveLevelRequirements),
	}
}

func (h *Handler) listTrainings(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	data, err := h.svc.Trainings(r.Context())
	if err != nil {
		return err
	}
	return ok(w, data)
}
func (h *Handler) saveTraining(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id := ""
	var err error
	if r.Method == "PUT" {
		id, err = pathUUID(r, "id")
		if err != nil {
			return err
		}
	}
	var in Training
	if err = decodeTrainingBody(r, &in); err != nil {
		return err
	}
	data, err := h.svc.SaveTraining(r.Context(), u.ID, id, in)
	if err != nil {
		return err
	}
	if id == "" {
		return created(w, data)
	}
	return ok(w, data)
}
func (h *Handler) trainingParticipants(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	data, err := h.svc.TrainingParticipants(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, data)
}
func (h *Handler) trainingCandidates(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	data, err := h.svc.TrainingCandidates(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, data)
}
func (h *Handler) enrollTraining(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		IDs []string `json:"therapist_ids"`
	}
	if err = decodeTrainingBody(r, &in); err != nil {
		return err
	}
	data, err := h.svc.EnrollTraining(r.Context(), u.ID, id, in.IDs)
	if err != nil {
		return err
	}
	return created(w, data)
}
func (h *Handler) reviewTraining(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Status string `json:"status"`
		Notes  string `json:"notes"`
	}
	if err = decodeTrainingBody(r, &in); err != nil {
		return err
	}
	if err = h.svc.ReviewTraining(r.Context(), u.ID, id, in.Status, in.Notes); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}
func (h *Handler) levelRequirements(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	data, err := h.svc.LevelRequirements(r.Context())
	if err != nil {
		return err
	}
	return ok(w, data)
}
func (h *Handler) saveLevelRequirements(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var in LevelRequirements
	if err := decodeTrainingBody(r, &in); err != nil {
		return err
	}
	if err := h.svc.SaveLevelRequirements(r.Context(), u.ID, in); err != nil {
		return err
	}
	return ok(w, in)
}
func (h *Handler) myTrainings(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	data, err := h.svc.MyTrainings(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, data)
}
