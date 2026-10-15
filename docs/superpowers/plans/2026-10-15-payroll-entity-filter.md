# Payroll Multi-Entitas — Filter Entitas & Slip per Entitas: Analisa & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proses gaji dimulai dengan memilih entitas. Satu karyawan bisa digaji oleh beberapa entitas dengan nominal masing-masing (mis. A Rp1 juta, B Rp1 juta), dan setiap entitas menerbitkan slip sendiri untuk karyawan itu.

**Architecture:** Struktur gaji (`hris.employee_salary`) mendapat `company_id`, sehingga satu karyawan bisa punya satu struktur gaji aktif **per entitas**. Payroll run (`hris.payroll_runs`) wajib punya `company_id`, dengan satu run per entitas per periode. Kalkulasi run entitas X hanya memakai struktur gaji X. PPh21 dan BPJS dihitung terpisah dari porsi X saja, karena kalkulator yang ada cukup diberi gaji X. Item yang tidak boleh berulang di setiap slip (cicilan pinjaman, potongan telat) dikendalikan satu **kebijakan multi-entitas** yang sudah disiapkan. Untuk sementara hanya mode "entitas utama" yang aktif, sampai HRD memutuskan.

**Tech Stack:** Go modular monolith (`backend/internal/modules/payroll`, adapter di `backend/internal/app`), PostgreSQL 16 (delta SQL), Next.js + TanStack Query (`frontend/src/features/hris/{payroll,salary}`).

**Spec:** Permintaan user 2026-10-15 + jawaban klarifikasi (Bagian A1). Epic: `docs/epics/EPIC-054-payroll-multi-entitas.md` (dibuat di Task 11).

---

## Bagian A — Analisa (baca sebelum eksekusi)

### A1. Kebutuhan (hasil klarifikasi dengan user)

| # | Kebutuhan | Status |
|---|-----------|--------|
| K1 | Saat run/proses gaji, user **memilih entitas terlebih dahulu** (filter entitas) | Diputuskan |
| K2 | Satu karyawan bisa digaji **beberapa entitas**, dan tiap entitas menerbitkan **slip sendiri**. Total yang diterima karyawan = jumlah semua slipnya | Diputuskan |
| K3 | Porsi gaji ditentukan dengan **nominal per entitas**: HRD mengisi struktur gaji per entitas | Diputuskan |
| K4 | **PPh21 & BPJS dihitung terpisah per entitas**, karena tiap entitas adalah pemberi kerja sendiri | Diputuskan |
| K5 | Potongan pinjaman/kasbon, telat, dan cuti tidak dibayar: masuk slip entitas mana? | **Belum diputuskan.** Cukup disiapkan, jangan dieksekusi |
| K6 | Absensi (hari kerja, lembur, prorata) berlaku sama untuk semua entitas? | **Belum diputuskan.** Cukup disiapkan, jangan diimplementasikan |

### A2. Kondisi sekarang (as-is)

| Area | Perilaku sekarang | Lokasi |
|------|-------------------|--------|
| Struktur gaji | **Satu** versi aktif per karyawan. Membuat versi baru menonaktifkan **semua** versi aktif karyawan itu. Constraint `unique_employee_salary (employee_id, effective_date)` | `payroll/salary.go:104`, schema `hris/*_table_employee_salary.sql` |
| Run gaji | Satu run per periode (`unique_period`), lalu menghitung **semua** karyawan aktif | `service_runs.go:47,322`, `postgres_runs.go:76` |
| Kalkulasi | `activeSalary(employee)` (versi terbaru) → `BuildInputRange` → `Calculate` | `service_runs.go:432`, `domain/calculator.go` |
| Lembur | `fullBase / OvertimeHourlyDivisor × jam × multiplier`, **proporsional** gaji pokok | `domain/calculator.go:200-203` |
| THR | gaji pokok penuh, **proporsional** | `domain/calculator.go:137,206` |
| Cuti tidak dibayar | `base / hari kerja × hari`, **proporsional** | `domain/calculator.go:158,219` |
| Potongan telat | **nominal tetap** × menit/hari (`LateAmount`). Akan **terpotong ganda** jika ada di setiap slip | `domain/calculator.go:166` |
| Cicilan pinjaman | per karyawan, dihitung dari `hris.loans`, dilunasi saat run "Paid". Akan **terpotong ganda** jika ada di setiap slip | `domain/inputs.go:184`, `service_runs.go markRunPaid` |
| Alokasi biaya ke toko | satu slip dibagi ke toko dari absensi + penempatan, **tanpa memperhatikan entitas toko** | `domain/allocation.go:149`, `allocations.go:45` |
| Jurnal "Paid" | dipecah per company berdasarkan **akun user** karyawan | `service_runs.go:244`, `accounting/service_payroll.go:128` |
| Slip PDF | kop surat dari `app_settings.company_legal_name`, berlaku **global** untuk semua entitas | `payslip_pdf.go:151,212` |
| Konsumen lain yang menganggap 1 gaji aktif | sinkron gaji dari kontrak (`ON CONFLICT (employee_id, effective_date)`), limit pinjaman, gaji terapis spa, snapshot offer rekrutmen, `ActiveBaseSalary` HRIS | `app/adapters_hris.go:117,141,172`, `payroll/loans.go:61`, `spa/payroll.go:256`, `app/adapters_recruitment.go:62` |
| Routing | `/api/hris/*` dilayani Go (route TS hanya fallback) | `frontend/src/lib/backend-routes.ts:33` |

### A3. Data aktual (DB lokal `paddydev-db`, 2026-10-15)

- Entitas (= `configuration.companies`): **Paddy** (holding Paddy Group, 2 toko) dan **Paddy Kantor Pusat** (holding CV Cipta Kreasi Kreatif, 1 toko). Tabel company hanya punya `name`/`code`, **tanpa NPWP/alamat**.
- 31 karyawan aktif. Semuanya punya penempatan utama (27 di toko Paddy, 4 di Kantor Pusat).
- 23 karyawan punya struktur gaji, masing-masing tepat **1 versi aktif**. Backfill entitas dari penempatan utama aman.
- Run yang ada: Agu 2026 *paid*, Sep 2026 *draft*, Okt 2026 *paid*, Nov 2026 *draft*. Semuanya tanpa entitas (run lama).

### A4. Desain

1. **Entitas = `configuration.companies`.**
2. **Struktur gaji per entitas.** `employee_salary.company_id` (FK). Satu versi aktif per (karyawan, entitas). Versi baru hanya menonaktifkan versi aktif **entitas yang sama**. Backfill semua baris lama ke entitas penempatan utama karyawan.
3. **Run wajib berentitas.** `payroll_runs.company_id`. Run baru wajib memilih entitas, dan hanya boleh ada satu run per (periode, entitas). Run lama (`company_id NULL`) tetap bisa dilihat, diubah statusnya, dan dihapus. Run lama tidak bisa **dihitung ulang**, dan keberadaannya memblokir run entitas pada periode yang sama (anti bayar ganda dengan data lama).
4. **Kalkulasi run entitas X.** Karyawan yang dihitung = karyawan aktif yang punya struktur gaji aktif di X. Karyawan yang hanya punya gaji di entitas lain dihitung sebagai `other_entity_count`, sedangkan karyawan tanpa gaji sama sekali masuk *skipped* ("Belum ada struktur gaji aktif", pesan lama). Kalkulator dipakai apa adanya dengan gaji X, sehingga PPh21 (TER/PTKP) dan BPJS otomatis dihitung dari porsi X saja (**K4**).
5. **Entitas utama** karyawan (dibutuhkan kebijakan K5) = entitas penempatan utama di akhir periode absensi, **jika** karyawan punya gaji di entitas itu. Jika tidak, dipakai entitas dengan gaji pokok terbesar (seri: company id terkecil). Untuk karyawan satu entitas, entitas utamanya otomatis entitas itu, jadi tidak ada perubahan perilaku.
6. **K5 & K6: disiapkan, belum diputuskan.** Kebijakan `domain.MultiEntityPolicy` dengan satu mode aktif **sementara**, `primary_entity`:
   - cicilan pinjaman dan potongan telat **hanya** di slip entitas utama, nol di slip entitas lain. Ini perilaku teraman: tidak ada potongan ganda, dan pelunasan pinjaman saat "Paid" tetap tepat sekali.
   - item berbasis absensi yang proporsional terhadap gaji pokok (prorata karyawan baru, cuti tidak dibayar, lembur, THR) **tetap dihitung di setiap slip** dari gaji pokok entitas itu. Jumlahnya sama dengan bila dihitung dari total gaji. Ini perilaku bawaan kalkulator, **tanpa kode baru**.
   - Mode lain (proporsional, per entitas, lembur ikut toko) cukup dicatat sebagai opsi di komentar `domain/policy.go` dan di epic, **tidak diimplementasikan**. Ganti mode = ubah satu konstanta + implementasi cabangnya, setelah HRD memutuskan.
7. **Alokasi biaya ke toko per entitas.** Slip entitas X hanya dialokasikan ke toko milik X. Absensi di toko entitas lain diabaikan, dan bila tidak ada toko X yang cocok, slip masuk "Tanpa toko" di entitas X.
8. **Jurnal.** Run entitas memposting semua slipnya ke company run itu.
9. **Slip.** Embed run di daftar slip memuat `company_name`, dan kop PDF memakai nama entitas run. Identitas legal per entitas (NPWP, alamat) **belum ada di data** dan menjadi follow-up.
10. **Konsumen lain** memakai **total** gaji pokok aktif semua entitas: tampilan `ActiveBaseSalary` HRIS, limit pinjaman, gaji terapis spa, snapshot offer. Sinkron dari kontrak: bila karyawan punya >1 entitas aktif, sinkron **dilewati** (HRD mengubah per entitas di menu Struktur Gaji). Bila hanya 1, entitas itu dipertahankan. Bila belum ada, dipakai entitas penempatan utama.
11. **Daftar entitas** lewat `GET /api/hris/payroll/entities` (dijaga menu kompensasi), dipakai halaman Payroll dan Struktur Gaji.
12. **UI tanpa popup untuk memilih** (koreksi user 2026-10-15), mengikuti `docs/frontend-conventions.md` dan kit `src/components/ui`:
    - **Entitas** dipilih lewat `Tabs` pil di halaman Payroll dan Struktur Gaji. Nilainya disimpan di URL `?entity=`, meniru `?run=` di Biaya Gaji per Toko.
    - **Bulan/Tahun** lewat `Select` di form inline di bawah tab.
    - **Entitas pembayar** di form Struktur Gaji lewat `Select`.
    - **THR** lewat `Checkbox` di panel **Hitung Payroll** inline pada halaman detail run. Hasil hitung juga tampil inline.
    - Tiga popup lama payroll (Payroll Baru, Konfirmasi Hitung, Hasil Hitung) dihapus.
    - Popup yang tetap ada hanya yang bukan pilihan: konfirmasi hapus run dan dialog lihat detail slip di ESS.

### A5. Risiko & catatan untuk HRD/Finance

| Topik | Catatan |
|-------|---------|
| PPh21 terpisah | Tiap entitas menerapkan PTKP/TER sendiri, sehingga potongan bulanan gabungan bisa **lebih kecil** daripada bila dihitung dari total. Selisihnya dibereskan di SPT tahunan karyawan. Ini konsekuensi pilihan K4, mohon dikonfirmasi Finance. |
| BPJS terpisah | Batas upah BPJS (Kesehatan, JP) berlaku per entitas, sehingga total iuran gabungan bisa melebihi batas bila dihitung dari total. Konsekuensi K4. |
| Run lama Sep & Nov 2026 (*draft*) | Memblokir run entitas pada periode itu. Hapus dulu, lalu buat per entitas. |
| Run lama Agu & Okt 2026 (*paid*) | Tetap sah. Periode itu tidak bisa diproses per entitas (benar, sudah dibayar). |
| Kebijakan sementara K5 | Cicilan & telat di entitas utama. **Perlu konfirmasi** sebelum go-live multi-entitas. |
| Kop slip | Alamat dari setting global tetap tampil di bawah nama entitas sampai identitas per entitas tersedia. |

### A6. Di luar scope (follow-up di epic)

Pembatasan run sesuai `business_scope` user · identitas legal per entitas (NPWP, alamat) untuk kop slip & laporan pajak · `payroll_settings` per entitas · implementasi mode K5/K6 lain · parity route TS fallback.

---

## Global Constraints

- PostgreSQL ≥ 15 (`NULLS NOT DISTINCT`). Container `paddydev-db` = `postgres:16-alpine`.
- File `backend/database/migrations/schemas/**` **jangan diedit manual**. Regenerate dengan `cd backend/database && npm run db:pull`.
- Pesan lama dipertahankan persis: `"Payroll untuk periode ini sudah ada"` (sekarang untuk duplikat periode+entitas), `"Belum ada struktur gaji aktif"`, `"Bulan dan tahun periode wajib diisi dengan benar"`.
- Pesan baru: `"Entitas wajib dipilih"`, `"Entitas tidak ditemukan atau tidak aktif"`, `"Periode ini masih punya payroll lama tanpa entitas (<run_name>) — hapus run itu dulu untuk memproses per entitas"`, `"Run lama tanpa entitas tidak bisa dihitung ulang — hapus lalu buat payroll per entitas"`.
- `run_name` default **tidak** berubah (`"Payroll <Bulan> <Tahun>"`). Entitas ditampilkan lewat field `company`.
- Semua copy UI berbahasa Indonesia.
- Route Go baru → `make -C backend generate`.
- Delta baru: `backend/database/migrations/deltas/20261016100000_payroll_multi_entity.sql`.
- Mode kebijakan multi-entitas yang aktif: **hanya** `primary_entity`.
- UI: pilihan apa pun (entitas, bulan, tahun, entitas pembayar, THR) memakai `Tabs`/`Select`/`Combobox`/`Checkbox` inline dari kit. **Tidak ada dialog untuk memilih.** Tanpa literal hex di class/style; cek 375 & 768 px (`main.scrollWidth === main.clientWidth`).

## Review Focus

1. **Karyawan di entitas A dan B**: dua slip. PPh21/BPJS tiap slip sama dengan karyawan yang hanya digaji entitas itu dengan nominal yang sama. Cicilan pinjaman muncul **sekali** (slip entitas utama). Tes: Task 7.
2. **Entitas penempatan utama tidak punya gaji** untuk karyawan itu: entitas utama jatuh ke gaji pokok terbesar, dan cicilan tetap dipotong tepat sekali. Tes: Task 2 (`TestPrimaryEntity`) + Task 7.
3. **Run lama tanpa entitas pada periode yang sama**: run entitas ditolak, dan hitung ulang run lama ditolak dengan pesan jelas. Tes: Task 5.
4. **Sinkron gaji dari kontrak** untuk karyawan multi-entitas: tidak menimpa/menggandakan versi entitas mana pun. Tes: Task 6.
5. **Alokasi toko**: slip entitas B tidak pernah dialokasikan ke toko entitas A. Tes: Task 2 (`TestScopeToCompany`) + Task 7.

---

## File Structure

| File | Aksi | Tanggung jawab |
|------|------|----------------|
| `backend/database/migrations/deltas/20261016100000_payroll_multi_entity.sql` | Create | Kolom, constraint, backfill |
| `backend/internal/modules/payroll/domain/entity.go` (+`_test.go`) | Create | `EntityOf`, `PrimaryEntity`, `ScopeToCompany` |
| `backend/internal/modules/payroll/domain/policy.go` (+`_test.go`) | Create | `MultiEntityPolicy`, `ApplyMultiEntityPolicy` (K5/K6 disiapkan) |
| `backend/internal/modules/payroll/ports.go` | Modify | Port `Entities` |
| `backend/internal/app/adapters_payroll.go` (+test) | Modify | Adapter `payrollEntitiesSQL` |
| `backend/internal/modules/payroll/entities.go` | Create | Endpoint entitas, `entityByID`, `attachCompanies` |
| `backend/internal/modules/payroll/salary.go` | Modify | Gaji per entitas |
| `backend/internal/modules/payroll/postgres_runs.go` | Modify | `activeSalary(employee, company)`, `activeSalaryEntities`, query run |
| `backend/internal/modules/payroll/service_runs.go`, `http_runs.go`, `module.go` | Modify | Run per entitas, kalkulasi, jurnal |
| `backend/internal/modules/payroll/loans.go`, `payslips.go`, `payslip_pdf.go` | Modify | Total gaji untuk limit, nama entitas di slip |
| `backend/internal/app/adapters_hris.go`, `adapters_recruitment.go`, `backend/internal/modules/spa/payroll.go` | Modify | Konsumen lain → total / sinkron aman |
| `backend/internal/modules/payroll/*_integration_test.go` | Modify/Create | Fake, helper, test baru, test lama + entitas default |
| `frontend/src/features/hris/payroll/components/entity-tabs.tsx` | Create | `EntityTabs` + `useEntityParam` (`?entity=`), dipakai Payroll & Struktur Gaji |
| `frontend/src/features/hris/salary/components/*` | Modify | Tab entitas di daftar, dropdown Entitas pembayar di form, entitas read-only di edit |
| `frontend/src/features/hris/payroll/components/{new-run-form,calculation-panel}.tsx` | Create | Form buat run inline, panel hitung inline |
| `frontend/src/features/hris/payroll/components/{payroll-page,payroll-detail-page,payslip-page}.tsx` | Modify | Tab entitas, tanpa popup, nama entitas di slip |
| `frontend/src/features/hris/payroll/components/payroll-run-dialogs.tsx` | Delete | 3 popup lama diganti inline |
| `frontend/src/features/hris/ess/{types.ts,components/payslip-detail-dialog.tsx}` | Modify | Label slip ESS menyertakan entitas |
| `docs/epics/EPIC-054-payroll-multi-entitas.md`, `docs/epics/README.md` | Create/Modify | Epic + registry + Automation Log |

---

### Task 1: Migrasi — entitas pada struktur gaji & payroll run

**Files:**
- Create: `backend/database/migrations/deltas/20261016100000_payroll_multi_entity.sql`
- Regenerate: `backend/database/migrations/schemas/hris/*_table_employee_salary.sql`, `*_table_payroll_runs.sql`

**Interfaces:**
- Produces: `hris.employee_salary.company_id`, `hris.payroll_runs.company_id`; index unik `employee_salary_entity_effective_key`, `employee_salary_one_active_per_entity`, `payroll_runs_period_company_key`.

- [ ] **Step 1: Tulis delta**

```sql
-- =============================================================================
-- Payroll multi-entitas (EPIC-054).
--
-- hris.employee_salary.company_id: entitas (configuration.companies) yang
--   membayar struktur gaji ini. Satu karyawan boleh punya satu versi aktif PER
--   entitas (mis. Paddy Rp1jt + Kantor Pusat Rp1jt → dua slip).
--   Backfill: semua versi lama → entitas penempatan utama karyawan saat ini.
-- hris.payroll_runs.company_id: entitas yang diproses run. Run baru wajib
--   berentitas (dijaga aplikasi); NULL = run lama "semua entitas".
-- =============================================================================

ALTER TABLE hris.employee_salary
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES configuration.companies(id) ON DELETE RESTRICT;

UPDATE hris.employee_salary s
   SET company_id = pc.company_id
  FROM (SELECT DISTINCT ON (p.employee_id) p.employee_id, b.company_id
          FROM hris.employee_placements p
          JOIN configuration.branches b ON b.id = p.branch_id
         WHERE p.is_primary AND p.start_date <= CURRENT_DATE
           AND (p.end_date IS NULL OR p.end_date >= CURRENT_DATE)
         ORDER BY p.employee_id, p.start_date DESC) pc
 WHERE s.company_id IS NULL AND s.employee_id = pc.employee_id;

-- Satu versi aktif per (karyawan, entitas): yang lebih lama dinonaktifkan,
-- sama dengan versi yang selama ini dipakai payroll (effective_date terbaru).
UPDATE hris.employee_salary s SET is_active = false, updated_at = now()
 WHERE s.is_active AND EXISTS (
   SELECT 1 FROM hris.employee_salary n
    WHERE n.employee_id = s.employee_id AND n.company_id IS NOT DISTINCT FROM s.company_id
      AND n.is_active AND n.id <> s.id
      AND (n.effective_date, n.created_at) > (s.effective_date, s.created_at));

ALTER TABLE hris.employee_salary DROP CONSTRAINT IF EXISTS unique_employee_salary;
CREATE UNIQUE INDEX IF NOT EXISTS employee_salary_entity_effective_key
  ON hris.employee_salary (employee_id, company_id, effective_date) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS employee_salary_one_active_per_entity
  ON hris.employee_salary (employee_id, company_id) NULLS NOT DISTINCT WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_employee_salary_company ON hris.employee_salary (company_id);

ALTER TABLE hris.payroll_runs
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES configuration.companies(id) ON DELETE RESTRICT;
ALTER TABLE hris.payroll_runs DROP CONSTRAINT IF EXISTS unique_period;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_period_company_key
  ON hris.payroll_runs (period_month, period_year, company_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_payroll_runs_company ON hris.payroll_runs (company_id);

COMMENT ON COLUMN hris.employee_salary.company_id IS 'Entitas yang membayar struktur gaji ini (satu versi aktif per entitas).';
COMMENT ON COLUMN hris.payroll_runs.company_id IS 'Entitas yang diproses run; NULL = run lama semua entitas.';
```

- [ ] **Step 2: Apply ke DB lokal & test DB**

Run: `make -C backend migrate` lalu `make -C backend migrate-apply`
Expected: delta `20261016100000_payroll_multi_entity.sql` applied tanpa error.

- [ ] **Step 3: Verifikasi backfill**

Run:
```bash
docker exec paddydev-db sh -c 'psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -c "SELECT count(*) FILTER (WHERE company_id IS NULL) AS tanpa_entitas, count(*) FILTER (WHERE is_active) AS aktif FROM hris.employee_salary"'
```
Expected: `tanpa_entitas = 0`, `aktif = 23`.

- [ ] **Step 4: Regenerate schema** — `cd backend/database && npm run db:pull`. File schema `employee_salary` & `payroll_runs` memuat `company_id` dan index baru.

- [ ] **Step 5: Commit**

```bash
git add backend/database/migrations
git commit -m "feat(payroll): entitas pada struktur gaji & payroll run (multi-entitas)"
```

---

### Task 2: Domain — entitas utama & alokasi per entitas

**Files:**
- Create: `backend/internal/modules/payroll/domain/entity.go`
- Test: `backend/internal/modules/payroll/domain/entity_test.go`

**Interfaces:**
- Consumes: `Placement`, `BranchDay` (`domain/allocation.go:70,84`).
- Produces:
  ```go
  func EntityOf(placements []Placement, branchCompany map[string]string, end string) string
  type EntitySalary struct { CompanyID string; Base float64 }
  func PrimaryEntity(placementEntity string, salaries []EntitySalary) string
  func ScopeToCompany(days []BranchDay, placements []Placement, branchCompany map[string]string, company string) ([]BranchDay, []Placement)
  ```

- [ ] **Step 1: Tulis test yang gagal**

```go
package domain

import "testing"

func TestEntityOf(t *testing.T) {
	str := func(s string) *string { return &s }
	branches := map[string]string{"pvj": "paddy", "kopo": "paddy", "hq": "pusat"}
	const end = "2026-10-20"
	cases := []struct {
		name       string
		placements []Placement
		want       string
	}{
		{"tanpa penempatan", nil, ""},
		{"utama aktif di akhir periode", []Placement{{BranchID: "pvj", IsPrimary: true, Start: "2025-01-01"}}, "paddy"},
		{"pindah di tengah periode: entitas di akhir periode", []Placement{
			{BranchID: "hq", IsPrimary: true, Start: "2025-01-01", End: str("2026-10-05")},
			{BranchID: "pvj", IsPrimary: true, Start: "2026-10-06"},
		}, "paddy"},
		{"utama berakhir sebelum akhir periode: utama yang mulai paling akhir", []Placement{
			{BranchID: "hq", IsPrimary: true, Start: "2025-01-01", End: str("2026-10-10")},
			{BranchID: "kopo", Start: "2026-09-25"},
		}, "pusat"},
		{"tanpa utama: penempatan yang mulai paling akhir", []Placement{
			{BranchID: "hq", Start: "2025-01-01"}, {BranchID: "kopo", Start: "2026-09-25"},
		}, "paddy"},
		{"toko tanpa company diabaikan", []Placement{
			{BranchID: "unknown", IsPrimary: true, Start: "2026-01-01"}, {BranchID: "hq", Start: "2025-01-01"},
		}, "pusat"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := EntityOf(c.placements, branches, end); got != c.want {
				t.Fatalf("EntityOf = %q, want %q", got, c.want)
			}
		})
	}
}

func TestPrimaryEntity(t *testing.T) {
	salaries := []EntitySalary{{CompanyID: "b", Base: 1_000_000}, {CompanyID: "a", Base: 3_000_000}, {CompanyID: "c", Base: 3_000_000}}
	cases := []struct {
		name, placement string
		salaries        []EntitySalary
		want            string
	}{
		{"entitas penempatan punya gaji", "b", salaries, "b"},
		{"entitas penempatan tanpa gaji: gaji pokok terbesar, seri → id terkecil", "x", salaries, "a"},
		{"tanpa penempatan", "", salaries, "a"},
		{"satu entitas", "x", []EntitySalary{{CompanyID: "b", Base: 1}}, "b"},
		{"tanpa gaji", "b", nil, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := PrimaryEntity(c.placement, c.salaries); got != c.want {
				t.Fatalf("PrimaryEntity = %q, want %q", got, c.want)
			}
		})
	}
}

func TestScopeToCompany(t *testing.T) {
	pvj, hq := "pvj", "hq"
	branches := map[string]string{"pvj": "paddy", "hq": "pusat"}
	days := []BranchDay{
		{Date: "2026-10-01", Status: "present", BranchID: &pvj},
		{Date: "2026-10-02", Status: "present", BranchID: &hq},
		{Date: "2026-10-03", Status: "present"},
	}
	placements := []Placement{{BranchID: "pvj", IsPrimary: true, Start: "2025-01-01"}, {BranchID: "hq", Start: "2025-01-01"}}

	d, p := ScopeToCompany(days, placements, branches, "pusat")
	if len(d) != 2 || d[0].Date != "2026-10-02" || d[1].BranchID != nil {
		t.Fatalf("days %+v", d)
	}
	if len(p) != 1 || p[0].BranchID != "hq" {
		t.Fatalf("placements %+v", p)
	}
	if d, p := ScopeToCompany(days, placements, branches, "lain"); len(d) != 1 || len(p) != 0 {
		t.Fatalf("other company: days %+v placements %+v", d, p)
	}
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && go test ./internal/modules/payroll/domain -run 'TestEntityOf|TestPrimaryEntity|TestScopeToCompany' -count=1`
Expected: FAIL `undefined: EntityOf`

- [ ] **Step 3: Implementasi**

```go
package domain

import "slices"

// EntityOf is the company an employee is placed under at the end of a
// period: the company of the primary placement running on its last day
// (end), else of the latest-starting primary placement, else of the
// latest-starting placement. Placements whose store has no company are
// ignored; "" when none is left. Ties keep the first in input order.
func EntityOf(placements []Placement, branchCompany map[string]string, end string) string {
	onEnd := func(p Placement) bool { return p.Start <= end && (p.End == nil || *p.End >= end) }
	rules := []func(Placement) bool{
		func(p Placement) bool { return p.IsPrimary && onEnd(p) },
		func(p Placement) bool { return p.IsPrimary },
		func(Placement) bool { return true },
	}
	for _, ok := range rules {
		best := -1
		for i, p := range placements {
			if branchCompany[p.BranchID] == "" || !ok(p) {
				continue
			}
			if best < 0 || p.Start > placements[best].Start {
				best = i
			}
		}
		if best >= 0 {
			return branchCompany[placements[best].BranchID]
		}
	}
	return ""
}

// EntitySalary is one entity's active salary of an employee.
type EntitySalary struct {
	CompanyID string
	Base      float64
}

// PrimaryEntity is the entity that carries an employee's once-per-period
// items when several entities pay them: the placement's entity when it pays
// the employee, else the one paying the highest base salary (ties: lowest
// company id); "" without salaries.
func PrimaryEntity(placementEntity string, salaries []EntitySalary) string {
	if placementEntity != "" && slices.ContainsFunc(salaries, func(s EntitySalary) bool { return s.CompanyID == placementEntity }) {
		return placementEntity
	}
	best := ""
	bestBase := 0.0
	for _, s := range salaries {
		if best == "" || s.Base > bestBase || (s.Base == bestBase && s.CompanyID < best) {
			best, bestBase = s.CompanyID, s.Base
		}
	}
	return best
}

// ScopeToCompany keeps what one entity's slip is allocated over: the
// attendance days at that entity's stores or without a store, and the
// placements at its stores.
func ScopeToCompany(days []BranchDay, placements []Placement, branchCompany map[string]string, company string) ([]BranchDay, []Placement) {
	outDays := make([]BranchDay, 0, len(days))
	for _, d := range days {
		if d.BranchID == nil || branchCompany[*d.BranchID] == company {
			outDays = append(outDays, d)
		}
	}
	outPlacements := make([]Placement, 0, len(placements))
	for _, p := range placements {
		if branchCompany[p.BranchID] == company {
			outPlacements = append(outPlacements, p)
		}
	}
	return outDays, outPlacements
}
```

- [ ] **Step 4: Jalankan** — `cd backend && go test ./internal/modules/payroll/domain -count=1` → PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/modules/payroll/domain/entity.go backend/internal/modules/payroll/domain/entity_test.go
git commit -m "feat(payroll): entitas utama karyawan & lingkup alokasi per entitas"
```

---

### Task 3: Domain — kebijakan multi-entitas (K5/K6 disiapkan)

**Files:**
- Create: `backend/internal/modules/payroll/domain/policy.go`
- Test: `backend/internal/modules/payroll/domain/policy_test.go`

**Interfaces:**
- Consumes: `Input` (`domain/calculator.go`: field `LoanDeduction`, `LoanBreakdown`, `LateDays`, `LateMinutes`).
- Produces:
  ```go
  type MultiEntityPolicy string
  const PolicyPrimaryEntity MultiEntityPolicy = "primary_entity"
  func ApplyMultiEntityPolicy(in Input, isPrimary bool, p MultiEntityPolicy) Input
  ```

- [ ] **Step 1: Tulis test yang gagal**

```go
package domain

import "testing"

func TestApplyMultiEntityPolicy(t *testing.T) {
	in := Input{BaseSalary: 1_000_000, LoanDeduction: 100_000,
		LoanBreakdown: []LoanInstallmentDetail{{}}, LateDays: 2, LateMinutes: 30, UnpaidLeaveDays: 1, OvertimeHours: 3}

	if got := ApplyMultiEntityPolicy(in, true, PolicyPrimaryEntity); got.LoanDeduction != 100_000 || got.LateDays != 2 ||
		got.LateMinutes != 30 || len(got.LoanBreakdown) != 1 {
		t.Fatalf("primary slip changed: %+v", got)
	}
	got := ApplyMultiEntityPolicy(in, false, PolicyPrimaryEntity)
	if got.LoanDeduction != 0 || got.LoanBreakdown != nil || got.LateDays != 0 || got.LateMinutes != 0 {
		t.Fatalf("secondary slip keeps once-per-period items: %+v", got)
	}
	// Attendance items proportional to the base stay on every slip (K6 default).
	if got.UnpaidLeaveDays != 1 || got.OvertimeHours != 3 || got.BaseSalary != 1_000_000 {
		t.Fatalf("secondary slip lost proportional items: %+v", got)
	}
}
```

> Terverifikasi: `Input.BaseSalary`, `OvertimeHours`, `UnpaidLeaveDays` bertipe `float64`; `LoanBreakdown []LoanInstallmentDetail` (`domain/calculator.go:14-38`).

- [ ] **Step 2: Jalankan** — `go test ./internal/modules/payroll/domain -run TestApplyMultiEntityPolicy -count=1` → FAIL `undefined`

- [ ] **Step 3: Implementasi**

```go
package domain

// MultiEntityPolicy decides, for an employee paid by several entities
// (EPIC-054), which slip carries the items that must not repeat on every
// slip of the period.
//
// Only PolicyPrimaryEntity is implemented. Options awaiting HR's decision
// (K5/K6, docs/epics/EPIC-054-payroll-multi-entitas.md), NOT implemented:
//   - "proportional": loan installment and late deduction split by each
//     entity's share of the total base salary;
//   - "per_entity": loans recorded per entity (needs hris.loans.company_id);
//   - overtime paid by the entity owning the store where it was worked.
//
// Attendance items proportional to the base salary (prorate, unpaid leave,
// overtime, THR) stay on every slip under every policy: computed from each
// entity's base they add up to the amount on the total.
type MultiEntityPolicy string

// PolicyPrimaryEntity keeps the loan installment and the late deduction on
// the primary entity's slip only.
const PolicyPrimaryEntity MultiEntityPolicy = "primary_entity"

// ApplyMultiEntityPolicy adjusts one entity's input; isPrimary says whether
// that entity is the employee's primary one (PrimaryEntity).
func ApplyMultiEntityPolicy(in Input, isPrimary bool, p MultiEntityPolicy) Input {
	if isPrimary {
		return in
	}
	switch p {
	case PolicyPrimaryEntity:
		in.LoanDeduction = 0
		in.LoanBreakdown = nil
		in.LateDays, in.LateMinutes = 0, 0
	}
	return in
}
```

- [ ] **Step 4: Jalankan** — `go test ./internal/modules/payroll/domain -count=1` → PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/modules/payroll/domain/policy.go backend/internal/modules/payroll/domain/policy_test.go
git commit -m "feat(payroll): kebijakan multi-entitas (sementara: cicilan & telat di entitas utama)"
```

---

### Task 4: Port `Entities`, endpoint daftar entitas, helper test

**Files:**
- Modify: `backend/internal/modules/payroll/ports.go`, `backend/internal/app/adapters_payroll.go` (+`adapters_payroll_test.go`)
- Create: `backend/internal/modules/payroll/entities.go`
- Modify: `backend/internal/modules/payroll/module.go` (route), `payroll_integration_test.go` (fake + helper + entitas default)
- Test: `backend/internal/modules/payroll/entity_integration_test.go`

**Interfaces:**
- Produces:
  ```go
  type Entity struct { ID, Code, Name, HoldingName string; IsActive bool }
  type Entities interface {
      List(ctx context.Context, q database.Querier) ([]Entity, error)
      BranchCompanies(ctx context.Context, q database.Querier) (map[string]string, error)
  }
  func (s *service) entityByID(ctx context.Context, id string) (*Entity, error)   // 400 bila tidak ada/aktif
  func (s *service) attachCompanies(ctx context.Context, rows []*obj) error          // set "company": {id,name}|nil dari "company_id"
  // GET /api/hris/payroll/entities → {"data":[{id,code,name,holding_name}]}
  // test: env.ents *fakeEntities, env.co (entitas default), env.store,
  //       e.entity(name) (company, branch), e.salary(employeeID, companyID, base), e.newRun(month, year, companyID) string
  ```

- [ ] **Step 1: Port** (`ports.go`, sebelum `// Ports bundles…`)

```go
// Entity is a configuration.companies row: an entity that pays salaries
// and runs payroll, with its holding's name.
type Entity struct {
	ID          string
	Code        string
	Name        string
	HoldingName string
	IsActive    bool
}

// Entities reads the business hierarchy (configuration context).
type Entities interface {
	// List is every company ordered by holding name, then company name.
	List(ctx context.Context, q database.Querier) ([]Entity, error)
	// BranchCompanies maps every branch id to its company id.
	BranchCompanies(ctx context.Context, q database.Querier) (map[string]string, error)
}
```

dan di `type Ports struct`: `Entities Entities // companies and branches (payroll per entity)`.

- [ ] **Step 2: Adapter** (`app/adapters_payroll.go`). Tambahkan `Entities: payrollEntitiesSQL{},` ke literal `payroll.Ports{…}` di `payrollPorts()`.

```go
type payrollEntitiesSQL struct{}

func (payrollEntitiesSQL) List(ctx context.Context, q database.Querier) ([]payroll.Entity, error) {
	rows, err := q.Query(ctx, `SELECT c.id::text, COALESCE(c.code, ''), c.name, h.name, COALESCE(c.is_active, false)
		FROM configuration.companies c JOIN configuration.holdings h ON h.id = c.holding_id
		ORDER BY h.name, c.name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (payroll.Entity, error) {
		var e payroll.Entity
		return e, r.Scan(&e.ID, &e.Code, &e.Name, &e.HoldingName, &e.IsActive)
	})
}

func (payrollEntitiesSQL) BranchCompanies(ctx context.Context, q database.Querier) (map[string]string, error) {
	rows, err := q.Query(ctx, `SELECT id::text, company_id::text FROM configuration.branches WHERE company_id IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var branch, company string
		if err := rows.Scan(&branch, &company); err != nil {
			return nil, err
		}
		out[branch] = company
	}
	return out, rows.Err()
}
```

Test adapter (`adapters_payroll_test.go`, di akhir `TestPayrollAdapters` setelah blok `Companies`):

```go
	entities, err := ports.Entities.List(ctx, tx)
	must(err)
	if !slices.ContainsFunc(entities, func(en payroll.Entity) bool {
		return en.ID == branchCompany && en.Name != "" && en.HoldingName != ""
	}) {
		t.Fatalf("entities %+v missing %s", entities, branchCompany)
	}
	if bc, err := ports.Entities.BranchCompanies(ctx, tx); err != nil || bc[branch] != branchCompany {
		t.Fatalf("branch companies %v %v", bc[branch], err)
	}
```

(tambahkan import `slices` dan paket `payroll` bila belum ada).

- [ ] **Step 3: `entities.go`**

```go
package payroll

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
)

// Entities that pay salaries and run payroll (configuration.companies).

type entityRow struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	HoldingName string `json:"holding_name"`
}

// GET /api/hris/payroll/entities
func (h *handler) listEntities(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...); err != nil {
		return err
	}
	all, err := h.svc.ports.Entities.List(r.Context(), h.svc.db)
	if err != nil {
		return opaque(err)
	}
	out := []entityRow{}
	for _, e := range all {
		if e.IsActive {
			out = append(out, entityRow{e.ID, e.Code, e.Name, e.HoldingName})
		}
	}
	return writeJSON(w, dataBody{out})
}

// entityByID is the active entity with this id; a 400 when id is empty,
// unknown or inactive.
func (s *service) entityByID(ctx context.Context, id string) (*Entity, error) {
	if id == "" {
		return nil, httpx.BadRequest("Entitas wajib dipilih")
	}
	all, err := s.ports.Entities.List(ctx, s.db)
	if err != nil {
		return nil, opaque(err)
	}
	for _, e := range all {
		if e.ID == id && e.IsActive {
			return &e, nil
		}
	}
	return nil, httpx.BadRequest("Entitas tidak ditemukan atau tidak aktif")
}

// attachCompanies sets "company" on each row from its company_id:
// {id, name}, nil when the row has none.
func (s *service) attachCompanies(ctx context.Context, rows []*obj) error {
	all, err := s.ports.Entities.List(ctx, s.db)
	if err != nil {
		return opaque(err)
	}
	names := map[string]string{}
	for _, e := range all {
		names[e.ID] = e.Name
	}
	for _, row := range rows {
		if id := row.Str("company_id"); id != "" {
			row.Set("company", object("id", id, "name", names[id]))
		} else {
			row.Set("company", nil)
		}
	}
	return nil
}
```

Catatan terverifikasi: `handler{svc}` / `service{db, ports}` ada di `module.go:43,53`. `obj.Str` mengembalikan `""` untuk NULL (`rowjson.go:68`). `opaque` **membuang** tipe `httpx.Error` (`rowjson.go:376`), jadi error 400 dikembalikan tanpa `opaque`.

Route di `module.go`, sebelum `route("GET /api/hris/payroll/{id}", h.getRun),`:

```go
		route("GET /api/hris/payroll/entities", h.listEntities),
```

- [ ] **Step 4: Fake, helper, entitas default** (`payroll_integration_test.go`)

Setelah `fakeSettings`:

```go
// fakeEntities is the business hierarchy the test registers.
type fakeEntities struct {
	list     []Entity
	branches map[string]string // branch id → company id
}

func (f *fakeEntities) List(context.Context, database.Querier) ([]Entity, error) { return f.list, nil }

func (f *fakeEntities) BranchCompanies(context.Context, database.Querier) (map[string]string, error) {
	return f.branches, nil
}

// entity inserts a holding, company and one store, and registers them.
func (e *env) entity(name string) (company, branch string) {
	e.t.Helper()
	sfx := testutil.RandomHex(4)
	var holding string
	e.scalar(&holding, `INSERT INTO configuration.holdings (name, code) VALUES ($1, $2) RETURNING id::text`, name+" Group", "H-"+sfx)
	e.scalar(&company, `INSERT INTO configuration.companies (holding_id, name, code) VALUES ($1, $2, $3) RETURNING id::text`,
		holding, name, "CO-"+sfx)
	e.scalar(&branch, `INSERT INTO configuration.branches (company_id, name, code) VALUES ($1, $2, $3) RETURNING id::text`,
		company, name+" Toko", "BR-"+sfx)
	e.ents.list = append(e.ents.list, Entity{ID: company, Code: "CO-" + sfx, Name: name, HoldingName: name + " Group", IsActive: true})
	e.ents.branches[branch] = company
	return company, branch
}

// salary inserts an active salary of employeeID paid by companyID.
func (e *env) salary(employeeID, companyID string, base int) {
	e.t.Helper()
	e.exec(`INSERT INTO hris.employee_salary (employee_id, company_id, base_salary, ptkp_status, effective_date)
		VALUES ($1, $2, $3, 'TK/0', '2026-01-01')`, employeeID, companyID, base)
}

// newRun creates a draft run of companyID and returns its id.
func (e *env) newRun(month, year int, companyID string) string {
	e.t.Helper()
	body := map[string]any{"period_month": month, "period_year": year, "company_id": companyID}
	return e.call(&e.hr, "POST", "/api/hris/payroll", body, 200)["data"].(map[string]any)["id"].(string)
}
```

Di `type env struct` tambahkan `ents *fakeEntities` dan `co, store string // default entity and its store`. Di `setup`: tambahkan `ents: &fakeEntities{branches: map[string]string{}},` pada literal `e := &env{…}`, ubah `ports := Ports{…, Entities: e.ents}`, lalu **setelah** `e.mux = …` tambahkan `e.co, e.store = e.entity("Entitas Uji")`.

- [ ] **Step 5: Test endpoint** (`entity_integration_test.go`)

```go
package payroll

import "testing"

func TestPayrollEntities(t *testing.T) {
	e := setup(t)
	e.entity("Pusat Uji")
	if rec := e.raw(&e.staff, "GET", "/api/hris/payroll/entities", nil); rec.Code != 403 {
		t.Fatalf("non-compensation = %d", rec.Code)
	}
	list := e.call(&e.hr, "GET", "/api/hris/payroll/entities", nil, 200)["data"].([]any)
	if len(list) != 2 || list[0].(map[string]any)["name"] != "Entitas Uji" ||
		list[1].(map[string]any)["holding_name"] != "Pusat Uji Group" {
		t.Fatalf("entities %v", list)
	}
}
```

- [ ] **Step 6: Jalankan** — `cd backend && go test ./internal/app ./internal/modules/payroll/... -run 'TestPayrollAdapters|TestPayrollEntities' -count=1` → PASS. Test lama belum disentuh di task ini.

- [ ] **Step 7: Regenerate manifest** — `make -C backend generate` (`go-routes.generated.json` memuat `GET /api/hris/payroll/entities`).

- [ ] **Step 8: Commit**

```bash
git add backend/internal frontend/src/lib/go-routes.generated.json
git commit -m "feat(payroll): port & endpoint daftar entitas"
```

---

### Task 5: Payroll run per entitas (buat, daftar, detail, hitung ulang run lama)

**Files:**
- Modify: `backend/internal/modules/payroll/http_runs.go`, `service_runs.go`, `postgres_runs.go`
- Modify test lama: POST `/api/hris/payroll` di `payroll_integration_test.go` (4), `allocation_integration_test.go` (1), `attendance_period_integration_test.go` (1)
- Test: `entity_integration_test.go`

**Interfaces:**
- Consumes: `entityByID`, `attachCompanies`, `e.co`, `e.newRun` (Task 4).
- Produces: `runHead.CompanyID *string`; `POST /api/hris/payroll` wajib `company_id`; baris run memuat `company_id` & `company`.

- [ ] **Step 1: Tulis test yang gagal**

```go
func TestRunPerEntityCreate(t *testing.T) {
	e := setup(t)
	e.employee("HR Payroll", e.hr.UserID, true)
	pusat, _ := e.entity("Pusat Uji")

	wantErr(t, e.call(&e.hr, "POST", "/api/hris/payroll", map[string]any{"period_month": 6, "period_year": 2099}, 400),
		"Entitas wajib dipilih")
	wantErr(t, e.call(&e.hr, "POST", "/api/hris/payroll",
		map[string]any{"period_month": 6, "period_year": 2099, "company_id": "00000000-0000-0000-0000-000000000000"}, 400),
		"Entitas tidak ditemukan atau tidak aktif")

	runA := e.newRun(6, 2099, e.co)
	e.newRun(6, 2099, pusat) // another entity, same period: allowed
	wantErr(t, e.call(&e.hr, "POST", "/api/hris/payroll",
		map[string]any{"period_month": 6, "period_year": 2099, "company_id": e.co}, 400), "Payroll untuk periode ini sudah ada")

	got := e.call(&e.hr, "GET", "/api/hris/payroll/"+runA, nil, 200)["data"].(map[string]any)
	if got["run_name"] != "Payroll Juni 2099" || got["company"].(map[string]any)["name"] != "Entitas Uji" {
		t.Fatalf("run %v", got)
	}
	rows := e.call(&e.hr, "GET", "/api/hris/payroll?year=2099", nil, 200)["data"].([]any)
	if len(rows) != 2 || rows[0].(map[string]any)["company"] == nil {
		t.Fatalf("list %v", rows)
	}

	// A legacy run without entity blocks entity runs of its period and
	// cannot be recalculated.
	var legacy string
	e.scalar(&legacy, `INSERT INTO hris.payroll_runs (run_name, period_month, period_year, status)
		VALUES ('Payroll Juli 2099', 7, 2099, 'draft') RETURNING id::text`)
	wantErr(t, e.call(&e.hr, "POST", "/api/hris/payroll",
		map[string]any{"period_month": 7, "period_year": 2099, "company_id": e.co}, 400),
		"Periode ini masih punya payroll lama tanpa entitas (Payroll Juli 2099) — hapus run itu dulu untuk memproses per entitas")
	wantErr(t, e.call(&e.hr, "POST", "/api/hris/payroll/"+legacy+"/calculate", nil, 400),
		"Run lama tanpa entitas tidak bisa dihitung ulang — hapus lalu buat payroll per entitas")
	if c := e.call(&e.hr, "GET", "/api/hris/payroll/"+legacy, nil, 200)["data"].(map[string]any)["company"]; c != nil {
		t.Fatalf("legacy company %v", c)
	}
}
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `go test ./internal/modules/payroll -run TestRunPerEntityCreate -count=1` → FAIL

- [ ] **Step 3: Query** (`postgres_runs.go`)

`runHead` + `runHeadByID`:

```go
type runHead struct {
	ID          string
	Status      string
	PeriodMonth int
	PeriodYear  int
	// CompanyID is the run's entity; nil for a legacy "all entities" run.
	CompanyID *string
}

func runHeadByID(ctx context.Context, q database.Querier, id string) *runHead {
	var h runHead
	err := q.QueryRow(ctx, `SELECT id::text, status, period_month, period_year, company_id::text
		FROM hris.payroll_runs WHERE id::text = $1`, id).
		Scan(&h.ID, &h.Status, &h.PeriodMonth, &h.PeriodYear, &h.CompanyID)
	if err != nil {
		return nil
	}
	return &h
}
```

Ganti `runExistsForPeriod` dengan:

```go
// overlappingRun is a run of the period a new run of company would clash
// with: one of the same company, or a legacy run without entity (first).
// nil when none.
func overlappingRun(ctx context.Context, q database.Querier, month, year int, company string) (name string, legacy bool, found bool, err error) {
	err = q.QueryRow(ctx, `SELECT run_name, company_id IS NULL FROM hris.payroll_runs
		WHERE period_month = $1 AND period_year = $2 AND (company_id IS NULL OR company_id = $3::uuid)
		ORDER BY (company_id IS NULL) DESC, created_at LIMIT 1`, month, year, company).Scan(&name, &legacy)
	if database.IsNoRows(err) {
		return "", false, false, nil
	}
	return name, legacy, err == nil, err
}

// lockPeriod serializes run creation for one payroll month (transaction-scoped).
func lockPeriod(ctx context.Context, q database.Querier, month, year int) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('hris.payroll_runs'), $1)`, year*100+month)
	return err
}

func insertRun(ctx context.Context, q database.Querier, name string, month, year int, processedBy *string, company string) (*obj, error) {
	return queryObj(ctx, q, `INSERT INTO hris.payroll_runs (run_name, period_month, period_year, status, processed_by, company_id)
		VALUES ($1, $2, $3, 'draft', $4, $5::uuid) RETURNING *`, name, month, year, processedBy, company)
}
```

- [ ] **Step 4: Service & handler**

`http_runs.go` `createRun`: setelah `name := …` tambahkan `company := f.Str("company_id", nullish, validate.StrOpts{})`. Panggil `h.svc.createRun(r.Context(), u.ID, *month, *year, name, company)`. Komentar route: `{ period_month, period_year, company_id, run_name? }`.

`service_runs.go` (`"errors"` ditambahkan ke import):

```go
func (s *service) createRun(ctx context.Context, userID string, month, year int, name, companyID *string) (*obj, error) {
	id := ""
	if companyID != nil {
		id = *companyID
	}
	entity, err := s.entityByID(ctx, id)
	if err != nil {
		return nil, err
	}
	runName := "Payroll " + domain.PeriodLabelID(&month, year)
	if name != nil && *name != "" {
		runName = *name
	}
	processedBy, err := s.employeeOf(ctx, userID)
	if err != nil {
		return nil, err
	}
	var row *obj
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := lockPeriod(ctx, tx, month, year); err != nil {
			return err
		}
		other, legacy, found, err := overlappingRun(ctx, tx, month, year, entity.ID)
		switch {
		case err != nil:
			return err
		case found && legacy:
			return httpx.BadRequest("Periode ini masih punya payroll lama tanpa entitas (" + other +
				") — hapus run itu dulu untuk memproses per entitas")
		case found:
			return httpx.BadRequest("Payroll untuk periode ini sudah ada")
		}
		row, err = insertRun(ctx, tx, runName, month, year, processedBy, entity.ID)
		return err
	})
	// opaque flattens every error (rowjson.go:376): pass the 400s through.
	if he := (*httpx.Error)(nil); errors.As(err, &he) {
		return nil, err
	}
	return row, opaque(err)
}
```

`listRuns`: sebelum `return rows, s.stitch(…)` → `if err := s.attachCompanies(ctx, rows); err != nil { return nil, err }`. `getRun`: setelah `row.Set("attendance_period", …)` → `if err := s.attachCompanies(ctx, []*obj{row}); err != nil { return nil, err }`.

`calculateRun`, tepat setelah cek `CanCalculateRun`:

```go
	if run.CompanyID == nil {
		return nil, httpx.BadRequest("Run lama tanpa entitas tidak bisa dihitung ulang — hapus lalu buat payroll per entitas")
	}
```

- [ ] **Step 5: Sesuaikan test lama** — setiap `POST /api/hris/payroll` sukses di `payroll_integration_test.go` (4), `allocation_integration_test.go` (1), `attendance_period_integration_test.go` (1) menambah `"company_id": e.co` (atau memakai `e.newRun`). Assertion `"Payroll untuk periode ini sudah ada"` di `TestRunLifecycle` tetap berlaku untuk entitas yang sama.

- [ ] **Step 6: Jalankan** — `cd backend && go test ./internal/modules/payroll/... -count=1` → PASS. Test kalkulasi lama tetap hijau, karena `activeSalary` belum diubah (Task 6) dan run test sudah memakai `e.co`.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/modules/payroll
git commit -m "feat(payroll): payroll run wajib per entitas; run lama tidak bisa dihitung ulang"
```

---

### Task 6: Struktur gaji per entitas + konsumen gaji lain

**Files:**
- Modify: `backend/internal/modules/payroll/salary.go` (handler & service create/list)
- Modify: `backend/internal/modules/payroll/postgres_runs.go` (`activeSalary`, baru `activeSalaryEntities`)
- Modify: `backend/internal/modules/payroll/loans.go:61` (limit dari total gaji)
- Modify: `backend/internal/app/adapters_hris.go:114-175` (`ActiveBaseSalary`, `SyncFromContract`)
- Modify: `backend/internal/app/adapters_recruitment.go:~62` (snapshot = total)
- Modify: `backend/internal/modules/spa/payroll.go:256` (gaji terapis = total)
- Modify test lama: `payroll_integration_test.go` (15 POST `/api/hris/employee-salary`, 2 INSERT salary), `allocation_integration_test.go` (1 INSERT), `attendance_period_integration_test.go` (1 INSERT)
- Test: `entity_integration_test.go`, `backend/internal/app/adapters_hris_test.go` (atau file test adapter HRIS yang ada; cek dengan `grep -ln SyncFromContract backend/internal/app/*_test.go`)

**Interfaces:**
- Consumes: `entityByID`, `attachCompanies`, `e.co`, `e.entity`, `e.salary` (Task 4).
- Consumes juga: `runHead.CompanyID` (Task 5; run lama sudah ditolak `calculateRun`, sehingga `*run.CompanyID` aman).
- Produces:
  ```go
  func activeSalary(ctx context.Context, q database.Querier, employeeID, companyID string) (*domain.Salary, error)
  func activeSalaryEntities(ctx context.Context, q database.Querier, employeeID string) ([]domain.EntitySalary, error)
  // POST /api/hris/employee-salary menerima company_id (wajib); GET menyertakan company_id & company
  ```

- [ ] **Step 1: Tulis test yang gagal** (`entity_integration_test.go`)

```go
func TestSalaryPerEntity(t *testing.T) {
	e := setup(t)
	pusat, _ := e.entity("Pusat Uji")
	emp := e.employee("Dua Entitas", "", true)
	post := func(company string, base int, status int) map[string]any {
		body := map[string]any{"employee_id": emp, "base_salary": base, "effective_date": "2026-01-01"}
		if company != "" {
			body["company_id"] = company
		}
		return e.call(&e.hr, "POST", "/api/hris/employee-salary", body, status)
	}
	wantErr(t, post("", 1_000_000, 400), "Entitas wajib dipilih")
	post(e.co, 1_000_000, 200)
	post(pusat, 2_000_000, 200)
	// A new version of one entity deactivates only that entity's version.
	e.call(&e.hr, "POST", "/api/hris/employee-salary",
		map[string]any{"employee_id": emp, "base_salary": 1_500_000, "effective_date": "2026-03-01", "company_id": e.co}, 200)

	var active int
	e.scalar(&active, `SELECT count(*)::int FROM hris.employee_salary WHERE employee_id = $1 AND is_active`, emp)
	if active != 2 {
		t.Fatalf("active versions = %d, want 2 (one per entity)", active)
	}
	rows := e.call(&e.hr, "GET", "/api/hris/employee-salary?employee_id="+emp, nil, 200)["data"].([]any)
	names := map[string]bool{}
	for _, r := range rows {
		if c, ok := r.(map[string]any)["company"].(map[string]any); ok {
			names[c["name"].(string)] = true
		}
	}
	if !names["Entitas Uji"] || !names["Pusat Uji"] {
		t.Fatalf("salary rows company embed %v", rows)
	}
}
```

Test adapter sinkron kontrak. Letakkan di file test adapter HRIS yang memanggil `SyncFromContract`; buat `backend/internal/app/adapters_hris_salary_test.go` bila belum ada. Ikuti pola `TestPayrollAdapters` (staff, `testutil.Tx`, `must`):

```go
func TestSalarySyncMultiEntity(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	var emp, coA, coB string
	must(tx.QueryRow(ctx, `INSERT INTO hris.employees (full_name, nip, email, phone, join_date)
		VALUES ('Sinkron', 'SYN-1', 'syn1@test.local', '08', '2024-01-01') RETURNING id::text`).Scan(&emp))
	must(tx.QueryRow(ctx, `SELECT id::text FROM configuration.companies ORDER BY created_at LIMIT 1`).Scan(&coA))
	must(tx.QueryRow(ctx, `SELECT id::text FROM configuration.companies WHERE id <> $1 ORDER BY created_at LIMIT 1`, coA).Scan(&coB))
	_, err := tx.Exec(ctx, `INSERT INTO hris.employee_salary (employee_id, company_id, base_salary, effective_date)
		VALUES ($1, $2, 1000000, '2026-01-01'), ($1, $3, 1000000, '2026-01-01')`, emp, coA, coB)
	must(err)

	port := hrisSalarySQL{}
	if base, err := port.ActiveBaseSalary(ctx, tx, emp); err != nil || base == nil || *base != "2000000.00" {
		t.Fatalf("total base = %v %v", base, err)
	}
	// Two entities: the contract sync leaves both versions untouched.
	must(port.SyncFromContract(ctx, tx, hris.SalarySync{EmployeeID: emp, BaseSalary: 5000000, StartDate: "2026-06-01"}))
	var n int
	must(tx.QueryRow(ctx, `SELECT count(*)::int FROM hris.employee_salary WHERE employee_id = $1 AND is_active AND base_salary = 1000000`, emp).Scan(&n))
	if n != 2 {
		t.Fatalf("multi-entity versions after sync = %d, want 2", n)
	}
}
```

> Bila DB test hanya punya satu company, sisipkan holding+company kedua dulu (pola helper `entity()` di Task 4). Sesuaikan field `hris.SalarySync` dengan definisinya di `backend/internal/modules/hris/ports.go:~74`.

- [ ] **Step 2: Jalankan, pastikan gagal** — `go test ./internal/modules/payroll -run TestSalaryPerEntity -count=1` dan `go test ./internal/app -run TestSalarySyncMultiEntity -count=1` → FAIL

- [ ] **Step 3: Query gaji** (`postgres_runs.go`). Ganti `activeSalary`:

```go
// activeSalary is the employee's newest active salary paid by companyID,
// nil when none.
func activeSalary(ctx context.Context, q database.Querier, employeeID, companyID string) (*domain.Salary, error) {
	var s domain.Salary
	var base, fixed, variable, transport, meal, housing *string
	err := q.QueryRow(ctx, `SELECT base_salary::text, fixed_allowance::text, variable_allowance::text,
		       transport_allowance::text, meal_allowance::text, housing_allowance::text,
		       ptkp_status, is_taxable, bpjs_tk_enrolled, bpjs_kes_enrolled, tapera_enrolled
		  FROM hris.employee_salary WHERE employee_id = $1 AND company_id = $2::uuid AND is_active = true
		 ORDER BY effective_date DESC LIMIT 1`, employeeID, companyID).
		Scan(&base, &fixed, &variable, &transport, &meal, &housing,
			&s.PTKPStatus, &s.IsTaxable, &s.BpjsTkEnrolled, &s.BpjsKesEnrolled, &s.TaperaEnrl)
	if database.IsNoRows(err) {
		return nil, nil
	}
	s.BaseSalary, s.FixedAllowance, s.VariableAllowance = textOrNil(base), textOrNil(fixed), textOrNil(variable)
	s.TransportAllowance, s.MealAllowance, s.HousingAllowance = textOrNil(transport), textOrNil(meal), textOrNil(housing)
	return &s, err
}

// activeSalaryEntities are the entities paying the employee an active
// salary, with each base salary.
func activeSalaryEntities(ctx context.Context, q database.Querier, employeeID string) ([]domain.EntitySalary, error) {
	rows, err := q.Query(ctx, `SELECT company_id::text, base_salary::float8 FROM hris.employee_salary
		WHERE employee_id = $1 AND is_active AND company_id IS NOT NULL ORDER BY company_id`, employeeID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.EntitySalary, error) {
		var s domain.EntitySalary
		return s, r.Scan(&s.CompanyID, &s.Base)
	})
}
```

Lalu ubah `payrollInput` (`service_runs.go`) agar menerima `companyID string` tepat setelah `e EmployeeBrief` dan memanggil `activeSalary(ctx, s.db, e.ID, companyID)`. Di `calculateRun`, panggilannya menjadi `s.payrollInput(ctx, e, *run.CompanyID, run.PeriodMonth, run.PeriodYear, start, end, includeThr, holidays)`.

- [ ] **Step 4: Create/list salary** (`salary.go`)

Handler `createSalary`, setelah `effective := …`:

```go
	company := f.Str("company_id", nullish, validate.StrOpts{})
```

dan panggilan service: `h.svc.createSalary(r.Context(), *employeeID, deref(company), *base, effective, in)`. Gunakan helper lokal `deref := func(p *string) string { if p == nil { return "" }; return *p }` bila paket belum punya.

Service `createSalary(ctx, employeeID, companyID string, base float64, effective *string, in *salaryInput)`. Setelah cek `emp == nil`, tambahkan:

```go
	entity, err := s.entityByID(ctx, companyID)
	if err != nil {
		return nil, err
	}
```

ubah UPDATE penonaktifan menjadi per entitas:

```go
	if _, err := s.db.Exec(ctx, `UPDATE hris.employee_salary SET is_active = false, end_date = $2, updated_at = $3
		WHERE employee_id = $1 AND company_id = $4::uuid AND is_active = true`, employeeID, endDate, now, entity.ID); err != nil {
```

dan INSERT menambah kolom `company_id`:

```go
	return queryObj(ctx, s.db, `INSERT INTO hris.employee_salary (employee_id, base_salary, fixed_allowance,
		variable_allowance, transport_allowance, meal_allowance, housing_allowance, loan_deduction, other_deduction,
		ptkp_status, is_taxable, bpjs_tk_enrolled, bpjs_kes_enrolled, tapera_enrolled, effective_date, notes, company_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::uuid) RETURNING *`,
		employeeID, numParam(base), val("fixed_allowance", 0), val("variable_allowance", 0), val("transport_allowance", 0),
		val("meal_allowance", 0), val("housing_allowance", 0), val("loan_deduction", 0), val("other_deduction", 0),
		val("ptkp_status", "TK/0"), flag("is_taxable"), flag("bpjs_tk_enrolled"), flag("bpjs_kes_enrolled"),
		flag("tapera_enrolled"), effectiveDate, notes, entity.ID)
```

`listSalaries`: sebelum `return rows, s.stitch(…)` tambahkan `if err := s.attachCompanies(ctx, rows); err != nil { return nil, err }`. `getSalary` juga memanggil `s.attachCompanies(ctx, []*obj{row})` sebelum return. `updateSalary` **tidak** mengubah `company_id`; ganti entitas = buat versi baru.

- [ ] **Step 5: Konsumen lain**

`payroll/loans.go` `loanLimits`, ganti blok `salary, err := activeSalary(…)`:

```go
	salaries, err := activeSalaryEntities(ctx, s.db, employeeID)
	if err != nil {
		return domain.Config{}, nil, 0, err
	}
	if len(salaries) > 0 {
		total := 0.0
		for _, sal := range salaries {
			total += sal.Base
		}
		base = &total
	}
```

`app/adapters_hris.go` `ActiveBaseSalary`: total semua entitas.

```go
func (hrisSalarySQL) ActiveBaseSalary(ctx context.Context, q database.Querier, employeeID string) (*string, error) {
	var base *string
	err := q.QueryRow(ctx, `SELECT sum(base_salary)::text FROM hris.employee_salary
		WHERE employee_id = $1 AND is_active`, employeeID).Scan(&base)
	return base, err
}
```

`SyncFromContract`: di awal fungsi tambahkan guard multi-entitas, dan bawa `company_id`:

```go
	var entities int
	if err := q.QueryRow(ctx, `SELECT count(DISTINCT company_id)::int FROM hris.employee_salary
		WHERE employee_id = $1 AND is_active`, in.EmployeeID).Scan(&entities); err != nil {
		return err
	}
	if entities > 1 {
		// Paid by several entities: HR versions each entity's salary itself.
		return nil
	}
```

Tambahkan `company_id::text` ke SELECT versi aktif (var `company *string`). Di INSERT, tambahkan kolom `company_id` dengan nilai:

```sql
COALESCE($17::uuid, (SELECT b.company_id FROM hris.employee_placements p
   JOIN configuration.branches b ON b.id = p.branch_id
  WHERE p.employee_id = $1 AND p.is_primary AND (p.end_date IS NULL OR p.end_date >= $15::date)
  ORDER BY p.start_date DESC LIMIT 1))
```

lalu ganti `ON CONFLICT (employee_id, effective_date)` menjadi `ON CONFLICT (employee_id, company_id, effective_date)`. Update `is_active=false` versi lama tetap memakai `WHERE id = $1`, jadi aman.

`app/adapters_recruitment.go` (snapshot offer): ganti subquery lateral menjadi

```sql
     LEFT JOIN LATERAL (
       SELECT sum(base_salary) AS base_salary FROM hris.employee_salary
       WHERE employee_id = e.id AND is_active
     ) s ON true
```

`spa/payroll.go:256`: ganti lateral menjadi

```sql
   LEFT JOIN LATERAL (SELECT sum(es.base_salary) AS base_salary, sum(es.fixed_allowance) AS fixed_allowance
                        FROM hris.employee_salary es
                       WHERE es.employee_id = t.employee_id AND es.is_active AND es.effective_date <= $1::date
                         AND (es.end_date IS NULL OR es.end_date >= $1::date)) s ON true
```

- [ ] **Step 6: Sesuaikan test lama**

1. Setiap `POST /api/hris/employee-salary` sukses di `payroll_integration_test.go` (15 tempat, cari dengan `grep -n '/api/hris/employee-salary' backend/internal/modules/payroll/payroll_integration_test.go`) menambah `"company_id": e.co` pada body. Test validasi yang mengharapkan 400 karena field lain **tidak** perlu diubah, karena validasi field berjalan sebelum cek entitas.
2. Setiap `INSERT INTO hris.employee_salary (employee_id, …) VALUES ($1, …)` di `payroll_integration_test.go` (2), `allocation_integration_test.go` (1), `attendance_period_integration_test.go` (1) menjadi `INSERT INTO hris.employee_salary (employee_id, company_id, …) VALUES ($1, $N, …)` dengan argumen tambahan `e.co`. Cara lain: ganti dengan `e.salary(id, e.co, base)` bila hanya memakai kolom default. INSERT di `spa/payroll_integration_test.go` dibiarkan, karena spa membaca total.
3. Ekspektasi pada respons salary yang membandingkan body persis harus menerima tambahan `company_id` dan `company` di akhir objek.

- [ ] **Step 7: Jalankan** — `cd backend && go test ./internal/modules/payroll/... ./internal/app/... ./internal/modules/spa/... ./internal/modules/recruitment/... ./internal/modules/hris/... -count=1` → PASS (termasuk test kalkulasi lama, yang kini memakai entitas default `e.co`).

- [ ] **Step 8: Commit**

```bash
git add backend/internal
git commit -m "feat(payroll): struktur gaji per entitas; konsumen lain pakai total gaji"
```

---

### Task 7: Kalkulasi run per entitas (slip per entitas, kebijakan, alokasi)

**Files:**
- Modify: `backend/internal/modules/payroll/service_runs.go` (`calcSummary`, `calculateRun`, `payrollInput`)
- Test: `entity_integration_test.go`

**Interfaces:**
- Consumes: `activeSalary(…, companyID)`, `activeSalaryEntities`, `payrollInput(…, companyID, …)` (Task 6), `domain.EntityOf/PrimaryEntity/ScopeToCompany` (Task 2), `domain.ApplyMultiEntityPolicy` (Task 3), `Ports.Entities.BranchCompanies` (Task 4), `runHead.CompanyID` (Task 5).
- Produces: `calcSummary.OtherEntity int` (JSON `other_entity_count`); konstanta `multiEntityPolicy = domain.PolicyPrimaryEntity`.

- [ ] **Step 1: Tulis test yang gagal**

```go
func TestMultiEntityCalculate(t *testing.T) {
	e := setup(t)
	e.employee("HR Payroll", e.hr.UserID, true)
	coA, storeA := e.co, e.store
	coB, storeB := e.entity("Entitas B")
	shared := e.employee("Dua Entitas", "", true)
	refA := e.employee("Hanya A", "", true)
	refB := e.employee("Hanya B", "", true)
	e.salary(shared, coA, 1_000_000)
	e.salary(shared, coB, 9_000_000)
	e.salary(refA, coA, 1_000_000)
	e.salary(refB, coB, 9_000_000)
	e.exec(`INSERT INTO hris.loans (employee_id, loan_type, principal_amount, tenor_months, monthly_installment,
		remaining_balance, first_installment_month, first_installment_year, status, approved_at)
		VALUES ($1, 'kasbon', 300000, 3, 100000, 300000, 6, 2099, 'approved', now())`, shared)
	// Placed at A's store: A is the primary entity (B pays more).
	e.work.placements = map[string][]domain.Placement{
		shared: {{BranchID: storeA, IsPrimary: true, Start: "2026-01-01"}},
		refA:   {{BranchID: storeA, IsPrimary: true, Start: "2026-01-01"}},
		refB:   {{BranchID: storeB, IsPrimary: true, Start: "2026-01-01"}},
	}

	runA, runB := e.newRun(6, 2099, coA), e.newRun(6, 2099, coB)
	sumA := e.call(&e.hr, "POST", "/api/hris/payroll/"+runA+"/calculate", nil, 200)["summary"].(map[string]any)
	sumB := e.call(&e.hr, "POST", "/api/hris/payroll/"+runB+"/calculate", nil, 200)["summary"].(map[string]any)
	if sumA["total_employees"].(float64) != 2 || sumB["total_employees"].(float64) != 2 {
		t.Fatalf("A %v / B %v", sumA, sumB)
	}
	if sumA["other_entity_count"].(float64) != 1 { // Hanya B
		t.Fatalf("A other entity %v", sumA["other_entity_count"])
	}

	type slip struct{ gross, pph, bpjsKes, bpjsTk, loan string }
	read := func(runID, emp string) slip {
		var s slip
		if err := e.tx.QueryRow(e.ctx, `SELECT gross_salary::text, pph21_deduction::text, bpjs_kes_deduction::text,
			bpjs_tk_jht_deduction::text, loan_deduction::text FROM hris.payroll_details
			WHERE payroll_run_id = $1 AND employee_id = $2`, runID, emp).Scan(&s.gross, &s.pph, &s.bpjsKes, &s.bpjsTk, &s.loan); err != nil {
			t.Fatalf("slip %s/%s: %v", runID, emp, err)
		}
		return s
	}
	a, b := read(runA, shared), read(runB, shared)
	ra, rb := read(runA, refA), read(runB, refB)
	// K4: each slip's tax/BPJS equals that of an employee paid only by that entity.
	if a.gross != ra.gross || a.pph != ra.pph || a.bpjsKes != ra.bpjsKes || a.bpjsTk != ra.bpjsTk {
		t.Fatalf("A slip %+v vs reference %+v", a, ra)
	}
	if b.gross != rb.gross || b.pph != rb.pph || b.bpjsKes != rb.bpjsKes || b.bpjsTk != rb.bpjsTk {
		t.Fatalf("B slip %+v vs reference %+v", b, rb)
	}
	// K5 (interim policy): the installment is on the primary entity's slip only.
	if a.loan != "100000.00" || b.loan != "0.00" {
		t.Fatalf("loan A %s B %s", a.loan, b.loan)
	}
	// B's slip is never allocated to A's store.
	var leaked int
	e.scalar(&leaked, `SELECT count(*)::int FROM hris.payroll_detail_allocations
		WHERE payroll_run_id = $1 AND branch_id = $2`, runB, storeA)
	if leaked != 0 {
		t.Fatalf("%d allocations of run B at A's store", leaked)
	}
}
```

(import `"nuhabit/backend/internal/modules/payroll/domain"` di file test.)

- [ ] **Step 2: Jalankan, pastikan gagal** — `go test ./internal/modules/payroll -run TestMultiEntityCalculate -count=1` → FAIL

- [ ] **Step 3: Implementasi** (`service_runs.go`)

Di dekat tipe kalkulasi:

```go
// multiEntityPolicy is the active multi-entity policy (EPIC-054 K5/K6):
// change it only once HR has decided, see domain/policy.go.
const multiEntityPolicy = domain.PolicyPrimaryEntity
```

`calcSummary`, setelah `Skipped`:

```go
	// OtherEntity counts the active employees paid only by other entities.
	OtherEntity int `json:"other_entity_count"`
```

`calculateRun`: setelah blok `holidays, err := …`, tambahkan:

```go
	company := *run.CompanyID
	branchCompany, err := s.ports.Entities.BranchCompanies(ctx, s.db)
	if err != nil {
		return nil, opaque(err)
	}
```

Ganti isi loop karyawan **hingga** `result := domain.Calculate(*in, config)` dengan:

```go
	for _, e := range employees {
		skip := func(reason string) {
			out.Summary.Skipped = append(out.Summary.Skipped, skipped{e.ID, e.FullName, reason})
		}
		salaries, err := activeSalaryEntities(ctx, s.db, e.ID)
		if err != nil {
			return nil, err
		}
		if !slices.ContainsFunc(salaries, func(sal domain.EntitySalary) bool { return sal.CompanyID == company }) {
			if len(salaries) > 0 {
				out.Summary.OtherEntity++
			} else {
				skip("Belum ada struktur gaji aktif")
			}
			continue
		}
		placements, err := s.ports.Workforce.Placements(ctx, s.db, e.ID, start, end)
		if err != nil {
			return nil, err
		}
		in, records, err := s.payrollInput(ctx, e, company, run.PeriodMonth, run.PeriodYear, start, end, includeThr, holidays)
		if err != nil {
			return nil, err
		}
		if in == nil {
			skip("Belum ada struktur gaji aktif")
			continue
		}
		primary := domain.PrimaryEntity(domain.EntityOf(placements, branchCompany, end), salaries)
		*in = domain.ApplyMultiEntityPolicy(*in, primary == company, multiEntityPolicy)
		result := domain.Calculate(*in, config)
```

Di dalam `database.WithTx`, ganti baris alokasi menjadi:

```go
			days, scoped := domain.ScopeToCompany(branchDays(records.Attendance), placements, branchCompany, company)
			allocation = domain.AllocateSlip(slipAmounts(detail), days, scoped, start, end)
```

Hapus blok `placements, err := s.ports.Workforce.Placements(…)` yang lama (sebelumnya setelah `if in == nil`). Tambahkan `"slices"` ke import.

> `insertDetail` menyimpan `loan_details` dari `in.LoanBreakdown`. Karena kebijakan sudah menolkannya untuk slip non-utama, `markRunPaid` melunasi cicilan tepat sekali, yaitu dari slip entitas utama.

- [ ] **Step 4: Jalankan semua test payroll** — `cd backend && go test ./internal/modules/payroll/... -count=1` → PASS (termasuk `TestRunLifecycle`, `TestMultiStoreAllocation`, `TestRunAttendancePeriod`, `TestRunDeleteAndPaidMismatch` yang kini memakai entitas default).

Bila `TestMultiStoreAllocation` gagal karena toko uji dibuat helper `branch()` dengan company acak (bukan `e.co`), ubah helper `branch()` di `allocation_integration_test.go` agar memakai company `e.co`:

```go
func (e *env) branch(name string) string {
	e.t.Helper()
	var id string
	e.scalar(&id, `INSERT INTO configuration.branches (company_id, name, code) VALUES ($1, $2, $3) RETURNING id::text`,
		e.co, name, "BR-"+testutil.RandomHex(4))
	e.ents.branches[id] = e.co
	return id
}
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/modules/payroll
git commit -m "feat(payroll): kalkulasi per entitas — slip per entitas, PPh21/BPJS terpisah, alokasi toko per entitas"
```

---

### Task 8: Jurnal & slip menampilkan entitas

**Files:**
- Modify: `backend/internal/modules/payroll/service_runs.go` (`markRunPaid`, `splitByCompany`)
- Modify: `backend/internal/modules/payroll/payslips.go:21` (`payslipRunEmbed`)
- Modify: `backend/internal/modules/payroll/payslip_pdf.go` (`payslipDoc.entity`, query, kop)
- Test: `entity_integration_test.go`

**Interfaces:**
- Consumes: `runHead.CompanyID` (Task 5).
- Produces: `splitByCompany(…, runCompany *string)`; embed `payroll_run.company_name`; `payslipDoc.entity string`.

- [ ] **Step 1: Tulis test yang gagal**

```go
func TestMultiEntityPaidAndPayslip(t *testing.T) {
	e := setup(t)
	e.employee("HR Payroll", e.hr.UserID, true)
	crew := e.employee("Crew", "", true) // no account → no company via Companies()
	e.salary(crew, e.co, 5_000_000)
	e.work.placements = map[string][]domain.Placement{crew: {{BranchID: e.store, IsPrimary: true, Start: "2026-01-01"}}}

	id := e.newRun(6, 2099, e.co)
	e.call(&e.hr, "POST", "/api/hris/payroll/"+id+"/calculate", nil, 200)
	for _, st := range []string{"processing", "completed", "paid"} {
		e.call(&e.hr, "PUT", "/api/hris/payroll/"+id, map[string]any{"status": st}, 200)
	}
	var companies string
	e.scalar(&companies, `SELECT (payload->'companies')::text FROM platform.outbox_events
		WHERE topic = 'payroll.run.paid' AND key = $1`, id)
	if !strings.Contains(companies, `"company_id":"`+e.co+`"`) || strings.Contains(companies, `"company_id":null`) {
		t.Fatalf("paid event companies %s", companies)
	}
	slips := e.call(&e.hr, "GET", "/api/hris/payslips?payroll_run_id="+id, nil, 200)["data"].([]any)
	if run := slips[0].(map[string]any)["payroll_run"].(map[string]any); run["company_name"] != "Entitas Uji" {
		t.Fatalf("payslip run embed %v", run)
	}
}
```

(import `"strings"`.) Fakta terverifikasi: `platform.outbox_events(topic, key, payload)` dengan `key = run.ID`. Tanpa port `AttendancePeriods`, periode dianggap tertutup, sehingga transisi status tidak diblok.

- [ ] **Step 2: Jalankan, pastikan gagal** — `go test ./internal/modules/payroll -run TestMultiEntityPaidAndPayslip -count=1` → FAIL

- [ ] **Step 3: Jurnal**

`markRunPaid`: `s.splitByCompany(ctx, tx, &event, deductedBy, run.CompanyID)`.

`splitByCompany(ctx, q, event, deducted map[string]float64, runCompany *string)`. Ganti pembentukan `companies`:

```go
	var companies map[string]string
	if runCompany != nil {
		// A run of one entity posts every slip to that entity.
		companies = make(map[string]string, len(ids))
		for _, id := range ids {
			companies[id] = *runCompany
		}
	} else if companies, err = s.ports.Employees.Companies(ctx, q, ids); err != nil {
		return err
	}
```

- [ ] **Step 4: Slip**

`payslips.go`:

```go
const payslipRunEmbed = `NULL AS employee,
	(SELECT row_to_json(e) FROM (SELECT r.id, r.run_name, r.period_month, r.period_year, r.status, r.paid_at,
	        c.name AS company_name
	   FROM hris.payroll_runs r LEFT JOIN configuration.companies c ON c.id = r.company_id
	  WHERE r.id = d.payroll_run_id) e) AS payroll_run`
```

`payslip_pdf.go`: tambah field `entity string` di `payslipDoc`. Pada query `payslipDocument`, tambahkan `COALESCE(c.name, '')` setelah `r.paid_at` (scan ke `&doc.entity`, letakkan setelah `&doc.paidAt` di `dest`) dan `LEFT JOIN configuration.companies c ON c.id = r.company_id`. Di kop:

```go
	title := "SLIP GAJI"
	if v := p.company["company_legal_name"]; v != nil && strings.TrimSpace(*v) != "" {
		title = strings.TrimSpace(*v)
	}
	if p.entity != "" {
		title = p.entity
	}
```

- [ ] **Step 5: Sesuaikan assertion lama** — `TestRunLifecycle` (`payroll_integration_test.go:~430`) membandingkan `*c.CompanyID` dengan `e.emps.companies[worker]`. Sekarang jurnal memakai entitas run, jadi ganti menjadi `*c.CompanyID != e.co`. Baris `e.emps.companies[worker] = …` (baris ~301) dan di `allocation_integration_test.go:~53` boleh dihapus karena tidak lagi berpengaruh.

- [ ] **Step 6: Jalankan** — `go test ./internal/modules/payroll/... ./internal/modules/accounting/... -count=1` → PASS

- [ ] **Step 7: Commit**

```bash
git add backend/internal/modules/payroll
git commit -m "feat(payroll): jurnal & slip gaji per entitas"
```

---

### Task 9: Frontend — tab entitas bersama + Struktur Gaji per entitas

**Prinsip UI (berlaku untuk Task 9 & 10):** setiap **pilihan** dibuat inline dengan komponen kit, sesuai `docs/frontend-conventions.md`:
- entitas → `Tabs` (pill, `ui/tabs.tsx`), dengan nilai di URL `?entity=`, sama dengan pola `?run=` di `store-cost-report-page.tsx:37-40,86`
- bulan/tahun/entitas di form → `Select` (`ui/select.tsx`)
- karyawan → `Combobox` (sudah ada)
- opsi THR → `Checkbox` (`ui/checkbox.tsx`, pola `kpi-config-page.tsx:126`)

**Tidak ada dialog untuk memilih apa pun.** Popup yang tersisa hanya yang bukan pilihan dan sudah ada: konfirmasi hapus run (`confirm()` di `payroll-page.tsx handleDelete`) dan dialog lihat detail slip di ESS (`ess/components/payslip-detail-dialog.tsx`). Keduanya tidak diubah.

**Files:**
- Modify: `frontend/src/features/hris/payroll/{types,api,queries,query-keys}.ts`
- Create: `frontend/src/features/hris/payroll/components/entity-tabs.tsx`
- Modify: `frontend/src/features/hris/salary/types.ts`
- Modify: `frontend/src/features/hris/salary/components/{salary-page,new-salary-page,edit-salary-page}.tsx`

**Interfaces:**
- Consumes: `GET /api/hris/payroll/entities` (Task 4); `company_id`/`company` di baris salary (Task 6).
- Produces:
  ```ts
  usePayrollEntities(): UseQueryResult<PayrollEntity[]>
  interface PayrollEntity { id: string; code: string; name: string; holding_name: string }
  interface ExtraEntityTab { value: string; label: string }
  useEntityParam(extra?: ExtraEntityTab[]): { entity: string; setEntity(v: string): void; entities: PayrollEntity[]; loading: boolean }
  <EntityTabs value entities extra? onChange />
  ```

- [ ] **Step 1: Tipe, API, query entitas** (payroll feature)

`payroll/types.ts` (tambahkan):

```ts
/** Entitas (perusahaan) yang membayar gaji dan memproses payroll. */
export interface PayrollEntity {
  id: string;
  code: string;
  name: string;
  holding_name: string;
}
```

`payroll/api.ts` (impor `PayrollEntity`):

```ts
export const fetchPayrollEntities = () =>
  apiGet<{ data: PayrollEntity[] }>("/api/hris/payroll/entities").then((res) => res.data || []);
```

`payroll/query-keys.ts` (di dalam objek): `entities: () => ["hris", "payroll", "entities"] as const,`

`payroll/queries.ts` (impor `fetchPayrollEntities`):

```ts
export const usePayrollEntities = () =>
  useQuery({ queryKey: payrollQueryKeys.entities(), queryFn: fetchPayrollEntities, staleTime: 5 * 60 * 1000 });
```

- [ ] **Step 2: `entity-tabs.tsx`**

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePayrollEntities } from "../queries";
import type { PayrollEntity } from "../types";

/** Tab di luar daftar entitas, mis. "Run lama" atau "Belum ada entitas". */
export interface ExtraEntityTab {
  value: string;
  label: string;
}

/**
 * Entitas aktif halaman, dibaca dari `?entity=` (default: entitas pertama),
 * sama dengan pola `?run=` di Biaya Gaji per Toko: pilihan bertahan saat
 * reload dan link bisa dibagikan.
 */
export function useEntityParam(extra: ExtraEntityTab[] = []) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const entitiesQuery = usePayrollEntities();
  const entities = entitiesQuery.data ?? [];
  const requested = params.get("entity") ?? "";
  const known = entities.some((e) => e.id === requested) || extra.some((x) => x.value === requested);
  const entity = known ? requested : (entities[0]?.id ?? extra[0]?.value ?? "");
  const setEntity = (value: string) => router.replace(`${pathname}?entity=${value}`);
  return { entity, setEntity, entities, loading: entitiesQuery.isLoading };
}

/** Pilihan entitas sebagai pill tabs (kit `Tabs`), bukan popup. */
export function EntityTabs({
  value,
  entities,
  extra = [],
  onChange,
}: {
  value: string;
  entities: PayrollEntity[];
  extra?: ExtraEntityTab[];
  onChange: (value: string) => void;
}) {
  if (entities.length === 0 && extra.length === 0) return null;
  return (
    <Tabs value={value} onValueChange={(v) => onChange(String(v))}>
      <TabsList aria-label="Entitas">
        {entities.map((e) => (
          <TabsTrigger key={e.id} value={e.id} title={e.holding_name}>
            {e.name}
          </TabsTrigger>
        ))}
        {extra.map((x) => (
          <TabsTrigger key={x.value} value={x.value}>
            {x.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
```

Ekspor dari `payroll/index.ts`: `export { EntityTabs, useEntityParam, type ExtraEntityTab } from "./components/entity-tabs";`

- [ ] **Step 3: Tipe salary** (`salary/types.ts`): `EmployeeSalary` tambah `company_id?: string | null; company?: { id: string; name: string } | null;`, `SalaryPayload` tambah `company_id?: string;`.

- [ ] **Step 4: Daftar Struktur Gaji per entitas** (`salary-page.tsx`)

Import `useEntityParam`, `EntityTabs` dari `@/features/hris/payroll`. Di awal komponen:

```tsx
const UNASSIGNED = "unassigned";
```

(letakkan di luar komponen) lalu di dalam:

```tsx
  const hasUnassigned = salaries.some((s) => !s.company_id);
  const extra = hasUnassigned ? [{ value: UNASSIGNED, label: "Belum ada entitas" }] : [];
  const { entity, setEntity, entities, loading: entitiesLoading } = useEntityParam(extra);
  const visible = salaries.filter((s) => (entity === UNASSIGNED ? !s.company_id : s.company_id === entity));
```

`loading` menjadi `salaryQuery.isLoading || entitiesLoading`. Tombol "Tambah Salary" → `router.push(\`/dashboard/hris/salary/insert${entity && entity !== UNASSIGNED ? \`?entity=${entity}\` : ""}\`)`. Tepat di bawah blok header tambahkan:

```tsx
      <EntityTabs value={entity} entities={entities} extra={extra} onChange={setEntity} />
      {entity === UNASSIGNED && (
        <p className="text-sm text-muted-foreground">
          Struktur gaji tanpa entitas tidak ikut dihitung payroll mana pun. Buat versi baru dengan entitas pembayar.
        </p>
      )}
```

Di tabel, ganti `salaries.length === 0` / `salaries.map` menjadi `visible.length === 0` / `visible.map`. Teks kosong menjadi `Belum ada struktur gaji untuk entitas ini.` Karyawan yang digaji dua entitas muncul di tab kedua entitas.

- [ ] **Step 5: Tambah Struktur Gaji — Entitas pembayar sebagai dropdown** (`new-salary-page.tsx`)

Import `useSearchParams` (dari `next/navigation`), `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` (dari `@/components/ui/select`), dan `usePayrollEntities` (dari `@/features/hris/payroll`).

```tsx
  const params = useSearchParams();
  const entitiesQuery = usePayrollEntities();
  const [formData, setFormData] = useState({
    ...EMPTY_SALARY_FORM,
    employee_id: "",
    company_id: params.get("entity") ?? "",
  });
```

Validasi dan payload di `handleSave`:

```tsx
    if (!formData.employee_id || !formData.company_id || !formData.base_salary) {
      toast.error("Karyawan, entitas pembayar, dan gaji pokok wajib diisi");
      return;
    }
    …
      await createMutation.mutateAsync({
        ...formToSalaryPayload(formData),
        employee_id: formData.employee_id,
        company_id: formData.company_id,
        notes: undefined,
      });
```

Setelah sukses, kembali ke tab entitas yang sama: `router.push(\`/dashboard/hris/salary?entity=${formData.company_id}\`)`. Field baru, tepat **setelah** blok `{/* Employee Selection */}`:

```tsx
          <div>
            <Label htmlFor="company_id">Entitas pembayar *</Label>
            <div className="mt-1">
              <Select value={formData.company_id} onValueChange={(v) => setFormData({ ...formData, company_id: v })}>
                <SelectTrigger id="company_id">
                  <SelectValue placeholder={entitiesQuery.isLoading ? "Memuat entitas…" : "Pilih entitas"} />
                </SelectTrigger>
                <SelectContent>
                  {(entitiesQuery.data ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Karyawan yang digaji beberapa entitas dibuatkan satu struktur gaji per entitas (mis. A Rp1jt, B Rp1jt);
              tiap entitas menerbitkan slip sendiri.
            </p>
          </div>
```

- [ ] **Step 6: Edit Struktur Gaji — entitas read-only** (`edit-salary-page.tsx`). Di grid "Informasi Karyawan" (setelah item Departemen, baris ~123), tambahkan item dengan pola yang sama:

```tsx
            <div>
              <p className="text-sm text-gray-500">Entitas pembayar</p>
              <p className="font-semibold">{salary.company?.name ?? "Belum ada entitas"}</p>
              <p className="text-xs text-muted-foreground">Ganti entitas = buat struktur gaji baru.</p>
            </div>
```

Samakan elemen label/teks dengan item tetangganya di grid itu (baca baris 105–125 sebelum menempel).

- [ ] **Step 7: Typecheck & lint** — `cd frontend && pnpm exec tsc --noEmit && pnpm lint` → tanpa error baru.

- [ ] **Step 8: Verifikasi di aplikasi** (skill `run`), di lebar 1280 dan 375:
1. `/dashboard/hris/salary` menampilkan tab **Paddy | Paddy Kantor Pusat**, dan URL berubah menjadi `?entity=…` saat tab diganti. Reload tetap di tab yang sama.
2. "Tambah Salary" dari tab Kantor Pusat membuka form dengan Entitas pembayar terisi Kantor Pusat (dropdown, bukan popup).
3. Simpan, lalu kembali ke tab Kantor Pusat dan baris baru tampil. Karyawan yang sama dengan gaji Paddy tetap tampil di tab Paddy.
4. Di 375 px tidak ada scroll horizontal pada `main` (aturan `frontend-conventions.md`).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/hris/payroll frontend/src/features/hris/salary
git commit -m "feat(hris): struktur gaji per entitas dengan tab entitas"
```

---

### Task 10: Frontend — halaman Payroll tanpa popup (tab entitas, form inline, panel hitung inline)

**Files:**
- Modify: `frontend/src/features/hris/payroll/types.ts`
- Create: `frontend/src/features/hris/payroll/components/new-run-form.tsx`
- Create: `frontend/src/features/hris/payroll/components/calculation-panel.tsx`
- Modify: `frontend/src/features/hris/payroll/components/payroll-page.tsx`
- Modify: `frontend/src/features/hris/payroll/components/payroll-detail-page.tsx`
- Delete: `frontend/src/features/hris/payroll/components/payroll-run-dialogs.tsx` (hanya diimpor `payroll-page.tsx`)
- Modify: `frontend/src/features/hris/payroll/components/payslip-page.tsx`, `frontend/src/features/hris/ess/{types.ts,components/payslip-detail-dialog.tsx}`

**Interfaces:**
- Consumes: `EntityTabs`, `useEntityParam`, `usePayrollEntities` (Task 9); API Task 5–8.
- Produces: `<NewRunForm companyId companyName />`, `<CalculationPanel runId hasDetails />`.

**Alur baru:**
1. Payroll: pilih **tab entitas**, lalu isi **form inline** (dropdown Bulan + Tahun, tombol "Buat Payroll <Entitas>").
2. Klik "Hitung" di baris draft, lalu di halaman detail pakai **panel Hitung inline** (checkbox THR + tombol) dengan hasilnya tampil di panel itu.

Tiga popup lama (`NewPayrollDialog`, `CalculateConfirmDialog`, `CalculationResultDialog`) dihapus.

- [ ] **Step 1: Tipe** (`payroll/types.ts`)

`PayrollRun` tambah:

```ts
  /** Entitas run; null = run lama tanpa entitas. */
  company_id?: string | null;
  company?: { id: string; name: string } | null;
```

`CreatePayrollPayload` tambah `company_id: string;`. `CalculatePayrollResult.summary` tambah:

```ts
    skipped?: { employee_id: string; full_name: string; reason: string }[];
    /** Karyawan aktif yang hanya digaji entitas lain. */
    other_entity_count?: number;
```

Embed `payroll_run` di tipe slip (baris ~221) tambah `company_name?: string | null;`.

- [ ] **Step 2: `new-run-form.tsx`**

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONTH_NAMES_ID } from "@/lib/hris/month-label";
import { useCreatePayrollRun } from "../mutations";

/** Buat payroll periode untuk entitas tab aktif — form inline, bukan popup. */
export function NewRunForm({ companyId, companyName }: { companyId: string; companyName: string }) {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const years = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];
  const createMutation = useCreatePayrollRun();

  function handleCreate() {
    createMutation.mutate(
      { company_id: companyId, period_month: month, period_year: year },
      {
        onSuccess: () => toast.success(`Payroll ${MONTH_NAMES_ID[month - 1]} ${year} untuk ${companyName} dibuat`),
        onError: (error) => toast.error(error.message || "Gagal membuat payroll"),
      }
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 py-4">
        <div className="w-full sm:w-48">
          <Label htmlFor="run-month">Bulan</Label>
          <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v, 10))}>
            <SelectTrigger id="run-month" className="mt-1">
              <SelectValue placeholder="Pilih bulan" />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES_ID.map((name, index) => (
                <SelectItem key={name} value={String(index + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-32">
          <Label htmlFor="run-year">Tahun</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
            <SelectTrigger id="run-year" className="mt-1">
              <SelectValue placeholder="Tahun" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="primary" onClick={handleCreate} disabled={createMutation.isPending || !companyId}>
          <PlusIcon className="mr-2 h-4 w-4" />
          {createMutation.isPending ? "Membuat…" : `Buat Payroll ${companyName}`}
        </Button>
        <p className="basis-full text-xs text-muted-foreground">
          Hanya karyawan yang punya struktur gaji di {companyName} yang dihitung. Karyawan yang digaji beberapa entitas
          mendapat slip dari tiap entitas.
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: `calculation-panel.tsx`** (pengganti `CalculateConfirmDialog` + `CalculationResultDialog`)

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { CalculatePayrollResult } from "../types";
import { useCalculatePayroll } from "../mutations";

/** Hitung run draft langsung di halaman detail: opsi THR dan hasilnya inline. */
export function CalculationPanel({ runId, hasDetails }: { runId: string; hasDetails: boolean }) {
  const [includeThr, setIncludeThr] = useState(false);
  const [result, setResult] = useState<CalculatePayrollResult | null>(null);
  const calculate = useCalculatePayroll();

  function handleCalculate() {
    calculate.mutate(
      { runId, includeThr },
      {
        onSuccess: (res) => {
          setResult(res);
          toast.success(`Payroll dihitung untuk ${res.summary?.total_employees ?? 0} karyawan`);
        },
        onError: (error) => toast.error(error.message || "Gagal menghitung payroll"),
      }
    );
  }

  const s = result?.summary;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hitung Payroll</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Checkbox checked={includeThr} onCheckedChange={(v) => setIncludeThr(v === true)} />
            Sertakan THR
          </label>
          <Button variant="primary" onClick={handleCalculate} disabled={calculate.isPending}>
            {calculate.isPending ? "Menghitung…" : hasDetails ? "Hitung Ulang" : "Hitung Payroll"}
          </Button>
        </div>
        {includeThr && (
          <p className="text-xs text-muted-foreground">
            THR ditambahkan sebesar 1× gaji pokok entitas ini untuk karyawan yang sudah bekerja ≥ 1 tahun.
          </p>
        )}

        {result && (
          <div className="space-y-3">
            {result.warning ? (
              <div className="rounded-xl bg-warning-soft p-3 text-sm">⚠️ {result.warning}</div>
            ) : result.attendance_period?.label ? (
              <p className="text-xs text-muted-foreground">
                Absensi periode {result.attendance_period.label} (sudah di-closing)
              </p>
            ) : null}
            <p className="flex items-center gap-2 text-sm font-semibold text-forest">
              <CheckCircleIcon className="h-5 w-5" />
              {s?.total_employees ?? 0} karyawan dihitung
            </p>
            {(s?.other_entity_count ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                {s?.other_entity_count} karyawan hanya digaji entitas lain (tidak diproses di run ini).
              </p>
            )}
            {(s?.skipped?.length ?? 0) > 0 && (
              <div className="rounded-xl bg-danger-soft p-3">
                <p className="text-sm font-semibold">{s?.skipped?.length} karyawan dilewati</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {s?.skipped?.map((k) => (
                    <li key={k.employee_id}>
                      {k.full_name} <span className="text-xs text-muted-foreground">— {k.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(s?.allocation_warnings?.length ?? 0) > 0 && (
              <div className="rounded-xl bg-warning-soft p-3">
                <p className="text-sm font-semibold">{s?.allocation_warnings?.length} karyawan belum punya toko</p>
                <p className="mb-1 text-xs text-muted-foreground">
                  Biayanya masuk &quot;Tanpa toko&quot; di laporan Biaya Gaji per Toko dan jurnal. Atur di HRIS → Master
                  Data → Penempatan Karyawan, lalu hitung ulang.
                </p>
                <ul className="space-y-0.5 text-sm">
                  {s?.allocation_warnings?.map((w) => (
                    <li key={w.employee_id}>
                      {w.full_name} <span className="text-xs text-muted-foreground">— {w.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

> Terverifikasi: token `--color-warning-soft`, `--color-danger-soft`, `--color-forest` ada di `src/app/globals.css`. Varian `Card` `soft`, `Badge` `ink`/`muted`, dan `Button` `primary`/`ink` ada di kit (`ui/card.tsx`, `ui/badge.tsx`, `ui/button.tsx`).

- [ ] **Step 4: Halaman detail** (`payroll-detail-page.tsx`)

Import `Badge` dari `@/components/ui/badge` dan `CalculationPanel` dari `./calculation-panel`. Di header, di bawah `<h1>{payrollRun.run_name}</h1>`, sisipkan badge entitas sebelum `<p>` periode:

```tsx
          <Badge variant={payrollRun.company ? "ink" : "muted"} className="mt-1">
            {payrollRun.company?.name ?? "Run lama (tanpa entitas)"}
          </Badge>
```

Tepat sebelum `<StoreAllocationCard …/>`:

```tsx
      {payrollRun.status === "draft" &&
        (payrollRun.company_id ? (
          <CalculationPanel runId={id} hasDetails={details.length > 0} />
        ) : (
          <Card variant="soft">
            <CardContent className="py-4 text-sm text-muted-foreground">
              Run lama tanpa entitas tidak bisa dihitung ulang — hapus lalu buat payroll per entitas.
            </CardContent>
          </Card>
        ))}
```

Teks tabel kosong (`Klik "Calculate" di halaman sebelumnya.`) menjadi `Belum ada detail payroll. Klik "Hitung Payroll" di atas.`

- [ ] **Step 5: Halaman daftar** (`payroll-page.tsx`), ganti seluruh isi file:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Cog6ToothIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { formatRupiah } from "@/lib/format";
import { monthName } from "@/lib/hris/month-label";
import { shortDateId } from "@/lib/hris/attendance-period";
import type { PayrollRun } from "../types";
import { usePayrollRuns } from "../queries";
import { useUpdatePayrollStatus, useDeletePayrollRun } from "../mutations";
import { EntityTabs, useEntityParam } from "./entity-tabs";
import { NewRunForm } from "./new-run-form";

const LEGACY = "legacy";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  processing: "Processing",
  completed: "Completed",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  processing: "bg-yellow-100 text-yellow-700",
  completed: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

/** Status periode absensi (cut-off) bulan run: terbuka = payroll belum boleh diproses. */
function AttendancePeriodCell({ run }: { run: PayrollRun }) {
  const p = run.attendance_period;
  if (!p) return <span className="text-xs text-gray-400">—</span>;
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-gray-600">{p.label}</p>
      {p.status === "closed" ? (
        <Badge className="bg-slate-100 text-slate-700">🔒 Closed</Badge>
      ) : (
        <Badge className="bg-amber-100 text-amber-800" title="Absensi masih bisa berubah">
          Terbuka{p.closing_date ? ` · closing ${shortDateId(p.closing_date)}` : ""}
        </Badge>
      )}
    </div>
  );
}

export function PayrollPage() {
  const router = useRouter();
  const payrollQuery = usePayrollRuns();
  const payrollRuns = payrollQuery.data ?? [];
  const extra = payrollRuns.some((r) => !r.company_id) ? [{ value: LEGACY, label: "Run lama" }] : [];
  const { entity, setEntity, entities, loading: entitiesLoading } = useEntityParam(extra);
  const isLegacy = entity === LEGACY;
  const entityName = entities.find((e) => e.id === entity)?.name ?? "";
  const runs = payrollRuns.filter((r) => (isLegacy ? !r.company_id : r.company_id === entity));

  const updateStatusMutation = useUpdatePayrollStatus();
  const deleteMutation = useDeletePayrollRun();

  async function handleUpdateStatus(runId: string, newStatus: string) {
    try {
      await updateStatusMutation.mutateAsync({ runId, status: newStatus });
      toast.success(`Status diubah ke ${STATUS_LABELS[newStatus]}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal update status");
    }
  }

  async function handleDelete(runId: string) {
    if (!confirm("Apakah Anda yakin ingin menghapus payroll run ini? Data detail payroll juga akan terhapus.")) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(runId);
      toast.success("Payroll run berhasil dihapus");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus payroll");
    }
  }

  if (payrollQuery.isLoading || entitiesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        kicker="HRIS · Penggajian"
        title="Payroll & Benefits"
        description="Proses gaji per entitas: pilih entitas, buat payroll periode, lalu hitung di halaman detail."
        actions={
          <Button variant="outline" onClick={() => router.push("/dashboard/hris/payroll/settings")}>
            <Cog6ToothIcon className="w-4 h-4 mr-2" />
            Pengaturan
          </Button>
        }
      />

      {entities.length === 0 && !isLegacy ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Belum ada entitas aktif. Tambahkan perusahaan di pengaturan struktur bisnis.
          </CardContent>
        </Card>
      ) : (
        <>
          <EntityTabs value={entity} entities={entities} extra={extra} onChange={setEntity} />

          {isLegacy ? (
            <Card variant="soft">
              <CardContent className="py-4 text-sm text-muted-foreground">
                Run lama dibuat sebelum payroll per entitas. Run yang sudah dibayar tetap sah; run draft tidak bisa
                dihitung ulang — hapus lalu buat per entitas.
              </CardContent>
            </Card>
          ) : (
            <NewRunForm companyId={entity} companyName={entityName} />
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard label="Total payroll run" value={runs.length} />
            <StatCard label="Dalam draft" value={runs.filter((r) => r.status === "draft").length} />
            <StatCard label="Completed" value={runs.filter((r) => r.status === "completed").length} />
            <StatCard label="Paid" value={runs.filter((r) => r.status === "paid").length} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Riwayat Payroll — {isLegacy ? "Run lama" : entityName}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Periode</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Nama</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Status</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Periode Absensi</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Karyawan</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Total Gross</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Total Net</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-gray-500">
                          Belum ada payroll untuk entitas ini. Pilih bulan & tahun di atas lalu klik &quot;Buat Payroll&quot;.
                        </td>
                      </tr>
                    ) : (
                      runs.map((run) => (
                        <tr key={run.id} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4">
                            {monthName(run.period_month)} {run.period_year}
                          </td>
                          <td className="py-3 px-4">{run.run_name}</td>
                          <td className="py-3 px-4">
                            <Badge className={STATUS_COLORS[run.status]}>{STATUS_LABELS[run.status]}</Badge>
                          </td>
                          <td className="py-3 px-4">
                            <AttendancePeriodCell run={run} />
                          </td>
                          <td className="text-right py-3 px-4">{run.total_employees || 0}</td>
                          <td className="text-right py-3 px-4 font-medium">{formatRupiah(run.total_gross || 0)}</td>
                          <td className="text-right py-3 px-4 font-medium text-green-600">
                            {formatRupiah(run.total_net || 0)}
                          </td>
                          <td className="text-right py-3 px-4">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => router.push(`/dashboard/hris/payroll/${run.id}`)}
                              >
                                <DocumentTextIcon className="w-4 h-4" />
                              </Button>
                              {run.status === "draft" && run.company_id && (
                                <>
                                  <Button size="sm" onClick={() => router.push(`/dashboard/hris/payroll/${run.id}`)}>
                                    Hitung
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ink"
                                    onClick={() => handleUpdateStatus(run.id, "processing")}
                                    disabled={run.attendance_period?.status === "open"}
                                    title={
                                      run.attendance_period?.status === "open"
                                        ? "Closing periode absensi dulu (HRIS → Absensi → Periode Absensi)"
                                        : undefined
                                    }
                                  >
                                    Process
                                  </Button>
                                </>
                              )}
                              {run.status === "processing" && (
                                <Button
                                  size="sm"
                                  variant="ink"
                                  onClick={() => handleUpdateStatus(run.id, "completed")}
                                  disabled={run.attendance_period?.status === "open"}
                                  title={
                                    run.attendance_period?.status === "open"
                                      ? "Closing periode absensi dulu sebelum menyetujui payroll"
                                      : undefined
                                  }
                                >
                                  Approve
                                </Button>
                              )}
                              {run.status === "completed" && (
                                <Button size="sm" variant="ink" onClick={() => handleUpdateStatus(run.id, "paid")}>
                                  Mark Paid
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDelete(run.id)}
                                className="text-red-600 hover:text-red-700 hover:border-red-300"
                              >
                                Hapus
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
```

Catatan perubahan vs file lama (selain entitas):
- Kartu statistik memakai `StatCard` kit, mengikuti `store-cost-report-page.tsx`.
- Warna tombol literal (`style={{ backgroundColor: '#ea580c' }}`, `bg-blue-600`, `bg-green-600`) diganti varian kit `ink`/default, karena `frontend-conventions.md` melarang literal hex.
- Teks, guard periode absensi, dan konfirmasi hapus tidak berubah.

Kemudian **hapus** `components/payroll-run-dialogs.tsx`.

- [ ] **Step 6: Nama entitas di slip**

`payslip-page.tsx` (badge di header, baris ~108):

```tsx
            <Badge className="bg-blue-100 text-blue-700">
              {payrollRun?.company_name ? `${payrollRun.run_name} · ${payrollRun.company_name}` : payrollRun?.run_name}
            </Badge>
```

`ess/types.ts` (embed `payroll_run`, baris ~123) tambah `company_name?: string | null;`. `ess/components/payslip-detail-dialog.tsx` `payslipPeriodLabel` membedakan dua slip pada bulan yang sama:

```tsx
export function payslipPeriodLabel(slip: EssPayslip): string {
  const run = slip.payroll_run;
  if (!run) return "—";
  const period = monthYearLabel(run.period_month ?? 1, run.period_year);
  return run.company_name ? `${period} · ${run.company_name}` : period;
}
```

(Dialog detail slip ESS sendiri tidak diubah: isinya menampilkan slip, bukan pilihan.)

- [ ] **Step 7: Typecheck, lint, test** — `cd frontend && pnpm exec tsc --noEmit && pnpm lint && pnpm test` → tanpa error baru. Pastikan tidak ada lagi impor `payroll-run-dialogs`: `grep -rn "payroll-run-dialogs" frontend/src` kosong.

- [ ] **Step 8: Verifikasi di aplikasi** (skill `run`), di lebar 1280 dan 375:
1. `/dashboard/hris/payroll` menampilkan tab **Paddy | Paddy Kantor Pusat | Run lama**. Form Bulan/Tahun (dropdown) inline di bawah tab, **tanpa** popup.
2. Tab Paddy: pilih Desember 2026, lalu "Buat Payroll Paddy". Run muncul di tabel tab Paddy saja.
3. "Hitung" membuka detail run. Panel **Hitung Payroll** inline (checkbox THR + tombol) menampilkan hasil di panel itu, termasuk jumlah karyawan entitas lain dan daftar dilewati. Tabel detail ikut terisi.
4. Ulangi untuk tab Paddy Kantor Pusat. Karyawan uji multi-entitas punya slip di kedua run, dan badge slip menampilkan nama entitas.
5. Tab "Run lama" menampilkan Agu–Nov 2026, tanpa form buat dan tanpa tombol Hitung.
6. Di 375 px tab bisa digulir horizontal di dalam `TabsList` (`overflow-x-auto` bawaan kit), tetapi `main` tidak (`main.scrollWidth === main.clientWidth`).
7. Hapus run & gaji uji.

- [ ] **Step 9: Commit**

```bash
git add -A frontend/src/features/hris
git commit -m "feat(payroll): pilih entitas via tab, form & hitung inline tanpa popup"
```

---

### Task 11: Dokumentasi — epic, registry, Automation Log

**Files:**
- Create: `docs/epics/EPIC-054-payroll-multi-entitas.md`
- Modify: `docs/epics/README.md` (baris registry setelah EPIC-053)

- [ ] **Step 1: Epic**

```markdown
# EPIC-054: Payroll Multi-Entitas — Filter Entitas & Slip per Entitas (`MODULE-PAYROLL`)

status: on-progress
environment: dev
retries: 0

## Goal
Proses gaji dimulai dengan memilih entitas; satu karyawan bisa digaji beberapa entitas (nominal per entitas) dan menerima slip dari tiap entitas.

## Keputusan (2026-10-15)
- K1 pilih entitas dulu · K2 slip per entitas · K3 nominal per entitas · K4 PPh21 & BPJS terpisah per entitas.

## Belum diputuskan (disiapkan, belum diimplementasikan)
- K5 potongan pinjaman/telat/cuti tidak dibayar: SEMENTARA cicilan & telat hanya di slip entitas utama (`domain/policy.go`, `PolicyPrimaryEntity`). Opsi: proporsional / pinjaman per entitas.
- K6 absensi: SEMENTARA prorata, cuti tidak dibayar, lembur, THR dihitung di tiap slip dari gaji pokok entitas itu (proporsional). Opsi: lembur dibayar entitas pemilik toko.

## Tasks
- [ ] T1 Migrasi company_id (struktur gaji & run) + backfill
- [ ] T2 Entitas utama & lingkup alokasi · T3 Kebijakan multi-entitas
- [ ] T4 Port & endpoint entitas · T5 Run per entitas · T6 Struktur gaji per entitas + konsumen lain
- [ ] T7 Kalkulasi per entitas · T8 Jurnal & slip
- [ ] T9 UI Struktur Gaji (tab entitas) · T10 UI Payroll tanpa popup (tab entitas, form & hitung inline)

## Acceptance Criteria
- Given karyawan bergaji Paddy Rp1jt & Kantor Pusat Rp1jt, When run Paddy dan run Kantor Pusat dihitung, Then ia punya dua slip masing-masing gross Rp1jt.
- Given slip entitas X, Then PPh21 & BPJS-nya sama dengan karyawan yang hanya digaji X dengan nominal yang sama.
- Given cicilan pinjaman, Then hanya dipotong di slip entitas utama dan dilunasi tepat sekali saat Paid.
- Given run lama tanpa entitas pada periode P, Then run entitas untuk P ditolak dan run lama tidak bisa dihitung ulang.
- Given slip entitas B, Then tidak dialokasikan ke toko entitas A; jurnal diposting ke company B.

## Follow-up (di luar scope)
business_scope per user · identitas legal per entitas (NPWP, alamat) di kop slip/laporan pajak · payroll_settings per entitas · mode K5/K6 lain · parity route TS fallback.

## Automation Log
- 2026-10-15 — Analisa + klarifikasi user (K1–K6). Data lokal: 2 entitas (Paddy, Paddy Kantor Pusat), 23 karyawan bergaji (1 versi aktif masing-masing, backfill ke entitas penempatan utama). Plan: `docs/superpowers/plans/2026-10-15-payroll-entity-filter.md`.
```

- [ ] **Step 2: Registry** — setelah baris EPIC-053 di `docs/epics/README.md`:

```markdown
| [EPIC-054](./EPIC-054-payroll-multi-entitas.md) | Payroll Multi-Entitas — Filter Entitas & Slip per Entitas (`MODULE-PAYROLL`) | on-progress | 2026-10-15 |
```

- [ ] **Step 3: Saat semua task selesai** — centang tasks, ubah `status: ready-for-qa` (epic & registry), dan tambahkan Automation Log berisi hasil gate (`go test`, `tsc`/lint, verifikasi Task 9 Step 8 & Task 10 Step 8).

- [ ] **Step 4: Commit**

```bash
git add docs/epics/EPIC-054-payroll-multi-entitas.md docs/epics/README.md docs/superpowers/plans/2026-10-15-payroll-entity-filter.md
git commit -m "docs: EPIC-054 payroll multi-entitas — analisa & plan"
```
