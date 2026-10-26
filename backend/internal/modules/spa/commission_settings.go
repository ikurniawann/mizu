package spa

import (
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

type CommissionSetting struct {
	VariantID     string      `json:"variant_id"`
	TreatmentName string      `json:"treatment_name"`
	VariantName   string      `json:"variant_name"`
	DurationMin   int         `json:"duration_min"`
	IsActive      bool        `json:"is_active"`
	Values        [3]*float64 `json:"values"`
}

type commissionSettingInput struct {
	VariantID string     `json:"variant_id"`
	Values    []*float64 `json:"values"`
}

func (s *Service) CommissionSettings(ctx context.Context) ([]CommissionSetting, error) {
	return many(ctx, s.db, func(r pgx.Row) (CommissionSetting, error) {
		var v CommissionSetting
		err := r.Scan(&v.VariantID, &v.TreatmentName, &v.VariantName, &v.DurationMin, &v.IsActive, &v.Values[0], &v.Values[1], &v.Values[2])
		return v, err
	}, `SELECT v.id::text,t.name,v.name,v.duration_min,(v.is_active AND t.is_active),
  max(r.value) FILTER(WHERE r.therapist_level=0),max(r.value) FILTER(WHERE r.therapist_level=1),max(r.value) FILTER(WHERE r.therapist_level=2)
 FROM spa.treatment_variants v JOIN spa.treatments t ON t.id=v.treatment_id
 LEFT JOIN spa.commission_rules r ON r.variant_id=v.id AND r.is_active
 GROUP BY v.id,t.name,t.is_active ORDER BY t.name,v.duration_min,v.name,v.id`)
}

func (s *Service) saveCommissionSettings(ctx context.Context, userID string, rows []commissionSettingInput) error {
	if len(rows) == 0 || len(rows) > 500 {
		return httpx.BadRequest("Isi 1–500 varian per penyimpanan")
	}
	seen := map[string]bool{}
	for i := range rows {
		rows[i].VariantID = strings.ToLower(rows[i].VariantID)
		row := rows[i]
		if !validate.IsUUID(row.VariantID) || seen[row.VariantID] || len(row.Values) != 3 {
			return httpx.BadRequest("Varian harus unik dengan tiga tarif level")
		}
		seen[row.VariantID] = true
		for _, v := range row.Values {
			if v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) || *v < 0 || *v > 999999999999 || math.Trunc(*v) != *v {
				return httpx.BadRequest("Isi nominal rupiah bulat untuk Level 0, Level 1 dan Level 2")
			}
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].VariantID < rows[j].VariantID })
	return s.tx(ctx, func(q Q) error {
		for _, row := range rows {
			var exists bool
			if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM spa.treatment_variants WHERE id=$1)`, row.VariantID).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return httpx.BadRequest("Varian treatment tidak ditemukan")
			}
			for level, value := range row.Values {
				_, err := q.Exec(ctx, `INSERT INTO spa.commission_rules(variant_id,therapist_level,commission_type,value,updated_by)
     VALUES($1,$2,'fixed',$3,$4) ON CONFLICT(variant_id,therapist_level) DO UPDATE
     SET value=EXCLUDED.value,is_active=true,updated_at=now(),updated_by=EXCLUDED.updated_by`, row.VariantID, level, *value, userID)
				if err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func (h *Handler) commissionSettingRoutes() []module.Route {
	action := func(pattern, permission string, fn staffFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			u, err := h.auth.RequireMenuAction(r, permission, "spa.commission-settings")
			if err != nil {
				return err
			}
			return fn(w, r, u)
		})}
	}
	return []module.Route{
		action("GET /api/spa/commission-settings", "read", h.commissionSettings),
		action("PUT /api/spa/commission-settings", "update", h.saveCommissionSettings),
	}
}
func (h *Handler) commissionSettings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := h.svc.CommissionSettings(r.Context())
	if err != nil {
		return err
	}
	return ok(w, rows)
}
func (h *Handler) saveCommissionSettings(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var in struct {
		Rows []commissionSettingInput `json:"rows"`
	}
	d := json.NewDecoder(io.LimitReader(r.Body, 256<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(&in); err != nil {
		return httpx.BadRequest("Data komisi tidak valid")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return httpx.BadRequest("Data komisi tidak valid")
	}
	if err := h.svc.saveCommissionSettings(r.Context(), u.ID, in.Rows); err != nil {
		return err
	}
	return h.commissionSettings(w, r, u)
}

func (h *Handler) myCommissionRates(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	t, err := h.svc.requireMe(r.Context(), u.ID)
	if err != nil {
		return err
	}
	rows, err := h.svc.CommissionSettings(r.Context())
	if err != nil {
		return err
	}
	type rate struct {
		VariantID     string   `json:"variant_id"`
		TreatmentName string   `json:"treatment_name"`
		VariantName   string   `json:"variant_name"`
		Value         *float64 `json:"value"`
	}
	rates := []rate{}
	for _, row := range rows {
		if row.IsActive {
			rates = append(rates, rate{row.VariantID, row.TreatmentName, row.VariantName, row.Values[t.Level]})
		}
	}
	return ok(w, struct {
		Level int    `json:"level"`
		Rates []rate `json:"rates"`
	}{t.Level, rates})
}

func (h *Handler) legacyCommissionRule(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	return httpx.BadRequest("Gunakan halaman Pengaturan Komisi untuk tarif varian dan level")
}
