package insights

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
)

type salesTargetYear struct {
	Year   int         `json:"year"`
	Months [12]float64 `json:"months"`
	Total  float64     `json:"total"`
}

type targetCellChange struct {
	BranchID string   `json:"branch_id"`
	Month    int      `json:"month"`
	Amount   *float64 `json:"amount"`
	Previous *float64 `json:"previous"`
}

func targetYear(r *http.Request) (int, error) {
	year, err := strconv.Atoi(r.PathValue("year"))
	if err != nil || year < 2000 || year > 2100 {
		return 0, httpx.BadRequest("Tahun harus antara 2000 dan 2100")
	}
	return year, nil
}

func (s *Service) listSalesTargetYears(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	outlets, err := s.salesOutlets(r.Context(), u.ID)
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(outlets))
	for _, outlet := range outlets {
		ids = append(ids, outlet.ID)
	}
	rows, err := s.db.Query(r.Context(), `SELECT extract(year FROM month)::int,extract(month FROM month)::int,sum(amount)::float8
 FROM configuration.monthly_sales_targets WHERE branch_id=ANY($1::uuid[]) GROUP BY 1,2 ORDER BY 1 DESC,2`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	years := []salesTargetYear{}
	for rows.Next() {
		var year, month int
		var amount float64
		if err := rows.Scan(&year, &month, &amount); err != nil {
			return err
		}
		if len(years) == 0 || years[len(years)-1].Year != year {
			years = append(years, salesTargetYear{Year: year})
		}
		row := &years[len(years)-1]
		row.Months[month-1] = amount
		row.Total += amount
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, map[string]any{"outlets": outlets, "years": years})
}

func (s *Service) saveSalesTargetYear(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	year, err := targetYear(r)
	if err != nil {
		return err
	}
	var body struct {
		Changes []targetCellChange `json:"changes"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&body); err != nil || len(body.Changes) == 0 || len(body.Changes) > 12000 {
		return httpx.BadRequest("Isi perubahan target yang valid (maksimal 12.000 sel)")
	}
	outlets, err := s.salesOutlets(r.Context(), u.ID)
	if err != nil {
		return err
	}
	allowed := make(map[string]bool, len(outlets))
	for _, outlet := range outlets {
		allowed[outlet.ID] = true
	}
	seen := make(map[string]bool, len(body.Changes))
	for _, cell := range body.Changes {
		if !allowed[cell.BranchID] {
			return httpx.Forbidden("Outlet di luar akses Anda")
		}
		key := fmt.Sprintf("%s/%d", cell.BranchID, cell.Month)
		if cell.Month < 1 || cell.Month > 12 || seen[key] {
			return httpx.BadRequest("Bulan tidak valid atau sel target berulang")
		}
		seen[key] = true
		for _, amount := range []*float64{cell.Amount, cell.Previous} {
			if amount != nil && (math.IsNaN(*amount) || math.IsInf(*amount, 0) || *amount <= 0 || *amount > 100000000000 || math.Round(*amount*100) == 0) {
				return httpx.BadRequest("Target harus lebih dari 0 dan maksimal Rp 100 miliar; gunakan sel kosong untuk menghapus")
			}
		}
	}
	permissions := map[string]bool{}
	for _, action := range []string{"create", "update", "delete"} {
		permissions[action], err = s.auth.HasMenuAction(r.Context(), u, action, iam.ReportSalesTarget...)
		if err != nil {
			return err
		}
	}
	// Lock cells in a stable order. Only changed cells are written, so editing
	// one outlet does not overwrite another editor's untouched cells.
	slices.SortFunc(body.Changes, func(a, b targetCellChange) int {
		if cmp := strings.Compare(a.BranchID, b.BranchID); cmp != 0 {
			return cmp
		}
		return a.Month - b.Month
	})
	err = database.WithTx(r.Context(), s.db, func(tx pgx.Tx) error {
		for _, cell := range body.Changes {
			month := fmt.Sprintf("%04d-%02d-01", year, cell.Month)
			var current float64
			err := tx.QueryRow(r.Context(), `SELECT amount::float8 FROM configuration.monthly_sales_targets WHERE branch_id=$1 AND month=$2::date FOR UPDATE`, cell.BranchID, month).Scan(&current)
			exists := err == nil
			if err != nil && !database.IsNoRows(err) {
				return err
			}
			if exists != (cell.Previous != nil) || (exists && math.Round(current*100) != math.Round(*cell.Previous*100)) {
				return httpx.Conflict("Target telah berubah. Muat ulang data sebelum menyimpan kembali")
			}
			if !exists && cell.Amount == nil {
				continue
			}
			action := "create"
			if cell.Amount == nil {
				action = "delete"
			} else if exists {
				action = "update"
			}
			if !permissions[action] {
				return httpx.Forbidden("Anda tidak memiliki akses " + action + " target sales")
			}
			switch action {
			case "delete":
				_, err = tx.Exec(r.Context(), `DELETE FROM configuration.monthly_sales_targets WHERE branch_id=$1 AND month=$2::date`, cell.BranchID, month)
			case "update":
				_, err = tx.Exec(r.Context(), `UPDATE configuration.monthly_sales_targets SET amount=$3,updated_by=$4,updated_at=now() WHERE branch_id=$1 AND month=$2::date`, cell.BranchID, month, *cell.Amount, u.ID)
			case "create":
				tag, insertErr := tx.Exec(r.Context(), `INSERT INTO configuration.monthly_sales_targets(branch_id,month,amount,created_by,updated_by) VALUES ($1,$2::date,$3,$4,$4) ON CONFLICT (branch_id,month) DO NOTHING`, cell.BranchID, month, *cell.Amount, u.ID)
				err = insertErr
				if err == nil && tag.RowsAffected() == 0 {
					return httpx.Conflict("Target telah berubah. Muat ulang data sebelum menyimpan kembali")
				}
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, map[string]int{"year": year})
}

func (s *Service) deleteSalesTargetYear(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	year, err := targetYear(r)
	if err != nil {
		return err
	}
	outlets, err := s.salesOutlets(r.Context(), u.ID)
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(outlets))
	for _, outlet := range outlets {
		ids = append(ids, outlet.ID)
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM configuration.monthly_sales_targets WHERE branch_id=ANY($1::uuid[]) AND extract(year FROM month)=$2`, ids, year)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Target tahun tidak ditemukan")
	}
	return httpx.Data(w, http.StatusOK, map[string]int{"year": year})
}
