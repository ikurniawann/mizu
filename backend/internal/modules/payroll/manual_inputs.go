package payroll

import (
	"context"
	"encoding/csv"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Manual slip components (EPIC-055, Odoo "Other Inputs"): bonus, incentive,
// penalty, … per run × employee × code, read by Hitung. Editable only while
// the run is a draft; a change needs a new Hitung to reach the slip.

const inputsDraftOnly = "Komponen manual hanya bisa diubah saat payroll masih draft"

func (s *service) draftRun(ctx context.Context, runID string) error {
	run := runHeadByID(ctx, s.db, runID)
	if run == nil {
		return httpx.NotFound("Payroll run tidak ditemukan")
	}
	if !domain.CanCalculateRun(run.Status) {
		return httpx.BadRequest(inputsDraftOnly)
	}
	return nil
}

func (s *service) listInputs(ctx context.Context, runID string) ([]*obj, error) {
	if runHeadByID(ctx, s.db, runID) == nil {
		return nil, httpx.NotFound("Payroll run tidak ditemukan")
	}
	return queryObjs(ctx, s.db, `SELECT i.id, i.payroll_run_id, i.employee_id, i.code, i.amount, i.note,
			i.created_at, i.updated_at, e.full_name AS employee_name, e.nip AS employee_nip
		FROM hris.payroll_inputs i JOIN hris.employees e ON e.id = i.employee_id
		WHERE i.payroll_run_id = $1 ORDER BY e.full_name, i.code`, runID)
}

// upsertInput writes one component; amount 0 removes it.
func (s *service) upsertInput(ctx context.Context, runID, employeeID, code string, amount float64, note *string, userID string) (*obj, error) {
	if amount == 0 {
		_, err := s.db.Exec(ctx, `DELETE FROM hris.payroll_inputs WHERE payroll_run_id = $1 AND employee_id = $2 AND code = $3`,
			runID, employeeID, code)
		return nil, err
	}
	return queryObj(ctx, s.db, `INSERT INTO hris.payroll_inputs (payroll_run_id, employee_id, code, amount, note, created_by)
		VALUES ($1, $2, $3, $4, $5, $6::uuid)
		ON CONFLICT (payroll_run_id, employee_id, code)
		DO UPDATE SET amount = EXCLUDED.amount, note = EXCLUDED.note, updated_at = now()
		RETURNING *`, runID, employeeID, code, numParam(amount), note, nilIfEmpty(userID))
}

func (s *service) employeeExists(ctx context.Context, id string) (bool, error) {
	var ok bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM hris.employees WHERE id::text = $1)`, id).Scan(&ok)
	return ok, err
}

// importResult is the outcome of a CSV import.
type importResult struct {
	Imported int           `json:"imported"`
	Errors   []importIssue `json:"errors"`
}

type importIssue struct {
	Line    int    `json:"line"`
	Message string `json:"message"`
}

// importInputs reads "nip,kode,nominal[,catatan]" lines (header optional).
func (s *service) importInputs(ctx context.Context, runID, text, userID string) (*importResult, error) {
	r := csv.NewReader(strings.NewReader(text))
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = true
	records, err := r.ReadAll()
	if err != nil {
		return nil, httpx.BadRequest("CSV tidak bisa dibaca: " + err.Error())
	}
	out := &importResult{Errors: []importIssue{}}
	codes := domain.ManualInputCodes()
	for i, rec := range records {
		line := i + 1
		if len(rec) == 0 || (len(rec) == 1 && strings.TrimSpace(rec[0]) == "") {
			continue
		}
		if i == 0 && strings.EqualFold(strings.TrimSpace(rec[0]), "nip") {
			continue
		}
		if len(rec) < 3 {
			out.Errors = append(out.Errors, importIssue{line, "Kolom kurang: nip, kode, nominal[, catatan]"})
			continue
		}
		nip, code := strings.TrimSpace(rec[0]), strings.ToUpper(strings.TrimSpace(rec[1]))
		if !slices.Contains(codes, code) {
			out.Errors = append(out.Errors, importIssue{line, fmt.Sprintf("Kode %q tidak dikenal", code)})
			continue
		}
		raw := strings.NewReplacer(".", "", " ", "").Replace(strings.TrimSpace(rec[2]))
		raw = strings.Replace(raw, ",", ".", 1)
		amount, err := strconv.ParseFloat(raw, 64)
		if err != nil || amount < 0 {
			out.Errors = append(out.Errors, importIssue{line, fmt.Sprintf("Nominal %q tidak valid", rec[2])})
			continue
		}
		var employeeID string
		if err := s.db.QueryRow(ctx, `SELECT id::text FROM hris.employees WHERE nip = $1`, nip).Scan(&employeeID); err != nil {
			out.Errors = append(out.Errors, importIssue{line, fmt.Sprintf("NIP %q tidak ditemukan", nip)})
			continue
		}
		var note *string
		if len(rec) > 3 && strings.TrimSpace(rec[3]) != "" {
			n := strings.TrimSpace(rec[3])
			note = &n
		}
		if _, err := s.upsertInput(ctx, runID, employeeID, code, amount, note, userID); err != nil {
			return nil, err
		}
		out.Imported++
	}
	return out, nil
}

// GET /api/hris/payroll/{id}/inputs
func (h *handler) listInputs(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...); err != nil {
		return err
	}
	rows, err := h.svc.listInputs(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return writeJSON(w, dataBody{rows})
}

// PUT /api/hris/payroll/{id}/inputs { employee_id, code, amount, note? } — amount 0 removes.
func (h *handler) putInput(w http.ResponseWriter, r *http.Request) error {
	u, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...)
	if err != nil {
		return err
	}
	runID := r.PathValue("id")
	if err := h.svc.draftRun(r.Context(), runID); err != nil {
		return err
	}
	const msg = "Data komponen manual tidak valid"
	f, err := readJSON(r, msg)
	if err != nil {
		return err
	}
	employeeID := f.Str("employee_id", validate.Rule{}, validate.StrOpts{Min: 1})
	code := f.Enum("code", validate.Rule{}, domain.ManualInputCodes())
	amount := coerceNum(f, "amount", numRule{NumOpts: validate.NumOpts{Min: validate.Bound(0)}})
	note := f.Str("note", nullish, validate.StrOpts{Max: 500})
	if err := issuesErr(f, msg); err != nil {
		return err
	}
	if ok, err := h.svc.employeeExists(r.Context(), *employeeID); err != nil {
		return err
	} else if !ok {
		return httpx.NotFound("Karyawan tidak ditemukan")
	}
	row, err := h.svc.upsertInput(r.Context(), runID, *employeeID, *code, *amount, note, u.ID)
	if err != nil {
		return err
	}
	return writeJSON(w, dataBody{row})
}

// POST /api/hris/payroll/{id}/inputs/import { csv } — baris "nip,kode,nominal[,catatan]".
func (h *handler) importInputs(w http.ResponseWriter, r *http.Request) error {
	u, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...)
	if err != nil {
		return err
	}
	runID := r.PathValue("id")
	if err := h.svc.draftRun(r.Context(), runID); err != nil {
		return err
	}
	const msg = "Isi CSV wajib diisi"
	f, err := readJSON(r, msg)
	if err != nil {
		return err
	}
	text := f.Str("csv", validate.Rule{}, validate.StrOpts{Min: 1, Max: 2_000_000})
	if err := issuesErr(f, msg); err != nil {
		return err
	}
	res, err := h.svc.importInputs(r.Context(), runID, *text, u.ID)
	if err != nil {
		return err
	}
	return writeJSON(w, dataBody{res})
}
