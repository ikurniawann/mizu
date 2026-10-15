package payroll

import (
	"cmp"
	"context"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/xlsx"
)

// Laporan "Biaya Gaji per Toko": a payroll run's labour cost per store from
// hris.payroll_detail_allocations (gross, deductions, employer BPJS/Tapera,
// total labour cost = gross + employer contributions, net), with the
// employees behind each store for the drill-down, plus CSV/XLSX export.

// storeCostAmounts are the money totals of a store or an employee's share,
// summed in cents.
type storeCostAmounts struct {
	Gross        float64 `json:"gross_amount"`
	Deductions   float64 `json:"deductions_amount"`
	Pph21        float64 `json:"pph21_amount"`
	BpjsEmployee float64 `json:"bpjs_employee_amount"`
	Net          float64 `json:"net_amount"`
	EmployerTk   float64 `json:"employer_bpjs_tk_amount"`
	EmployerKes  float64 `json:"employer_bpjs_kes_amount"`
	EmployerTap  float64 `json:"employer_tapera_amount"`
	Employer     float64 `json:"employer_contribution_amount"`
	LaborCost    float64 `json:"labor_cost"`
}

type centsAcc struct{ gross, ded, pph, bpjsEmp, net, tk, kes, tap int64 }

func (a *centsAcc) add(o centsAcc) {
	a.gross += o.gross
	a.ded += o.ded
	a.pph += o.pph
	a.bpjsEmp += o.bpjsEmp
	a.net += o.net
	a.tk += o.tk
	a.kes += o.kes
	a.tap += o.tap
}

func (a centsAcc) amounts() storeCostAmounts {
	c := func(v int64) float64 { return float64(v) / 100 }
	employer := a.tk + a.kes + a.tap
	return storeCostAmounts{Gross: c(a.gross), Deductions: c(a.ded), Pph21: c(a.pph), BpjsEmployee: c(a.bpjsEmp),
		Net: c(a.net), EmployerTk: c(a.tk), EmployerKes: c(a.kes), EmployerTap: c(a.tap), Employer: c(employer),
		LaborCost: c(a.gross + employer)}
}

type storeCostStore struct {
	BranchID      *string `json:"branch_id"`
	BranchCode    *string `json:"branch_code"`
	BranchName    string  `json:"branch_name"`
	EmployeeCount int     `json:"employee_count"`
	FTE           float64 `json:"fte"`
	Days          float64 `json:"days"`
	Hours         float64 `json:"hours"`
	storeCostAmounts
}

type storeCostEmployee struct {
	EmployeeID string  `json:"employee_id"`
	FullName   string  `json:"full_name"`
	NIP        *string `json:"nip"`
	Department *string `json:"department"`
	Position   *string `json:"position"`
	BranchID   *string `json:"branch_id"`
	BranchName string  `json:"branch_name"`
	Basis      string  `json:"basis"`
	Ratio      float64 `json:"ratio"`
	Days       float64 `json:"days"`
	Hours      float64 `json:"hours"`
	storeCostAmounts
}

type storeCostRun struct {
	ID          string `json:"id"`
	RunName     string `json:"run_name"`
	PeriodMonth int    `json:"period_month"`
	PeriodYear  int    `json:"period_year"`
	Status      string `json:"status"`
	// CompanyName is the run's paying entity; nil for a legacy run without one.
	CompanyName *string `json:"company_name"`
}

type storeCostTotals struct {
	EmployeeCount int `json:"employee_count"`
	storeCostAmounts
}

type storeCostReport struct {
	Run       storeCostRun        `json:"run"`
	Stores    []storeCostStore    `json:"stores"`
	Totals    storeCostTotals     `json:"totals"`
	Employees []storeCostEmployee `json:"employees"`
	// UnallocatedSlips counts the run's slips without a store split (runs
	// calculated before the feature; recalculate a draft to fill them).
	UnallocatedSlips int `json:"unallocated_slips"`
}

const noStoreLabel = "Tanpa toko"

func (s *service) storeCostReport(ctx context.Context, runID string) (*storeCostReport, error) {
	var out storeCostReport
	err := s.db.QueryRow(ctx, `SELECT r.id::text, r.run_name, r.period_month, r.period_year, r.status, c.name
		FROM hris.payroll_runs r LEFT JOIN configuration.companies c ON c.id = r.company_id WHERE r.id::text = $1`, runID).
		Scan(&out.Run.ID, &out.Run.RunName, &out.Run.PeriodMonth, &out.Run.PeriodYear, &out.Run.Status, &out.Run.CompanyName)
	if err != nil {
		if database.IsNoRows(err) {
			return nil, httpx.NotFound("Payroll run tidak ditemukan")
		}
		return nil, err
	}
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM hris.payroll_details d WHERE d.payroll_run_id = $1
		AND NOT EXISTS (SELECT 1 FROM hris.payroll_detail_allocations a WHERE a.payroll_detail_id = d.id)`, runID).
		Scan(&out.UnallocatedSlips); err != nil {
		return nil, err
	}
	type allocRow struct {
		employeeID           string
		branchID, code, name *string
		basis                string
		days, hours, ratio   float64
		cents                centsAcc
	}
	rows, err := s.db.Query(ctx, `SELECT a.employee_id::text, a.branch_id::text, b.code, b.name, a.basis,
		a.days::float8, a.hours::float8, a.ratio::float8,
		(a.gross_amount * 100)::int8, (a.deductions_amount * 100)::int8, (a.pph21_deduction * 100)::int8,
		((a.bpjs_tk_jht_deduction + a.bpjs_tk_jp_deduction + a.bpjs_kes_deduction + a.tapera_deduction) * 100)::int8,
		(a.net_amount * 100)::int8,
		((a.bpjs_tk_jht_employer + a.bpjs_tk_jp_employer + a.bpjs_tk_jkk_employer + a.bpjs_tk_jkm_employer) * 100)::int8,
		(a.bpjs_kes_employer * 100)::int8, (a.tapera_employer * 100)::int8
		FROM hris.payroll_detail_allocations a
		LEFT JOIN configuration.branches b ON b.id = a.branch_id
		WHERE a.payroll_run_id = $1`, runID)
	if err != nil {
		return nil, err
	}
	allocs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (allocRow, error) {
		var a allocRow
		c := &a.cents
		return a, r.Scan(&a.employeeID, &a.branchID, &a.code, &a.name, &a.basis, &a.days, &a.hours, &a.ratio,
			&c.gross, &c.ded, &c.pph, &c.bpjsEmp, &c.net, &c.tk, &c.kes, &c.tap)
	})
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(allocs))
	for _, a := range allocs {
		ids = append(ids, a.employeeID)
	}
	briefs, err := s.ports.Employees.Briefs(ctx, s.db, ids)
	if err != nil {
		return nil, err
	}

	type storeAcc struct {
		store     storeCostStore
		employees map[string]bool
		fte       float64
		cents     centsAcc
	}
	var stores []*storeAcc
	var total centsAcc
	everyone := map[string]bool{}
	out.Employees = []storeCostEmployee{}
	for _, a := range allocs {
		name := noStoreLabel
		if a.name != nil {
			name = *a.name
		}
		i := slices.IndexFunc(stores, func(x *storeAcc) bool { return sameBranchID(x.store.BranchID, a.branchID) })
		if i < 0 {
			stores = append(stores, &storeAcc{store: storeCostStore{BranchID: a.branchID, BranchCode: a.code, BranchName: name},
				employees: map[string]bool{}})
			i = len(stores) - 1
		}
		st := stores[i]
		st.employees[a.employeeID] = true
		st.fte += a.ratio
		st.store.Days += a.days
		st.store.Hours += a.hours
		st.cents.add(a.cents)
		total.add(a.cents)
		everyone[a.employeeID] = true

		e := storeCostEmployee{EmployeeID: a.employeeID, BranchID: a.branchID, BranchName: name, Basis: a.basis,
			Ratio: a.ratio, Days: a.days, Hours: a.hours, storeCostAmounts: a.cents.amounts()}
		if b, ok := briefs[a.employeeID]; ok {
			e.FullName, e.NIP, e.Department, e.Position = b.FullName, b.NIP, b.Department, b.Position
		}
		out.Employees = append(out.Employees, e)
	}
	out.Stores = make([]storeCostStore, len(stores))
	for i, st := range stores {
		st.store.EmployeeCount = len(st.employees)
		st.store.FTE = jsmath.RoundTo(st.fte, 4)
		st.store.Hours = jsmath.RoundTo(st.store.Hours, 2)
		st.store.storeCostAmounts = st.cents.amounts()
		out.Stores[i] = st.store
	}
	slices.SortStableFunc(out.Stores, func(a, b storeCostStore) int {
		if c := cmp.Compare(boolRank(a.BranchID == nil), boolRank(b.BranchID == nil)); c != 0 {
			return c
		}
		return cmp.Compare(a.BranchName, b.BranchName)
	})
	slices.SortStableFunc(out.Employees, func(a, b storeCostEmployee) int {
		if c := cmp.Compare(boolRank(a.BranchID == nil), boolRank(b.BranchID == nil)); c != 0 {
			return c
		}
		if c := cmp.Compare(a.BranchName, b.BranchName); c != 0 {
			return c
		}
		return cmp.Compare(a.FullName, b.FullName)
	})
	out.Totals = storeCostTotals{EmployeeCount: len(everyone), storeCostAmounts: total.amounts()}
	return &out, nil
}

func boolRank(b bool) int {
	if b {
		return 1
	}
	return 0
}

func sameBranchID(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// GET /api/hris/payroll/{id}/store-costs
func (h *handler) storeCosts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...); err != nil {
		return err
	}
	id, err := requireUUID(r.PathValue("id"), "ID payroll run tidak valid")
	if err != nil {
		return err
	}
	out, err := h.svc.storeCostReport(r.Context(), id)
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store, private")
	return writeJSON(w, dataBody{out})
}

// GET /api/hris/payroll/{id}/store-costs/export?format=csv|xlsx
func (h *handler) exportStoreCosts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...); err != nil {
		return err
	}
	id, err := requireUUID(r.PathValue("id"), "ID payroll run tidak valid")
	if err != nil {
		return err
	}
	rep, err := h.svc.storeCostReport(r.Context(), id)
	if err != nil {
		return err
	}
	name := "biaya-gaji-per-toko-" + strconv.Itoa(rep.Run.PeriodYear) + "-" + twoDigits(rep.Run.PeriodMonth)
	if rep.Run.CompanyName != nil {
		if slug := fileSlug(*rep.Run.CompanyName); slug != "" {
			name += "-" + slug
		}
	}
	var data []byte
	contentType := "text/csv;charset=utf-8"
	switch r.URL.Query().Get("format") {
	case "xlsx":
		if data, err = storeCostsXLSX(rep, h.svc.clock()); err != nil {
			return err
		}
		contentType, name = xlsx.ContentType, name+".xlsx"
	default:
		data, name = []byte(xlsx.BOM+storeCostsCSV(rep)), name+".csv"
	}
	hd := w.Header()
	hd.Set("Content-Type", contentType)
	hd.Set("Content-Disposition", `attachment; filename="`+name+`"`)
	hd.Set("Cache-Control", "no-store, private")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
	return nil
}

// fileSlug lower-cases name and joins its letters and digits with dashes, for
// a download filename.
func fileSlug(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(name) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			if dash && b.Len() > 0 {
				b.WriteByte('-')
			}
			b.WriteRune(r)
			dash = false
		} else {
			dash = true
		}
	}
	return b.String()
}

func twoDigits(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

func basisLabel(b string) string {
	switch b {
	case domain.BasisHours:
		return "Jam kerja"
	case domain.BasisDays:
		return "Hari hadir"
	case domain.BasisPrimary:
		return "Penempatan utama (tanpa absensi)"
	case domain.BasisNone:
		return "Tanpa penempatan"
	}
	return b
}

func orDash(s *string) string {
	if s == nil || *s == "" {
		return "-"
	}
	return *s
}

func periodTitle(rep *storeCostReport) string {
	return domain.PeriodLabelID(&rep.Run.PeriodMonth, rep.Run.PeriodYear)
}

// storeCostsCSV is the flat per employee and store export.
func storeCostsCSV(rep *storeCostReport) string {
	rows := [][]any{{"Periode", "Toko", "Kode Toko", "NIP", "Nama Karyawan", "Departemen", "Dasar Alokasi", "Porsi (%)",
		"Hari Hadir", "Jam Hadir", "Gaji Kotor", "Potongan", "PPh 21", "BPJS/Tapera Karyawan", "Gaji Bersih",
		"BPJS TK Perusahaan", "BPJS Kes Perusahaan", "Tapera Perusahaan", "Beban Perusahaan", "Total Biaya Tenaga Kerja"}}
	period := periodTitle(rep)
	codes := map[string]string{}
	for _, st := range rep.Stores {
		if st.BranchID != nil && st.BranchCode != nil {
			codes[*st.BranchID] = *st.BranchCode
		}
	}
	for _, e := range rep.Employees {
		code := "-"
		if e.BranchID != nil {
			code = codes[*e.BranchID]
		}
		rows = append(rows, []any{period, e.BranchName, code, orDash(e.NIP), e.FullName, orDash(e.Department), basisLabel(e.Basis),
			jsmath.RoundTo(e.Ratio*100, 2), e.Days, e.Hours, e.Gross, e.Deductions, e.Pph21, e.BpjsEmployee, e.Net,
			e.EmployerTk, e.EmployerKes, e.EmployerTap, e.Employer, e.LaborCost})
	}
	return xlsx.ToCSV(rows)
}

// storeCostsXLSX: "Ringkasan per Toko" and "Rincian Karyawan" sheets.
func storeCostsXLSX(rep *storeCostReport, now time.Time) ([]byte, error) {
	wb := xlsx.NewReport(now)
	ws := wb.Sheet("Ringkasan per Toko")
	runLine := rep.Run.RunName + " (status: " + rep.Run.Status + ")"
	if rep.Run.CompanyName != nil {
		runLine = *rep.Run.CompanyName + " · " + runLine
	}
	row := ws.TitleBlock("Biaya Gaji per Toko — "+periodTitle(rep), runLine,
		"Total biaya tenaga kerja = gaji kotor + beban perusahaan (BPJS & Tapera pemberi kerja).")
	cols := []xlsx.Col{
		{Header: "Toko", Width: 24}, {Header: "Jumlah Karyawan", Width: 12, Fmt: xlsx.FmtNum},
		{Header: "FTE", Width: 8, Fmt: xlsx.FmtQty}, {Header: "Hari Hadir", Width: 10, Fmt: xlsx.FmtQty},
		{Header: "Jam Hadir", Width: 10, Fmt: xlsx.FmtQty}, {Header: "Gaji Kotor", Width: 16, Fmt: xlsx.FmtRp},
		{Header: "Potongan", Width: 15, Fmt: xlsx.FmtRp}, {Header: "BPJS TK Perusahaan", Width: 15, Fmt: xlsx.FmtRp},
		{Header: "BPJS Kes Perusahaan", Width: 15, Fmt: xlsx.FmtRp}, {Header: "Tapera Perusahaan", Width: 14, Fmt: xlsx.FmtRp},
		{Header: "Beban Perusahaan", Width: 16, Fmt: xlsx.FmtRp}, {Header: "Total Biaya Tenaga Kerja", Width: 18, Fmt: xlsx.FmtRp},
		{Header: "Gaji Bersih", Width: 16, Fmt: xlsx.FmtRp},
	}
	var data [][]any
	fte, days, hours := 0.0, 0.0, 0.0
	for _, st := range rep.Stores {
		data = append(data, []any{st.BranchName, st.EmployeeCount, st.FTE, st.Days, st.Hours, st.Gross, st.Deductions,
			st.EmployerTk, st.EmployerKes, st.EmployerTap, st.Employer, st.LaborCost, st.Net})
		fte, days, hours = fte+st.FTE, days+st.Days, hours+st.Hours
	}
	t := rep.Totals
	ws.Table(row, cols, data, xlsx.TableOpts{FreezeHeader: true, Totals: []any{"Total", t.EmployeeCount,
		jsmath.RoundTo(fte, 4), days, jsmath.RoundTo(hours, 2), t.Gross, t.Deductions, t.EmployerTk, t.EmployerKes,
		t.EmployerTap, t.Employer, t.LaborCost, t.Net}})

	ds := wb.Sheet("Rincian Karyawan")
	start := ds.TitleBlock("Rincian Karyawan per Toko — " + periodTitle(rep))
	detailCols := []xlsx.Col{
		{Header: "Toko", Width: 22}, {Header: "NIP", Width: 12}, {Header: "Nama Karyawan", Width: 24},
		{Header: "Departemen", Width: 18}, {Header: "Dasar Alokasi", Width: 20}, {Header: "Porsi", Width: 9, Fmt: xlsx.FmtPct},
		{Header: "Hari", Width: 7, Fmt: xlsx.FmtQty}, {Header: "Jam", Width: 8, Fmt: xlsx.FmtQty},
		{Header: "Gaji Kotor", Width: 15, Fmt: xlsx.FmtRp}, {Header: "Potongan", Width: 14, Fmt: xlsx.FmtRp},
		{Header: "Beban Perusahaan", Width: 15, Fmt: xlsx.FmtRp}, {Header: "Total Biaya", Width: 16, Fmt: xlsx.FmtRp},
		{Header: "Gaji Bersih", Width: 15, Fmt: xlsx.FmtRp},
	}
	var detail [][]any
	for _, e := range rep.Employees {
		detail = append(detail, []any{e.BranchName, orDash(e.NIP), e.FullName, orDash(e.Department), basisLabel(e.Basis),
			jsmath.RoundTo(e.Ratio*100, 2), e.Days, e.Hours, e.Gross, e.Deductions, e.Employer, e.LaborCost, e.Net})
	}
	ds.Table(start, detailCols, detail, xlsx.TableOpts{FreezeHeader: true, Totals: []any{"Total", "", "", "", "", "", "", "",
		t.Gross, t.Deductions, t.Employer, t.LaborCost, t.Net}})
	return wb.Bytes()
}
