# HRIS Go-Live: Data Karyawan & Jadwal Shift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyiapkan modul Karyawan & Jadwal Kerja untuk go-live 21-10-2026, mencakup:
- resign, lepas email, audit log;
- export/import karyawan;
- kode shift, Shift/Non-Shift, jadwal tetap;
- jadwal per tanggal dengan bulk upload per cabang dan validasi.

**Architecture:** Semua logika baru ditaruh di modul Go `hris` (`backend/internal/modules/hris`). Prinsipnya:
- **Logika murni** (parsing/validasi Excel, label, aturan jadwal) di `hris/domain` dan diuji unit.
- **SQL & alur transaksi** di file service baru, memakai `repo.InTx` + `r.querier()`. Interface `Repository` tidak dibengkakkan.
- **Jadwal per tanggal** disatukan dengan pola mingguan lewat view `hris.v_employee_schedule`. Hasilnya resolver lama (`domain.ResolveScheduleRow`) otomatis memakai jadwal per tanggal tanpa logika baru.
- **File Excel** dibangun dengan builder template baru di `platform/xlsx`, di atas excelize.
- **Frontend:** Next.js, fitur di `frontend/src/features/{users,hris/schedules,hris/shifts}`.

**Tech Stack:** Go 1.x + pgx + excelize v2.11, PostgreSQL 16, Next.js (versi repo; baca `frontend/node_modules/next/dist/docs` sebelum menulis halaman), TanStack Query, vitest + testing-library.

**Spec:** `docs/superpowers/specs/2026-10-19-hris-karyawan-jadwal-golive-design.md`

## Global Constraints

- **Target live 2026-10-21.** Urutan task di bawah sudah sesuai prioritas spec; kalau waktu habis, task belakang ditunda, bukan dipotong setengah jalan.
- **Payroll, KPI, dan roster spa TIDAK diubah** (tahap 2). Mereka tetap membaca `hris.employee_shifts`.
- **File Excel tanpa nama field database:** tidak ada `snake_case`, ID, `true`/`false`. Judul dan nilai pilihan memakai label tabel di Spec Bagian 3.2/3.3. Sheet tersembunyi *Info* boleh berisi ID karena tidak terlihat.
- **Tanggal:** di file ditampilkan `DD/MM/YYYY`. Import menerima tanggal Excel, `DD/MM/YYYY`, `DD-MM-YYYY`, `YYYY-MM-DD`.
- **Angka panjang disimpan sebagai teks:** NIP, NIK, NPWP, No. HP, No. Rekening, No. BPJS.
- **Rentang upload jadwal 7–45 hari.** Maksimal 300 karyawan per file jadwal dan 1.000 baris per file karyawan.
- **Jadwal tetap Non-Shift:** Senin–Jumat kode `NS` 09.00–18.00, istirahat 60 menit; Sabtu–Minggu libur.
- **Shift default:** kode `DEF` 08.00–17.00, istirahat 60 menit. Toleransi telat kedua shift bawaan: 15 menit (sama dengan Odoo).
- **Email arsip** untuk data lama yang dilepas: `arsip-{nip}@resign.invalid`, dengan `{nip}` huruf kecil dan karakter non `[a-z0-9-]` dibuang.
- **Tanpa password di proteksi sheet:** kunci hanya mencegah salah edit, bukan keamanan.
- **Commit** per task ke branch kerja, dengan pesan diakhiri `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tidak ada deploy** sebelum user menyetujui hasil di stack uji salinan DB.
- **Test integrasi Go** butuh `TEST_DATABASE_URL` yang sudah dimigrasi (`make -C backend test`). Kegagalan lama yang sudah diketahui (hris TestAttendancePeriodClosing, TestLeaves; site/storedvalue/auth 403; spa TestTherapistPayrollTwiceAMonth; shop timeout) bukan regresi.

## Review Focus

1. **Karyawan dengan dua cabang** (penempatan utama + tambahan): template cabang B harus memuat karyawan yang punya penempatan *apa pun* di B pada rentang itu, dan validasi "tidak ditempatkan" dicek per tanggal. Test: `TestScheduleTemplateIncludesSecondaryPlacement` (Task 11).
2. **Shift malam yang melewati tengah malam** (CS3 16.00–00.00, Malam 22.00–06.00): perhitungan jeda antar shift memakai jam selesai di hari berikutnya. Test: kasus `overnight gap` di `TestValidateScheduleUploadWarnings` (Task 10).
3. **File diedit di Excel versi lokal Indonesia:** tanggal bisa terbaca sebagai teks `21/10/2026` atau sebagai serial tanggal, dan NIP bisa berubah jadi angka (`2.02505E+08`) bila HR menyalin ulang kolom. Import harus menerima kedua bentuk tanggal dan menolak NIP berformat ilmiah dengan pesan jelas. Test: `TestParseDateCell` dan `TestCleanNIP` (Task 3).
4. **Export → import Replacement tanpa perubahan** harus menghasilkan 0 baris diubah. Ini menangkap semua mismatch label ↔ nilai. Test: `TestEmployeeExportImportRoundTrip` (Task 16).
5. **Karyawan Non-Shift yang masih punya jadwal per tanggal lama:** setelah tipe diganti, jadwal per tanggal ke depan harus terhapus agar jadwal tetap berlaku. Kalau tidak, clock-in memakai shift lama. Test: `TestScheduleTypeToNonShiftClearsFutureDays` (Task 5).

---

## Peta file

**Backend — baru**

| File | Isi |
|---|---|
| `backend/database/migrations/deltas/20261019090000_hris_shift_codes.sql` | kode shift, `is_default`, seed `DEF`/`NS` |
| `backend/database/migrations/deltas/20261019090100_hris_employee_schedule_type.sql` | `employees.schedule_type` |
| `backend/database/migrations/deltas/20261019090200_hris_employee_shift_days.sql` | tabel jadwal per tanggal + view `hris.v_employee_schedule` |
| `backend/database/migrations/deltas/20261019090300_hris_menu_jadwal_kerja.sql` | menu "Jadwal Kerja" |
| `backend/database/sql/fixes/2026-10-21_non_shift_hq_warehouse.sql` | skrip ops (dijalankan manual setelah daftar disetujui) |
| `backend/internal/platform/xlsx/template.go` (+ `template_test.go`) | builder template (dropdown, teks, tanggal, kunci, sheet tersembunyi) |
| `backend/internal/modules/hris/domain/excel_values.go` (+ test) | label ↔ nilai, parse tanggal/angka |
| `backend/internal/modules/hris/domain/schedule_upload.go` (+ test) | parse & validasi file jadwal |
| `backend/internal/modules/hris/domain/employee_import.go` (+ test) | kolom & validasi file karyawan |
| `backend/internal/modules/hris/schedule_type.go` | ubah tipe jadwal + jadwal tetap (service + handler) |
| `backend/internal/modules/hris/schedule_days.go` | grid / template / import jadwal (service + handler) |
| `backend/internal/modules/hris/employee_resign.go` | resign (service + handler) |
| `backend/internal/modules/hris/employee_audit.go` | tulis/baca audit karyawan |
| `backend/internal/modules/hris/employee_excel.go` | export/import karyawan |
| `*_integration_test.go` | satu per file service di atas |

**Backend — diubah**

| File | Perubahan |
|---|---|
| `backend/internal/modules/hris/routes.go` | route baru |
| `backend/internal/modules/hris/overtime.go`, `http_schedules.go` | kode shift |
| `backend/internal/modules/hris/files.go`, `postgres_attendance.go`, `selfservice.go` | baca `hris.v_employee_schedule` |
| `backend/internal/modules/configuration/accounts/{input.go,employees.go,ports.go}`, `backend/internal/app/adapters_configuration_accounts.go` | `schedule_type`, filter, lepas email, audit |
| `frontend/src/lib/go-routes.generated.json` | regenerasi |

**Frontend — baru**
- `frontend/src/features/hris/schedules/` (`api.ts`, `queries.ts`, `types.ts`, `components/schedules-page.tsx`, `components/schedule-grid.tsx`, `components/schedule-upload-dialog.tsx`, `components/fixed-schedule-dialog.tsx`, + test)
- `frontend/src/features/users/components/resign-dialog.tsx`
- `frontend/src/features/users/components/schedule-type-dialog.tsx`
- `frontend/src/features/users/components/employee-import-dialog.tsx`
- `frontend/src/features/users/components/detail/employee-audit-tab.tsx`
- `frontend/src/lib/hris/schedule-type.ts`
- tests

**Frontend — diubah**
- `features/users/components/{users-list-page,users-list-filters,user-detail-page,employee-shifts-tab}.tsx`
- `features/users/components/user-form/employment-section.tsx`, `lib/hris/users-form.ts`, `lib/users/user-mapper.ts`, `features/users/{api,types}.ts`
- `features/hris/shifts/*`, `lib/hris/shifts-view.ts`
- `features/hris/leaves/api.ts`
- `app/dashboard/(dashboard)/hris/schedules/page.tsx`
- `features/hris/ess/components/shift-tim-page.tsx`
- `features/audit/audit-labels.ts`

---

### Task 1: Migrasi skema (kode shift, tipe jadwal, jadwal per tanggal, menu)

**Files:**
- Create: `backend/database/migrations/deltas/20261019090000_hris_shift_codes.sql`
- Create: `backend/database/migrations/deltas/20261019090100_hris_employee_schedule_type.sql`
- Create: `backend/database/migrations/deltas/20261019090200_hris_employee_shift_days.sql`
- Create: `backend/database/migrations/deltas/20261019090300_hris_menu_jadwal_kerja.sql`
- Test: `backend/internal/modules/hris/schema_golive_integration_test.go`

**Interfaces:**
- Produces:
  - kolom `hris.shifts.code text NOT NULL` (unik case-insensitive, format `^[A-Z0-9]{1,12}$`) dan `hris.shifts.is_default boolean`;
  - baris shift `DEF` dan `NS`;
  - `hris.employees.schedule_type text NOT NULL DEFAULT 'shift'` (`shift` | `non_shift`);
  - tabel `hris.employee_shift_days(id, employee_id, work_date, shift_id, branch_id, batch_id, created_by_name, created_at)` dengan `UNIQUE(employee_id, work_date)`;
  - view `hris.v_employee_schedule(employee_id, day_of_week, shift_id, effective_from, effective_to, priority)`;
  - menu `hris.kepegawaian.schedules`.

- [ ] **Step 1: Tulis test skema yang gagal**

```go
// backend/internal/modules/hris/schema_golive_integration_test.go
package hris

import "testing"

func TestGoLiveSchema(t *testing.T) {
	h := newHarness(t)
	if got := h.scalar(`SELECT code FROM hris.shifts WHERE is_default`); got != "DEF" {
		t.Fatalf("default shift = %q, want DEF", got)
	}
	if got := h.scalar(`SELECT start_time::text || '-' || end_time::text || '/' || break_minutes || '/' || late_tolerance_minutes
		FROM hris.shifts WHERE code = 'NS'`); got != "09:00:00-18:00:00/60/15" {
		t.Fatalf("NS = %q", got)
	}
	if got := h.scalar(`SELECT count(*)::text FROM hris.shifts WHERE code IS NULL`); got != "0" {
		t.Fatalf("shifts without code: %s", got)
	}
	e := h.employee(emp{})
	if got := h.scalar(`SELECT schedule_type FROM hris.employees WHERE id = $1`, e); got != "shift" {
		t.Fatalf("schedule_type default = %q", got)
	}
	// Jadwal per tanggal menang atas pola mingguan yang mulai di hari yang sama.
	ns := h.scalar(`SELECT id::text FROM hris.shifts WHERE code = 'NS'`)
	def := h.scalar(`SELECT id::text FROM hris.shifts WHERE code = 'DEF'`)
	h.exec(`INSERT INTO hris.employee_shifts (employee_id, day_of_week, shift_id, effective_from) VALUES ($1, 2, $2, '2026-11-03')`, e, ns)
	h.exec(`INSERT INTO hris.employee_shift_days (employee_id, work_date, shift_id, batch_id) VALUES ($1, '2026-11-03', $2, gen_random_uuid())`, e, def)
	got := h.scalar(`SELECT shift_id::text FROM hris.v_employee_schedule WHERE employee_id = $1 AND day_of_week = 2
		ORDER BY effective_from DESC, priority LIMIT 1`, e)
	if got != def {
		t.Fatalf("view winner = %s, want per-date %s", got, def)
	}
	if got := h.scalar(`SELECT count(*)::text FROM iam.menus WHERE code = 'hris.kepegawaian.schedules' AND route_path = '/dashboard/hris/schedules'`); got != "1" {
		t.Fatalf("menu rows = %s", got)
	}
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run TestGoLiveSchema -count=1`
Expected: FAIL (`column "code" does not exist`)

- [ ] **Step 3: Tulis migrasi kode shift**

```sql
-- backend/database/migrations/deltas/20261019090000_hris_shift_codes.sql
-- =============================================================================
-- Kode shift untuk file upload Jadwal Kerja (nama shift live ada yang kembar)
-- + shift bawaan DEF (Default 08.00–17.00) dan NS (Non-Shift 09.00–18.00).
-- Spec: docs/superpowers/specs/2026-10-19-hris-karyawan-jadwal-golive-design.md §2.1
-- =============================================================================

ALTER TABLE hris.shifts
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Kode mudah dibaca untuk shift yang sudah ada di live (nama + jam masuk).
UPDATE hris.shifts s SET code = m.code
FROM (VALUES
  ('CS Shift 1 - 06.00-14.00', '06:00', 'CS1'),
  ('CS Shift 2 - 11.00-19.00', '11:00', 'CS2'),
  ('CS Shift 3 - 16.00-00.00', '16:00', 'CS3'),
  ('CS Shift 4 - 07.00-15.00', '07:00', 'CS4'),
  ('SPG Store 1 - 08.00-16.00', '08:00', 'SPG1'),
  ('SPG Store 2 - 11.00-19.00', '11:00', 'SPG2'),
  ('SPG Store 3 - 13.30-21.30', '13:30', 'SPG3'),
  ('SPG Store 4 - 14.00-22.00', '14:00', 'SPG4'),
  ('SPG Store 7 - 12.00-20.00', '12:00', 'SPG7'),
  ('SPG Store 11 - 09.00-17.00', '09:00', 'SPG11'),
  ('SPG 13 - 14.30-22.30', '14:30', 'SPG13'),
  ('PERFUMER Shift 1 - 06.00-14.00', '06:00', 'PRF1'),
  ('Shift Pagi', '08:00', 'PAGI8'),
  ('Shift Pagi', '09:00', 'PAGI9'),
  ('Shift Siang', '13:00', 'SIANG13'),
  ('Shift Siang', '14:00', 'SIANG14'),
  ('Shift Malam', '22:00', 'MALAM')
) AS m(name, start_at, code)
WHERE s.code IS NULL AND s.name = m.name AND s.start_time = m.start_at::time
  AND NOT EXISTS (SELECT 1 FROM hris.shifts x WHERE upper(x.code) = m.code);

-- Shift lain (lingkungan non-live): SHIFT1, SHIFT2, … berurutan.
WITH n AS (
  SELECT id, row_number() OVER (ORDER BY sort_order NULLS LAST, start_time, name) AS rn
  FROM hris.shifts WHERE code IS NULL
)
UPDATE hris.shifts s SET code = 'SHIFT' || n.rn FROM n WHERE s.id = n.id;

INSERT INTO hris.shifts (code, name, start_time, end_time, break_minutes, late_tolerance_minutes, is_overnight, sort_order)
SELECT 'DEF', 'Default 08.00–17.00', '08:00', '17:00', 60, 15, false, 0
WHERE NOT EXISTS (SELECT 1 FROM hris.shifts WHERE upper(code) = 'DEF');

INSERT INTO hris.shifts (code, name, start_time, end_time, break_minutes, late_tolerance_minutes, is_overnight, sort_order)
SELECT 'NS', 'Non-Shift 09.00–18.00', '09:00', '18:00', 60, 15, false, 1
WHERE NOT EXISTS (SELECT 1 FROM hris.shifts WHERE upper(code) = 'NS');

UPDATE hris.shifts SET is_default = (upper(code) = 'DEF');

ALTER TABLE hris.shifts ALTER COLUMN code SET NOT NULL;
ALTER TABLE hris.shifts DROP CONSTRAINT IF EXISTS shifts_code_format;
ALTER TABLE hris.shifts ADD CONSTRAINT shifts_code_format CHECK (code ~ '^[A-Z0-9]{1,12}$');
CREATE UNIQUE INDEX IF NOT EXISTS shifts_code_key ON hris.shifts (upper(code));
CREATE UNIQUE INDEX IF NOT EXISTS shifts_single_default ON hris.shifts (is_default) WHERE is_default;
```

- [ ] **Step 4: Tulis migrasi tipe jadwal**

```sql
-- backend/database/migrations/deltas/20261019090100_hris_employee_schedule_type.sql
-- Tipe jadwal karyawan (Spec §2.2): shift = ditugaskan lewat Jadwal Kerja,
-- non_shift = jadwal tetap Sen–Jum 09.00–18.00. Wajib untuk semua karyawan.
ALTER TABLE hris.employees
  ADD COLUMN IF NOT EXISTS schedule_type text NOT NULL DEFAULT 'shift';
ALTER TABLE hris.employees DROP CONSTRAINT IF EXISTS employees_schedule_type_check;
ALTER TABLE hris.employees ADD CONSTRAINT employees_schedule_type_check
  CHECK (schedule_type IN ('shift', 'non_shift'));
```

- [ ] **Step 5: Tulis migrasi jadwal per tanggal + view**

```sql
-- backend/database/migrations/deltas/20261019090200_hris_employee_shift_days.sql
-- Jadwal per tanggal hasil bulk upload Jadwal Kerja (Spec §2.4). shift_id
-- NULL = libur. Menang atas pola mingguan (hris.employee_shifts) di
-- tanggal yang sama; view v_employee_schedule menyatukan keduanya dalam
-- bentuk baris pola sehingga domain.ResolveScheduleRow tidak berubah:
-- baris per tanggal = pola satu hari (effective_from = effective_to = tanggal),
-- priority 0 dipakai sebagai pemenang bila effective_from sama.
CREATE TABLE IF NOT EXISTS hris.employee_shift_days (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
  work_date       date NOT NULL,
  shift_id        uuid REFERENCES hris.shifts(id),
  branch_id       uuid REFERENCES configuration.branches(id),
  batch_id        uuid NOT NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_shift_days_unique UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS employee_shift_days_branch_date_idx
  ON hris.employee_shift_days (branch_id, work_date);

CREATE OR REPLACE VIEW hris.v_employee_schedule AS
  SELECT d.employee_id,
         EXTRACT(ISODOW FROM d.work_date)::int AS day_of_week,
         d.shift_id,
         d.work_date AS effective_from,
         d.work_date AS effective_to,
         0 AS priority
  FROM hris.employee_shift_days d
  UNION ALL
  SELECT es.employee_id, es.day_of_week, es.shift_id, es.effective_from, es.effective_to, 1
  FROM hris.employee_shifts es;
```

- [ ] **Step 6: Tulis migrasi menu**

```sql
-- backend/database/migrations/deltas/20261019090300_hris_menu_jadwal_kerja.sql
-- Menu Kepegawaian → Jadwal Kerja (bulk upload jadwal per cabang). Hak
-- aksesnya disalin dari Shift Kerja, sehingga peran yang sudah mengelola
-- Shift Kerja otomatis bisa membuka Jadwal Kerja.
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.kepegawaian.schedules', 'Jadwal Kerja', '/dashboard/hris/schedules', 'calendar',
        'sidebar', 31, '{"actions":["read","create","update","import","export"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'hris', level = 3 WHERE code = 'hris.kepegawaian.schedules';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.kepegawaian.schedules' AND parent.code = 'hris.kepegawaian';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT rmp.role_id, m.id, rmp.granted_actions
FROM iam.role_menu_permissions rmp
JOIN iam.menus s ON s.id = rmp.menu_id AND s.code = 'hris.kepegawaian.shifts'
CROSS JOIN iam.menus m
WHERE m.code = 'hris.kepegawaian.schedules'
ON CONFLICT ON CONSTRAINT role_menu_permissions_unique DO NOTHING;
```

- [ ] **Step 7: Terapkan ke DB test lalu jalankan test**

Run:
```bash
cd backend && DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go run ./cmd/migrate -apply && DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go run ./cmd/migrate -verify
TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run TestGoLiveSchema -count=1
```
Expected: migrate OK; PASS

- [ ] **Step 8: Commit**

```bash
git add backend/database/migrations/deltas/2026101909* backend/internal/modules/hris/schema_golive_integration_test.go
git commit -m "feat(hris): skema kode shift, tipe jadwal, jadwal per tanggal, menu Jadwal Kerja"
```

---

### Task 2: Builder template Excel (`platform/xlsx/template.go`)

**Files:**
- Create: `backend/internal/platform/xlsx/template.go`
- Test: `backend/internal/platform/xlsx/template_test.go`

**Interfaces:**
- Produces:
```go
type ColumnKind int
const (KindText ColumnKind = iota; KindDate; KindList; KindNumber; KindFormula)
type TemplateColumn struct {
    Header   string     // judul tampilan, mis. "Nama Lengkap"
    Required bool       // judul diberi " *" dan warna wajib
    Width    float64
    Kind     ColumnKind
    Options  []string   // KindList: daftar pilihan (ditaruh di sheet tersembunyi "Pilihan")
    ReadOnly bool       // judul abu-abu + catatan "hanya informasi"; sel dikunci bila sheet dikunci
    Fill     string     // warna isi seluruh kolom data, mis. "#FDECEC" (Minggu/libur); "" = tanpa
    Formula  func(row int) string // KindFormula: rumus untuk baris data (1-based Excel row)
}
type TemplateSheet struct {
    Name       string
    TitleLines []string   // baris judul di atas header (boleh kosong)
    Columns    []TemplateColumn
    Rows       [][]any    // nilai data; string untuk teks, time.Time untuk tanggal
    FreezeCols int        // kolom kiri yang dibekukan
    DataRows   int        // jumlah baris kosong yang tetap diberi dropdown/format (template import)
    Protect    bool       // kunci sheet; sel kolom non-ReadOnly & non-formula tetap bisa diubah
    CellFill   map[string]string // isi sel → warna, mis. {"L": "#E5E7EB"} (conditional format)
}
type InfoSheet struct { Name string; Pairs [][2]string } // sheet tersembunyi
func BuildTemplate(sheets []TemplateSheet, notes []SheetSpec, info *InfoSheet) ([]byte, error)
// HeaderRow is the 0-based row index of the header in a TemplateSheet (= len(TitleLines)).
func HeaderRow(s TemplateSheet) int
const RequiredMark = " *"
```
- `notes` adalah sheet petunjuk polos (`SheetSpec` yang sudah ada) yang ditaruh **sebelum** sheet data.

- [ ] **Step 1: Tulis test yang gagal**

```go
// backend/internal/platform/xlsx/template_test.go
package xlsx

import (
	"bytes"
	"strconv"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

func itoa(n int) string                  { return strconv.Itoa(n) }
func bytesReader(b []byte) *bytes.Reader { return bytes.NewReader(b) }

func TestBuildTemplate(t *testing.T) {
	data := TemplateSheet{
		Name:       "Data Karyawan",
		Columns: []TemplateColumn{
			{Header: "NIP", Kind: KindText, Width: 14},
			{Header: "Nama Lengkap", Required: true, Kind: KindText, Width: 28},
			{Header: "Tanggal Masuk", Required: true, Kind: KindDate, Width: 14},
			{Header: "Tipe Jadwal", Required: true, Kind: KindList, Options: []string{"Shift", "Non-Shift"}},
			{Header: "Status Aktif", ReadOnly: true, Kind: KindText},
		},
		Rows:       [][]any{{"0202505272", "Feti", time.Date(2025, 6, 1, 0, 0, 0, 0, time.UTC), "Shift", "Aktif"}},
		FreezeCols: 2,
		DataRows:   50,
	}
	notes := []SheetSpec{{Name: "Petunjuk", Rows: [][]any{{"Cara mengisi"}}}}
	out, err := BuildTemplate([]TemplateSheet{data}, notes, &InfoSheet{Name: "Info", Pairs: [][2]string{{"Cabang ID", "abc"}}})
	if err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(bytesReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if got := f.GetSheetList(); len(got) < 3 || got[0] != "Petunjuk" || got[1] != "Data Karyawan" {
		t.Fatalf("sheets = %v", got)
	}
	if v, _ := f.GetCellValue("Data Karyawan", "B1"); v != "Nama Lengkap *" {
		t.Fatalf("B1 = %q", v)
	}
	if v, _ := f.GetCellValue("Data Karyawan", "A2"); v != "0202505272" {
		t.Fatalf("leading zero lost: %q", v)
	}
	if typ, _ := f.GetCellType("Data Karyawan", "A2"); typ != excelize.CellTypeSharedString && typ != excelize.CellTypeInlineString {
		t.Fatalf("NIP cell type = %v, want text", typ)
	}
	if v, _ := f.GetCellValue("Data Karyawan", "C2"); v != "01/06/2025" {
		t.Fatalf("date shown %q, want 01/06/2025", v)
	}
	dvs, _ := f.GetDataValidations("Data Karyawan")
	if len(dvs) == 0 {
		t.Fatal("no dropdown on Tipe Jadwal")
	}
	if visible, _ := f.GetSheetVisible("Info"); visible {
		t.Fatal("Info sheet must be hidden")
	}
	panes, _ := f.GetPanes("Data Karyawan")
	if !panes.Freeze || panes.XSplit != 2 || panes.YSplit != 1 {
		t.Fatalf("panes = %+v", panes)
	}
}

func TestBuildTemplateProtectsOnlyFixedColumns(t *testing.T) {
	s := TemplateSheet{
		Name:       "Jadwal",
		TitleLines: []string{"Jadwal Kerja — PPJA"},
		Columns: []TemplateColumn{
			{Header: "NIP", ReadOnly: true}, {Header: "Sen 03/11", Kind: KindList, Options: []string{"DEF", "L"}},
			{Header: "Hari Masuk", Kind: KindFormula, Formula: func(r int) string { return "COUNTIF(B" + itoa(r) + ",\"<>L\")" }},
		},
		Rows:    [][]any{{"202505272", "DEF", nil}},
		Protect: true,
	}
	out, err := BuildTemplate([]TemplateSheet{s}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	f, _ := excelize.OpenReader(bytesReader(out))
	if HeaderRow(s) != 1 {
		t.Fatalf("header row = %d", HeaderRow(s))
	}
	if v, _ := f.GetCellValue("Jadwal", "A2"); v != "NIP" {
		t.Fatalf("A2 = %q", v)
	}
	if fx, _ := f.GetCellFormula("Jadwal", "C3"); fx == "" {
		t.Fatal("formula missing")
	}
	lockedB := cellLocked(t, f, "Jadwal", "B3")
	lockedA := cellLocked(t, f, "Jadwal", "A3")
	if lockedB || !lockedA {
		t.Fatalf("locks: A3=%v B3=%v, want A locked, B editable", lockedA, lockedB)
	}
}

func cellLocked(t *testing.T, f *excelize.File, sheet, ref string) bool {
	t.Helper()
	id, _ := f.GetCellStyle(sheet, ref)
	st, err := f.GetStyle(id)
	if err != nil {
		t.Fatal(err)
	}
	return st.Protection == nil || st.Protection.Locked
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && go test ./internal/platform/xlsx -run TestBuildTemplate -count=1`
Expected: FAIL (`undefined: TemplateSheet`)

- [ ] **Step 3: Implementasi**

```go
// backend/internal/platform/xlsx/template.go
package xlsx

import (
	"fmt"
	"time"

	"github.com/xuri/excelize/v2"
)

// Template workbooks for import/export files people fill in by hand
// (Spec 2026-10-19 §3): human headers, required marks, dropdowns from a
// hidden "Pilihan" sheet, text-formatted long numbers, DD/MM/YYYY dates,
// frozen header, optional sheet protection without a password.

type ColumnKind int

const (
	KindText ColumnKind = iota
	KindDate
	KindList
	KindNumber
	KindFormula
)

const RequiredMark = " *"

type TemplateColumn struct {
	Header   string
	Required bool
	Width    float64
	Kind     ColumnKind
	Options  []string
	ReadOnly bool
	Fill     string
	Formula  func(row int) string
}

type TemplateSheet struct {
	Name       string
	TitleLines []string
	Columns    []TemplateColumn
	Rows       [][]any
	FreezeCols int
	DataRows   int
	Protect    bool
	CellFill   map[string]string
}

type InfoSheet struct {
	Name  string
	Pairs [][2]string
}

const optionsSheet = "Pilihan"

// HeaderRow is the 0-based row of the header (after the title lines).
func HeaderRow(s TemplateSheet) int { return len(s.TitleLines) }

// BuildTemplate writes notes sheets first, then the data sheets, then the
// hidden option and info sheets.
func BuildTemplate(sheets []TemplateSheet, notes []SheetSpec, info *InfoSheet) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()
	index := 0
	for _, n := range notes {
		if err := addSheet(f, index, n.Name); err != nil {
			return nil, err
		}
		index++
		for r, row := range n.Rows {
			for c, v := range row {
				if v == nil {
					v = ""
				}
				if err := f.SetCellValue(n.Name, cellName(c, r), v); err != nil {
					return nil, err
				}
			}
		}
		for c, w := range n.ColumnWidths {
			col, _ := excelize.ColumnNumberToName(c + 1)
			_ = f.SetColWidth(n.Name, col, col, w)
		}
	}
	optCol := 0 // next free column in the options sheet
	needOptions := false
	for _, s := range sheets {
		for _, c := range s.Columns {
			if c.Kind == KindList {
				needOptions = true
			}
		}
	}
	if needOptions {
		if err := addSheet(f, index, optionsSheet); err != nil {
			return nil, err
		}
		index++
	}
	styles, err := newTemplateStyles(f)
	if err != nil {
		return nil, err
	}
	for _, s := range sheets {
		if err := addSheet(f, index, s.Name); err != nil {
			return nil, err
		}
		index++
		if err := writeTemplateSheet(f, s, styles, &optCol); err != nil {
			return nil, err
		}
	}
	if needOptions {
		_ = f.SetSheetVisible(optionsSheet, false)
	}
	if info != nil {
		if _, err := f.NewSheet(info.Name); err != nil {
			return nil, err
		}
		for r, p := range info.Pairs {
			_ = f.SetCellStr(info.Name, cellName(0, r), p[0])
			_ = f.SetCellStr(info.Name, cellName(1, r), p[1])
		}
		_ = f.SetSheetVisible(info.Name, false)
	}
	// Open on the first data sheet when there are notes, else the first sheet.
	if idx, err := f.GetSheetIndex(sheets[0].Name); err == nil && len(notes) == 0 {
		f.SetActiveSheet(idx)
	}
	return writeBytes(f)
}

type templateStyles struct {
	title, header, required, readOnlyHeader int
	text, date, number                      map[string]int // by fill ("" = none), editable
	textLocked, dateLocked, numberLocked    map[string]int
}

func newTemplateStyles(f *excelize.File) (*templateStyles, error) {
	st := &templateStyles{text: map[string]int{}, date: map[string]int{}, number: map[string]int{},
		textLocked: map[string]int{}, dateLocked: map[string]int{}, numberLocked: map[string]int{}}
	var err error
	if st.title, err = f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 13}}); err != nil {
		return nil, err
	}
	head := func(fill string) (int, error) {
		return f.NewStyle(&excelize.Style{
			Font:      &excelize.Font{Bold: true, Color: "#111827"},
			Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{fill}},
			Alignment: &excelize.Alignment{WrapText: true, Vertical: "center"},
			Border:    []excelize.Border{{Type: "bottom", Color: "#9CA3AF", Style: 1}},
			Protection: &excelize.Protection{Locked: true},
		})
	}
	if st.header, err = head("#E5E7EB"); err != nil {
		return nil, err
	}
	if st.required, err = head("#FDE68A"); err != nil {
		return nil, err
	}
	if st.readOnlyHeader, err = head("#F3F4F6"); err != nil {
		return nil, err
	}
	return st, nil
}

// cellStyle returns (and caches) the style for a data cell of kind with an
// optional fill; locked cells stay locked when the sheet is protected.
func (st *templateStyles) cellStyle(f *excelize.File, kind ColumnKind, fill string, locked bool) (int, error) {
	cache := map[ColumnKind]map[string]int{KindText: st.text, KindList: st.text, KindDate: st.date, KindNumber: st.number, KindFormula: st.number}
	if locked {
		cache = map[ColumnKind]map[string]int{KindText: st.textLocked, KindList: st.textLocked, KindDate: st.dateLocked, KindNumber: st.numberLocked, KindFormula: st.numberLocked}
	}
	m := cache[kind]
	if id, ok := m[fill]; ok {
		return id, nil
	}
	s := &excelize.Style{Protection: &excelize.Protection{Locked: locked}}
	switch kind {
	case KindDate:
		code := "dd/mm/yyyy"
		s.CustomNumFmt = &code
	case KindText, KindList:
		s.NumFmt = 49 // "@" text: keeps leading zeros and 16-digit NIK
	}
	if fill != "" {
		s.Fill = excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{fill}}
	}
	id, err := f.NewStyle(s)
	if err == nil {
		m[fill] = id
	}
	return id, err
}

func writeTemplateSheet(f *excelize.File, s TemplateSheet, st *templateStyles, optCol *int) error {
	name := s.Name
	for i, line := range s.TitleLines {
		if err := f.SetCellStr(name, cellName(0, i), line); err != nil {
			return err
		}
		_ = f.SetCellStyle(name, cellName(0, i), cellName(0, i), st.title)
	}
	h := HeaderRow(s)
	last := h + max(len(s.Rows), s.DataRows) // last 0-based data row
	for c, col := range s.Columns {
		header := col.Header
		style := st.header
		switch {
		case col.Required:
			header += RequiredMark
			style = st.required
		case col.ReadOnly:
			style = st.readOnlyHeader
		}
		ref := cellName(c, h)
		if err := f.SetCellStr(name, ref, header); err != nil {
			return err
		}
		_ = f.SetCellStyle(name, ref, ref, style)
		if col.ReadOnly {
			_ = f.AddComment(name, excelize.Comment{Cell: ref, Author: "HRIS",
				Paragraph: []excelize.RichTextRun{{Text: "Hanya informasi, tidak dibaca saat import."}}})
		}
		width := col.Width
		if width == 0 {
			width = float64(max(12, len([]rune(header))+2))
		}
		colName, _ := excelize.ColumnNumberToName(c + 1)
		_ = f.SetColWidth(name, colName, colName, width)

		locked := s.Protect && (col.ReadOnly || col.Kind == KindFormula)
		styleID, err := st.cellStyle(f, col.Kind, col.Fill, locked)
		if err != nil {
			return err
		}
		if last > h {
			_ = f.SetCellStyle(name, cellName(c, h+1), cellName(c, last), styleID)
		}
		if col.Kind == KindList && len(col.Options) > 0 && last > h {
			if err := addDropdown(f, name, c, h+1, last, col.Options, optCol); err != nil {
				return err
			}
		}
	}
	for r, row := range s.Rows {
		excelRow := h + 1 + r
		for c, v := range row {
			if c >= len(s.Columns) {
				break
			}
			col := s.Columns[c]
			ref := cellName(c, excelRow)
			var err error
			switch {
			case col.Kind == KindFormula && col.Formula != nil:
				err = f.SetCellFormula(name, ref, col.Formula(excelRow+1))
			case v == nil:
				continue
			case col.Kind == KindDate:
				if t, ok := v.(time.Time); ok {
					err = f.SetCellValue(name, ref, t)
				} else {
					err = f.SetCellStr(name, ref, fmt.Sprint(v))
				}
			case col.Kind == KindNumber:
				err = f.SetCellValue(name, ref, v)
			default:
				err = f.SetCellStr(name, ref, fmt.Sprint(v))
			}
			if err != nil {
				return err
			}
		}
	}
	// Formula columns on template rows without data.
	for c, col := range s.Columns {
		if col.Kind != KindFormula || col.Formula == nil {
			continue
		}
		for r := h + 1 + len(s.Rows); r <= last; r++ {
			_ = f.SetCellFormula(name, cellName(c, r), col.Formula(r+1))
		}
	}
	for value, color := range s.CellFill {
		fmtID, err := f.NewConditionalStyle(&excelize.Style{Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{color}}})
		if err != nil {
			return err
		}
		rangeRef := cellName(0, h+1) + ":" + cellName(len(s.Columns)-1, max(last, h+1))
		_ = f.SetConditionalFormat(name, rangeRef, []excelize.ConditionalFormatOptions{{
			Type: "cell", Criteria: "==", Format: &fmtID, Value: `"` + value + `"`}})
	}
	_ = f.SetPanes(name, &excelize.Panes{Freeze: true, XSplit: s.FreezeCols, YSplit: h + 1,
		TopLeftCell: cellName(s.FreezeCols, h+1), ActivePane: "bottomRight"})
	if s.Protect {
		return f.ProtectSheet(name, &excelize.SheetProtectionOptions{
			SelectLockedCells: true, SelectUnlockedCells: true, FormatColumns: true, AutoFilter: true})
	}
	return nil
}

// addDropdown writes the options into a column of the hidden options sheet
// and points a list validation at it (no 255-character limit).
func addDropdown(f *excelize.File, sheet string, col, fromRow, toRow int, options []string, optCol *int) error {
	letter, _ := excelize.ColumnNumberToName(*optCol + 1)
	for i, o := range options {
		if err := f.SetCellStr(optionsSheet, cellName(*optCol, i), o); err != nil {
			return err
		}
	}
	*optCol++
	dv := excelize.NewDataValidation(true)
	dv.Sqref = cellName(col, fromRow) + ":" + cellName(col, toRow)
	dv.SetSqrefDropList(fmt.Sprintf("'%s'!$%s$1:$%s$%d", optionsSheet, letter, letter, len(options)))
	dv.SetError(excelize.DataValidationErrorStyleStop, "Pilihan tidak tersedia", "Pilih salah satu nilai dari daftar.")
	return f.AddDataValidation(sheet, dv)
}
```

> Catatan untuk implementer: bila signature excelize v2.11 berbeda (mis. `SetError` atau `ProtectSheet`), cek `go doc github.com/xuri/excelize/v2 DataValidation` dan sesuaikan; perilaku yang dituntut test tetap sama.

- [ ] **Step 4: Jalankan test**

Run: `cd backend && go test ./internal/platform/xlsx -count=1`
Expected: PASS (termasuk test lama `xlsx_test.go`)

- [ ] **Step 5: Commit**

```bash
git add backend/internal/platform/xlsx/template.go backend/internal/platform/xlsx/template_test.go
git commit -m "feat(xlsx): builder template import (dropdown, teks, tanggal, kunci sheet)"
```

---

### Task 3: Label & parser nilai Excel (`hris/domain/excel_values.go`)

**Files:**
- Create: `backend/internal/modules/hris/domain/excel_values.go`
- Test: `backend/internal/modules/hris/domain/excel_values_test.go`

**Interfaces:**
- Produces:
```go
var GenderLabels = []Choice{{"male", "Laki-laki"}, {"female", "Perempuan"}}
var MaritalLabels = []Choice{{"single", "Belum Menikah"}, {"married", "Menikah"}, {"divorced", "Cerai Hidup"}, {"widowed", "Cerai Mati"}}
var ScheduleTypeLabels = []Choice{{"shift", "Shift"}, {"non_shift", "Non-Shift"}}
type Choice struct{ Value, Label string }
func LabelOf(choices []Choice, value string) string             // "" bila tidak dikenal
func ValueOf(choices []Choice, label string) (string, bool)      // case-insensitive, spasi dirapikan
func Labels(choices []Choice) []string
func ParseDateCell(s string) (iso string, ok bool)              // "2026-10-21" atau ok=false
func FormatDateID(iso string) string                            // "21/10/2026"; "" bila kosong
func CleanDigits(s string) string                               // buang spasi . - / dan apostrof
func CleanNIP(s string) (string, string)                        // (nip, pesan error "" bila ok)
func NormalizePhone(s string) (string, string)                  // "08…", pesan error
func NormalizeHeader(s string) string                           // "Nama Lengkap *" -> "nama lengkap"
```

- [ ] **Step 1: Tulis test yang gagal**

```go
// backend/internal/modules/hris/domain/excel_values_test.go
package domain

import "testing"

func TestParseDateCell(t *testing.T) {
	cases := map[string]string{
		"2026-10-21":               "2026-10-21",
		"2026-10-21T00:00:00.000Z": "2026-10-21",
		"21/10/2026":               "2026-10-21",
		"21-10-2026":               "2026-10-21",
		" 1/6/2025 ":               "2025-06-01",
	}
	for in, want := range cases {
		got, ok := ParseDateCell(in)
		if !ok || got != want {
			t.Errorf("ParseDateCell(%q) = %q,%v want %q", in, got, ok, want)
		}
	}
	for _, bad := range []string{"31/02/2026", "2026/13/01", "kemarin", "45123"} {
		if _, ok := ParseDateCell(bad); ok {
			t.Errorf("ParseDateCell(%q) accepted", bad)
		}
	}
	if FormatDateID("2026-10-21") != "21/10/2026" || FormatDateID("") != "" {
		t.Fatal("FormatDateID")
	}
}

func TestCleanNIP(t *testing.T) {
	if nip, msg := CleanNIP(" 202505272 "); nip != "202505272" || msg != "" {
		t.Fatalf("got %q %q", nip, msg)
	}
	if nip, _ := CleanNIP("EMP-2026-00004"); nip != "EMP-2026-00004" {
		t.Fatalf("got %q", nip)
	}
	if _, msg := CleanNIP("2.02505E+08"); msg == "" {
		t.Fatal("scientific notation must be rejected")
	}
}

func TestNormalizePhoneAndDigits(t *testing.T) {
	for in, want := range map[string]string{"0812-3456-7890": "081234567890", "+62 812 3456 7890": "081234567890", "6281234567890": "081234567890"} {
		if got, msg := NormalizePhone(in); got != want || msg != "" {
			t.Errorf("NormalizePhone(%q) = %q %q", in, got, msg)
		}
	}
	if _, msg := NormalizePhone("12345"); msg == "" {
		t.Fatal("bad phone accepted")
	}
	if CleanDigits("3273.0123 4567-8901") != "3273012345678901" {
		t.Fatal("CleanDigits")
	}
}

func TestChoices(t *testing.T) {
	if v, ok := ValueOf(MaritalLabels, "  belum   menikah "); !ok || v != "single" {
		t.Fatalf("got %q %v", v, ok)
	}
	if LabelOf(ScheduleTypeLabels, "non_shift") != "Non-Shift" {
		t.Fatal("LabelOf")
	}
	if NormalizeHeader("Nama  Lengkap *") != "nama lengkap" {
		t.Fatal("NormalizeHeader")
	}
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && go test ./internal/modules/hris/domain -run 'TestParseDateCell|TestCleanNIP|TestNormalizePhone|TestChoices' -count=1`
Expected: FAIL (`undefined: ParseDateCell`)

- [ ] **Step 3: Implementasi**

```go
// backend/internal/modules/hris/domain/excel_values.go
package domain

import (
	"regexp"
	"strings"
	"time"
)

// Values of the HR-facing Excel files (Spec 2026-10-19 §3): labels people
// read and type, never database values.

type Choice struct{ Value, Label string }

var (
	GenderLabels       = []Choice{{"male", "Laki-laki"}, {"female", "Perempuan"}}
	MaritalLabels      = []Choice{{"single", "Belum Menikah"}, {"married", "Menikah"}, {"divorced", "Cerai Hidup"}, {"widowed", "Cerai Mati"}}
	ScheduleTypeLabels = []Choice{{"shift", "Shift"}, {"non_shift", "Non-Shift"}}
)

var spaces = regexp.MustCompile(`\s+`)

func squash(s string) string { return strings.ToLower(strings.TrimSpace(spaces.ReplaceAllString(s, " "))) }

func LabelOf(choices []Choice, value string) string {
	for _, c := range choices {
		if c.Value == value {
			return c.Label
		}
	}
	return ""
}

func ValueOf(choices []Choice, label string) (string, bool) {
	want := squash(label)
	for _, c := range choices {
		if squash(c.Label) == want {
			return c.Value, true
		}
	}
	return "", false
}

func Labels(choices []Choice) []string {
	out := make([]string, len(choices))
	for i, c := range choices {
		out[i] = c.Label
	}
	return out
}

var dmy = regexp.MustCompile(`^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$`)

// ParseDateCell accepts an ISO date, an ExcelJS-style ISO timestamp (date
// cells as read by platform/xlsx), DD/MM/YYYY and DD-MM-YYYY.
func ParseDateCell(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if len(s) >= 10 && s[4] == '-' && s[7] == '-' {
		if t, err := time.Parse(DateLayout, s[:10]); err == nil {
			return t.Format(DateLayout), true
		}
		return "", false
	}
	m := dmy.FindStringSubmatch(s)
	if m == nil {
		return "", false
	}
	t, err := time.Parse("2/1/2006", m[1]+"/"+m[2]+"/"+m[3])
	if err != nil {
		return "", false
	}
	return t.Format(DateLayout), true
}

func FormatDateID(iso string) string {
	t, err := time.Parse(DateLayout, iso)
	if err != nil {
		return ""
	}
	return t.Format("02/01/2006")
}

var digitNoise = strings.NewReplacer(" ", "", ".", "", "-", "", "/", "", "'", "")

func CleanDigits(s string) string { return digitNoise.Replace(strings.TrimSpace(s)) }

var scientific = regexp.MustCompile(`(?i)^\d+(\.\d+)?e\+?\d+$`)

// CleanNIP trims a NIP; a NIP Excel turned into scientific notation is an
// error the person can fix (format the column as text and retype it).
func CleanNIP(s string) (string, string) {
	s = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "'"))
	if scientific.MatchString(s) {
		return "", "NIP berubah jadi format angka Excel (mis. 2,02E+08). Ubah kolom NIP ke format Teks lalu ketik ulang."
	}
	return s, ""
}

// NormalizePhone returns 08… from 08…, 62… or +62….
func NormalizePhone(s string) (string, string) {
	d := CleanDigits(strings.TrimPrefix(strings.TrimSpace(s), "+"))
	if strings.HasPrefix(d, "62") {
		d = "0" + d[2:]
	}
	if !strings.HasPrefix(d, "08") || len(d) < 10 || len(d) > 14 || strings.Trim(d, "0123456789") != "" {
		return "", "No. HP harus diawali 08 / 62 / +62 dan berisi 10–14 angka"
	}
	return d, ""
}

func NormalizeHeader(s string) string {
	return squash(strings.TrimSuffix(strings.TrimSpace(s), "*"))
}
```

- [ ] **Step 4: Jalankan test**

Run: `cd backend && go test ./internal/modules/hris/domain -count=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/modules/hris/domain/excel_values.go backend/internal/modules/hris/domain/excel_values_test.go
git commit -m "feat(hris): label & parser nilai file Excel HR"
```

---

### Task 4: Kode shift di master Shift Kerja

**Files:**
- Modify: `backend/internal/modules/hris/overtime.go:217-292` (shiftColumns, CreateShift, UpdateShift, DeleteShift, shiftInput)
- Modify: `backend/internal/modules/hris/http_schedules.go:33-120` (createShift/updateShift parsing)
- Modify: `frontend/src/lib/hris/shifts-view.ts`, `frontend/src/features/hris/shifts/components/shift-form-dialog.tsx`, `frontend/src/features/hris/shifts/components/shifts-page.tsx`, `frontend/src/features/hris/shifts/types.ts`
- Test: `backend/internal/modules/hris/shift_codes_integration_test.go`, `frontend/src/lib/hris/shifts-view.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/hris/shifts` rows sekarang berisi `code` dan `is_default`;
  - `POST`/`PATCH` menerima `code`;
  - `shiftInput.Code *string`.
- Frontend: `ShiftPayload.code: string` dan `ShiftRow.code`/`is_default`.

- [ ] **Step 1: Test integrasi yang gagal**

```go
// backend/internal/modules/hris/shift_codes_integration_test.go
package hris

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/iam"
)

func TestShiftCodes(t *testing.T) {
	h := newHarness(t)
	hr, _ := h.staff("hrd", iam.HrisKepegawaian, false)
	c := h.do(&hr, http.MethodPost, "/api/hris/shifts", map[string]any{
		"name": "SPG Pagi", "code": " spg1x ", "start_time": "08:00", "end_time": "16:00"})
	expect(t, c, http.StatusCreated, "")
	if c.data()["code"] != "SPG1X" {
		t.Fatalf("code = %v", c.data()["code"])
	}
	dup := h.do(&hr, http.MethodPost, "/api/hris/shifts", map[string]any{
		"name": "Lain", "code": "spg1x", "start_time": "09:00", "end_time": "17:00"})
	expect(t, dup, http.StatusConflict, "Kode shift SPG1X sudah dipakai")
	bad := h.do(&hr, http.MethodPost, "/api/hris/shifts", map[string]any{
		"name": "Lain", "code": "SPG 1", "start_time": "09:00", "end_time": "17:00"})
	expect(t, bad, http.StatusBadRequest, "Kode shift 1–12 huruf/angka tanpa spasi")
	def := h.scalar(`SELECT id::text FROM hris.shifts WHERE code = 'DEF'`)
	del := h.do(&hr, http.MethodDelete, "/api/hris/shifts/"+def, nil)
	expect(t, del, http.StatusBadRequest, "Shift bawaan DEF/NS tidak bisa dihapus atau dinonaktifkan")
	off := h.do(&hr, http.MethodPatch, "/api/hris/shifts/"+def, map[string]any{"is_active": false})
	expect(t, off, http.StatusBadRequest, "Shift bawaan DEF/NS tidak bisa dihapus atau dinonaktifkan")
	// Shift dipakai jadwal per tanggal ke depan tidak bisa dinonaktifkan.
	id := c.data()["id"].(string)
	e := h.employee(emp{})
	h.exec(`INSERT INTO hris.employee_shift_days (employee_id, work_date, shift_id, batch_id) VALUES ($1, '2026-12-01', $2, gen_random_uuid())`, e, id)
	used := h.do(&hr, http.MethodPatch, "/api/hris/shifts/"+id, map[string]any{"is_active": false})
	expect(t, used, http.StatusBadRequest, "Shift masih dipakai 1 jadwal mulai hari ini — ganti dulu jadwalnya")
}
```


- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run TestShiftCodes -count=1`
Expected: FAIL (code kosong / 201 untuk duplikat)

- [ ] **Step 3: Implementasi backend**

Di `overtime.go`:

```go
const shiftColumns = `id, code, name, start_time, end_time, break_minutes,
  late_tolerance_minutes, is_overnight, is_active, is_default, sort_order`

type shiftInput struct {
	Code, Name, StartTime, EndTime         *string
	BreakMinutes, LateTolerance, SortOrder *int
	IsOvernight, IsActive                  *bool
}

const (
	shiftCodeInvalid  = "Kode shift 1–12 huruf/angka tanpa spasi"
	shiftBuiltinFixed = "Shift bawaan DEF/NS tidak bisa dihapus atau dinonaktifkan"
)

var shiftCodeRe = regexp.MustCompile(`^[A-Z0-9]{1,12}$`)

// normalizeShiftCode upper-cases and trims; "" when absent.
func normalizeShiftCode(p *string) (*string, error) {
	if p == nil {
		return nil, nil
	}
	c := strings.ToUpper(strings.TrimSpace(*p))
	if !shiftCodeRe.MatchString(c) {
		return nil, httpx.BadRequest(shiftCodeInvalid)
	}
	return &c, nil
}

func shiftCodeConflict(err error, code string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "shifts_code_key" {
		return httpx.Conflict("Kode shift " + code + " sudah dipakai")
	}
	return err
}
```

`CreateShift` (store) menyisipkan `code`. Kode wajib saat create: handler menolak dengan `shiftCodeInvalid` bila kosong.

```go
func (s *store) CreateShift(ctx context.Context, in shiftInput) (*Row, error) {
	row, err := queryRow(ctx, s.db, `INSERT INTO hris.shifts
		(code, name, start_time, end_time, break_minutes, late_tolerance_minutes, is_overnight, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING `+shiftColumns,
		strOr(in.Code), strOr(in.Name), strOr(in.StartTime), strOr(in.EndTime), intOr(in.BreakMinutes, 60),
		intOr(in.LateTolerance, 10), in.IsOvernight != nil && *in.IsOvernight, intOr(in.SortOrder, 0))
	return row, shiftCodeConflict(err, strOr(in.Code))
}
```

`UpdateShift` menambah `code = COALESCE($10, code)` dan membungkus error dengan `shiftCodeConflict`. Sebelum UPDATE, service `UpdateShift` menjalankan:

```go
// guardShiftDeactivate blocks turning off DEF/NS or a shift still on a
// schedule from today on (per-date or a running weekly pattern).
func guardShiftDeactivate(ctx context.Context, q database.Querier, id, today string) error {
	var code string
	var used int
	if err := q.QueryRow(ctx, `SELECT s.code,
		(SELECT count(*) FROM hris.employee_shift_days d WHERE d.shift_id = s.id AND d.work_date >= $2::date)
		+ (SELECT count(DISTINCT es.employee_id) FROM hris.employee_shifts es
		   WHERE es.shift_id = s.id AND (es.effective_to IS NULL OR es.effective_to >= $2::date))
		FROM hris.shifts s WHERE s.id = $1`, id, today).Scan(&code, &used); err != nil {
		if database.IsNoRows(err) {
			return httpx.NotFound("Shift tidak ditemukan")
		}
		return err
	}
	if code == "DEF" || code == "NS" {
		return httpx.BadRequest(shiftBuiltinFixed)
	}
	if used > 0 {
		return httpx.BadRequest(fmt.Sprintf("Shift masih dipakai %d jadwal mulai hari ini — ganti dulu jadwalnya", used))
	}
	return nil
}
```

Aturan pemanggilan:
- Service `UpdateShift` (`overtime.go:300`) memanggil `guardShiftDeactivate(ctx, s.repo.querier(), id, domain.TodayWIB(s.clock()))` sebelum `s.repo.UpdateShift`, hanya bila `in.IsActive != nil && !*in.IsActive`.
- Service `DeleteShift` (`overtime.go:308`) memanggil guard yang sama sebelum query yang ada. Shift lain yang dipakai di masa lalu tetap dinonaktifkan seperti sekarang.

Di `http_schedules.go` `createShift`/`updateShift`:

```go
in.Code, err = normalizeShiftCode(f.Str("code", optional, validate.StrOpts{}))
if err != nil {
	return err
}
// createShift only:
if in.Code == nil {
	return httpx.BadRequest(shiftCodeInvalid)
}
```

Import tambahan bila belum ada: `errors`, `regexp`, `strings`, `github.com/jackc/pgx/v5/pgconn`.

- [ ] **Step 4: Jalankan test backend**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run 'TestShiftCodes|TestShift' -count=1`
Expected: PASS

- [ ] **Step 5: Test frontend yang gagal**

```ts
// frontend/src/lib/hris/shifts-view.test.ts (tambahkan)
import { describe, expect, it } from "vitest";
import { EMPTY_SHIFT_FORM, shiftPayload, shiftCodeError } from "./shifts-view";

describe("kode shift", () => {
  it("dikirim huruf besar tanpa spasi", () => {
    expect(shiftPayload({ ...EMPTY_SHIFT_FORM, name: "SPG", code: " spg1 " }).code).toBe("SPG1");
  });
  it("menolak spasi dan karakter lain", () => {
    expect(shiftCodeError("SPG 1")).toBe("Kode 1–12 huruf/angka tanpa spasi");
    expect(shiftCodeError("SPG1")).toBeNull();
  });
});
```

- [ ] **Step 6: Implementasi frontend**

Di `shifts-view.ts`:
- tambah `code: string` ke `ShiftForm` dan `ShiftPayload`;
- `EMPTY_SHIFT_FORM.code = ""`;
- `shiftFormFrom` membaca `shift.code`;
- `shiftPayload` mengirim `code: form.code.trim().toUpperCase()`;
- tambahkan:

```ts
export function shiftCodeError(code: string): string | null {
  return /^[A-Z0-9]{1,12}$/.test(code.trim().toUpperCase()) ? null : "Kode 1–12 huruf/angka tanpa spasi";
}
```

Di `shift-form-dialog.tsx`, tambah input **Kode** (wajib) di atas Nama, dengan placeholder `SPG1` dan pesan dari `shiftCodeError` di bawah input. Tombol Simpan nonaktif selama ada error.

Di `shifts-page.tsx`:
- tampilkan kode sebagai `Badge` di kartu shift;
- shift dengan `is_default` diberi label "Bawaan";
- tombol hapus/nonaktif disembunyikan untuk kode `DEF`/`NS`.

Di `types.ts`, tambah `code: string; is_default: boolean;` ke `ShiftRow`.

- [ ] **Step 7: Jalankan test frontend**

Run: `cd frontend && npx vitest run src/lib/hris/shifts-view.test.ts src/features/hris/shifts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/internal/modules/hris/overtime.go backend/internal/modules/hris/http_schedules.go backend/internal/modules/hris/shift_codes_integration_test.go frontend/src/lib/hris/shifts-view.ts frontend/src/lib/hris/shifts-view.test.ts frontend/src/features/hris/shifts
git commit -m "feat(hris): kode shift wajib & unik, shift bawaan DEF/NS terkunci"
```


---

### Task 5: Backend tipe jadwal & jadwal tetap Non-Shift

**Files:**
- Create: `backend/internal/modules/hris/schedule_type.go`
- Create: `backend/internal/modules/hris/employee_audit.go` (penulis audit; pembaca ditambah di Task 14)
- Modify: `backend/internal/modules/hris/routes.go` (sub-route `schedule-type`, route bulk & fixed)
- Test: `backend/internal/modules/hris/schedule_type_integration_test.go`

**Interfaces:**
- Consumes: shift `NS` (Task 1), `SaveShiftPattern` di store (`postgres_employees.go:226`), `s.ensureAttendanceOpen` (`attendance_periods.go:255`).
- Produces:
```go
// employee_audit.go
func writeEmployeeAudit(ctx context.Context, q database.Querier, actor *auth.User, action, employeeID, label string, before, after any) error
// schedule_type.go
func fixedPatternDays(nsShiftID string) []patternDay     // Sen–Jum = NS, Sab–Min = libur
func applyFixedSchedule(ctx context.Context, r Repository, employeeID, from, actorName string) (clearedDays int, err error)
type scheduleTypeResult struct {
    Changed     int      `json:"changed"`
    ClearedDays int      `json:"cleared_days"`
    Warnings    []string `json:"warnings"`
}
func (s *Service) ChangeScheduleType(ctx context.Context, actor *auth.User, ids []string, to, from string, dryRun bool) (*scheduleTypeResult, error)
func (s *Service) ApplyFixedSchedule(ctx context.Context, actor *auth.User, branchID string, ids []string, from string) (*scheduleTypeResult, error)
```
- HTTP:
  - `GET /api/hris/employees/{id}/schedule-type` → `{data:{schedule_type, future_days}}`
  - `PUT /api/hris/employees/{id}/schedule-type` body `{schedule_type, effective_from}` → `{data: scheduleTypeResult, message}`
  - `POST /api/hris/employees/schedule-type/bulk` body `{employee_ids, schedule_type, effective_from, dry_run}` → sama
  - `POST /api/hris/schedules/fixed` body `{branch_id?, employee_ids?, effective_from}` → sama
  - Semua dijaga `h.withMenu(iam.HrisKepegawaian, …)`.
- Aksi audit: `employee.schedule_type`, `schedule.fixed_apply`.

- [ ] **Step 1: Test integrasi yang gagal**

```go
// backend/internal/modules/hris/schedule_type_integration_test.go
package hris

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/iam"
)

func TestScheduleTypeToNonShiftClearsFutureDays(t *testing.T) {
	h := newHarness(t)
	hr, _ := h.staff("hrd", iam.HrisKepegawaian, false)
	e := h.employee(emp{})
	def := h.scalar(`SELECT id::text FROM hris.shifts WHERE code = 'DEF'`)
	// fixedNow = Senin 2026-10-05; satu jadwal per tanggal lampau, dua ke depan.
	h.exec(`INSERT INTO hris.employee_shift_days (employee_id, work_date, shift_id, batch_id) VALUES
		($1, '2026-10-01', $2, gen_random_uuid()), ($1, '2026-10-07', $2, gen_random_uuid()), ($1, '2026-10-08', $2, gen_random_uuid())`, e, def)

	dry := h.do(&hr, http.MethodPost, "/api/hris/employees/schedule-type/bulk", map[string]any{
		"employee_ids": []string{e}, "schedule_type": "non_shift", "effective_from": "2026-10-06", "dry_run": true})
	expect(t, dry, http.StatusOK, "")
	if dry.data()["cleared_days"] != float64(2) {
		t.Fatalf("dry run cleared_days = %v", dry.data()["cleared_days"])
	}
	if h.scalar(`SELECT schedule_type FROM hris.employees WHERE id = $1`, e) != "shift" {
		t.Fatal("dry run must not change anything")
	}

	c := h.do(&hr, http.MethodPut, "/api/hris/employees/"+e+"/schedule-type", map[string]any{
		"schedule_type": "non_shift", "effective_from": "2026-10-06"})
	expect(t, c, http.StatusOK, "")
	if h.scalar(`SELECT schedule_type FROM hris.employees WHERE id = $1`, e) != "non_shift" {
		t.Fatal("type not changed")
	}
	if h.scalar(`SELECT count(*)::text FROM hris.employee_shift_days WHERE employee_id = $1`, e) != "1" {
		t.Fatal("future per-date rows must be deleted, past kept")
	}
	got := h.scalar(`SELECT string_agg(es.day_of_week || ':' || coalesce(s.code, 'L'), ',' ORDER BY es.day_of_week)
		FROM hris.employee_shifts es LEFT JOIN hris.shifts s ON s.id = es.shift_id
		WHERE es.employee_id = $1 AND es.effective_from = '2026-10-06'`, e)
	if got != "1:NS,2:NS,3:NS,4:NS,5:NS,6:L,7:L" {
		t.Fatalf("fixed pattern = %s", got)
	}
	if h.scalar(`SELECT count(*)::text FROM audit.audit_log WHERE entity = 'hris.employees' AND entity_id = $1 AND action = 'employee.schedule_type'`, e) != "1" {
		t.Fatal("audit missing")
	}

	back := h.do(&hr, http.MethodPut, "/api/hris/employees/"+e+"/schedule-type", map[string]any{
		"schedule_type": "shift", "effective_from": "2026-10-12"})
	expect(t, back, http.StatusOK, "")
	warnings, _ := back.data()["warnings"].([]any)
	if len(warnings) != 1 || warnings[0] != "Karyawan belum punya jadwal shift mulai 12/10/2026; tugaskan di Jadwal Kerja" {
		t.Fatalf("warnings = %v", warnings)
	}
	if h.scalar(`SELECT count(*)::text FROM hris.employee_shifts WHERE employee_id = $1 AND (effective_to IS NULL OR effective_to >= '2026-10-12')`, e) != "0" {
		t.Fatal("fixed pattern must stop on 2026-10-12")
	}
}

func TestApplyFixedScheduleRejectsShiftEmployees(t *testing.T) {
	h := newHarness(t)
	hr, _ := h.staff("hrd", iam.HrisKepegawaian, false)
	shiftEmp := h.employee(emp{name: "Kasir Satu"})
	c := h.do(&hr, http.MethodPost, "/api/hris/schedules/fixed", map[string]any{
		"employee_ids": []string{shiftEmp}, "effective_from": "2026-10-06"})
	expect(t, c, http.StatusBadRequest, "Kasir Satu bertipe Shift — jadwal tetap hanya untuk karyawan Non-Shift")
	past := h.do(&hr, http.MethodPost, "/api/hris/schedules/fixed", map[string]any{
		"employee_ids": []string{shiftEmp}, "effective_from": "2026-10-01"})
	expect(t, past, http.StatusBadRequest, "Tanggal mulai tidak boleh sebelum hari ini")
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run 'TestScheduleType|TestApplyFixed' -count=1`
Expected: FAIL (404 route)

- [ ] **Step 3: Penulis audit**

```go
// backend/internal/modules/hris/employee_audit.go
package hris

import (
	"context"

	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
)

// Employee audit trail (Spec §1.3): audit.audit_log rows with entity
// hris.employees, written on the caller's querier so they commit with the
// change. before/after hold only the changed fields.
const employeeEntity = "hris.employees"

func writeEmployeeAudit(ctx context.Context, q database.Querier, actor *auth.User, action, employeeID, label string, before, after any) error {
	e := audit.Entry{Action: action, Entity: employeeEntity, EntityID: &employeeID, Before: before, After: after}
	if label != "" {
		e.EntityLabel = &label
	}
	if actor != nil {
		e.ActorID = actor.ID
		name := actor.FullName
		e.ActorName = &name
	}
	return audit.Write(ctx, q, e)
}
```

- [ ] **Step 4: Service & handler tipe jadwal**

```go
// backend/internal/modules/hris/schedule_type.go
package hris

import (
	"context"
	"fmt"
	"net/http"

	"nuhabit/backend/internal/modules/hris/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Tipe jadwal karyawan (Spec §2.2–2.3): shift = ditugaskan di Jadwal Kerja,
// non_shift = jadwal tetap Sen–Jum NS 09.00–18.00, Sab–Min libur.

const (
	scheduleShift    = "shift"
	scheduleNonShift = "non_shift"
	msgFromPast      = "Tanggal mulai tidak boleh sebelum hari ini"
)

func fixedPatternDays(ns string) []patternDay {
	days := make([]patternDay, 7)
	for i := range days {
		days[i].DayOfWeek = i + 1
		if i < 5 {
			id := ns
			days[i].ShiftID = &id
		}
	}
	return days
}

func shiftIDByCode(ctx context.Context, q database.Querier, code string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM hris.shifts WHERE code = $1`, code).Scan(&id)
	return id, err
}

// applyFixedSchedule clears per-date schedules from `from` on and saves the
// fixed weekly pattern from `from`; it returns the cleared per-date rows.
func applyFixedSchedule(ctx context.Context, r Repository, employeeID, from, actorName string) (int, error) {
	q := r.querier()
	tag, err := q.Exec(ctx, `DELETE FROM hris.employee_shift_days WHERE employee_id = $1 AND work_date >= $2::date`, employeeID, from)
	if err != nil {
		return 0, err
	}
	ns, err := shiftIDByCode(ctx, q, "NS")
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), r.SaveShiftPattern(ctx, employeeID, from, fixedPatternDays(ns), actorName)
}

// stopWeeklyPattern ends running weekly rows the day before `from` and
// drops rows starting on/after it (Non-Shift → Shift).
func stopWeeklyPattern(ctx context.Context, q database.Querier, employeeID, from string) error {
	if _, err := q.Exec(ctx, `DELETE FROM hris.employee_shifts WHERE employee_id = $1 AND effective_from >= $2::date`, employeeID, from); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `UPDATE hris.employee_shifts SET effective_to = $2::date - 1
		WHERE employee_id = $1 AND (effective_to IS NULL OR effective_to >= $2::date)`, employeeID, from)
	return err
}

type scheduleTypeResult struct {
	Changed     int      `json:"changed"`
	ClearedDays int      `json:"cleared_days"`
	Warnings    []string `json:"warnings"`
}

type scheduleTarget struct {
	ID, Name, Type string
	Active         bool
}

func loadScheduleTargets(ctx context.Context, q database.Querier, ids []string) ([]scheduleTarget, error) {
	rows, err := q.Query(ctx, `SELECT id::text, full_name, schedule_type, is_active FROM hris.employees
		WHERE id = ANY($1::uuid[]) ORDER BY full_name`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []scheduleTarget
	for rows.Next() {
		var t scheduleTarget
		if err := rows.Scan(&t.ID, &t.Name, &t.Type, &t.Active); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) != len(ids) {
		return nil, httpx.BadRequest("Sebagian karyawan tidak ditemukan")
	}
	for _, t := range out {
		if !t.Active {
			return nil, httpx.BadRequest(t.Name + " sudah nonaktif/resign")
		}
	}
	return out, nil
}

func (s *Service) checkScheduleFrom(ctx context.Context, from string) error {
	if _, ok := domain.ParseDate(from); !ok {
		return httpx.BadRequest("Tanggal mulai wajib diisi (YYYY-MM-DD)")
	}
	if from < domain.TodayWIB(s.clock()) {
		return httpx.BadRequest(msgFromPast)
	}
	return s.ensureAttendanceOpen(ctx, from)
}

func (s *Service) ChangeScheduleType(ctx context.Context, actor *auth.User, ids []string, to, from string, dryRun bool) (*scheduleTypeResult, error) {
	if to != scheduleShift && to != scheduleNonShift {
		return nil, httpx.BadRequest("Tipe jadwal harus Shift atau Non-Shift")
	}
	if err := s.checkScheduleFrom(ctx, from); err != nil {
		return nil, err
	}
	res := &scheduleTypeResult{Warnings: []string{}}
	err := s.repo.InTx(ctx, func(r Repository) error {
		q := r.querier()
		targets, err := loadScheduleTargets(ctx, q, ids)
		if err != nil {
			return err
		}
		for _, t := range targets {
			if t.Type == to {
				continue
			}
			res.Changed++
			if dryRun {
				var n int
				if to == scheduleNonShift {
					if err := q.QueryRow(ctx, `SELECT count(*) FROM hris.employee_shift_days WHERE employee_id = $1 AND work_date >= $2::date`, t.ID, from).Scan(&n); err != nil {
						return err
					}
				}
				res.ClearedDays += n
				continue
			}
			if to == scheduleNonShift {
				n, err := applyFixedSchedule(ctx, r, t.ID, from, actor.FullName)
				if err != nil {
					return err
				}
				res.ClearedDays += n
			} else {
				if err := stopWeeklyPattern(ctx, q, t.ID, from); err != nil {
					return err
				}
				res.Warnings = append(res.Warnings, fmt.Sprintf("%sKaryawan belum punya jadwal shift mulai %s; tugaskan di Jadwal Kerja",
					namePrefix(len(targets), t.Name), domain.FormatDateID(from)))
			}
			if _, err := q.Exec(ctx, `UPDATE hris.employees SET schedule_type = $2, updated_at = now() WHERE id = $1`, t.ID, to); err != nil {
				return err
			}
			if err := writeEmployeeAudit(ctx, q, actor, "employee.schedule_type", t.ID, t.Name,
				map[string]any{"schedule_type": t.Type}, map[string]any{"schedule_type": to, "effective_from": from}); err != nil {
				return err
			}
		}
		return nil
	})
	return res, err
}

// namePrefix names the employee in a warning only for bulk changes.
func namePrefix(n int, name string) string {
	if n > 1 {
		return name + ": "
	}
	return ""
}

func (s *Service) ApplyFixedSchedule(ctx context.Context, actor *auth.User, branchID string, ids []string, from string) (*scheduleTypeResult, error) {
	if err := s.checkScheduleFrom(ctx, from); err != nil {
		return nil, err
	}
	res := &scheduleTypeResult{Warnings: []string{}}
	err := s.repo.InTx(ctx, func(r Repository) error {
		q := r.querier()
		if branchID != "" {
			rows, err := q.Query(ctx, `SELECT DISTINCT e.id::text FROM hris.employees e
				JOIN hris.employee_placements p ON p.employee_id = e.id AND p.branch_id = $1::uuid
				  AND p.start_date <= $2::date AND (p.end_date IS NULL OR p.end_date >= $2::date)
				WHERE e.is_active AND e.schedule_type = 'non_shift'`, branchID, from)
			if err != nil {
				return err
			}
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					rows.Close()
					return err
				}
				ids = append(ids, id)
			}
			rows.Close()
			if len(ids) == 0 {
				return httpx.BadRequest("Tidak ada karyawan Non-Shift aktif di cabang ini")
			}
		}
		targets, err := loadScheduleTargets(ctx, q, ids)
		if err != nil {
			return err
		}
		for _, t := range targets {
			if t.Type != scheduleNonShift {
				return httpx.BadRequest(t.Name + " bertipe Shift — jadwal tetap hanya untuk karyawan Non-Shift")
			}
		}
		for _, t := range targets {
			n, err := applyFixedSchedule(ctx, r, t.ID, from, actor.FullName)
			if err != nil {
				return err
			}
			res.Changed++
			res.ClearedDays += n
			if err := writeEmployeeAudit(ctx, q, actor, "schedule.fixed_apply", t.ID, t.Name, nil,
				map[string]any{"effective_from": from, "pattern": "Sen–Jum NS 09.00–18.00, Sab–Min libur"}); err != nil {
				return err
			}
		}
		return nil
	})
	return res, err
}

/* ── HTTP ────────────────────────────────────────────────────────────── */

type scheduleTypeBody struct {
	ids    []string
	to     string
	from   string
	dryRun bool
}

func readScheduleTypeBody(r *http.Request, bulk bool) (scheduleTypeBody, error) {
	f, err := readForm(r, "")
	if err != nil {
		return scheduleTypeBody{}, err
	}
	var b scheduleTypeBody
	b.to = strOr(f.Enum("schedule_type", validate.Rule{}, []string{scheduleShift, scheduleNonShift}))
	b.from = strOr(reqStr(f, "effective_from", "Tanggal mulai wajib diisi (YYYY-MM-DD)", validate.StrOpts{Check: matches(domain.DateRe, "Tanggal mulai wajib diisi (YYYY-MM-DD)")}))
	if bulk {
		b.ids = f.Strings("employee_ids", validate.Rule{}, 1000, validate.StrOpts{Check: validate.UUIDCheck})
		if v := f.Bool("dry_run", optional); v != nil {
			b.dryRun = *v
		}
		if len(b.ids) == 0 {
			f.Fail("employee_ids", "custom", "Pilih minimal satu karyawan")
		}
	}
	return b, formErr(f, "")
}

func (h handlers) getScheduleType(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"), "ID karyawan tidak valid")
	if err != nil {
		return err
	}
	var typ string
	var future int
	err = h.svc.repo.querier().QueryRow(r.Context(), `SELECT e.schedule_type,
		(SELECT count(*) FROM hris.employee_shift_days d WHERE d.employee_id = e.id AND d.work_date >= $2::date)
		FROM hris.employees e WHERE e.id = $1`, id, domain.TodayWIB(h.svc.clock())).Scan(&typ, &future)
	if database.IsNoRows(err) {
		return httpx.NotFound("Karyawan tidak ditemukan")
	}
	if err != nil {
		return err
	}
	return ok(w, dataOf(map[string]any{"schedule_type": typ, "future_days": future}))
}

func (h handlers) putScheduleType(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := requireUUID(r.PathValue("id"), "ID karyawan tidak valid")
	if err != nil {
		return err
	}
	b, err := readScheduleTypeBody(r, false)
	if err != nil {
		return err
	}
	res, err := h.svc.ChangeScheduleType(r.Context(), u, []string{id}, b.to, b.from, false)
	if err != nil {
		return err
	}
	return ok(w, dataMsg(res, "Tipe jadwal disimpan"))
}

func (h handlers) bulkScheduleType(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	b, err := readScheduleTypeBody(r, true)
	if err != nil {
		return err
	}
	res, err := h.svc.ChangeScheduleType(r.Context(), u, b.ids, b.to, b.from, b.dryRun)
	if err != nil {
		return err
	}
	return ok(w, dataMsg(res, fmt.Sprintf("Tipe jadwal %d karyawan disimpan", res.Changed)))
}

func (h handlers) applyFixedSchedule(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	f, err := readForm(r, "")
	if err != nil {
		return err
	}
	branch := f.UUID("branch_id", nullish)
	ids := f.Strings("employee_ids", optional, 1000, validate.StrOpts{Check: validate.UUIDCheck})
	from := strOr(reqStr(f, "effective_from", "Tanggal mulai wajib diisi (YYYY-MM-DD)", validate.StrOpts{Check: matches(domain.DateRe, "Tanggal mulai wajib diisi (YYYY-MM-DD)")}))
	if branch == nil && len(ids) == 0 {
		f.Fail("branch_id", "custom", "Pilih cabang atau karyawan")
	}
	if err := formErr(f, ""); err != nil {
		return err
	}
	res, err := h.svc.ApplyFixedSchedule(r.Context(), u, strOr(branch), ids, from)
	if err != nil {
		return err
	}
	return ok(w, dataMsg(res, fmt.Sprintf("Jadwal tetap diterapkan ke %d karyawan", res.Changed)))
}
```

> Bila helper `f.Enum`, `f.Strings`, `f.UUID`, `strOr`, `requireUUID`, `matches`, `formErr`, `dataMsg`, `dataOf` punya signature lain di modul hris, ikuti yang ada (contoh pemakaian: `http_employees.go`, `placements.go`). Pesan error yang dicek test harus tetap persis.

- [ ] **Step 5: Daftarkan route**

Di `routes.go`:
- tambah di blok employees:
  ```go
  r("POST /api/hris/employees/schedule-type/bulk", h.withMenu(kepegawaian, h.bulkScheduleType)),
  ```
- tambah di blok shifts:
  ```go
  r("POST /api/hris/schedules/fixed", h.withMenu(kepegawaian, h.applyFixedSchedule)),
  ```
- tambah entri di tabel `employeeSubroutes`:
  ```go
  "schedule-type": {
      http.MethodGet: h.withMenu(kepegawaian, h.getScheduleType),
      http.MethodPut: h.withMenu(kepegawaian, h.putScheduleType),
  },
  ```

- [ ] **Step 6: Jalankan test**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run 'TestScheduleType|TestApplyFixed' -count=1`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/internal/modules/hris/schedule_type.go backend/internal/modules/hris/employee_audit.go backend/internal/modules/hris/routes.go backend/internal/modules/hris/schedule_type_integration_test.go
git commit -m "feat(hris): tipe jadwal Shift/Non-Shift & jadwal tetap Sen–Jum 09.00–18.00"
```

---

### Task 6: `schedule_type` di API Karyawan (`/api/users`)

**Files:**
- Modify: `backend/internal/modules/configuration/accounts/ports.go:83-110` (`EmployeeFilter.ScheduleType`, `Employee.ScheduleType`)
- Modify: `backend/internal/modules/configuration/accounts/input.go` (`listQuery.scheduleType`, `parseListQuery`, `parseEmployeeBody` create-only `schedule_type`)
- Modify: `backend/internal/modules/configuration/accounts/employees.go:115-119,207-243` (filter, insert)
- Modify: `backend/internal/modules/configuration/accounts/view.go` (`ScheduleType` json `scheduleType`)
- Modify: `backend/internal/app/adapters_configuration_accounts.go:135-206` (select + scan + filter)
- Test: `backend/internal/modules/configuration/accounts/accounts_integration_test.go` (tambah test)

**Interfaces:**
- Produces:
  - `GET /api/users?schedule_type=shift|non_shift`;
  - setiap item list/detail berisi `"scheduleType": "shift"|"non_shift"`;
  - `POST /api/users` menerima `schedule_type` (default `shift`);
  - `PUT /api/users/{id}` **mengabaikan** `schedule_type`. Perubahan tipe hanya lewat endpoint Task 5, supaya aturan transisinya selalu jalan.

- [ ] **Step 1: Test yang gagal**

Tambahkan ke `accounts_integration_test.go`. Helper `setup`, `do`, `wantError`, `uniqueEmail`, dan `employeeBody` sudah ada di file itu.

```go
func TestEmployeeScheduleType(t *testing.T) {
	e := setup(t, map[string][]string{"hris.kepegawaian.users": {"read", "create", "update"}})
	email := uniqueEmail()
	body := employeeBody(email)
	body["schedule_type"] = "non_shift"
	code, out, raw := e.do("POST", "/api/users", body)
	if code != 201 {
		t.Fatalf("create = %d %s", code, raw)
	}
	data := out["data"].(map[string]any)
	id := data["id"].(string)
	if data["scheduleType"] != "non_shift" {
		t.Fatalf("scheduleType = %v", data["scheduleType"])
	}
	code, out, raw = e.do("PUT", "/api/users/"+id, map[string]any{"schedule_type": "shift", "full_name": "Budi Dua"})
	if code != 200 || out["data"].(map[string]any)["scheduleType"] != "non_shift" {
		t.Fatalf("PUT must not change schedule_type: %d %s", code, raw)
	}
	code, out, _ = e.do("GET", "/api/users?schedule_type=non_shift&search="+email, nil)
	if list, _ := out["data"].([]any); code != 200 || len(list) != 1 {
		t.Fatalf("filtered list = %d %v", code, out)
	}
	code, out, _ = e.do("GET", "/api/users?schedule_type=libur", nil)
	wantError(t, code, out, 400, "Parameter tidak valid")
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/configuration/accounts -run TestEmployeeScheduleType -count=1`
Expected: FAIL (`scheduleType` nil)

- [ ] **Step 3: Implementasi**

- **`ports.go`:** `EmployeeFilter` mendapat `ScheduleType *string`; `Employee` mendapat `ScheduleType string`.
- **`adapters_configuration_accounts.go`:**
  - `employeeSelect` mendapat kolom `schedule_type` setelah `is_access_app`;
  - `scanEmployee` membaca `&e.ScheduleType` di posisi yang sama;
  - `List` mendapat filter:
    ```go
    if f.ScheduleType != nil {
        where = append(where, `"schedule_type" = `+param(*f.ScheduleType))
    }
    ```
- **`input.go`:**
  - `listQuery` mendapat `scheduleType *string`;
  - di `parseListQuery`, setelah `q.role`:
    ```go
    q.scheduleType = f.Enum("schedule_type", optional, []string{"shift", "non_shift"})
    ```
  - `employeeBody` mendapat `scheduleType *string`; `parseEmployeeBody` hanya mengisinya saat `create`:
    ```go
    if create {
        b.scheduleType = f.Enum("schedule_type", optional, []string{"shift", "non_shift"})
    }
    ```
- **`employees.go`:**
  - `EmployeeFilter{… ScheduleType: q.scheduleType}`;
  - di `createUser`, setelah `{"is_access_app", …}`:
    ```go
    scheduleType := "shift"
    if b.scheduleType != nil {
        scheduleType = *b.scheduleType
    }
    cols = append(cols, Column{"schedule_type", scheduleType})
    ```
- **`view.go`:** `employeeView` mendapat ``ScheduleType string `json:"scheduleType"` `` setelah `IsAccessApp`, dan `mapEmployee` mengisinya `ScheduleType: e.ScheduleType`.

- [ ] **Step 4: Jalankan test**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/configuration/accounts -count=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/modules/configuration/accounts backend/internal/app/adapters_configuration_accounts.go
git commit -m "feat(users): tipe jadwal di data karyawan (create, filter, tampil)"
```

---

### Task 7: UI Shift/Non-Shift di data karyawan

**Files:**
- Create: `frontend/src/lib/hris/schedule-type.ts` (+ `schedule-type.test.ts`)
- Create: `frontend/src/features/users/components/schedule-type-dialog.tsx` (+ `schedule-type-dialog.test.tsx`)
- Modify:
  - `frontend/src/lib/hris/users-form.ts` (field `schedule_type`, validasi wajib saat create)
  - `frontend/src/features/users/components/user-form/employment-section.tsx` (pilihan Shift/Non-Shift)
  - `frontend/src/lib/users/user-mapper.ts`, `frontend/src/features/users/types.ts` (`scheduleType`)
  - `frontend/src/features/users/components/users-list-filters.tsx` (filter "Tipe Jadwal")
  - `frontend/src/features/users/components/users-list-page.tsx` (param + seleksi massal)
  - `frontend/src/features/users/components/users-table.tsx` (badge + checkbox seleksi)
  - `frontend/src/features/users/components/user-detail-page.tsx` (badge header + tombol "Ubah tipe jadwal")
  - `frontend/src/features/users/components/employee-shifts-tab.tsx` (terkunci untuk Non-Shift)
  - `frontend/src/features/hris/ess/components/shift-tim-page.tsx` (bawahan Non-Shift read-only)
  - `frontend/src/features/users/api.ts` (fungsi API)

**Interfaces:**
- Consumes: endpoint Task 5; `scheduleType` dari Task 6.
- Produces:
```ts
// lib/hris/schedule-type.ts
export type ScheduleType = "shift" | "non_shift";
export const SCHEDULE_TYPE_OPTIONS: { value: ScheduleType; label: string }[]; // Shift, Non-Shift
export function scheduleTypeLabel(t: ScheduleType | null | undefined): string;    // "Shift" | "Non-Shift" | "—"
export function scheduleTypeConfirmText(to: ScheduleType, from: string, futureDays: number): string;
// features/users/api.ts
export const fetchScheduleType: (id: string) => Promise<{ data: { schedule_type: ScheduleType; future_days: number } }>;
export const saveScheduleType: (id: string, body: { schedule_type: ScheduleType; effective_from: string }) => Promise<{ data: ScheduleTypeResult; message?: string }>;
export const bulkScheduleType: (body: { employee_ids: string[]; schedule_type: ScheduleType; effective_from: string; dry_run?: boolean }) => Promise<{ data: ScheduleTypeResult; message?: string }>;
export const applyFixedSchedule: (body: { branch_id?: string; employee_ids?: string[]; effective_from: string }) => Promise<{ data: ScheduleTypeResult; message?: string }>;
export interface ScheduleTypeResult { changed: number; cleared_days: number; warnings: string[] }
```

- [ ] **Step 1: Test logika murni yang gagal**

```ts
// frontend/src/lib/hris/schedule-type.test.ts
import { describe, expect, it } from "vitest";
import { scheduleTypeConfirmText, scheduleTypeLabel } from "./schedule-type";

describe("schedule type", () => {
  it("label", () => {
    expect(scheduleTypeLabel("non_shift")).toBe("Non-Shift");
    expect(scheduleTypeLabel(undefined)).toBe("—");
  });
  it("teks konfirmasi ke Non-Shift menyebut jadwal yang dihapus", () => {
    expect(scheduleTypeConfirmText("non_shift", "2026-10-21", 3)).toBe(
      "3 jadwal per tanggal mulai 21/10/2026 akan dihapus dan diganti jadwal tetap Senin–Jumat 09.00–18.00."
    );
    expect(scheduleTypeConfirmText("non_shift", "2026-10-21", 0)).toBe(
      "Jadwal tetap Senin–Jumat 09.00–18.00 berlaku mulai 21/10/2026."
    );
  });
  it("teks konfirmasi ke Shift mengingatkan penugasan", () => {
    expect(scheduleTypeConfirmText("shift", "2026-10-21", 0)).toBe(
      "Jadwal tetap berhenti mulai 21/10/2026. Karyawan perlu ditugaskan di Jadwal Kerja."
    );
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd frontend && npx vitest run src/lib/hris/schedule-type.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implementasi `schedule-type.ts`**

```ts
// frontend/src/lib/hris/schedule-type.ts
/** Tipe jadwal karyawan (Spec 2026-10-19 §2.2). */
export type ScheduleType = "shift" | "non_shift";

export const SCHEDULE_TYPE_OPTIONS: { value: ScheduleType; label: string }[] = [
  { value: "shift", label: "Shift" },
  { value: "non_shift", label: "Non-Shift" },
];

export function scheduleTypeLabel(t: ScheduleType | null | undefined): string {
  return SCHEDULE_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? "—";
}

/** "2026-10-21" → "21/10/2026". */
export function dmy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function scheduleTypeConfirmText(to: ScheduleType, from: string, futureDays: number): string {
  if (to === "non_shift") {
    return futureDays > 0
      ? `${futureDays} jadwal per tanggal mulai ${dmy(from)} akan dihapus dan diganti jadwal tetap Senin–Jumat 09.00–18.00.`
      : `Jadwal tetap Senin–Jumat 09.00–18.00 berlaku mulai ${dmy(from)}.`;
  }
  return `Jadwal tetap berhenti mulai ${dmy(from)}. Karyawan perlu ditugaskan di Jadwal Kerja.`;
}
```

- [ ] **Step 4: API & tipe**

Di `features/users/api.ts`, tambahkan (pakai `apiGet`/`apiPut`/`apiPost` yang sudah diimpor):

```ts
export interface ScheduleTypeResult { changed: number; cleared_days: number; warnings: string[] }

export const fetchScheduleType = (id: string) =>
  apiGet<{ data: { schedule_type: ScheduleType; future_days: number } }>(`/api/hris/employees/${id}/schedule-type`);
export const saveScheduleType = (id: string, body: { schedule_type: ScheduleType; effective_from: string }) =>
  apiPut<{ data: ScheduleTypeResult; message?: string }>(`/api/hris/employees/${id}/schedule-type`, body);
export const bulkScheduleType = (body: { employee_ids: string[]; schedule_type: ScheduleType; effective_from: string; dry_run?: boolean }) =>
  apiPost<{ data: ScheduleTypeResult; message?: string }>("/api/hris/employees/schedule-type/bulk", body);
export const applyFixedSchedule = (body: { branch_id?: string; employee_ids?: string[]; effective_from: string }) =>
  apiPost<{ data: ScheduleTypeResult; message?: string }>("/api/hris/schedules/fixed", body);
```

Tambahan lain:
- `UserEmployeeItem` (`lib/users/user-mapper.ts`): tambah `scheduleType: ScheduleType`. Di mapper fallback: `scheduleType: row.schedule_type ?? "shift"`.
- `UserListParams` (`features/users/types.ts`): tambah `schedule_type?: ScheduleType`.

- [ ] **Step 5: Test komponen dialog yang gagal**

```tsx
// frontend/src/features/users/components/schedule-type-dialog.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ScheduleTypeDialog } from "./schedule-type-dialog";

const api = vi.hoisted(() => ({
  fetchScheduleType: vi.fn(async () => ({ data: { schedule_type: "shift", future_days: 4 } })),
  saveScheduleType: vi.fn(async () => ({ data: { changed: 1, cleared_days: 4, warnings: [] } })),
}));
vi.mock("../api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
afterEach(cleanup);

it("meminta konfirmasi sebelum mengganti Shift → Non-Shift", async () => {
  const onDone = vi.fn();
  render(<ScheduleTypeDialog open employeeId="e1" employeeName="Feti" today="2026-10-21" onOpenChange={() => {}} onDone={onDone} />);
  fireEvent.click(await screen.findByRole("radio", { name: "Non-Shift" }));
  expect(await screen.findByText(/4 jadwal per tanggal mulai 21\/10\/2026 akan dihapus/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
  await waitFor(() => expect(api.saveScheduleType).toHaveBeenCalledWith("e1", { schedule_type: "non_shift", effective_from: "2026-10-21" }));
  expect(onDone).toHaveBeenCalled();
});
```

- [ ] **Step 6: Implementasi dialog**

```tsx
// frontend/src/features/users/components/schedule-type-dialog.tsx
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SCHEDULE_TYPE_OPTIONS, scheduleTypeConfirmText, type ScheduleType } from "@/lib/hris/schedule-type";
import { fetchScheduleType, saveScheduleType } from "../api";

interface Props {
  open: boolean;
  employeeId: string;
  employeeName: string;
  today: string; // YYYY-MM-DD (WIB)
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/** Ubah tipe jadwal satu karyawan; selalu menampilkan dampaknya dulu. */
export function ScheduleTypeDialog({ open, employeeId, employeeName, today, onOpenChange, onDone }: Props) {
  const [current, setCurrent] = useState<ScheduleType | null>(null);
  const [futureDays, setFutureDays] = useState(0);
  const [target, setTarget] = useState<ScheduleType | null>(null);
  const [from, setFrom] = useState(today);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchScheduleType(employeeId).then((res) => {
      if (!alive) return;
      setCurrent(res.data.schedule_type);
      setTarget(res.data.schedule_type);
      setFutureDays(res.data.future_days);
    });
    return () => {
      alive = false;
    };
  }, [open, employeeId]);

  const changed = target !== null && current !== null && target !== current;

  async function save() {
    if (!target || !changed) return;
    setSaving(true);
    try {
      const res = await saveScheduleType(employeeId, { schedule_type: target, effective_from: from });
      res.data.warnings.forEach((w) => toast.warning(w));
      toast.success(res.message ?? "Tipe jadwal disimpan");
      onDone();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan tipe jadwal");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tipe jadwal — {employeeName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Tipe jadwal" className="flex gap-2">
            {SCHEDULE_TYPE_OPTIONS.map((o) => (
              <label key={o.value} className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm">
                <input type="radio" name="schedule_type" aria-label={o.label} checked={target === o.value} onChange={() => setTarget(o.value)} />
                {o.label}
              </label>
            ))}
          </div>
          <label className="block text-sm">
            Berlaku mulai
            <Input type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
          </label>
          {changed ? (
            <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">{scheduleTypeConfirmText(target, from, target === "non_shift" ? futureDays : 0)}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button disabled={!changed || saving || from < today} onClick={save}>Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> `futureDays` dari server dihitung mulai hari ini. Bila HR memilih tanggal mulai lebih jauh, teksnya tetap aman karena server yang menghapus tepat mulai `from`. Pesan sukses menampilkan jumlah sebenarnya dari `cleared_days`.

- [ ] **Step 7: Pasang di halaman**

- **Form tambah karyawan** (`employment-section.tsx`): radio "Tipe Jadwal \*" (Shift / Non-Shift), default Shift. Di `users-form.ts`:
  - tambah `schedule_type: ScheduleType` ke `UserEmployeeFormValues` (default `"shift"`);
  - `buildUserPayload` mengirim `schedule_type` **hanya** saat create;
  - `validateUserForm` mengembalikan `"Tipe jadwal wajib dipilih"` bila kosong.
  - Di mode edit field ini tampil read-only beserta tombol "Ubah tipe jadwal" yang membuka `ScheduleTypeDialog`.
- **Detail karyawan** (`user-detail-page.tsx`): `Badge` "Shift"/"Non-Shift" di header di sebelah nama, plus tombol "Ubah tipe jadwal" untuk HR (`useIamAccess().hasPrefix(IAM.hrisKepegawaian)`) yang membuka dialog. Setelah `onDone`, panggil `refetch` detail.
- **Daftar** (`users-list-filters.tsx`):
  - tambah `scheduleType: "all" | ScheduleType` ke `UserListFilters` dengan default `"all"` di kedua default;
  - `countActiveFilters` ikut membandingkan field ini;
  - field filter "Tipe Jadwal" dengan pilihan Semua / Shift / Non-Shift.
- **Halaman daftar** (`users-list-page.tsx`):
  - param `schedule_type: filters.scheduleType !== "all" ? filters.scheduleType : undefined`;
  - di variant directory, checkbox seleksi baris (`users-table.tsx` prop `selectable`, `selected`, `onSelectedChange`);
  - toolbar muncul bila ada yang dipilih: "Set Shift / Non-Shift (N)". Toolbar ini membuka dialog massal: pilih tipe + tanggal → panggil `bulkScheduleType({…, dry_run: true})` → tampilkan `scheduleTypeConfirmText(to, from, res.data.cleared_days)` dan jumlah karyawan → tombol "Simpan" memanggil tanpa `dry_run`.
- **Tabel** (`users-table.tsx`): kolom kecil "Jadwal" berisi `Badge` (`scheduleTypeLabel(row.scheduleType)`).
- **Tab Jadwal Shift** (`employee-shifts-tab.tsx`) menerima prop `scheduleType`. Bila `"non_shift"`:
  - semua combobox disabled;
  - judul "Jadwal tetap (Non-Shift)";
  - hanya tombol "Terapkan jadwal tetap" (memanggil `applyFixedSchedule({ employee_ids: [id], effective_from })`);
  - catatan "Ubah tipe jadwal ke Shift untuk mengatur shift".
  - `user-detail-page.tsx` meneruskan `employee.schedule_type`. `GET /api/hris/employees/{id}` mengembalikan seluruh kolom, sehingga `schedule_type` ikut; tambahkan `schedule_type` ke tipe `Employee` di `@/types/hris`.
- **Shift Tim** (`shift-tim-page.tsx`): untuk bawahan Non-Shift, tombol atur shift diganti badge "Non-Shift — jadwal tetap", dan dialog tidak dibuka.

- [ ] **Step 8: Test komponen tambahan**

Tambahkan di `frontend/src/features/users/components/employee-shifts-tab.test.tsx`:

```tsx
it("mengunci pengaturan shift untuk karyawan Non-Shift", async () => {
  render(<EmployeeShiftsTab employeeId="e1" scheduleType="non_shift" />);
  expect(await screen.findByText("Jadwal tetap (Non-Shift)")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Terapkan jadwal tetap" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Simpan pola" })).toBeNull();
});
```

Mock `../api` dan query seperti test komponen lain di folder itu. Teks tombol simpan pola disesuaikan dengan label yang ada di komponen.

- [ ] **Step 9: Jalankan test & typecheck**

Run: `cd frontend && npx vitest run src/lib/hris/schedule-type.test.ts src/features/users && npx tsc --noEmit -p .`
Expected: PASS, tanpa error tipe

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/hris/schedule-type.ts frontend/src/lib/hris/schedule-type.test.ts frontend/src/lib/hris/users-form.ts frontend/src/lib/users/user-mapper.ts frontend/src/features/users frontend/src/features/hris/ess/components/shift-tim-page.tsx frontend/src/types/hris.ts
git commit -m "feat(hris): checklist Shift/Non-Shift di data karyawan, ubah massal, tab jadwal terkunci"
```

---

### Task 8: Resign karyawan + karyawan resign hilang dari pemilih

**Files:**
- Create: `backend/internal/modules/hris/employee_resign.go`
- Create: `frontend/src/features/users/components/resign-dialog.tsx` (+ test)
- Modify: `backend/internal/modules/hris/routes.go` (sub-route `resign`)
- Modify: `frontend/src/features/users/components/user-detail-page.tsx` (tombol Resign)
- Modify: `frontend/src/features/users/api.ts` (`resignEmployee`)
- Modify: `frontend/src/features/hris/leaves/api.ts:28` (pemilih cuti hanya aktif)
- Test: `backend/internal/modules/hris/employee_resign_integration_test.go`

**Interfaces:**
- Consumes: `writeEmployeeAudit` (Task 5).
- Produces:
  - `POST /api/hris/employees/{id}/resign` body `{effective_date, resign_type: "resign"|"terminated"|"end_of_contract", reason}` → `{data:{id, employment_status, end_date}, message:"Karyawan diresign"}`;
  - `func (s *Service) ResignEmployee(ctx context.Context, actor *auth.User, id string, in resignInput) (map[string]any, error)`;
  - frontend `resignEmployee(id, body)`.

- [ ] **Step 1: Test integrasi yang gagal**

```go
// backend/internal/modules/hris/employee_resign_integration_test.go
package hris

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/iam"
)

func TestResignEmployee(t *testing.T) {
	h := newHarness(t)
	hr, _ := h.staff("hrd", iam.HrisKepegawaian, false)
	login, e := h.staff("employee", nil, true, emp{name: "Rina Resign", join: "2025-01-10"})
	branch := h.scalar(`SELECT id::text FROM configuration.branches LIMIT 1`)
	h.exec(`INSERT INTO hris.employee_placements (employee_id, branch_id, is_primary, start_date) VALUES ($1, $2, true, '2025-01-10')`, e, branch)
	def := h.scalar(`SELECT id::text FROM hris.shifts WHERE code = 'DEF'`)
	h.exec(`INSERT INTO hris.employee_shifts (employee_id, day_of_week, shift_id, effective_from) VALUES ($1, 1, $2, '2025-01-10')`, e, def)
	h.exec(`INSERT INTO hris.employee_shift_days (employee_id, work_date, shift_id, batch_id) VALUES ($1, '2026-10-20', $2, gen_random_uuid())`, e, def)

	bad := h.do(&hr, http.MethodPost, "/api/hris/employees/"+e+"/resign", map[string]any{"effective_date": "2024-12-31", "resign_type": "resign"})
	expect(t, bad, http.StatusBadRequest, "Tanggal efektif tidak boleh sebelum tanggal masuk (10/01/2025)")

	c := h.do(&hr, http.MethodPost, "/api/hris/employees/"+e+"/resign", map[string]any{
		"effective_date": "2026-10-15", "resign_type": "resign", "reason": "Pindah kota"})
	expect(t, c, http.StatusOK, "")
	row := h.scalar(`SELECT employment_status || '|' || is_active || '|' || end_date::text FROM hris.employees WHERE id = $1`, e)
	if row != "resigned|false|2026-10-15" {
		t.Fatalf("employee = %s", row)
	}
	if h.scalar(`SELECT end_date::text FROM hris.employee_placements WHERE employee_id = $1`, e) != "2026-10-15" {
		t.Fatal("placement not closed")
	}
	if h.scalar(`SELECT effective_to::text FROM hris.employee_shifts WHERE employee_id = $1`, e) != "2026-10-15" {
		t.Fatal("weekly pattern not closed")
	}
	if h.scalar(`SELECT count(*)::text FROM hris.employee_shift_days WHERE employee_id = $1`, e) != "0" {
		t.Fatal("per-date rows after resign date must be removed")
	}
	if h.scalar(`SELECT (banned_until IS NOT NULL)::text FROM auth.users WHERE id = $1`, login.UserID) != "true" {
		t.Fatal("login account must be blocked")
	}
	if h.scalar(`SELECT change_type || '|' || coalesce(reason, '') FROM hris.employment_history WHERE employee_id = $1 AND change_type = 'resign'`, e) != "resign|Pindah kota" {
		t.Fatal("history missing")
	}
	if h.scalar(`SELECT count(*)::text FROM audit.audit_log WHERE entity_id = $1 AND action = 'employee.resign'`, e) != "1" {
		t.Fatal("audit missing")
	}
	again := h.do(&hr, http.MethodPost, "/api/hris/employees/"+e+"/resign", map[string]any{"effective_date": "2026-10-15", "resign_type": "resign"})
	expect(t, again, http.StatusBadRequest, "Karyawan sudah nonaktif")
}
```

> Bila `h.staff` dengan `menus == nil` tidak mengizinkan role `employee`, pakai role apa pun. Yang diuji hanya akun login yang tertaut (`login.UserID`).

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run TestResignEmployee -count=1`
Expected: FAIL (404)

- [ ] **Step 3: Implementasi**

```go
// backend/internal/modules/hris/employee_resign.go
package hris

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/modules/hris/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Resign (Spec §1.1): one transaction sets the status, closes placements and
// schedules, blocks the login account and records history + audit.

type resignInput struct {
	EffectiveDate string
	Type          string // resign | terminated | end_of_contract
	Reason        *string
}

var resignStatus = map[string]string{"resign": "resigned", "end_of_contract": "resigned", "terminated": "terminated"}

func (s *Service) ResignEmployee(ctx context.Context, actor *auth.User, id string, in resignInput) (map[string]any, error) {
	var out map[string]any
	err := s.repo.InTx(ctx, func(r Repository) error {
		q := r.querier()
		var name, status, join string
		var active bool
		var userID *string
		err := q.QueryRow(ctx, `SELECT full_name, employment_status, join_date::text, is_active, user_id::text
			FROM hris.employees WHERE id = $1 FOR UPDATE`, id).Scan(&name, &status, &join, &active, &userID)
		if database.IsNoRows(err) {
			return httpx.NotFound("Karyawan tidak ditemukan")
		}
		if err != nil {
			return err
		}
		if !active {
			return httpx.BadRequest("Karyawan sudah nonaktif")
		}
		if in.EffectiveDate < join {
			return httpx.BadRequest("Tanggal efektif tidak boleh sebelum tanggal masuk (" + domain.FormatDateID(join) + ")")
		}
		newStatus := resignStatus[in.Type]
		d := in.EffectiveDate
		steps := []struct {
			sql  string
			args []any
		}{
			{`UPDATE hris.employees SET employment_status = $2, is_active = false, end_date = $3::date, is_access_app = false, updated_at = now() WHERE id = $1`, []any{id, newStatus, d}},
			{`DELETE FROM hris.employee_placements WHERE employee_id = $1 AND start_date > $2::date`, []any{id, d}},
			{`UPDATE hris.employee_placements SET end_date = $2::date WHERE employee_id = $1 AND (end_date IS NULL OR end_date > $2::date)`, []any{id, d}},
			{`DELETE FROM hris.employee_shifts WHERE employee_id = $1 AND effective_from > $2::date`, []any{id, d}},
			{`UPDATE hris.employee_shifts SET effective_to = $2::date WHERE employee_id = $1 AND (effective_to IS NULL OR effective_to > $2::date)`, []any{id, d}},
			{`DELETE FROM hris.employee_shift_days WHERE employee_id = $1 AND work_date > $2::date`, []any{id, d}},
			{`INSERT INTO hris.employment_history (employee_id, change_type, effective_date, prev_employment_status, new_employment_status, reason, recorded_by)
			  VALUES ($1, $2, $3::date, $4, $5, $6, (SELECT e.id FROM hris.employees e WHERE e.user_id = $7::uuid LIMIT 1))`,
				[]any{id, in.Type, d, status, newStatus, in.Reason, actor.ID}}, // recorded_by → hris.employees(id)
		}
		if userID != nil {
			// Same effect as accounts.revokeAccount (ban_duration 876000h).
			steps = append(steps,
				struct {
					sql  string
					args []any
				}{`UPDATE auth.users SET banned_until = now() + interval '876000 hours' WHERE id = $1`, []any{*userID}},
				struct {
					sql  string
					args []any
				}{`UPDATE configuration.users SET status = 'inactive', updated_at = now() WHERE id = $1`, []any{*userID}})
		}
		for _, st := range steps {
			if _, err := q.Exec(ctx, st.sql, st.args...); err != nil {
				return err
			}
		}
		if err := writeEmployeeAudit(ctx, q, actor, "employee.resign", id, name,
			map[string]any{"employment_status": status, "is_active": true},
			map[string]any{"employment_status": newStatus, "is_active": false, "end_date": d, "resign_type": in.Type, "reason": in.Reason}); err != nil {
			return err
		}
		out = map[string]any{"id": id, "employment_status": newStatus, "end_date": d}
		return nil
	})
	return out, err
}

func (h handlers) resignEmployee(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := requireUUID(r.PathValue("id"), "ID karyawan tidak valid")
	if err != nil {
		return err
	}
	f, err := readForm(r, "")
	if err != nil {
		return err
	}
	const dateMsg = "Tanggal efektif wajib diisi"
	in := resignInput{
		EffectiveDate: strOr(reqStr(f, "effective_date", dateMsg, validate.StrOpts{Check: matches(domain.DateRe, dateMsg)})),
		Type:          strOr(f.Enum("resign_type", validate.Rule{}, []string{"resign", "terminated", "end_of_contract"})),
		Reason:        f.Str("reason", nullish, validate.StrOpts{Trim: true, Max: 500}),
	}
	if err := formErr(f, ""); err != nil {
		return err
	}
	row, err := h.svc.ResignEmployee(r.Context(), u, id, in)
	if err != nil {
		return err
	}
	return ok(w, dataMsg(row, "Karyawan diresign"))
}
```

Tambahkan ke tabel `employeeSubroutes` di `routes.go`:

```go
"resign": {http.MethodPost: h.withMenu(employeeRecordManagers, h.resignEmployee)},
```

- [ ] **Step 4: Jalankan test**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run TestResignEmployee -count=1`
Expected: PASS

- [ ] **Step 5: Test dialog frontend yang gagal**

```tsx
// frontend/src/features/users/components/resign-dialog.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResignDialog } from "./resign-dialog";

const api = vi.hoisted(() => ({ resignEmployee: vi.fn(async () => ({ data: {}, message: "Karyawan diresign" })) }));
vi.mock("../api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

it("wajib tanggal & jenis, lalu mengirim resign", async () => {
  const onDone = vi.fn();
  render(<ResignDialog open employeeId="e1" employeeName="Rina" joinDate="2025-01-10" today="2026-10-21" onOpenChange={() => {}} onDone={onDone} />);
  expect(screen.getByText(/Akun login Rina akan diblokir/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Alasan"), { target: { value: "Pindah kota" } });
  fireEvent.click(screen.getByRole("button", { name: "Resign" }));
  await waitFor(() =>
    expect(api.resignEmployee).toHaveBeenCalledWith("e1", { effective_date: "2026-10-21", resign_type: "resign", reason: "Pindah kota" })
  );
  expect(onDone).toHaveBeenCalled();
});
```

- [ ] **Step 6: Implementasi dialog**

```tsx
// frontend/src/features/users/components/resign-dialog.tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { resignEmployee } from "../api";

const TYPES = [
  { value: "resign", label: "Resign (mengundurkan diri)" },
  { value: "end_of_contract", label: "Kontrak berakhir" },
  { value: "terminated", label: "Diberhentikan (PHK)" },
] as const;

interface Props {
  open: boolean;
  employeeId: string;
  employeeName: string;
  joinDate: string;
  today: string;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

export function ResignDialog({ open, employeeId, employeeName, joinDate, today, onOpenChange, onDone }: Props) {
  const [date, setDate] = useState(today);
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("resign");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const dateError = !date ? "Tanggal efektif wajib diisi" : date < joinDate ? "Tidak boleh sebelum tanggal masuk" : null;

  async function submit() {
    if (dateError) return;
    setSaving(true);
    try {
      const res = await resignEmployee(employeeId, { effective_date: date, resign_type: type, reason: reason.trim() || null });
      toast.success(res.message ?? "Karyawan diresign");
      onDone();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memproses resign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Resign — {employeeName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="rounded-lg bg-danger-soft p-3 text-danger">
            Akun login {employeeName} akan diblokir, penempatan dan jadwal ditutup per tanggal efektif. Data lama tetap tersimpan.
          </p>
          <label className="block">
            Tanggal efektif *
            <Input type="date" min={joinDate} value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            {dateError ? <span className="text-danger">{dateError}</span> : null}
          </label>
          <fieldset className="space-y-1">
            <legend>Jenis *</legend>
            {TYPES.map((t) => (
              <label key={t.value} className="flex items-center gap-2">
                <input type="radio" name="resign_type" checked={type === t.value} onChange={() => setType(t.value)} />
                {t.label}
              </label>
            ))}
          </fieldset>
          <label className="block">
            Alasan
            <textarea aria-label="Alasan" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-lg border p-2" rows={3} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button variant="destructive" disabled={!!dateError || saving} onClick={submit}>Resign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Pemasangan:
- `features/users/api.ts`:
  ```ts
  export const resignEmployee = (id: string, body: { effective_date: string; resign_type: string; reason: string | null }) =>
    apiPost<{ data: unknown; message?: string }>(`/api/hris/employees/${id}/resign`, body);
  ```
- `user-detail-page.tsx`: tombol "Resign" (variant `outline`, warna danger) di header, hanya bila `employee.is_active` dan user punya akses `IAM.hrisKepegawaian`. Setelah `onDone`, panggil refetch detail. Untuk karyawan nonaktif, tampilkan `Badge` "Resign" / "Diberhentikan" beserta tanggal keluar.
- `features/hris/leaves/api.ts:28`: ubah URL menjadi `"/api/hris/employees?is_active=true&limit=500&sort_by=full_name&sort_order=asc"`. Batas 100 sekarang juga memotong daftar (373 aktif).
- Cek ulang semua pemilih karyawan lain sudah memakai `is_active=true`: `rg -n "/api/hris/employees\?" frontend/src/features`. Saat plan ditulis, sudah aktif-saja: `shared/use-employee-options.ts` (dipakai pinjaman & lembur), `attendance/api.ts:127`, `org-chart`, `users/api.ts:282`. Tidak perlu diubah.

- [ ] **Step 7: Jalankan test**

Run: `cd frontend && npx vitest run src/features/users src/features/hris/leaves && npx tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/internal/modules/hris/employee_resign.go backend/internal/modules/hris/employee_resign_integration_test.go backend/internal/modules/hris/routes.go frontend/src/features/users frontend/src/features/hris/leaves/api.ts
git commit -m "feat(hris): aksi Resign (tutup penempatan & jadwal, blokir login) + pemilih cuti hanya karyawan aktif"
```

---

### Task 9: Jadwal per tanggal dibaca clock-in, roster, dan ESS

**Files:**
- Modify: `backend/internal/modules/hris/files.go:65-73` (`ShiftPattern`)
- Modify: `backend/internal/modules/hris/postgres_attendance.go:78-86` (`RosterRows`), `:150-158` (`ScheduleRows`)
- Modify: `backend/internal/modules/hris/selfservice.go:325-331` (`ESSSchedule`)
- Test: `backend/internal/modules/hris/schedule_days_reader_integration_test.go`

**Interfaces:**
- Consumes: view `hris.v_employee_schedule` (Task 1).
- Produces: `shiftSnapshot`, `RosterRows`, `ScheduleRows`, dan `ESSSchedule` memakai jadwal per tanggal bila ada. Tanpa jadwal per tanggal, hasilnya identik dengan sebelumnya.

- [ ] **Step 1: Test yang gagal**

```go
// backend/internal/modules/hris/schedule_days_reader_integration_test.go
package hris

import (
	"context"
	"testing"
)

func TestPerDateScheduleWinsInReaders(t *testing.T) {
	h := newHarness(t)
	e := h.employee(emp{})
	ns := h.scalar(`SELECT id::text FROM hris.shifts WHERE code = 'NS'`)
	def := h.scalar(`SELECT id::text FROM hris.shifts WHERE code = 'DEF'`)
	// Pola mingguan Selasa = NS; jadwal per tanggal Selasa 2026-10-06 = DEF, 2026-10-13 = libur.
	h.exec(`INSERT INTO hris.employee_shifts (employee_id, day_of_week, shift_id, effective_from) VALUES ($1, 2, $2, '2026-01-01')`, e, ns)
	h.exec(`INSERT INTO hris.employee_shift_days (employee_id, work_date, shift_id, batch_id) VALUES
		($1, '2026-10-06', $2, gen_random_uuid()), ($1, '2026-10-13', NULL, gen_random_uuid())`, e, def)
	ctx := context.Background()

	snap, err := h.svc.shiftSnapshot(ctx, e, "2026-10-06")
	if err != nil || snap == nil || snap.shiftID != def || snap.times.StartTime != "08:00:00" {
		t.Fatalf("snapshot 10-06 = %+v %v, want DEF", snap, err)
	}
	if snap, _ := h.svc.shiftSnapshot(ctx, e, "2026-10-13"); snap != nil {
		t.Fatalf("snapshot 10-13 = %+v, want day off", snap)
	}
	if snap, _ := h.svc.shiftSnapshot(ctx, e, "2026-10-20"); snap == nil || snap.shiftID != ns {
		t.Fatalf("snapshot 10-20 = %+v, want weekly NS", snap)
	}
	rows, err := h.svc.repo.RosterRows(ctx, "2026-10-06", 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.Str("employee_id") == e && r.Str("scheduled_shift_id") != def {
			t.Fatalf("roster shift = %s, want DEF", r.Str("scheduled_shift_id"))
		}
	}
	ess, err := h.svc.repo.ESSSchedule(ctx, e)
	if err != nil || len(ess) != 3 {
		t.Fatalf("ESS rows = %d %v, want 3 (1 weekly + 2 per-date)", len(ess), err)
	}
}
```

> `RosterRows`, `ESSSchedule`, dan `shiftSnapshot` dipanggil lewat `h.svc.repo`. Bila `repo` bukan field bernama `repo`, pakai nama yang ada (lihat `module.go`).

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run TestPerDateScheduleWinsInReaders -count=1`
Expected: FAIL (snapshot 10-06 = NS)

- [ ] **Step 3: Ganti sumber query ke view**

`files.go` `ShiftPattern`:
```go
	return queryRows(ctx, s.db, `SELECT es.day_of_week, es.shift_id,
		es.effective_from::text, es.effective_to::text,
		s.name, s.start_time::text, s.end_time::text,
		s.late_tolerance_minutes, s.is_overnight
		FROM hris.v_employee_schedule es
		LEFT JOIN hris.shifts s ON s.id = es.shift_id
		WHERE es.employee_id = $1
		ORDER BY es.priority`, employeeID)
```
Urutan `priority` membuat baris per tanggal ada di depan. `domain.ResolveScheduleRow` memakai sort stabil, sehingga baris per tanggal menang bila `effective_from` sama.

`postgres_attendance.go` `RosterRows`, CTE `scheduled`:
```sql
		  SELECT DISTINCT ON (es.employee_id) es.employee_id, es.shift_id
		  FROM hris.v_employee_schedule es
		  WHERE es.day_of_week = $2
		    AND es.effective_from <= $1::date
		    AND (es.effective_to IS NULL OR es.effective_to >= $1::date)
		  ORDER BY es.employee_id, es.effective_from DESC, es.priority
```

`postgres_attendance.go` `ScheduleRows`: `FROM hris.v_employee_schedule es` dan `ORDER BY es.effective_from DESC, es.priority, es.day_of_week ASC`.

`selfservice.go` `ESSSchedule`: `FROM hris.v_employee_schedule es` + `ORDER BY es.priority`.

**Jangan** ubah:
- `EmployeeShifts`: tab riwayat pola mingguan di detail karyawan tetap membaca `hris.employee_shifts`;
- `SaveShiftPattern`;
- reader payroll/KPI/spa di `backend/internal/app/adapters_*.go` (tahap 2).

- [ ] **Step 4: Jalankan test hris lengkap**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -count=1`
Expected: test baru PASS. Kegagalan lama TestAttendancePeriodClosing/TestLeaves (sudah ada di main) boleh tetap; test lain PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/modules/hris/files.go backend/internal/modules/hris/postgres_attendance.go backend/internal/modules/hris/selfservice.go backend/internal/modules/hris/schedule_days_reader_integration_test.go
git commit -m "feat(hris): clock-in, roster & ESS membaca jadwal per tanggal"
```


---

### Task 10: Parse & validasi file jadwal (`hris/domain/schedule_upload.go`)

**Files:**
- Create: `backend/internal/modules/hris/domain/schedule_upload.go`
- Test: `backend/internal/modules/hris/domain/schedule_upload_test.go`

**Interfaces:**
- Consumes: `ParseDateCell`, `FormatDateID`, `NormalizeHeader`, `CleanNIP` (Task 3).
- Produces:
```go
const ScheduleOff = "L"          // libur
const ScheduleNotPlaced = "-"    // tanggal di luar penempatan cabang ini
const MaxScheduleRows = 300
type UploadEmployee struct {
    ID, NIP, Name, Position, ScheduleType string
    Active bool
    Placed map[string]bool // tanggal (YYYY-MM-DD) karyawan ditempatkan di cabang ini
}
type UploadShift struct {
    ID, Code, Name, Start, End string // Start/End "HH:MM:SS"
    Overnight, Active          bool
}
type ScheduleUploadContext struct {
    BranchID, BranchName string
    Dates                []string // from..to, sudah lolos ScheduleDates
    Today                string
    Employees            map[string]UploadEmployee   // per NIP
    Shifts               map[string]UploadShift      // per kode huruf besar
    ClosedDates          map[string]bool
    Holidays             map[string]string           // tanggal → nama libur
    OnLeave              map[string]map[string]bool  // employeeID → tanggal
    ClockedIn            map[string]map[string]bool  // employeeID → tanggal
}
type ScheduleFile struct {
    InfoBranchID, InfoFrom, InfoTo string
    HeaderLine                     int // baris Excel (1-based) judul kolom
    DateHeaders                    []string
    Rows                           []ScheduleFileRow
}
type ScheduleFileRow struct { Line int; NIP string; Cells []string }
type UploadIssue struct {
    Line    int    `json:"line"`
    Column  string `json:"column"`
    Name    string `json:"name"`
    Message string `json:"message"`
}
type ScheduleAssignment struct { EmployeeID, Date string; ShiftID *string }
type ScheduleUploadResult struct {
    Assignments []ScheduleAssignment
    Errors      []UploadIssue
    Warnings    []UploadIssue
    EmployeeIDs []string
}
func ScheduleDates(from, to string) ([]string, string)        // tanggal, pesan error ("" bila ok)
func ScheduleDateHeader(date string) string                   // "Sen 03/11"
func ReadScheduleFile(matrix, info [][]string) (ScheduleFile, string)
func ValidateScheduleUpload(c ScheduleUploadContext, f ScheduleFile) ScheduleUploadResult
```

- [ ] **Step 1: Test yang gagal (satu kasus per baris tabel error/peringatan Spec §2.6)**

```go
// backend/internal/modules/hris/domain/schedule_upload_test.go
package domain

import (
	"strings"
	"testing"
)

func uctx() ScheduleUploadContext {
	dates, _ := ScheduleDates("2026-11-02", "2026-11-08") // Sen–Min
	all := map[string]bool{}
	for _, d := range dates {
		all[d] = true
	}
	return ScheduleUploadContext{
		BranchID: "b1", BranchName: "PPJA", Dates: dates, Today: "2026-11-02",
		Employees: map[string]UploadEmployee{
			"111": {ID: "e1", NIP: "111", Name: "Ana", ScheduleType: "shift", Active: true, Placed: all},
			"222": {ID: "e2", NIP: "222", Name: "Budi", ScheduleType: "shift", Active: true, Placed: all},
			"333": {ID: "e3", NIP: "333", Name: "Cici", ScheduleType: "non_shift", Active: true, Placed: all},
			"444": {ID: "e4", NIP: "444", Name: "Dodi", ScheduleType: "shift", Active: false, Placed: all},
			"555": {ID: "e5", NIP: "555", Name: "Eka", ScheduleType: "shift", Active: true, Placed: map[string]bool{"2026-11-02": true}},
		},
		Shifts: map[string]UploadShift{
			"SPG1":  {ID: "s1", Code: "SPG1", Start: "08:00:00", End: "16:00:00", Active: true},
			"MALAM": {ID: "s2", Code: "MALAM", Start: "22:00:00", End: "06:00:00", Overnight: true, Active: true},
			"OLD":   {ID: "s3", Code: "OLD", Start: "08:00:00", End: "16:00:00", Active: false},
		},
		ClosedDates: map[string]bool{}, Holidays: map[string]string{},
		OnLeave: map[string]map[string]bool{}, ClockedIn: map[string]map[string]bool{},
	}
}

func sfile(c ScheduleUploadContext, rows ...ScheduleFileRow) ScheduleFile {
	h := make([]string, len(c.Dates))
	for i, d := range c.Dates {
		h[i] = ScheduleDateHeader(d)
	}
	return ScheduleFile{InfoBranchID: c.BranchID, InfoFrom: c.Dates[0], InfoTo: c.Dates[len(c.Dates)-1], HeaderLine: 3, DateHeaders: h, Rows: rows}
}

func row(line int, nip string, cells ...string) ScheduleFileRow {
	return ScheduleFileRow{Line: line, NIP: nip, Cells: cells}
}

func week(v string) []string { return []string{v, v, v, v, v, "L", "L"} }

func hasIssue(list []UploadIssue, substr string) bool {
	for _, i := range list {
		if strings.Contains(i.Message, substr) {
			return true
		}
	}
	return false
}

func TestScheduleDatesAndHeader(t *testing.T) {
	if _, msg := ScheduleDates("2026-11-02", "2026-11-07"); msg != "Rentang tanggal 7–45 hari" {
		t.Fatalf("6 days: %q", msg)
	}
	if _, msg := ScheduleDates("2026-11-02", "2026-12-17"); msg != "Rentang tanggal 7–45 hari" {
		t.Fatalf("46 days: %q", msg)
	}
	if d, msg := ScheduleDates("2026-11-02", "2026-12-16"); msg != "" || len(d) != 45 {
		t.Fatalf("45 days: %d %q", len(d), msg)
	}
	if ScheduleDateHeader("2026-11-03") != "Sel 03/11" {
		t.Fatalf("header %q", ScheduleDateHeader("2026-11-03"))
	}
}

func TestValidateScheduleUploadOK(t *testing.T) {
	c := uctx()
	res := ValidateScheduleUpload(c, sfile(c, row(4, "111", week("spg1")...), row(5, "222", week("SPG1")...)))
	if len(res.Errors) != 0 {
		t.Fatalf("errors %v", res.Errors)
	}
	// Both employees are off on Sat–Sun, so only "Tidak ada yang masuk" may appear.
	for _, w := range res.Warnings {
		if !strings.HasPrefix(w.Message, "Tidak ada yang masuk") {
			t.Fatalf("unexpected warning %+v", w)
		}
	}
	if len(res.Assignments) != 14 || res.Assignments[5].ShiftID != nil {
		t.Fatalf("assignments = %+v", res.Assignments)
	}
}

func TestValidateScheduleUploadErrors(t *testing.T) {
	cases := []struct {
		name string
		edit func(*ScheduleUploadContext, *ScheduleFile)
		want string
	}{
		{"template lain", func(c *ScheduleUploadContext, f *ScheduleFile) { f.InfoBranchID = "b2" }, "File ini bukan template PPJA 02/11/2026–08/11/2026"},
		{"tanpa info", func(c *ScheduleUploadContext, f *ScheduleFile) { f.InfoBranchID, f.InfoFrom, f.InfoTo = "", "", "" }, "Sheet Info tidak ditemukan"},
		{"kolom tanggal bergeser", func(c *ScheduleUploadContext, f *ScheduleFile) { f.DateHeaders[2] = "Kam 05/11" }, "Kolom tanggal tidak sesuai template"},
		{"tanggal lewat", func(c *ScheduleUploadContext, f *ScheduleFile) { c.Today = "2026-11-03" }, "Tanggal 02/11/2026 sudah lewat"},
		{"periode closing", func(c *ScheduleUploadContext, f *ScheduleFile) { c.ClosedDates["2026-11-04"] = true }, "Periode absensi 04/11/2026 sudah closing"},
		{"NIP tidak dikenal", func(c *ScheduleUploadContext, f *ScheduleFile) { f.Rows = append(f.Rows, row(6, "999", week("SPG1")...)) }, "NIP 999 tidak dikenal atau sudah nonaktif"},
		{"NIP nonaktif", func(c *ScheduleUploadContext, f *ScheduleFile) { f.Rows = append(f.Rows, row(6, "444", week("SPG1")...)) }, "NIP 444 tidak dikenal atau sudah nonaktif"},
		{"Non-Shift", func(c *ScheduleUploadContext, f *ScheduleFile) { f.Rows = append(f.Rows, row(6, "333", week("SPG1")...)) }, "Cici Non-Shift, pakai jadwal tetap"},
		{"NIP ganda", func(c *ScheduleUploadContext, f *ScheduleFile) { f.Rows = append(f.Rows, row(9, "111", week("SPG1")...)) }, "NIP 111 ganda (baris 4 & 9)"},
		{"kode salah ketik", func(c *ScheduleUploadContext, f *ScheduleFile) { f.Rows[0].Cells[0] = "SPG 1" }, "Kode 'SPG 1' tidak ada; maksud Anda SPG1?"},
		{"kode tidak ada", func(c *ScheduleUploadContext, f *ScheduleFile) { f.Rows[0].Cells[0] = "XX" }, "Kode 'XX' tidak ada di sheet Kode Shift"},
		{"shift nonaktif", func(c *ScheduleUploadContext, f *ScheduleFile) { f.Rows[0].Cells[0] = "old" }, "Shift OLD sudah nonaktif"},
		{"sel kosong", func(c *ScheduleUploadContext, f *ScheduleFile) { f.Rows[0].Cells[1] = " " }, "Isi kode shift atau L"},
		{"tidak ditempatkan", func(c *ScheduleUploadContext, f *ScheduleFile) { f.Rows = append(f.Rows, row(6, "555", week("SPG1")...)) }, "Eka tidak ditempatkan di PPJA pada 03/11/2026"},
		{"terlalu banyak baris", func(c *ScheduleUploadContext, f *ScheduleFile) {
			for i := 0; i < MaxScheduleRows; i++ {
				f.Rows = append(f.Rows, row(10+i, "111", week("SPG1")...))
			}
		}, "Maksimal 300 karyawan per file"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := uctx()
			f := sfile(c, row(4, "111", week("SPG1")...))
			tc.edit(&c, &f)
			res := ValidateScheduleUpload(c, f)
			if !hasIssue(res.Errors, tc.want) {
				t.Fatalf("want error %q, got %+v", tc.want, res.Errors)
			}
		})
	}
}

func TestValidateScheduleUploadNotPlacedDash(t *testing.T) {
	c := uctx()
	res := ValidateScheduleUpload(c, sfile(c, row(4, "555", "SPG1", "-", "-", "", "-", "-", "-")))
	if len(res.Errors) != 0 || len(res.Assignments) != 1 {
		t.Fatalf("errors %v, assignments %d (dash/empty outside placement are skipped)", res.Errors, len(res.Assignments))
	}
}

func TestValidateScheduleUploadWarnings(t *testing.T) {
	cases := []struct {
		name string
		edit func(*ScheduleUploadContext, *ScheduleFile)
		want string
	}{
		{"7 hari berturut", func(c *ScheduleUploadContext, f *ScheduleFile) {
			f.Rows[0].Cells = []string{"SPG1", "SPG1", "SPG1", "SPG1", "SPG1", "SPG1", "SPG1"}
		}, "Ana masuk 7 hari berturut-turut (02/11/2026–08/11/2026)"},
		{"overnight gap", func(c *ScheduleUploadContext, f *ScheduleFile) {
			f.Rows[0].Cells = []string{"MALAM", "SPG1", "L", "SPG1", "SPG1", "L", "L"}
		}, "Ana: jeda 2 jam antara 02/11/2026 (MALAM) dan 03/11/2026 (SPG1)"},
		{"cuti", func(c *ScheduleUploadContext, f *ScheduleFile) { c.OnLeave["e1"] = map[string]bool{"2026-11-03": true} }, "Ana cuti 03/11/2026 tapi diberi SPG1"},
		{"libur nasional", func(c *ScheduleUploadContext, f *ScheduleFile) { c.Holidays["2026-11-04"] = "Libur Uji" }, "04/11/2026 libur nasional (Libur Uji): 1 karyawan diberi shift"},
		{"tidak ada yang masuk", func(c *ScheduleUploadContext, f *ScheduleFile) {}, "Tidak ada yang masuk di PPJA 07/11/2026"},
		{"sudah clock-in", func(c *ScheduleUploadContext, f *ScheduleFile) { c.ClockedIn["e1"] = map[string]bool{"2026-11-02": true} }, "1 karyawan sudah clock-in 02/11/2026; telatnya tidak dihitung ulang"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := uctx()
			f := sfile(c, row(4, "111", week("SPG1")...))
			tc.edit(&c, &f)
			res := ValidateScheduleUpload(c, f)
			if len(res.Errors) != 0 {
				t.Fatalf("unexpected errors %+v", res.Errors)
			}
			if !hasIssue(res.Warnings, tc.want) {
				t.Fatalf("want warning %q, got %+v", tc.want, res.Warnings)
			}
		})
	}
}

func TestReadScheduleFile(t *testing.T) {
	matrix := [][]string{
		{"Jadwal Kerja — PPJA — 02/11/2026 s/d 08/11/2026"},
		{"Isi dengan kode shift"},
		{"NIP", "Nama Karyawan", "Jabatan", "Sen 02/11", "Sel 03/11", "Hari Masuk", "Hari Libur"},
		{"111", "Ana", "Kasir", "SPG1", "L", "", ""},
		{"", "", "", "", "", "", ""},
	}
	info := [][]string{{"Cabang ID", "b1"}, {"Dari", "2026-11-02"}, {"Sampai", "2026-11-03"}}
	f, msg := ReadScheduleFile(matrix, info)
	if msg != "" || f.HeaderLine != 3 || len(f.DateHeaders) != 2 || len(f.Rows) != 1 || f.Rows[0].Line != 4 || f.InfoBranchID != "b1" {
		t.Fatalf("file = %+v msg %q", f, msg)
	}
	if _, msg := ReadScheduleFile([][]string{{"Nama"}}, info); msg != "Judul kolom NIP tidak ditemukan — pakai template dari halaman Jadwal Kerja" {
		t.Fatalf("msg %q", msg)
	}
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && go test ./internal/modules/hris/domain -run 'Schedule' -count=1`
Expected: FAIL (`undefined: ScheduleUploadContext`)

- [ ] **Step 3: Implementasi**

```go
// backend/internal/modules/hris/domain/schedule_upload.go
package domain

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// Bulk upload Jadwal Kerja (Spec 2026-10-19 §2.5–2.6): read the template
// grid, check it, and turn valid cells into per-date assignments.

const (
	ScheduleOff       = "L"
	ScheduleNotPlaced = "-"
	MaxScheduleRows   = 300
	minScheduleDays   = 7
	maxScheduleDays   = 45
	minShiftGapMin    = 8 * 60
	maxStreak         = 6
)

type UploadEmployee struct {
	ID, NIP, Name, Position, ScheduleType string
	Active                                bool
	Placed                                map[string]bool
}

type UploadShift struct {
	ID, Code, Name, Start, End string
	Overnight, Active          bool
}

type ScheduleUploadContext struct {
	BranchID, BranchName string
	Dates                []string
	Today                string
	Employees            map[string]UploadEmployee
	Shifts               map[string]UploadShift
	ClosedDates          map[string]bool
	Holidays             map[string]string
	OnLeave              map[string]map[string]bool
	ClockedIn            map[string]map[string]bool
}

type ScheduleFile struct {
	InfoBranchID, InfoFrom, InfoTo string
	HeaderLine                     int
	DateHeaders                    []string
	Rows                           []ScheduleFileRow
}

type ScheduleFileRow struct {
	Line  int
	NIP   string
	Cells []string
}

type UploadIssue struct {
	Line    int    `json:"line"`
	Column  string `json:"column"`
	Name    string `json:"name"`
	Message string `json:"message"`
}

type ScheduleAssignment struct {
	EmployeeID, Date string
	ShiftID          *string
}

type ScheduleUploadResult struct {
	Assignments []ScheduleAssignment
	Errors      []UploadIssue
	Warnings    []UploadIssue
	EmployeeIDs []string
}

var dayShort = [...]string{"Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"}

func ScheduleDates(from, to string) ([]string, string) {
	a, err1 := time.Parse(DateLayout, from)
	b, err2 := time.Parse(DateLayout, to)
	if err1 != nil || err2 != nil || b.Before(a) {
		return nil, "Tanggal mulai dan selesai wajib diisi dengan benar"
	}
	n := int(b.Sub(a).Hours()/24) + 1
	if n < minScheduleDays || n > maxScheduleDays {
		return nil, "Rentang tanggal 7–45 hari"
	}
	out := make([]string, n)
	for i := range out {
		out[i] = a.AddDate(0, 0, i).Format(DateLayout)
	}
	return out, ""
}

func ScheduleDateHeader(date string) string {
	t, err := time.Parse(DateLayout, date)
	if err != nil {
		return date
	}
	return dayShort[t.Weekday()] + " " + t.Format("02/01")
}

// ReadScheduleFile finds the header row (first cell "NIP"), the date
// columns up to "Hari Masuk", and the non-blank rows below it.
func ReadScheduleFile(matrix, info [][]string) (ScheduleFile, string) {
	var f ScheduleFile
	for _, kv := range info {
		if len(kv) < 2 {
			continue
		}
		switch NormalizeHeader(kv[0]) {
		case "cabang id":
			f.InfoBranchID = strings.TrimSpace(kv[1])
		case "dari":
			f.InfoFrom, _ = ParseDateCell(kv[1])
		case "sampai":
			f.InfoTo, _ = ParseDateCell(kv[1])
		}
	}
	header := -1
	for i, r := range matrix {
		if len(r) > 0 && NormalizeHeader(r[0]) == "nip" {
			header = i
			break
		}
	}
	if header < 0 {
		return f, "Judul kolom NIP tidak ditemukan — pakai template dari halaman Jadwal Kerja"
	}
	f.HeaderLine = header + 1
	cols := matrix[header]
	if len(cols) < 4 {
		return f, "Kolom tanggal tidak ditemukan — pakai template dari halaman Jadwal Kerja"
	}
	for _, h := range cols[3:] {
		n := NormalizeHeader(h)
		if n == "" || n == "hari masuk" || n == "hari libur" {
			break
		}
		f.DateHeaders = append(f.DateHeaders, strings.TrimSpace(h))
	}
	for i := header + 1; i < len(matrix); i++ {
		r := matrix[i]
		nip := ""
		if len(r) > 0 {
			nip = r[0]
		}
		cells := make([]string, len(f.DateHeaders))
		blank := strings.TrimSpace(nip) == ""
		for j := range cells {
			if 3+j < len(r) {
				cells[j] = strings.TrimSpace(r[3+j])
				blank = blank && cells[j] == ""
			}
		}
		if blank {
			continue
		}
		f.Rows = append(f.Rows, ScheduleFileRow{Line: i + 1, NIP: nip, Cells: cells})
	}
	return f, ""
}

func clockMinutes(hms string) int {
	var h, m int
	fmt.Sscanf(hms, "%d:%d", &h, &m)
	return h*60 + m
}

func ValidateScheduleUpload(c ScheduleUploadContext, f ScheduleFile) ScheduleUploadResult {
	var res ScheduleUploadResult
	fail := func(line int, col, name, msg string) {
		res.Errors = append(res.Errors, UploadIssue{line, col, name, msg})
	}
	warn := func(line int, col, name, msg string) {
		res.Warnings = append(res.Warnings, UploadIssue{line, col, name, msg})
	}
	from, to := c.Dates[0], c.Dates[len(c.Dates)-1]
	switch {
	case f.InfoBranchID == "" && f.InfoFrom == "" && f.InfoTo == "":
		fail(0, "", "", "Sheet Info tidak ditemukan — pakai template xlsx yang diunduh dari halaman Jadwal Kerja")
		return res
	case f.InfoBranchID != c.BranchID || f.InfoFrom != from || f.InfoTo != to:
		fail(0, "", "", fmt.Sprintf("File ini bukan template %s %s–%s. Unduh template baru dari halaman Jadwal Kerja.",
			c.BranchName, FormatDateID(from), FormatDateID(to)))
		return res
	}
	if len(f.DateHeaders) != len(c.Dates) {
		fail(f.HeaderLine, "", "", fmt.Sprintf("Kolom tanggal tidak sesuai template (%d kolom, seharusnya %d)", len(f.DateHeaders), len(c.Dates)))
		return res
	}
	for i, d := range c.Dates {
		if want := ScheduleDateHeader(d); f.DateHeaders[i] != want {
			fail(f.HeaderLine, f.DateHeaders[i], "", fmt.Sprintf("Kolom tanggal tidak sesuai template ('%s', seharusnya '%s')", f.DateHeaders[i], want))
			return res
		}
	}
	for _, d := range c.Dates {
		if d < c.Today {
			fail(f.HeaderLine, ScheduleDateHeader(d), "", "Tanggal "+FormatDateID(d)+" sudah lewat")
		} else if c.ClosedDates[d] {
			fail(f.HeaderLine, ScheduleDateHeader(d), "", "Periode absensi "+FormatDateID(d)+" sudah closing")
		}
	}
	if len(f.Rows) > MaxScheduleRows {
		fail(0, "", "", fmt.Sprintf("Maksimal %d karyawan per file", MaxScheduleRows))
		return res
	}

	type parsed struct {
		emp   UploadEmployee
		line  int
		cells []*UploadShift // nil = libur / tidak dijadwalkan
		set   []bool         // sel menghasilkan penugasan
	}
	seen := map[string]int{}
	var valid []parsed
	working := map[string]int{}
	for _, r := range f.Rows {
		nip, msg := CleanNIP(r.NIP)
		if msg != "" {
			fail(r.Line, "NIP", "", msg)
			continue
		}
		if first, dup := seen[nip]; dup {
			fail(r.Line, "NIP", "", fmt.Sprintf("NIP %s ganda (baris %d & %d)", nip, first, r.Line))
			continue
		}
		seen[nip] = r.Line
		e, ok := c.Employees[nip]
		if !ok || !e.Active {
			fail(r.Line, "NIP", "", "NIP "+nip+" tidak dikenal atau sudah nonaktif")
			continue
		}
		if e.ScheduleType != "shift" {
			fail(r.Line, "NIP", e.Name, e.Name+" Non-Shift, pakai jadwal tetap")
			continue
		}
		p := parsed{emp: e, line: r.Line, cells: make([]*UploadShift, len(c.Dates)), set: make([]bool, len(c.Dates))}
		rowOK := true
		for i, d := range c.Dates {
			col := ScheduleDateHeader(d)
			raw := strings.TrimSpace(r.Cells[i])
			code := strings.ToUpper(raw)
			if !e.Placed[d] {
				if code == "" || code == ScheduleNotPlaced {
					continue
				}
				fail(r.Line, col, e.Name, fmt.Sprintf("%s tidak ditempatkan di %s pada %s", e.Name, c.BranchName, FormatDateID(d)))
				rowOK = false
				continue
			}
			switch {
			case code == "":
				fail(r.Line, col, e.Name, "Isi kode shift atau L")
				rowOK = false
			case code == ScheduleOff || code == "OFF":
				p.set[i] = true
			default:
				s, known := c.Shifts[code]
				if !known {
					if alt, ok := c.Shifts[strings.ReplaceAll(code, " ", "")]; ok {
						fail(r.Line, col, e.Name, fmt.Sprintf("Kode '%s' tidak ada; maksud Anda %s?", raw, alt.Code))
					} else {
						fail(r.Line, col, e.Name, fmt.Sprintf("Kode '%s' tidak ada di sheet Kode Shift", raw))
					}
					rowOK = false
					continue
				}
				if !s.Active {
					fail(r.Line, col, e.Name, "Shift "+s.Code+" sudah nonaktif")
					rowOK = false
					continue
				}
				sc := s
				p.cells[i], p.set[i] = &sc, true
				working[d]++
			}
		}
		if rowOK {
			valid = append(valid, p)
		}
	}
	for _, p := range valid {
		res.EmployeeIDs = append(res.EmployeeIDs, p.emp.ID)
		run := 0 // working days in the current streak
		for i, d := range c.Dates {
			if !p.set[i] {
				run = 0
				continue
			}
			s := p.cells[i]
			var shiftID *string
			if s != nil {
				id := s.ID
				shiftID = &id
				run++
				if c.OnLeave[p.emp.ID][d] {
					warn(p.line, ScheduleDateHeader(d), p.emp.Name, fmt.Sprintf("%s cuti %s tapi diberi %s", p.emp.Name, FormatDateID(d), s.Code))
				}
				if i+1 < len(c.Dates) && p.cells[i+1] != nil {
					next := p.cells[i+1]
					end := clockMinutes(s.End)
					if s.Overnight || end <= clockMinutes(s.Start) {
						end += 24 * 60
					}
					if gap := 24*60 + clockMinutes(next.Start) - end; gap < minShiftGapMin {
						warn(p.line, ScheduleDateHeader(c.Dates[i+1]), p.emp.Name, fmt.Sprintf("%s: jeda %d jam antara %s (%s) dan %s (%s)",
							p.emp.Name, gap/60, FormatDateID(d), s.Code, FormatDateID(c.Dates[i+1]), next.Code))
					}
				}
			} else {
				run = 0
			}
			// One warning per streak longer than 6, naming the whole streak.
			lastOfRun := s != nil && (i+1 == len(c.Dates) || p.cells[i+1] == nil)
			if lastOfRun && run > maxStreak {
				warn(p.line, "", p.emp.Name, fmt.Sprintf("%s masuk %d hari berturut-turut (%s–%s)", p.emp.Name, run,
					FormatDateID(c.Dates[i-run+1]), FormatDateID(d)))
			}
			res.Assignments = append(res.Assignments, ScheduleAssignment{EmployeeID: p.emp.ID, Date: d, ShiftID: shiftID})
		}
	}
	for _, d := range c.Dates {
		if name, ok := c.Holidays[d]; ok && working[d] > 0 {
			warn(f.HeaderLine, ScheduleDateHeader(d), "", fmt.Sprintf("%s libur nasional (%s): %d karyawan diberi shift", FormatDateID(d), name, working[d]))
		}
		if len(valid) > 0 && working[d] == 0 {
			warn(f.HeaderLine, ScheduleDateHeader(d), "", fmt.Sprintf("Tidak ada yang masuk di %s %s", c.BranchName, FormatDateID(d)))
		}
		if d == c.Today {
			n := 0
			for _, p := range valid {
				if c.ClockedIn[p.emp.ID][d] {
					n++
				}
			}
			if n > 0 {
				warn(f.HeaderLine, ScheduleDateHeader(d), "", fmt.Sprintf("%d karyawan sudah clock-in %s; telatnya tidak dihitung ulang", n, FormatDateID(d)))
			}
		}
	}
	sort.SliceStable(res.Errors, func(i, j int) bool { return res.Errors[i].Line < res.Errors[j].Line })
	sort.SliceStable(res.Warnings, func(i, j int) bool { return res.Warnings[i].Line < res.Warnings[j].Line })
	return res
}
```

- [ ] **Step 4: Jalankan test**

Run: `cd backend && go test ./internal/modules/hris/domain -count=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/modules/hris/domain/schedule_upload.go backend/internal/modules/hris/domain/schedule_upload_test.go
git commit -m "feat(hris): validasi file upload Jadwal Kerja (error & peringatan)"
```

---

### Task 11: Endpoint Jadwal Kerja (grid, template, upload preview/commit, file error)

**Files:**
- Create: `backend/internal/modules/hris/schedule_days.go`
- Create: `backend/internal/modules/hris/import_errors.go` (pembuat file error bersama, dipakai juga di Task 16)
- Modify: `backend/internal/modules/hris/routes.go`
- Test: `backend/internal/modules/hris/schedule_days_integration_test.go`

**Interfaces:**
- Consumes: Task 1 (tabel/view), Task 2 (`xlsx.BuildTemplate`), Task 10 (domain), `periodContaining` (`attendance_periods.go:208`), `writeEmployeeAudit` (Task 5).
- Produces:
  - `GET /api/hris/schedules?branch_id&from&to` →
    ```
    {data:{
      branch:{id,name,code},
      dates:[{date,label,holiday}],
      employees:[{id,nip,name,position,cells:[{date,code,source}]}],
      non_shift_count,
      shifts:[{code,name,start_time,end_time}]
    }}
    ```
    Nilai `code`: kode shift, `"L"` (libur), `"-"` (tidak ditempatkan), atau `""` (belum ada jadwal). Nilai `source`: `day`, `weekly`, atau `none`.
  - `GET /api/hris/schedules/template?branch_id&from&to` → xlsx `Jadwal Kerja - {kode cabang} - {dd-mm} sd {dd-mm-yyyy}.xlsx`
  - `POST /api/hris/schedules/import` multipart `file, branch_id, from, to, step=preview|commit|error_file, fingerprint, ack_warnings`:
    - `preview` → `{data:{summary:{employees,new,changed,same}, errors, warnings, fingerprint, changes:[{nip,name,date,before,after}]}}`
    - `commit` → `{data:{summary}, message}`
    - `error_file` → xlsx (file asli + kolom "Keterangan Error")
  - Go: `func errorWorkbook(matrix [][]string, headerRow int, issues []domain.UploadIssue, sheet string) ([]byte, error)`
- Semua route dijaga `h.withMenu(kepegawaian, …)`.

- [ ] **Step 1: Test integrasi yang gagal**

```go
// backend/internal/modules/hris/schedule_days_integration_test.go
package hris

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xuri/excelize/v2"

	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/testutil"
)

// fixedNow = Senin 2026-10-05 → rentang uji 2026-10-05..2026-10-11.

func scheduleFixture(h *harness) (branch, shiftEmp, other string) {
	branch = h.scalar(`INSERT INTO configuration.branches (company_id, name, code)
		SELECT id, 'Cabang Uji', 'CU'||substr(md5(random()::text),1,4) FROM configuration.companies LIMIT 1 RETURNING id::text`)
	branch2 := h.scalar(`INSERT INTO configuration.branches (company_id, name, code)
		SELECT id, 'Cabang Dua', 'CD'||substr(md5(random()::text),1,4) FROM configuration.companies LIMIT 1 RETURNING id::text`)
	shiftEmp = h.employee(emp{name: "Ana Shift"})
	other = h.employee(emp{name: "Budi Tambahan"})
	ns := h.employee(emp{name: "Cici Kantor"})
	h.exec(`UPDATE hris.employees SET schedule_type = 'non_shift' WHERE id = $1`, ns)
	h.exec(`INSERT INTO hris.employee_placements (employee_id, branch_id, is_primary, start_date) VALUES
		($1, $4, true, '2026-01-01'),
		($2, $5, true, '2026-01-01'), ($2, $4, false, '2026-10-08'),
		($3, $4, true, '2026-01-01')`, shiftEmp, other, ns, branch, branch2)
	return
}

func upload(t *testing.T, h *harness, hr *testutil.Staff, fields map[string]string, file []byte) call {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	fw, _ := w.CreateFormFile("file", "jadwal.xlsx")
	_, _ = fw.Write(file)
	_ = w.Close()
	r := httptest.NewRequest(http.MethodPost, "/api/hris/schedules/import", &body)
	r.Header.Set("Content-Type", w.FormDataContentType())
	r = testutil.AsStaff(r, *hr)
	h.exec("SAVEPOINT harness_request")
	rec, out := testutil.Do(t, h.mux, r)
	h.exec("RELEASE SAVEPOINT harness_request")
	return call{rec.Code, out, rec.Body.String()}
}

func TestScheduleTemplateIncludesSecondaryPlacement(t *testing.T) {
	h := newHarness(t)
	hr, _ := h.staff("hrd", iam.HrisKepegawaian, false)
	branch, _, _ := scheduleFixture(h)
	grid := h.do(&hr, http.MethodGet, "/api/hris/schedules?branch_id="+branch+"&from=2026-10-05&to=2026-10-11", nil)
	expect(t, grid, http.StatusOK, "")
	emps := grid.data()["employees"].([]any)
	if len(emps) != 2 || grid.data()["non_shift_count"] != float64(1) {
		t.Fatalf("employees %d non_shift %v (want Ana + Budi, Cici excluded)", len(emps), grid.data()["non_shift_count"])
	}
	for _, e := range emps {
		m := e.(map[string]any)
		if m["name"] == "Budi Tambahan" {
			cells := m["cells"].([]any)
			if cells[0].(map[string]any)["code"] != "-" || cells[3].(map[string]any)["code"] != "" {
				t.Fatalf("Budi cells = %v (not placed until 10-08)", cells)
			}
		}
	}
}

func TestScheduleUploadPreviewCommit(t *testing.T) {
	h := newHarness(t)
	hr, _ := h.staff("hrd", iam.HrisKepegawaian, false)
	branch, ana, _ := scheduleFixture(h)
	params := "?branch_id=" + branch + "&from=2026-10-05&to=2026-10-11"
	r := testutil.AsStaff(httptest.NewRequest(http.MethodGet, "/api/hris/schedules/template"+params, nil), hr)
	rec := httptest.NewRecorder()
	h.exec("SAVEPOINT harness_request")
	h.mux.ServeHTTP(rec, r)
	h.exec("RELEASE SAVEPOINT harness_request")
	if rec.Code != http.StatusOK {
		t.Fatalf("template status %d %s", rec.Code, rec.Body.String())
	}
	f, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if v, _ := f.GetCellValue("Jadwal", "D3"); v != "Sen 05/10" {
		t.Fatalf("D3 = %q", v)
	}
	// Ana: SPG? → pakai DEF Sen–Jum, L Sab–Min. Budi: '-' sampai 07/10 lalu DEF.
	// Data mulai baris Excel 4 (2 baris judul + header). Sen–Jum DEF, Sab–Min L; sel "-" dibiarkan.
	rows, _ := f.GetRows("Jadwal")
	for i := 3; i < len(rows); i++ {
		for j, v := range []string{"DEF", "DEF", "DEF", "DEF", "DEF", "L", "L"} {
			cell, _ := excelize.CoordinatesToCellName(4+j, i+1)
			if cur, _ := f.GetCellValue("Jadwal", cell); cur != "-" {
				_ = f.SetCellStr("Jadwal", cell, v)
			}
		}
	}
	var buf bytes.Buffer
	_ = f.Write(&buf)
	file := buf.Bytes()

	pre := upload(t, h, &hr, map[string]string{"branch_id": branch, "from": "2026-10-05", "to": "2026-10-11", "step": "preview"}, file)
	expect(t, pre, http.StatusOK, "")
	if errs := pre.data()["errors"].([]any); len(errs) != 0 {
		t.Fatalf("errors %v", errs)
	}
	fp := pre.data()["fingerprint"].(string)
	noAck := upload(t, h, &hr, map[string]string{"branch_id": branch, "from": "2026-10-05", "to": "2026-10-11", "step": "commit", "fingerprint": fp}, file)
	expect(t, noAck, http.StatusBadRequest, "Centang \"Saya sudah memeriksa peringatan\" sebelum menyimpan")
	ok := upload(t, h, &hr, map[string]string{"branch_id": branch, "from": "2026-10-05", "to": "2026-10-11", "step": "commit", "fingerprint": fp, "ack_warnings": "true"}, file)
	expect(t, ok, http.StatusOK, "")
	if h.scalar(`SELECT count(*)::text FROM hris.employee_shift_days WHERE employee_id = $1`, ana) != "7" {
		t.Fatal("Ana must have 7 per-date rows")
	}
	stale := upload(t, h, &hr, map[string]string{"branch_id": branch, "from": "2026-10-05", "to": "2026-10-11", "step": "commit", "fingerprint": fp, "ack_warnings": "true"}, file)
	expect(t, stale, http.StatusConflict, "Jadwal sudah diubah orang lain sejak preview — unggah ulang file")
	if h.scalar(`SELECT count(*)::text FROM audit.audit_log WHERE action = 'schedule.bulk_upload'`) == "0" {
		t.Fatal("audit missing")
	}
}
```

> Peringatan "Tidak ada yang masuk" Sabtu–Minggu memastikan jalur `ack_warnings` teruji. Kalau INSERT `configuration.branches` di fixture gagal karena kolom wajib lain, ikuti fixture cabang di `placements_integration_test.go`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run 'TestScheduleTemplate|TestScheduleUpload' -count=1`
Expected: FAIL (404)

- [ ] **Step 3: Pembuat file error bersama**

```go
// backend/internal/modules/hris/import_errors.go
package hris

import (
	"strings"

	"nuhabit/backend/internal/modules/hris/domain"
	"nuhabit/backend/internal/platform/xlsx"
)

// errorWorkbook is the uploaded sheet with a "Keterangan Error" column on
// the right (Spec §3.1): every message of a row joined, the header kept.
func errorWorkbook(matrix [][]string, headerRow int, issues []domain.UploadIssue, sheet string) ([]byte, error) {
	byLine := map[int][]string{}
	var general []string
	for _, i := range issues {
		msg := i.Message
		if i.Column != "" {
			msg = i.Column + ": " + msg
		}
		if i.Line == 0 {
			general = append(general, msg)
			continue
		}
		byLine[i.Line] = append(byLine[i.Line], msg)
	}
	width := 0
	for _, r := range matrix {
		width = max(width, len(r))
	}
	rows := make([][]any, 0, len(matrix)+1)
	if len(general) > 0 {
		rows = append(rows, []any{"Catatan: " + strings.Join(general, "; ")})
	}
	for i, r := range matrix {
		out := make([]any, width+1)
		for j, v := range r {
			out[j] = v
		}
		switch {
		case i == headerRow:
			out[width] = "Keterangan Error"
		default:
			out[width] = strings.Join(byLine[i+1], "; ")
		}
		rows = append(rows, out)
	}
	widths := make([]float64, width+1)
	widths[width] = 60
	return xlsx.Build(xlsx.SheetSpec{Name: sheet, Rows: rows, ColumnWidths: widths})
}
```

- [ ] **Step 4: Service & handler jadwal**

Buat `backend/internal/modules/hris/schedule_days.go`. Isinya bagian-bagian berikut, masing-masing satu fungsi.

```go
package hris

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/hris/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/xlsx"
)

type scheduleBranch struct{ ID, Name, Code string }

type scheduleRange struct {
	Branch scheduleBranch
	Dates  []string
}

// parseScheduleRange reads branch_id/from/to (query or form) and checks the
// 7–45 day range; the branch must exist.
func (s *Service) parseScheduleRange(ctx context.Context, q database.Querier, branchID, from, to string) (*scheduleRange, error) {
	dates, msg := domain.ScheduleDates(from, to)
	if msg != "" {
		return nil, httpx.BadRequest(msg)
	}
	var b scheduleBranch
	err := q.QueryRow(ctx, `SELECT id::text, name, coalesce(code, '') FROM configuration.branches WHERE id = $1::text::uuid`, branchID).
		Scan(&b.ID, &b.Name, &b.Code)
	if database.IsNoRows(err) || (err != nil && strings.Contains(err.Error(), "22P02")) {
		return nil, httpx.BadRequest("Cabang tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	return &scheduleRange{Branch: b, Dates: dates}, nil
}

type gridEmployee struct {
	ID, NIP, Name, Position, ScheduleType string
	Active                                bool
	Placed                                map[string]bool
}

// branchEmployees: everyone (any status/type) with a placement at the
// branch overlapping the range, with the dates they are placed there.
func branchEmployees(ctx context.Context, q database.Querier, branchID string, dates []string) ([]gridEmployee, error) {
	rows, err := q.Query(ctx, `SELECT e.id::text, e.nip, e.full_name, coalesce(p2.title, ''), e.schedule_type, e.is_active,
		  p.start_date::text, coalesce(p.end_date::text, '')
		FROM hris.employee_placements p
		JOIN hris.employees e ON e.id = p.employee_id
		LEFT JOIN hris.positions p2 ON p2.id = e.job_title_id
		WHERE p.branch_id = $1::uuid AND p.start_date <= $3::date AND (p.end_date IS NULL OR p.end_date >= $2::date)
		ORDER BY coalesce(p2.title, ''), e.full_name`, branchID, dates[0], dates[len(dates)-1])
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byID := map[string]*gridEmployee{}
	var order []string
	for rows.Next() {
		var g gridEmployee
		var start, end string
		if err := rows.Scan(&g.ID, &g.NIP, &g.Name, &g.Position, &g.ScheduleType, &g.Active, &start, &end); err != nil {
			return nil, err
		}
		cur, ok := byID[g.ID]
		if !ok {
			g.Placed = map[string]bool{}
			cur = &g
			byID[g.ID] = cur
			order = append(order, g.ID)
		}
		for _, d := range dates {
			if d >= start && (end == "" || d <= end) {
				cur.Placed[d] = true
			}
		}
	}
	out := make([]gridEmployee, 0, len(order))
	for _, id := range order {
		out = append(out, *byID[id])
	}
	return out, rows.Err()
}

type resolvedCell struct {
	Date   string `json:"date"`
	Code   string `json:"code"`   // kode, "L", "-" atau ""
	Source string `json:"source"` // day | weekly | none
}

// resolveCells resolves each date through hris.v_employee_schedule with the
// same rule as clock-in (domain.ResolveScheduleRow).
func resolveCells(ctx context.Context, q database.Querier, e gridEmployee, dates []string) ([]resolvedCell, error) {
	rows, err := q.Query(ctx, `SELECT es.day_of_week, es.shift_id::text, es.effective_from::text, es.effective_to::text,
		es.priority, coalesce(s.code, '') FROM hris.v_employee_schedule es
		LEFT JOIN hris.shifts s ON s.id = es.shift_id WHERE es.employee_id = $1 ORDER BY es.priority`, e.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pattern []domain.ScheduleRow
	var codes []string
	var prio []int
	for rows.Next() {
		var r domain.ScheduleRow
		var p int
		var code string
		if err := rows.Scan(&r.DayOfWeek, &r.ShiftID, &r.EffectiveFrom, &r.EffectiveTo, &p, &code); err != nil {
			return nil, err
		}
		pattern, codes, prio = append(pattern, r), append(codes, code), append(prio, p)
	}
	out := make([]resolvedCell, len(dates))
	for i, d := range dates {
		c := resolvedCell{Date: d, Source: "none"}
		switch idx := domain.ResolveScheduleRow(pattern, d); {
		case !e.Placed[d]:
			c.Code = domain.ScheduleNotPlaced
		case idx < 0:
		case pattern[idx].ShiftID == nil:
			c.Code, c.Source = domain.ScheduleOff, sourceOf(prio[idx])
		default:
			c.Code, c.Source = codes[idx], sourceOf(prio[idx])
		}
		out[i] = c
	}
	return out, rows.Err()
}

func sourceOf(priority int) string {
	if priority == 0 {
		return "day"
	}
	return "weekly"
}
```

Lanjutkan di file yang sama:

1. **`ScheduleGrid(ctx, branchID, from, to)`**
   - panggil `parseScheduleRange` → `branchEmployees`;
   - ambil karyawan `Active && ScheduleType == "shift"`, hitung yang `non_shift` aktif untuk `non_shift_count`;
   - `resolveCells` untuk tiap karyawan;
   - ambil libur dengan `SELECT holiday_date::text, name FROM hris.public_holidays WHERE deleted_at IS NULL AND status = 'aktif' AND holiday_date BETWEEN $1 AND $2`;
   - ambil shift aktif `SELECT code, name, start_time::text, end_time::text FROM hris.shifts WHERE is_active ORDER BY sort_order, code`;
   - kembalikan struktur JSON di bagian Interfaces.

2. **`ScheduleTemplate(ctx, branchID, from, to)`** membangun `xlsx.BuildTemplate` dengan:
   - **notes** `Petunjuk`: baris teks langkah 1–4 (unduh → isi kode/L → simpan → unggah), daftar error & peringatan dalam bahasa sederhana (salin kalimat dari tabel Spec §2.6), dan contoh satu baris `202505272 | Feti | Kasir | SPG1 | SPG1 | L | …`.
   - **sheet `Jadwal`**:
     - `TitleLines`: `Jadwal Kerja — {Cabang} — {dd/mm/yyyy} s/d {dd/mm/yyyy}` dan `Isi dengan kode shift (lihat sheet Kode Shift). L = Libur. Tanda - = tidak ditempatkan di cabang ini (biarkan).`;
     - kolom `NIP`, `Nama Karyawan`, `Jabatan` dengan `ReadOnly: true` (`KindText`);
     - satu kolom per tanggal: `Header: domain.ScheduleDateHeader(d)`, `Kind: KindList`, `Options: kode aktif + "L" + "-"`, `Fill: "#FDECEC"` bila Minggu atau libur nasional;
     - `Hari Masuk` (`KindFormula`: `COUNTA(D{r}:{last}{r})-COUNTIF(D{r}:{last}{r},"L")-COUNTIF(D{r}:{last}{r},"-")`) dan `Hari Libur` (`COUNTIF(…,"L")`);
     - `FreezeCols: 3`, `Protect: true`, `CellFill: {"L": "#E5E7EB", "-": "#F3F4F6"}`;
     - baris = karyawan Shift aktif dari `branchEmployees`, sel = `resolveCells`, dengan `""` diganti `"DEF"` untuk tanggal yang ditempatkan.
   - **sheet `Kode Shift`** (`Protect: true`, semua kolom `ReadOnly`): Kode, Nama Shift, Jam Masuk, Jam Pulang, Istirahat (menit); ditambah baris `L | Libur` dan `- | Tidak ditempatkan di cabang ini`.
   - **info** `Info`: `Cabang ID`, `Dari`, `Sampai`, `Diunduh` (`time.Now` WIB).
   - **Nama file** `Jadwal Kerja - {code} - {dd-mm} sd {dd-mm-yyyy}.xlsx`. Handler mengirim `Content-Type: xlsx.ContentType` dan `Content-Disposition: attachment; filename*=UTF-8''…` (lihat cara `attendance_export.go` mengirim file).

3. **`uploadContext(ctx, q, rng, today, nips)`** mengisi `domain.ScheduleUploadContext`:
   - `Employees` dari `branchEmployees`, ditambah karyawan dengan NIP di file yang tidak ditempatkan di cabang (query `SELECT id, nip, full_name, schedule_type, is_active FROM hris.employees WHERE nip = ANY($1)`, `Placed` kosong);
   - `Shifts` dari semua `hris.shifts` dengan key `upper(code)`;
   - `ClosedDates`: untuk tiap tanggal, `p, err := periodContaining(ctx, q, d, today)`; bila `p.Closed()`;
   - `Holidays`: query di atas;
   - `OnLeave`: `SELECT employee_id, generate_series(greatest(start_date,$1), least(end_date,$2), '1 day')::date::text FROM hris.leaves WHERE status = 'approved' AND start_date <= $2 AND end_date >= $1`;
   - `ClockedIn`: `SELECT employee_id, date::text FROM hris.attendance WHERE date = $1` (hari ini).

4. **`fingerprint(ctx, q, employeeIDs, from, to)`**:
   ```sql
   SELECT coalesce(md5(string_agg(employee_id::text || work_date::text || coalesce(shift_id::text, 'L'), ',' ORDER BY employee_id, work_date)), '')
   FROM hris.employee_shift_days
   WHERE employee_id = ANY($1::uuid[]) AND work_date BETWEEN $2 AND $3
   ```

5. **`ImportSchedule(ctx, actor, rng, data, step, fp, ack)`**:
   - baca `matrix, _ := xlsx.ParseMatrix(data, xlsx.ReadOptions{PreferSheet: "Jadwal"})` dan `info, _ := xlsx.ParseMatrix(data, xlsx.ReadOptions{PreferSheet: "Info"})`. Bila sheet pertama info bukan `Cabang ID`, pakai `info = nil`;
   - `domain.ReadScheduleFile` → pesan menjadi `httpx.BadRequest`;
   - jalankan dalam `s.repo.InTx`: `uploadContext` → `domain.ValidateScheduleUpload`;
   - **ringkasan**: bandingkan `Assignments` dengan `resolveCells` saat ini per karyawan. `new` = sel yang sebelumnya `""`; `changed` = berbeda; `same` = sama. `changes` berisi maksimal 500 baris `{nip, name, date, before, after}` (kode, `L`, atau kosong);
   - **`step=preview`**: kembalikan ringkasan + errors + warnings + `fingerprint(EmployeeIDs)`;
   - **`step=error_file`**: `errorWorkbook(matrix, HeaderLine-1, append(errors, warnings...), "Jadwal")`;
   - **`step=commit`**, berurutan:
     - error > 0 → 400 `"File masih punya error — perbaiki lalu unggah ulang"`;
     - warnings > 0 dan `!ack` → 400 `Centang "Saya sudah memeriksa peringatan" sebelum menyimpan`;
     - `fingerprint` ≠ `fp` → `httpx.Conflict("Jadwal sudah diubah orang lain sejak preview — unggah ulang file")`;
     - `DELETE FROM hris.employee_shift_days WHERE employee_id = ANY($1) AND work_date BETWEEN $2 AND $3`;
     - insert semua assignment dengan satu `batch_id` dari `SELECT gen_random_uuid()::text` (paket `google/uuid` tidak ada di go.mod), `branch_id`, dan `created_by_name = actor.FullName`. Pakai `pgx.CopyFrom` bila querier mendukung; kalau tidak, INSERT per baris;
     - satu baris audit per karyawan: `writeEmployeeAudit(ctx, q, actor, "schedule.bulk_upload", id, name, nil, map[string]any{"branch": rng.Branch.Name, "from": from, "to": to, "batch_id": batch, "days": n})`;
     - kembalikan ringkasan + pesan `Jadwal {N} karyawan disimpan ({dd/mm}–{dd/mm})`.

6. **Handler:**
   - `getSchedules` (query string);
   - `getScheduleTemplate`;
   - `importSchedules`: `r.ParseMultipartForm(16 << 20)`, `file, header, err := r.FormFile("file")`, tolak bila nama file tidak berakhiran `.xlsx` dengan `"Unggah file .xlsx dari template Jadwal Kerja"`, lalu `io.ReadAll`. Untuk `error_file`, tulis xlsx dengan nama `Error - {nama file asli}`.

Route di `routes.go` (blok shifts):
```go
r("GET /api/hris/schedules", h.withMenu(kepegawaian, h.getSchedules)),
r("GET /api/hris/schedules/template", h.withMenu(kepegawaian, h.getScheduleTemplate)),
r("POST /api/hris/schedules/import", h.withMenu(kepegawaian, h.importSchedules)),
```


- [ ] **Step 5: Jalankan test**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run 'TestScheduleTemplate|TestScheduleUpload|TestPerDate' -count=1 && go vet ./internal/modules/hris`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/modules/hris/schedule_days.go backend/internal/modules/hris/import_errors.go backend/internal/modules/hris/routes.go backend/internal/modules/hris/schedule_days_integration_test.go
git commit -m "feat(hris): Jadwal Kerja per cabang — grid, template xlsx, upload preview/commit"
```

---

### Task 12: Halaman Jadwal Kerja (frontend)

**Files:**
- Create:
  - `frontend/src/features/hris/schedules/api.ts`
  - `frontend/src/features/hris/schedules/queries.ts`
  - `frontend/src/features/hris/schedules/types.ts`
  - `frontend/src/features/hris/schedules/components/schedules-page.tsx`
  - `frontend/src/features/hris/schedules/components/schedule-grid.tsx`
  - `frontend/src/features/hris/schedules/components/schedule-upload-dialog.tsx`
  - `frontend/src/features/hris/schedules/components/fixed-schedule-dialog.tsx`
- Create tests: `frontend/src/features/hris/schedules/components/schedule-upload-dialog.test.tsx`, `frontend/src/features/hris/schedules/schedule-range.test.ts`
- Create: `frontend/src/features/hris/schedules/schedule-range.ts`
- Modify: `frontend/src/app/dashboard/(dashboard)/hris/schedules/page.tsx` (ganti redirect dengan halaman)

**Interfaces:**
- Consumes: endpoint Task 11 & `applyFixedSchedule` (Task 7).
- Produces:
```ts
// schedule-range.ts
export function rangeError(from: string, to: string): string | null; // "Rentang tanggal 7–45 hari" | null
export function defaultRange(today: string): { from: string; to: string }; // hari ini + 13 hari
// api.ts
export const fetchScheduleGrid: (p: { branch_id: string; from: string; to: string }) => Promise<{ data: ScheduleGrid }>;
export function scheduleTemplateUrl(p: { branch_id: string; from: string; to: string }): string;
export async function importScheduleFile(input: { file: File; branch_id: string; from: string; to: string; step: "preview" | "commit"; fingerprint?: string; ack_warnings?: boolean }): Promise<{ data: SchedulePreview; message?: string }>;
export async function downloadScheduleErrors(input: { file: File; branch_id: string; from: string; to: string }): Promise<void>;
```

- [ ] **Step 1: Test yang gagal**

```ts
// frontend/src/features/hris/schedules/schedule-range.test.ts
import { expect, it } from "vitest";
import { defaultRange, rangeError } from "./schedule-range";

it("rentang 7–45 hari", () => {
  expect(rangeError("2026-11-02", "2026-11-07")).toBe("Rentang tanggal 7–45 hari");
  expect(rangeError("2026-11-02", "2026-11-08")).toBeNull();
  expect(rangeError("2026-11-02", "2026-12-16")).toBeNull();
  expect(rangeError("2026-11-02", "2026-12-17")).toBe("Rentang tanggal 7–45 hari");
  expect(defaultRange("2026-10-21")).toEqual({ from: "2026-10-21", to: "2026-11-03" });
});
```

```tsx
// frontend/src/features/hris/schedules/components/schedule-upload-dialog.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ScheduleUploadDialog } from "./schedule-upload-dialog";

const api = vi.hoisted(() => ({
  importScheduleFile: vi.fn(),
  downloadScheduleErrors: vi.fn(),
}));
vi.mock("../api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

const range = { branch_id: "b1", from: "2026-11-02", to: "2026-11-08" };

it("menahan simpan sampai error nol dan peringatan dicentang", async () => {
  api.importScheduleFile.mockResolvedValueOnce({
    data: {
      summary: { employees: 2, new: 10, changed: 2, same: 2 },
      errors: [{ line: 5, column: "Sel 03/11", name: "Ana", message: "Kode 'SPG 1' tidak ada; maksud Anda SPG1?" }],
      warnings: [], fingerprint: "x", changes: [],
    },
  });
  render(<ScheduleUploadDialog open onOpenChange={() => {}} range={range} branchName="PPJA" onSaved={() => {}} />);
  fireEvent.change(screen.getByLabelText("File jadwal (.xlsx)"), { target: { files: [new File(["x"], "j.xlsx")] } });
  fireEvent.click(screen.getByRole("button", { name: "Periksa file" }));
  expect(await screen.findByText("Baris 5 · Sel 03/11 · Ana")).toBeTruthy();
  expect(screen.getByText("Kode 'SPG 1' tidak ada; maksud Anda SPG1?")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Simpan jadwal" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Unduh file dengan keterangan error" })).toBeTruthy();
});

it("peringatan wajib dicentang lalu menyimpan dengan fingerprint", async () => {
  api.importScheduleFile
    .mockResolvedValueOnce({ data: { summary: { employees: 1, new: 7, changed: 0, same: 0 }, errors: [],
      warnings: [{ line: 3, column: "Sab 07/11", name: "", message: "Tidak ada yang masuk di PPJA 07/11/2026" }], fingerprint: "fp1", changes: [] } })
    .mockResolvedValueOnce({ data: { summary: { employees: 1, new: 7, changed: 0, same: 0 } }, message: "Jadwal 1 karyawan disimpan" });
  const onSaved = vi.fn();
  render(<ScheduleUploadDialog open onOpenChange={() => {}} range={range} branchName="PPJA" onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText("File jadwal (.xlsx)"), { target: { files: [new File(["x"], "j.xlsx")] } });
  fireEvent.click(screen.getByRole("button", { name: "Periksa file" }));
  await screen.findByText("Tidak ada yang masuk di PPJA 07/11/2026");
  const save = screen.getByRole("button", { name: "Simpan jadwal" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Saya sudah memeriksa peringatan"));
  fireEvent.click(save);
  await waitFor(() => expect(api.importScheduleFile).toHaveBeenLastCalledWith(
    expect.objectContaining({ step: "commit", fingerprint: "fp1", ack_warnings: true })));
  expect(onSaved).toHaveBeenCalled();
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd frontend && npx vitest run src/features/hris/schedules`
Expected: FAIL (module not found)

- [ ] **Step 3: Implementasi logika & API**

```ts
// frontend/src/features/hris/schedules/schedule-range.ts
const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function rangeError(from: string, to: string): string | null {
  if (!from || !to) return "Pilih tanggal mulai dan selesai";
  const days = Math.round((parse(to) - parse(from)) / DAY) + 1;
  return days < 7 || days > 45 ? "Rentang tanggal 7–45 hari" : null;
}

export function defaultRange(today: string): { from: string; to: string } {
  return { from: today, to: iso(parse(today) + 13 * DAY) };
}
```

```ts
// frontend/src/features/hris/schedules/types.ts
export interface ScheduleCell { date: string; code: string; source: "day" | "weekly" | "none" }
export interface ScheduleGrid {
  branch: { id: string; name: string; code: string };
  dates: { date: string; label: string; holiday: string | null }[];
  employees: { id: string; nip: string; name: string; position: string; cells: ScheduleCell[] }[];
  non_shift_count: number;
  shifts: { code: string; name: string; start_time: string; end_time: string }[];
}
export interface ScheduleIssue { line: number; column: string; name: string; message: string }
export interface SchedulePreview {
  summary: { employees: number; new: number; changed: number; same: number };
  errors?: ScheduleIssue[];
  warnings?: ScheduleIssue[];
  fingerprint?: string;
  changes?: { nip: string; name: string; date: string; before: string; after: string }[];
}
```

```ts
// frontend/src/features/hris/schedules/api.ts
import { apiGet, buildListUrl } from "@/lib/api-client";
import { downloadBlob } from "@/lib/purchasing/report-ui-shared";
import type { ScheduleGrid, SchedulePreview } from "./types";

type Range = { branch_id: string; from: string; to: string };

export const fetchScheduleGrid = (p: Range) => apiGet<{ data: ScheduleGrid }>(buildListUrl("/api/hris/schedules", p));

export const scheduleTemplateUrl = (p: Range) => buildListUrl("/api/hris/schedules/template", p);

async function postImport(form: FormData): Promise<Response> {
  return fetch("/api/hris/schedules/import", { method: "POST", body: form });
}

function formOf(input: Range & { file: File; step: string; fingerprint?: string; ack_warnings?: boolean }): FormData {
  const form = new FormData();
  form.append("file", input.file);
  form.append("branch_id", input.branch_id);
  form.append("from", input.from);
  form.append("to", input.to);
  form.append("step", input.step);
  if (input.fingerprint) form.append("fingerprint", input.fingerprint);
  if (input.ack_warnings) form.append("ack_warnings", "true");
  return form;
}

export async function importScheduleFile(
  input: Range & { file: File; step: "preview" | "commit"; fingerprint?: string; ack_warnings?: boolean }
): Promise<{ data: SchedulePreview; message?: string }> {
  const res = await postImport(formOf(input));
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Upload gagal (${res.status})`);
  return json as { data: SchedulePreview; message?: string };
}

export async function downloadScheduleErrors(input: Range & { file: File }): Promise<void> {
  const res = await postImport(formOf({ ...input, step: "error_file" }));
  if (!res.ok) throw new Error(`Gagal membuat file error (${res.status})`);
  downloadBlob(await res.blob(), `Error - ${input.file.name}`);
}
```

`queries.ts` membungkus `fetchScheduleGrid` dengan `useQuery({ queryKey: ["hris","schedules",p], queryFn, enabled: !!p.branch_id && !rangeError(p.from,p.to) })`.

- [ ] **Step 4: Komponen**

**`schedule-upload-dialog.tsx`**. Props: `{ open, onOpenChange, range, branchName, onSaved }`. State: `file`, `preview`, `ack`, `busy`.
- Input file berlabel **"File jadwal (.xlsx)"** (`accept=".xlsx"`).
- Tombol **"Periksa file"** → `importScheduleFile({...range, file, step: "preview"})`.
- **Ringkasan**: "{employees} karyawan · {new} baru · {changed} berubah · {same} sama".
- **Error** dalam kotak merah, satu baris per issue: judul kecil `Baris {line} · {column} · {name}` (bagian kosong dihilangkan) dan pesannya. Bila ada error, tampilkan tombol **"Unduh file dengan keterangan error"** → `downloadScheduleErrors`.
- **Peringatan** dalam kotak kuning dengan format yang sama, ditambah checkbox berlabel **"Saya sudah memeriksa peringatan"**.
- **Tabel perubahan**: maksimal 50 baris pertama `changes` (Karyawan, Tanggal, Sebelum → Sesudah).
- Tombol **"Simpan jadwal"** disabled bila `!preview || errors.length > 0 || (warnings.length > 0 && !ack) || busy`. Saat diklik:
  - bila `summary.changed > 0`, **tampilkan konfirmasi penggantian** dulu (`ConfirmDialog`): judul "Ganti jadwal yang sudah ada?", isi "{changed} jadwal yang sudah ada akan diganti" + daftar maksimal 20 perubahan pertama `{name} · {dd/mm} · {before} → {after}`, tombol "Ya, ganti" / "Batal";
  - setelah dikonfirmasi (atau langsung bila `changed === 0`) → `importScheduleFile({...range, file, step: "commit", fingerprint: preview.fingerprint, ack_warnings: ack})` → `toast.success(message)`, `onSaved()`, tutup dialog.
- Error 409 ditampilkan sebagai toast error. `preview` direset supaya HR mengunggah ulang.

**`schedule-grid.tsx`**: tabel sticky.
- Kolom: NIP, Nama, Jabatan, lalu tanggal (judul `label`; Minggu/libur berlatar `bg-danger-soft`).
- Sel: kode; `L` abu-abu; `-` abu-abu muda; kosong ditampilkan "—" berwarna danger dengan `title="Belum ada jadwal"`.
- Sel bersumber `weekly` diberi garis bawah putus-putus dan title "Dari pola mingguan". Sel bersumber `day` tampil biasa.
- Legenda kode shift di bawah tabel (`shifts`).

**`fixed-schedule-dialog.tsx`**:
- input tanggal mulai (min hari ini) dan teks "Semua karyawan Non-Shift di {cabang} mendapat jadwal Senin–Jumat 09.00–18.00, Sabtu–Minggu libur, mulai {dd/mm/yyyy}.";
- tombol "Terapkan" → `applyFixedSchedule({ branch_id, effective_from })` dari `@/features/users/api`;
- toast memakai pesan server.

**`schedules-page.tsx`** (`"use client"`):
- **Header**: judul "Jadwal Kerja", subjudul "Atur jadwal shift per cabang untuk 7–45 hari".
- **Filter**: Combobox Cabang (data `GET /api/hris/branches`), input tanggal Dari/Sampai (default `defaultRange(todayWIB)`), dan pesan `rangeError`.
- **Tombol**:
  - "Unduh template" adalah `<a href={scheduleTemplateUrl(p)}>` dan disabled bila range invalid;
  - "Unggah jadwal" membuka upload dialog;
  - "Terapkan jadwal tetap (Non-Shift)" membuka fixed dialog dan hanya tampil bila `non_shift_count > 0`.
- **Info**: "{non_shift_count} karyawan Non-Shift di cabang ini memakai jadwal tetap", dengan tautan `/dashboard/employees?schedule_type=non_shift`.
- **Grid**; `onSaved` dari upload memanggil `refetch`.
- **Empty state**: "Belum ada karyawan Shift yang ditempatkan di cabang ini" + tautan ke Penempatan Karyawan.

**`app/dashboard/(dashboard)/hris/schedules/page.tsx`**: ganti redirect dengan halaman yang dijaga seperti `hris/shifts/page.tsx` (guard `IAM.hrisKepegawaian`) dan merender `<SchedulesPage />`. Baca `node_modules/next/dist/docs` bagian page/`searchParams` sebelum mengubah file ini (`frontend/AGENTS.md`).

- [ ] **Step 5: Jalankan test & typecheck**

Run: `cd frontend && npx vitest run src/features/hris/schedules && npx tsc --noEmit -p . && npx eslint src/features/hris/schedules "src/app/dashboard/(dashboard)/hris/schedules"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/hris/schedules "frontend/src/app/dashboard/(dashboard)/hris/schedules/page.tsx"
git commit -m "feat(hris): halaman Jadwal Kerja per cabang — grid, unduh template, unggah dengan validasi"
```

---

### Task 13: Lepas email dari karyawan resign saat membuat karyawan baru

**Files:**
- Modify: `backend/internal/modules/configuration/accounts/{ports.go,employees.go,input.go,routes.go}`
- Modify: `backend/internal/app/adapters_configuration_accounts.go` (`EmailOwner`, `ReleaseEmail`)
- Modify: `frontend/src/features/users/components/user-form-page.tsx`, `frontend/src/lib/hris/users-form.ts`, `frontend/src/features/users/api.ts`
- Test: `backend/internal/modules/configuration/accounts/accounts_integration_test.go`, `frontend/src/features/users/components/user-form-page.test.tsx` (baru bila belum ada)

**Interfaces:**
- Produces:
  - **Port `Employees`**, metode baru:
    ```go
    // EmailOwner is the employee holding email (case-insensitive), nil when none.
    EmailOwner(ctx context.Context, q database.Querier, email string) (*EmailOwnerRow, error)
    // ReleaseEmail sets the row's email to the archive address and unlinks its login account; it returns the old user_id.
    ReleaseEmail(ctx context.Context, q database.Querier, id, archive string) (*string, error)
    type EmailOwnerRow struct{ ID, NIP, FullName string; IsActive bool; EndDate *time.Time; UserID *string }
    ```
  - **`GET /api/users/email-owner?email=`** → `{data: null | {id, nip, full_name, is_active, end_date}}`. Guard sama dengan create.
  - **`POST /api/users`** menerima `release_email: true`. Bila email dipegang karyawan **nonaktif**, dalam satu transaksi:
    - email lama diganti `arsip-{nip}@resign.invalid` (Global Constraints);
    - karyawan baru dibuat;
    - bila data lama punya `user_id`, akun dipindah ke karyawan baru (`hris.employees.user_id`, `is_access_app = true`), blokir dibuka (`Identity.UpdateUser(Ban: false)`), dan `configuration.users.status = 'active'`.
  - Tanpa `release_email`, email milik karyawan nonaktif → 409 `"Email ini milik karyawan resign — konfirmasi lepas email"`. Email milik karyawan aktif tetap 409 `"Email sudah dipakai akun lain"`.
  - Audit: `employee.email_released` untuk data lama (`before: {email}`, `after: {email: arsip, released_to: newID}`).

- [ ] **Step 1: Test integrasi yang gagal**

```go
// accounts_integration_test.go (helper setup/do/scalar/wantError sudah ada)
func insertEmployee(t *testing.T, e *env, name, email, nip string, active bool, userID *string) string {
	t.Helper()
	var id string
	if err := e.tx.QueryRow(context.Background(), `INSERT INTO hris.employees
		(full_name, nip, email, phone, join_date, employment_status, is_active, user_id)
		VALUES ($1, $2, $3, '', '2023-01-02', 'permanent', $4, $5) RETURNING id::text`,
		name, nip, email, active, userID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestCreateEmployeeReleasesResignedEmail(t *testing.T) {
	e := setup(t, map[string][]string{"hris.kepegawaian.users": {"read", "create", "update"}})
	email := uniqueEmail()
	nip := "T" + testutil.RandomHex(5)
	login := testutil.CreateStaff(t, testutil.StaffOptions{Role: "employee", Email: email})
	e.tx.Exec(context.Background(), `UPDATE auth.users SET banned_until = now() + interval '1 year' WHERE id = $1`, login.UserID)
	oldID := insertEmployee(t, e, "Rina Lama", email, nip, false, &login.UserID)

	body := employeeBody(strings.ToUpper(email))
	code, out, _ := e.do("POST", "/api/users", body)
	wantError(t, code, out, 409, "Email ini milik karyawan resign — konfirmasi lepas email")

	code, out, _ = e.do("GET", "/api/users/email-owner?email="+strings.ToUpper(email), nil)
	if code != 200 || out["data"].(map[string]any)["nip"] != nip {
		t.Fatalf("owner = %d %v", code, out)
	}

	body["release_email"] = true
	code, out, raw := e.do("POST", "/api/users", body)
	if code != 201 {
		t.Fatalf("create = %d %s", code, raw)
	}
	newID := out["data"].(map[string]any)["id"].(string)
	if got := e.scalar(`SELECT email FROM hris.employees WHERE id = $1`, oldID); got != "arsip-"+strings.ToLower(nip)+"@resign.invalid" {
		t.Fatalf("old email = %v", got)
	}
	if got := e.scalar(`SELECT user_id::text FROM hris.employees WHERE id = $1`, newID); got != login.UserID {
		t.Fatalf("login account not moved: %v", got)
	}
	if got := e.scalar(`SELECT banned_until IS NULL FROM auth.users WHERE id = $1`, login.UserID); got != true {
		t.Fatal("login account must be unbanned")
	}
	if got := e.scalar(`SELECT count(*) FROM audit.audit_log WHERE entity_id = $1 AND action = 'employee.email_released'`, oldID); got != int64(1) {
		t.Fatalf("audit = %v", got)
	}

	active := uniqueEmail()
	insertEmployee(t, e, "Aktif", active, "T"+testutil.RandomHex(5), true, nil)
	again := employeeBody(active)
	again["release_email"] = true
	code, out, _ = e.do("POST", "/api/users", again)
	wantError(t, code, out, 409, "Email sudah dipakai akun lain")
}
```

> `testutil.StaffOptions` mungkin belum punya field `Email`. Cek `go doc nuhabit/backend/internal/platform/testutil StaffOptions`. Bila tidak ada, buat staff biasa lalu set email karyawan lama = `login.Email`. Import tambahan test: `context`, `strings`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/configuration/accounts -run TestCreateEmployeeReleasesResignedEmail -count=1`
Expected: FAIL (`409 Email sudah dipakai akun lain`)

- [ ] **Step 3: Implementasi**

**Adapter** (`adapters_configuration_accounts.go`):

```go
func (accountsEmployees) EmailOwner(ctx context.Context, q database.Querier, email string) (*accounts.EmailOwnerRow, error) {
	var o accounts.EmailOwnerRow
	err := q.QueryRow(ctx, `SELECT id::text, nip, full_name, is_active, end_date, user_id::text
		FROM hris.employees WHERE lower(email) = lower($1) ORDER BY is_active DESC, updated_at DESC LIMIT 1`, email).
		Scan(&o.ID, &o.NIP, &o.FullName, &o.IsActive, &o.EndDate, &o.UserID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &o, err
}

func (accountsEmployees) ReleaseEmail(ctx context.Context, q database.Querier, id, archive string) (*string, error) {
	var userID *string
	err := q.QueryRow(ctx, `UPDATE hris.employees SET email = $2, user_id = NULL, is_access_app = false, updated_at = now()
		WHERE id = $1::uuid RETURNING (SELECT user_id::text FROM hris.employees WHERE id = $1::uuid)`, id, archive).Scan(&userID)
	return userID, err
}
```

> `RETURNING` membaca nilai sebelum UPDATE lewat subquery snapshot. Bila hasilnya kosong di PostgreSQL 16, pecah menjadi SELECT `user_id` lalu UPDATE.

**Service** (`employees.go`): ubah awal `createUser`:

```go
func archiveEmail(nip string) string {
	clean := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			return r
		case r >= 'A' && r <= 'Z':
			return r + 32
		}
		return -1
	}, nip)
	return "arsip-" + clean + "@resign.invalid"
}

const emailHeldByResigned = "Email ini milik karyawan resign — konfirmasi lepas email"

	email := *b.str("email")
	owner, err := s.ports.Employees.EmailOwner(ctx, s.db, email)
	if err != nil {
		return nil, err
	}
	if owner != nil && (owner.IsActive || !b.releaseEmail) {
		if owner.IsActive {
			return nil, httpx.Conflict(emailInUseMessage)
		}
		return nil, httpx.Conflict(emailHeldByResigned)
	}
```

Pengubahan berikutnya:
- Seluruh pembuatan (`release` + `Insert` + pemindahan akun + `provision`) dibungkus `database.WithTx(ctx, s.db, func(tx pgx.Tx) error { … })`. Pakai `tx` sebagai querier di setiap port.
- Bila `owner != nil`:
  - `prev, err := s.ports.Employees.ReleaseEmail(ctx, tx, owner.ID, archiveEmail(owner.NIP))`;
  - setelah `Insert` id baru: bila `prev != nil`, `UPDATE hris.employees SET user_id = $2, is_access_app = true WHERE id = $1`, lalu `s.ports.Identity.UpdateUser(ctx, tx, *prev, AuthUpdate{Ban: ptr(false), Email: &email})`, lalu `UPDATE configuration.users SET status = 'active', updated_at = $1 WHERE id = $2`;
  - audit memakai `audit.Write(ctx, tx, audit.Entry{ActorID: actorID, Action: "employee.email_released", Entity: "hris.employees", EntityID: &owner.ID, EntityLabel: &owner.FullName, Before: map[string]any{"email": email}, After: map[string]any{"email": archiveEmail(owner.NIP), "released_to": id}})`.
- Bila `provision` sudah membuka transaksi sendiri, jalankan setelah transaksi di atas commit; urutan yang ada tetap.

**Input** (`input.go`): `employeeBody.releaseEmail bool`. Pada create: `b.releaseEmail = f.BoolDefault("release_email", false)`.

**Route** (`routes.go`):
```go
r("GET /api/users/email-owner", h.emailOwner)
```
Handler `emailOwner` memakai `writeGuard(r, "create")`, membaca `email` dari query, dan mengembalikan `{data: nil}` atau `{data: {id, nip, full_name, is_active, end_date}}`.

**Frontend:**
- `features/users/api.ts`: `fetchEmailOwner(email)`.
- `user-form-page.tsx` saat create, sebelum submit: bila `fetchEmailOwner(form.email).data` ada dan `is_active === false`, buka `ConfirmDialog` berisi `Email ini milik {full_name} (NIP {nip}, resign {dd/mm/yyyy}). Lepas email dari data lama dan buat karyawan baru?`. Bila disetujui, kirim payload ditambah `release_email: true`. Bila owner aktif, tampilkan error di field email `Email sudah dipakai {full_name} (NIP {nip})` tanpa submit.
- `lib/hris/users-form.ts`: `buildUserPayload` menerima opsi `{ releaseEmail?: boolean }`.

Test frontend (`user-form-page.test.tsx`): mock `fetchEmailOwner` mengembalikan owner nonaktif, isi form minimal, klik Simpan. Pastikan teks konfirmasi muncul, lalu klik "Lepas email & simpan" → `createUser` dipanggil dengan `release_email: true`.

- [ ] **Step 4: Jalankan test**

Run:
```bash
cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/configuration/accounts -count=1
cd ../frontend && npx vitest run src/features/users && npx tsc --noEmit -p .
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/modules/configuration/accounts backend/internal/app/adapters_configuration_accounts.go frontend/src/features/users frontend/src/lib/hris/users-form.ts
git commit -m "feat(users): email karyawan resign bisa dipakai karyawan baru (email lama diarsipkan, akun dipindah)"
```

---

### Task 14: Audit log karyawan (tulis di semua perubahan + tab Riwayat Perubahan)

**Files:**
- Modify: `backend/internal/modules/configuration/accounts/employees.go` (audit create/update)
- Modify: `backend/internal/modules/hris/employee_audit.go` (pembaca + handler)
- Modify: `backend/internal/modules/hris/routes.go` (sub-route `audit`)
- Create: `frontend/src/features/users/components/detail/employee-audit-tab.tsx` (+ test)
- Create: `frontend/src/lib/hris/employee-audit.ts` (+ test): label aksi & field
- Modify: `frontend/src/features/users/components/user-detail-page.tsx` (tab "Riwayat Perubahan")
- Modify: `frontend/src/features/audit/audit-labels.ts`
- Test: `backend/internal/modules/hris/employee_audit_integration_test.go`, `accounts_integration_test.go`

**Interfaces:**
- Produces:
  - `GET /api/hris/employees/{id}/audit?page=` (guard `kepegawaian`) → `{data:[{id, created_at, actor_name, action, before, after, reason}], meta:{total,totalPages}}` (20 per halaman, terbaru dulu, entity `hris.employees`, `entity_id = id`).
  - accounts `createUser` menulis `employee.create`; `updateUser` menulis `employee.update` dengan `before`/`after` **hanya field yang berubah**, memakai helper:
    ```go
    func changedFields(before map[string]any, after map[string]any) (map[string]any, map[string]any)
    ```
  - `lib/hris/employee-audit.ts`:
    ```ts
    export function auditActionLabel(action: string): string // "employee.update" → "Data diubah", dst.
    export function auditFieldLabel(field: string): string   // "full_name" → "Nama Lengkap"
    export function auditValue(field: string, v: unknown): string // tanggal → dd/mm/yyyy, schedule_type → Shift/Non-Shift, status → label
    ```

- [ ] **Step 1: Test yang gagal**

Backend:

```go
// backend/internal/modules/hris/employee_audit_integration_test.go
package hris

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/iam"
)

func TestEmployeeAuditTrail(t *testing.T) {
	h := newHarness(t)
	hr, _ := h.staff("hrd", iam.HrisKepegawaian, false)
	e := h.employee(emp{name: "Audit Satu"})
	h.do(&hr, http.MethodPut, "/api/hris/employees/"+e+"/schedule-type", map[string]any{"schedule_type": "non_shift", "effective_from": "2026-10-06"})
	h.do(&hr, http.MethodPost, "/api/hris/employees/"+e+"/resign", map[string]any{"effective_date": "2026-10-07", "resign_type": "resign"})
	c := h.do(&hr, http.MethodGet, "/api/hris/employees/"+e+"/audit", nil)
	expect(t, c, http.StatusOK, "")
	list := c.list()
	if len(list) != 2 || list[0].(map[string]any)["action"] != "employee.resign" {
		t.Fatalf("audit = %v", list)
	}
	ess, _ := h.staff("employee", nil, false)
	expect(t, h.do(&ess, http.MethodGet, "/api/hris/employees/"+e+"/audit", nil), http.StatusForbidden, "")
}
```

Accounts: tambahkan di akhir `TestEmployeeScheduleType` (Task 6). `PUT` di test itu mengganti `full_name` dari "Budi Santoso" menjadi "Budi Dua":

```go
	if got := e.scalar(`SELECT before->>'full_name' || '>' || (after->>'full_name') FROM audit.audit_log
		WHERE entity_id = $1 AND action = 'employee.update'`, id); got != "Budi Santoso>Budi Dua" {
		t.Fatalf("update audit = %v", got)
	}
	if got := e.scalar(`SELECT count(*) FROM audit.audit_log WHERE entity_id = $1 AND action = 'employee.create'`, id); got != int64(1) {
		t.Fatalf("create audit = %v", got)
	}
```

Frontend:

```ts
// frontend/src/lib/hris/employee-audit.test.ts
import { expect, it } from "vitest";
import { auditActionLabel, auditFieldLabel, auditValue } from "./employee-audit";

it("label tanpa nama field database", () => {
  expect(auditActionLabel("employee.resign")).toBe("Resign");
  expect(auditActionLabel("schedule.bulk_upload")).toBe("Jadwal diunggah");
  expect(auditFieldLabel("full_name")).toBe("Nama Lengkap");
  expect(auditFieldLabel("schedule_type")).toBe("Tipe Jadwal");
  expect(auditValue("schedule_type", "non_shift")).toBe("Non-Shift");
  expect(auditValue("end_date", "2026-10-07")).toBe("07/10/2026");
  expect(auditValue("is_active", false)).toBe("Tidak");
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run TestEmployeeAuditTrail -count=1; cd ../frontend && npx vitest run src/lib/hris/employee-audit.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementasi backend**

Tambahkan ke `employee_audit.go`:

```go
type employeeAuditRow struct {
	ID        string          `json:"id"`
	CreatedAt time.Time       `json:"created_at"`
	ActorName *string         `json:"actor_name"`
	Action    string          `json:"action"`
	Before    json.RawMessage `json:"before"`
	After     json.RawMessage `json:"after"`
	Reason    *string         `json:"reason"`
}

func (h handlers) employeeAudit(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"), "ID karyawan tidak valid")
	if err != nil {
		return err
	}
	page := 1
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && p > 0 {
		page = p
	}
	q := h.svc.repo.querier()
	var total int
	if err := q.QueryRow(r.Context(), `SELECT count(*) FROM audit.audit_log WHERE entity = $1 AND entity_id = $2`, employeeEntity, id).Scan(&total); err != nil {
		return err
	}
	rows, err := q.Query(r.Context(), `SELECT id::text, created_at, actor_name, action,
		coalesce(before, 'null'::jsonb)::text, coalesce(after, 'null'::jsonb)::text, reason
		FROM audit.audit_log WHERE entity = $1 AND entity_id = $2
		ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET $3`, employeeEntity, id, (page-1)*20)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []employeeAuditRow{}
	for rows.Next() {
		var a employeeAuditRow
		var before, after string
		if err := rows.Scan(&a.ID, &a.CreatedAt, &a.ActorName, &a.Action, &before, &after, &a.Reason); err != nil {
			return err
		}
		a.Before, a.After = json.RawMessage(before), json.RawMessage(after)
		out = append(out, a)
	}
	return ok(w, map[string]any{"success": true, "data": out,
		"meta": map[string]any{"total": total, "totalPages": max(1, (total+19)/20)}})
}
```


Sub-route di `routes.go`:
```go
"audit": {http.MethodGet: h.withMenu(kepegawaian, h.employeeAudit)},
```

Di accounts:
- tambahkan helper `changedFields`;
- di `updateUser`: ambil `before := s.ports.Employees.Get(…)` sebelum update, ubah dua `Employee` ke `map[string]any` dengan field `coreFields`, panggil `changedFields`, lalu bila tidak kosong tulis `audit.Write(ctx, s.db, audit.Entry{ActorID: actorID, Action: "employee.update", Entity: "hris.employees", EntityID: &id, EntityLabel: &fullName, Before: b, After: a})`;
- di `createUser`: `employee.create` dengan `After: {"nip","full_name","email","join_date","employment_status","schedule_type"}`.

- [ ] **Step 4: Implementasi frontend**

```ts
// frontend/src/lib/hris/employee-audit.ts
import { scheduleTypeLabel, type ScheduleType } from "./schedule-type";

const ACTIONS: Record<string, string> = {
  "employee.create": "Karyawan ditambahkan",
  "employee.update": "Data diubah",
  "employee.resign": "Resign",
  "employee.email_released": "Email dilepas",
  "employee.schedule_type": "Tipe jadwal diubah",
  "employee.import": "Diubah lewat import",
  "schedule.fixed_apply": "Jadwal tetap diterapkan",
  "schedule.bulk_upload": "Jadwal diunggah",
};

const FIELDS: Record<string, string> = {
  nip: "NIP", full_name: "Nama Lengkap", email: "Email", phone: "No. HP", join_date: "Tanggal Masuk",
  end_date: "Tanggal Keluar", employment_status: "Status Kepegawaian", schedule_type: "Tipe Jadwal",
  is_active: "Aktif", department_id: "Departemen", section_id: "Seksi", job_title_id: "Jabatan",
  reporting_to: "Atasan", ktp: "NIK (KTP)", npwp: "NPWP", birth_date: "Tanggal Lahir", gender: "Jenis Kelamin",
  marital_status: "Status Pernikahan", address: "Alamat", city: "Kota", province: "Provinsi",
  postal_code: "Kode Pos", bank_name: "Nama Bank", bank_account: "No. Rekening",
  bpjs_tk: "No. BPJS Ketenagakerjaan", bpjs_kesehatan: "No. BPJS Kesehatan",
  emergency_contact_name: "Kontak Darurat (Nama)", emergency_contact_phone: "Kontak Darurat (No. HP)",
  emergency_contact_relationship: "Kontak Darurat (Hubungan)", notes: "Catatan",
  effective_from: "Berlaku Mulai", resign_type: "Jenis", reason: "Alasan", branch: "Cabang",
  from: "Dari", to: "Sampai", days: "Jumlah Hari", released_to: "Dipindah ke Karyawan Baru",
};

const STATUS: Record<string, string> = {
  probation: "Masa Percobaan", contract: "Kontrak (PKWT)", permanent: "Tetap (PKWTT)", intern: "Magang",
  freelance: "Freelance", daily_worker: "Pekerja Harian", resigned: "Resign", terminated: "Diberhentikan",
  resign: "Resign", end_of_contract: "Kontrak berakhir",
};

export const auditActionLabel = (a: string) => ACTIONS[a] ?? a;
export const auditFieldLabel = (f: string) => FIELDS[f] ?? f;

export function auditValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Ya" : "Tidak";
  const s = String(v);
  if (field === "schedule_type") return scheduleTypeLabel(s as ScheduleType);
  if (field === "employment_status" || field === "resign_type") return STATUS[s] ?? s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  return s;
}
```

`employee-audit-tab.tsx`: daftar kartu kronologis (`useQuery` ke `/api/hris/employees/{id}/audit?page=`). Tiap kartu berisi:
- `auditActionLabel(action)`;
- `actor_name` dan waktu (`dd/mm/yyyy HH:mm`);
- tabel kecil "Data | Sebelum | Sesudah" untuk tiap key di `after`. Data id seperti `department_id` ditampilkan "diubah" saja, tanpa uuid; cukup tampilkan field non-id;
- `reason` bila ada;
- paginasi "Sebelumnya / Berikutnya".

Test komponen: mock fetch → dua entri → teks "Resign" dan "Nama Lengkap" muncul, dan **tidak ada** teks `full_name`.

`user-detail-page.tsx`: tambah tab `{ key: "audit", label: "Riwayat Perubahan", icon: ClipboardDocumentListIcon }` setelah "Employment History", hanya untuk HR (`IAM.hrisKepegawaian`).

`features/audit/audit-labels.ts`: tambahkan label aksi yang sama dan entity `hris.employees` → "Karyawan".

- [ ] **Step 5: Jalankan test**

Run:
```bash
cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris ./internal/modules/configuration/accounts -run 'Audit|ScheduleType' -count=1
cd ../frontend && npx vitest run src/lib/hris/employee-audit.test.ts src/features/users src/features/audit && npx tsc --noEmit -p .
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/modules/hris/employee_audit.go backend/internal/modules/hris/employee_audit_integration_test.go backend/internal/modules/hris/routes.go backend/internal/modules/configuration/accounts frontend/src/lib/hris/employee-audit.ts frontend/src/lib/hris/employee-audit.test.ts frontend/src/features/users frontend/src/features/audit/audit-labels.ts
git commit -m "feat(hris): audit log perubahan data karyawan + tab Riwayat Perubahan"
```

---

### Task 15: Export data karyawan (xlsx)

**Files:**
- Create: `backend/internal/modules/hris/domain/employee_import.go` (definisi kolom; validasi baris ditambah di Task 16)
- Create: `backend/internal/modules/hris/employee_excel.go` (export sekarang, import di Task 16)
- Modify: `backend/internal/modules/hris/routes.go`
- Modify: `frontend/src/features/users/components/users-list-page.tsx` (tombol Export), `frontend/src/features/users/api.ts`
- Test: `backend/internal/modules/hris/domain/employee_import_test.go`, `backend/internal/modules/hris/employee_excel_integration_test.go`

**Interfaces:**
- Produces:
```go
// domain/employee_import.go
type EmployeeColumn struct {
    Key      string // kunci internal (tidak tampil), mis. "full_name"
    Header   string // judul tampil, mis. "Nama Lengkap"
    Required bool
    Kind     string // "text" | "date" | "list"
    Width    float64
    ExportOnly bool
}
var EmployeeColumns []EmployeeColumn // urutan = Spec §3.2 (+ 4 kolom export di ujung)
func EmployeeHeaderKey(header string) (string, bool) // judul (toleran) → Key
```
- HTTP: `GET /api/hris/employees/export?search&department_id&employment_status&is_active&schedule_type` (guard `employeeRecordManagers`) → `Data Karyawan - {dd-mm-yyyy}.xlsx`. Untuk template kosong: `GET /api/hris/employees/import-template`.

- [ ] **Step 1: Test yang gagal**

```go
// backend/internal/modules/hris/domain/employee_import_test.go
package domain

import (
	"regexp"
	"testing"
)

func TestEmployeeColumnsAreHuman(t *testing.T) {
	want := []string{"NIP", "Nama Lengkap", "Email", "No. HP", "Tanggal Masuk", "Status Kepegawaian", "Tipe Jadwal",
		"Cabang Utama", "Departemen", "Jabatan", "NIP Atasan", "NIK (KTP)", "NPWP", "Tanggal Lahir", "Jenis Kelamin",
		"Status Pernikahan", "Alamat", "Kota", "Provinsi", "Kode Pos", "Nama Bank", "No. Rekening",
		"No. BPJS Ketenagakerjaan", "No. BPJS Kesehatan", "Kontak Darurat (Nama)", "Kontak Darurat (No. HP)",
		"Kontak Darurat (Hubungan)", "Nama Atasan", "Status Aktif", "Tanggal Keluar", "Terakhir Diubah"}
	if len(EmployeeColumns) != len(want) {
		t.Fatalf("columns = %d, want %d", len(EmployeeColumns), len(want))
	}
	technical := regexp.MustCompile(`_|\bid\b|true|false`)
	for i, c := range EmployeeColumns {
		if c.Header != want[i] {
			t.Fatalf("column %d = %q, want %q", i, c.Header, want[i])
		}
		if technical.MatchString(c.Header) {
			t.Fatalf("technical header %q", c.Header)
		}
	}
	if k, ok := EmployeeHeaderKey("  nama lengkap * "); !ok || k != "full_name" {
		t.Fatalf("header key = %q", k)
	}
}
```

```go
// backend/internal/modules/hris/employee_excel_integration_test.go
package hris

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xuri/excelize/v2"

	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/testutil"
)

func getFile(t *testing.T, h *harness, s *testutil.Staff, path string) *httptest.ResponseRecorder {
	t.Helper()
	r := testutil.AsStaff(httptest.NewRequest(http.MethodGet, path, nil), *s)
	rec := httptest.NewRecorder()
	h.exec("SAVEPOINT harness_request")
	h.mux.ServeHTTP(rec, r)
	h.exec("RELEASE SAVEPOINT harness_request")
	return rec
}

func TestEmployeeExport(t *testing.T) {
	h := newHarness(t)
	hr, _ := h.staff("hrd", iam.HrisKepegawaian, false)
	e := h.employee(emp{name: "Ekspor Satu", status: "contract", join: "2025-06-01"})
	h.exec(`UPDATE hris.employees SET nip = '0202505272', ktp = '3273012345678901', gender = 'female', marital_status = 'single', schedule_type = 'non_shift' WHERE id = $1`, e)
	rec := getFile(t, h, &hr, "/api/hris/employees/export?search=Ekspor")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	f, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := f.GetRows("Data Karyawan")
	if rows[0][1] != "Nama Lengkap *" || rows[1][0] != "0202505272" || rows[1][1] != "Ekspor Satu" {
		t.Fatalf("rows = %v", rows[:2])
	}
	get := func(header string) string {
		for i, h := range rows[0] {
			if h == header || h == header+" *" {
				return rows[1][i]
			}
		}
		return "<missing>"
	}
	checks := map[string]string{"Tanggal Masuk": "01/06/2025", "Status Kepegawaian": "Kontrak (PKWT)", "Tipe Jadwal": "Non-Shift",
		"Jenis Kelamin": "Perempuan", "Status Pernikahan": "Belum Menikah", "NIK (KTP)": "3273012345678901", "Status Aktif": "Aktif"}
	for header, want := range checks {
		if got := get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if list := f.GetSheetList(); list[0] != "Petunjuk" {
		t.Fatalf("first sheet = %v", list)
	}
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && go test ./internal/modules/hris/domain -run TestEmployeeColumns -count=1`
Expected: FAIL

- [ ] **Step 3: Implementasi kolom**

```go
// backend/internal/modules/hris/domain/employee_import.go
package domain

// Columns of the Data Karyawan file (Spec 2026-10-19 §3.2): export and
// import share them so an exported file can be edited and imported back.

type EmployeeColumn struct {
	Key        string
	Header     string
	Required   bool
	Kind       string
	Width      float64
	ExportOnly bool
}

var EmployeeColumns = []EmployeeColumn{
	{Key: "nip", Header: "NIP", Kind: "text", Width: 16},
	{Key: "full_name", Header: "Nama Lengkap", Required: true, Kind: "text", Width: 28},
	{Key: "email", Header: "Email", Required: true, Kind: "text", Width: 28},
	{Key: "phone", Header: "No. HP", Kind: "text", Width: 16},
	{Key: "join_date", Header: "Tanggal Masuk", Required: true, Kind: "date", Width: 14},
	{Key: "employment_status", Header: "Status Kepegawaian", Required: true, Kind: "list", Width: 20},
	{Key: "schedule_type", Header: "Tipe Jadwal", Required: true, Kind: "list", Width: 12},
	{Key: "branch", Header: "Cabang Utama", Required: true, Kind: "list", Width: 22},
	{Key: "department", Header: "Departemen", Kind: "list", Width: 22},
	{Key: "position", Header: "Jabatan", Kind: "list", Width: 24},
	{Key: "manager_nip", Header: "NIP Atasan", Kind: "text", Width: 16},
	{Key: "ktp", Header: "NIK (KTP)", Kind: "text", Width: 20},
	{Key: "npwp", Header: "NPWP", Kind: "text", Width: 20},
	{Key: "birth_date", Header: "Tanggal Lahir", Kind: "date", Width: 14},
	{Key: "gender", Header: "Jenis Kelamin", Kind: "list", Width: 14},
	{Key: "marital_status", Header: "Status Pernikahan", Kind: "list", Width: 18},
	{Key: "address", Header: "Alamat", Kind: "text", Width: 36},
	{Key: "city", Header: "Kota", Kind: "text", Width: 16},
	{Key: "province", Header: "Provinsi", Kind: "text", Width: 16},
	{Key: "postal_code", Header: "Kode Pos", Kind: "text", Width: 10},
	{Key: "bank_name", Header: "Nama Bank", Kind: "text", Width: 14},
	{Key: "bank_account", Header: "No. Rekening", Kind: "text", Width: 18},
	{Key: "bpjs_tk", Header: "No. BPJS Ketenagakerjaan", Kind: "text", Width: 22},
	{Key: "bpjs_kesehatan", Header: "No. BPJS Kesehatan", Kind: "text", Width: 20},
	{Key: "emergency_contact_name", Header: "Kontak Darurat (Nama)", Kind: "text", Width: 22},
	{Key: "emergency_contact_phone", Header: "Kontak Darurat (No. HP)", Kind: "text", Width: 18},
	{Key: "emergency_contact_relationship", Header: "Kontak Darurat (Hubungan)", Kind: "text", Width: 18},
	{Key: "manager_name", Header: "Nama Atasan", Kind: "text", Width: 24, ExportOnly: true},
	{Key: "active", Header: "Status Aktif", Kind: "text", Width: 12, ExportOnly: true},
	{Key: "end_date", Header: "Tanggal Keluar", Kind: "date", Width: 14, ExportOnly: true},
	{Key: "updated_at", Header: "Terakhir Diubah", Kind: "date", Width: 14, ExportOnly: true},
}

func EmployeeHeaderKey(header string) (string, bool) {
	h := NormalizeHeader(header)
	for _, c := range EmployeeColumns {
		if NormalizeHeader(c.Header) == h {
			return c.Key, true
		}
	}
	return "", false
}
```

- [ ] **Step 4: Implementasi export**

Buat `employee_excel.go` dengan isi berikut.

**`employeeExportFilter`**: baca query `search`, `department_id`, `employment_status`, `is_active` (`true`/`false`), dan `schedule_type`, dengan aturan sama dengan `/api/users`.

**`exportEmployees(ctx, f)`**: query

```sql
SELECT e.nip, e.full_name, e.email, e.phone, e.join_date::text, e.employment_status, e.schedule_type,
       coalesce(b.name, ''), coalesce(d.name, ''), coalesce(p.title, ''), coalesce(m.nip, ''),
       coalesce(e.ktp, ''), coalesce(e.npwp, ''), coalesce(e.birth_date::text, ''), coalesce(e.gender::text, ''),
       coalesce(e.marital_status::text, ''), coalesce(e.address, ''), coalesce(e.city, ''), coalesce(e.province, ''),
       coalesce(e.postal_code, ''), coalesce(e.bank_name, ''), coalesce(e.bank_account, ''), coalesce(e.bpjs_tk, ''),
       coalesce(e.bpjs_kesehatan, ''), coalesce(e.emergency_contact_name, ''), coalesce(e.emergency_contact_phone, ''),
       coalesce(e.emergency_contact_relationship, ''), coalesce(m.full_name, ''), e.is_active,
       coalesce(e.end_date::text, ''), coalesce(e.updated_at::date::text, '')
FROM hris.employees e
LEFT JOIN LATERAL (SELECT br.name FROM hris.employee_placements ep JOIN configuration.branches br ON br.id = ep.branch_id
                   WHERE ep.employee_id = e.id AND ep.is_primary AND ep.start_date <= current_date
                     AND (ep.end_date IS NULL OR ep.end_date >= current_date)
                   ORDER BY ep.start_date DESC LIMIT 1) b ON true
LEFT JOIN hris.departments d ON d.id = e.department_id
LEFT JOIN hris.positions p ON p.id = e.job_title_id
LEFT JOIN hris.employees m ON m.id = e.reporting_to
WHERE … (filter) ORDER BY e.full_name
```

**Konversi nilai ke label:**
- `employment_status` → nama dari `hris.employment_statuses` (`SELECT code, name …`);
- `schedule_type` → `domain.LabelOf(domain.ScheduleTypeLabels, …)`;
- `gender` / `marital_status` → `LabelOf`;
- tanggal → `time.Time` (sel tanggal, tampil DD/MM/YYYY);
- `is_active` → `Aktif` / `Resign`.

**`employeeWorkbook(rows [][]any, lists map[string][]string)`** membangun `xlsx.BuildTemplate`:
- `TemplateSheet{Name: "Data Karyawan", FreezeCols: 2, DataRows: max(len(rows), 200)}`;
- kolom dari `domain.EmployeeColumns`: `Kind` date → `KindDate`, list → `KindList` dengan `Options` dari `lists[key]`, `ExportOnly` → `ReadOnly`;
- `lists`:
  - Status Kepegawaian: nama `employment_statuses` aktif **tanpa** `resigned` / `terminated`;
  - Tipe Jadwal: `Labels(ScheduleTypeLabels)`;
  - Jenis Kelamin dan Status Pernikahan: `Labels`;
  - Cabang: nama cabang aktif;
  - Departemen: nama departemen;
  - Jabatan: judul jabatan aktif;
- notes `Petunjuk`:
  - "Cara mengisi" (4 langkah);
  - tabel "Kolom | Wajib | Isi" yang dibangun dari `EmployeeColumns` + teks format (copy dari tabel Spec §3.2);
  - baris "Mode Tambah: hanya karyawan baru; NIP yang sudah ada ditolak. Mode Timpa: NIP yang ada diperbarui, sel kosong tidak mengubah data.";
  - contoh satu baris.

**Handler:**
- `exportEmployees` → `Data Karyawan - {dd-mm-yyyy}.xlsx`;
- `employeeImportTemplate` → workbook dengan `rows = nil` dan nama file `Template Import Karyawan.xlsx`.

Route (sebelum route `{id}`):
```go
r("GET /api/hris/employees/export", h.withMenu(employeeRecordManagers, h.exportEmployees)),
r("GET /api/hris/employees/import-template", h.withMenu(employeeRecordManagers, h.employeeImportTemplate)),
```

**Frontend** `users-list-page.tsx` (variant directory):
- tombol **"Export"** → `window.location.href = buildListUrl("/api/hris/employees/export", { search, department_id, employment_status, is_active, schedule_type })` memakai filter yang sedang aktif;
- tombol **"Import"** (dikerjakan di Task 16) di sebelahnya.

- [ ] **Step 5: Jalankan test**

Run: `cd backend && go test ./internal/modules/hris/domain -count=1 && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run TestEmployeeExport -count=1`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/modules/hris/domain/employee_import.go backend/internal/modules/hris/domain/employee_import_test.go backend/internal/modules/hris/employee_excel.go backend/internal/modules/hris/employee_excel_integration_test.go backend/internal/modules/hris/routes.go frontend/src/features/users
git commit -m "feat(hris): export data karyawan ke Excel berjudul kolom bahasa user"
```

---

### Task 16: Import data karyawan (mode Tambah / Timpa)

**Files:**
- Modify: `backend/internal/modules/hris/domain/employee_import.go` (validasi baris)
- Modify: `backend/internal/modules/hris/employee_excel.go` (preview/commit/error file)
- Modify: `backend/internal/modules/hris/routes.go`
- Create: `frontend/src/features/users/components/employee-import-dialog.tsx` (+ test)
- Modify: `frontend/src/features/users/components/users-list-page.tsx`, `frontend/src/features/users/api.ts`
- Test: `backend/internal/modules/hris/domain/employee_import_test.go`, `backend/internal/modules/hris/employee_excel_integration_test.go`

**Interfaces:**
- Produces:
```go
type EmployeeLookups struct {
    Statuses    map[string]string // label (lowercase) → code, tanpa resigned/terminated
    Branches    map[string]string // nama (lowercase) → id
    Departments map[string]string
    Positions   map[string]string
    ExistingNIP map[string]EmployeeRef // NIP → karyawan yang ada
    EmailOwner  map[string]EmployeeRef // email (lowercase) → pemilik
    ManagerNIP  map[string]string      // NIP → id (karyawan aktif)
}
type EmployeeRef struct{ ID, NIP, Name string; Active bool }
type EmployeeImportRow struct {
    Line   int
    Action string            // "create" | "update" | "skip"
    NIP    string
    Name   string
    Set    map[string]any    // kolom hris.employees → nilai (hanya sel terisi)
    Branch string            // id cabang utama baru ("" = tidak berubah)
    ReleaseEmailFrom string  // id karyawan resign pemilik email ("" = tidak ada)
}
func ValidateEmployeeImport(mode string, header []string, rows [][]string, firstLine int, lk EmployeeLookups) ([]EmployeeImportRow, []UploadIssue, []UploadIssue)
```
- HTTP: `POST /api/hris/employees/import` multipart `file, mode=add|replace, step=preview|commit|error_file, release_emails=true|false`:
  - `preview` → `{data:{summary:{create,update,skip}, errors, warnings, rows:[{line,action,nip,name}], changes:[{nip,name,field,before,after}]}}`. `field` = judul kolom bahasa user (`EmployeeColumns.Header`), `before`/`after` = label tampilan (mis. "Shift" → "Non-Shift"), maksimal 500 baris.
  - `commit` → `{data:{summary}, message}`
  - `error_file` → xlsx.

- [ ] **Step 1: Test domain yang gagal**

```go
func lk() EmployeeLookups {
	return EmployeeLookups{
		Statuses:    map[string]string{"kontrak (pkwt)": "contract", "masa percobaan": "probation"},
		Branches:    map[string]string{"ppln": "b1"},
		Departments: map[string]string{"retail operational": "d1"},
		Positions:   map[string]string{"shopkeeper staff": "p1"},
		ExistingNIP: map[string]EmployeeRef{"202505272": {ID: "e1", NIP: "202505272", Name: "Feti", Active: true}},
		EmailOwner: map[string]EmployeeRef{
			"feti@x.id": {ID: "e1", NIP: "202505272", Name: "Feti", Active: true},
			"lama@x.id": {ID: "e9", NIP: "201901001", Name: "Lama", Active: false},
		},
		ManagerNIP: map[string]string{"202310037": "m1"},
	}
}

var hdr = []string{"NIP", "Nama Lengkap *", "Email *", "No. HP", "Tanggal Masuk *", "Status Kepegawaian *", "Tipe Jadwal *", "Cabang Utama *", "Jenis Kelamin", "NIK (KTP)", "Status Aktif"}

func TestValidateEmployeeImportAdd(t *testing.T) {
	rows := [][]string{
		{"", "Baru Satu", "baru@x.id", "0812-3456-7890", "21/10/2026", "Kontrak (PKWT)", "Shift", "PPLN", "Perempuan", "3273012345678901", "Aktif"},
		{"202505272", "Feti", "feti@x.id", "", "01/06/2025", "Kontrak (PKWT)", "Shift", "PPLN", "", "", ""},
		{"", "Tanpa Email", "", "", "21/10/2026", "Kontrak (PKWT)", "Shift", "PPLN", "", "", ""},
		{"", "Status Salah", "s@x.id", "", "21/10/2026", "Karyawan Tetap", "Shift", "PPLN", "", "", ""},
		{"", "NIK Pendek", "n@x.id", "", "2026-10-21", "Kontrak (PKWT)", "shift", "ppln", "", "3273", ""},
		{"", "Email Lama", "lama@x.id", "", "21/10/2026", "Kontrak (PKWT)", "Shift", "PPLN", "", "", ""},
	}
	out, errs, warns := ValidateEmployeeImport("add", hdr, rows, 2, lk())
	wantErr := []string{
		"Baris 3: NIP 202505272 sudah ada (mode Tambah hanya untuk karyawan baru)",
		"Baris 4, kolom Email: wajib diisi untuk karyawan baru",
		"Baris 5, kolom Status Kepegawaian: 'Karyawan Tetap' tidak ada di daftar pilihan",
		"Baris 6, kolom NIK (KTP): harus 16 angka",
	}
	for _, w := range wantErr {
		if !issueText(errs, w) {
			t.Errorf("missing error %q in %+v", w, errs)
		}
	}
	if !issueText(warns, "Baris 7, kolom Email: lama@x.id milik Lama (NIP 201901001, resign) — akan dilepas bila dikonfirmasi") {
		t.Errorf("warnings %+v", warns)
	}
	if out[0].Action != "create" || out[0].Set["phone"] != "081234567890" || out[0].Set["join_date"] != "2026-10-21" ||
		out[0].Set["gender"] != "female" || out[0].Set["schedule_type"] != "shift" || out[0].Branch != "b1" {
		t.Fatalf("row 1 = %+v", out[0])
	}
	if _, ok := out[0].Set["active"]; ok {
		t.Fatal("export-only column must be ignored")
	}
	if out[5].ReleaseEmailFrom != "e9" {
		t.Fatalf("release = %q", out[5].ReleaseEmailFrom)
	}
}

func TestValidateEmployeeImportReplaceKeepsBlankCells(t *testing.T) {
	rows := [][]string{{"202505272", "Feti P.", "", "", "", "", "Non-Shift", "", "", "", ""}}
	out, errs, _ := ValidateEmployeeImport("replace", hdr, rows, 2, lk())
	if len(errs) != 0 {
		t.Fatalf("errors %+v", errs)
	}
	if out[0].Action != "update" || len(out[0].Set) != 2 || out[0].Set["full_name"] != "Feti P." || out[0].Set["schedule_type"] != "non_shift" {
		t.Fatalf("set = %+v (blank cells must not overwrite)", out[0].Set)
	}
	missing, errs2, _ := ValidateEmployeeImport("replace", hdr, [][]string{{"", "X", "x@x.id", "", "21/10/2026", "Kontrak (PKWT)", "Shift", "PPLN", "", "", ""}}, 2, lk())
	_ = missing
	if !issueText(errs2, "Baris 2, kolom NIP: wajib diisi di mode Timpa") {
		t.Fatalf("errors %+v", errs2)
	}
}

func issueText(list []UploadIssue, text string) bool {
	for _, i := range list {
		got := "Baris " + strconv.Itoa(i.Line)
		if i.Column != "" {
			got += ", kolom " + i.Column
		}
		if got+": "+i.Message == text {
			return true
		}
	}
	return false
}
```

(tambahkan `strconv` ke import test)

> Perubahan Tipe Jadwal lewat import mode Timpa **tidak** menjalankan transisi jadwal (Task 5). Commit memanggil `ChangeScheduleType` untuk baris yang tipe jadwalnya berubah, dengan `effective_from` = hari ini, sehingga aturannya tetap sama dengan perubahan lewat dialog. Lihat Step 3.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && go test ./internal/modules/hris/domain -run TestValidateEmployeeImport -count=1`
Expected: FAIL

- [ ] **Step 3: Implementasi validasi & service**

`ValidateEmployeeImport` (di `domain/employee_import.go`):

1. **Petakan header**: indeks kolom → key lewat `EmployeeHeaderKey`. Header tidak dikenal diabaikan. Kolom `ExportOnly` diabaikan. Bila tidak ada kolom `nama lengkap` → satu error baris 0 `Judul kolom "Nama Lengkap" tidak ditemukan — pakai template dari halaman Karyawan`.
2. **Per baris** (`line = firstLine + i`; lewati baris kosong; maksimal 1.000 baris, lebih dari itu error baris 0 `Maksimal 1.000 baris per file`):
   - **NIP**: `CleanNIP`. Mode `add`: NIP ada di `ExistingNIP` → error tanpa kolom `NIP {nip} sudah ada (mode Tambah hanya untuk karyawan baru)`; kosong = dibuat otomatis. Mode `replace`: kosong → error kolom NIP `wajib diisi di mode Timpa`; NIP tidak ada → action `create`; ada → `update`. NIP ganda dalam file → `NIP {nip} ganda (baris a & b)`.
   - **Kolom wajib** saat action `create`: Nama Lengkap, Email, Tanggal Masuk, Status Kepegawaian, Tipe Jadwal, Cabang Utama. Pesannya `wajib diisi untuk karyawan baru`. Untuk `update` hanya sel terisi yang divalidasi dan dimasukkan ke `Set`.
   - **Tanggal** (`join_date`, `birth_date`): `ParseDateCell`; gagal → `format tanggal harus DD/MM/YYYY`. `birth_date` > hari ini → `tidak boleh di masa depan`.
   - **Daftar pilihan**: `employment_status` (`Statuses`), `schedule_type` (`ValueOf ScheduleTypeLabels`), `gender`, `marital_status` (`ValueOf`), `branch` (`Branches` → `Branch`), `department` → `Set["department_id"]`, `position` → `Set["job_title_id"]`. Tidak cocok → `'{nilai}' tidak ada di daftar pilihan`.
   - **`manager_nip`** → `ManagerNIP` → `Set["reporting_to"]`; tidak ada → `NIP atasan {x} tidak ditemukan / tidak aktif`.
   - **`phone` dan `emergency_contact_phone`**: `NormalizePhone`.
   - **`ktp`**: `CleanDigits`, harus 16 → `harus 16 angka`. **`npwp`**: 15–16 → `harus 15–16 angka`. **`bank_account` / `bpjs_*` / `postal_code`**: `CleanDigits`, harus angka semua → `hanya boleh angka`.
   - **Email**: wajib format (`strings.Contains(@)` dan domain bertitik); `EmailOwner`:
     - pemilik aktif lain (bukan NIP baris ini) → error `sudah dipakai {nama} (NIP {nip})`;
     - pemilik nonaktif → warning `{email} milik {nama} (NIP {nip}, resign) — akan dilepas bila dikonfirmasi` dan `ReleaseEmailFrom = id`.
   - **Teks lain** di-`TrimSpace` lalu dimasukkan ke `Set` bila tidak kosong.

Service `ImportEmployees(ctx, actor, data, fileName, mode, step, releaseEmails)` di `employee_excel.go`:
- baca `xlsx.SpreadsheetMatrix(data, fileName)` (csv/xlsx; untuk xlsx pakai `ParseMatrix` `PreferSheet: "Data Karyawan"`); header = baris 0;
- bangun `EmployeeLookups` dari DB (status aktif, cabang aktif, departemen, jabatan, NIP & email semua karyawan, NIP manajer aktif);
- **`preview`**: ringkasan + errors + warnings + 200 baris pertama `{line, action, nip, name}` + `changes`. Hitung `changes` dengan membandingkan `Set` baris `update` terhadap data sekarang (nilai sama tidak ikut, sesuai catatan round-trip). Nilai ditampilkan sebagai label, bukan kode/ID;
- **`error_file`**: `errorWorkbook(matrix, 0, append(errs, warns...), "Data Karyawan")`;
- **`commit`**, dalam `s.repo.InTx`:
  - errors > 0 → 400 `"File masih punya error — perbaiki lalu unggah ulang"`;
  - ada `ReleaseEmailFrom` dan `!releaseEmails` → 400 `"Konfirmasi lepas email karyawan resign dulu"`;
  - per baris:
    - `ReleaseEmailFrom` → `UPDATE hris.employees SET email = <arsip>` (fungsi `archiveEmail` versi hris, aturan sama dengan Task 13) + audit `employee.email_released`;
    - `create` → INSERT kolom `Set` + `nip` (bila kosong: NIP berikutnya `EMP-{tahun}-{seq}` via `SELECT coalesce(max(substring(nip from 'EMP-'||$1||'-(\d+)')::int), 0) + 1 FROM hris.employees WHERE nip LIKE 'EMP-'||$1||'-%'`) + `is_active = true`;
    - `update` → UPDATE kolom `Set` kecuali `schedule_type`;
    - `Branch` berbeda dari penempatan utama berjalan → tutup penempatan utama lama per kemarin (`end_date = today - 1`) lalu INSERT penempatan utama baru `start_date = today`. Untuk baris `create`, langsung INSERT;
    - `schedule_type` berubah pada update → `s.ChangeScheduleType(ctx, actor, []string{id}, to, today, false)`. Panggil di dalam transaksi yang sama: refactor badan `ChangeScheduleType` menjadi `changeScheduleTypeTx(ctx, r Repository, …)` yang dipakai keduanya;
    - audit `employee.import` per baris (`before` = nilai lama kolom yang diubah, `after` = `Set`).

Handler: `importEmployees` membaca multipart (`file`, `mode`, `step`, `release_emails`), maksimal 5 MB. Route:
```go
r("POST /api/hris/employees/import", h.withMenu(employeeRecordManagers, h.importEmployees)),
```

Test integrasi round-trip (Review Focus #4):

```go
func TestEmployeeExportImportRoundTrip(t *testing.T) {
	h := newHarness(t)
	hr, _ := h.staff("hrd", iam.HrisKepegawaian, false)
	e := h.employee(emp{name: "Bolak Balik", status: "contract"})
	branch := h.scalar(`SELECT id::text FROM configuration.branches WHERE is_active LIMIT 1`)
	h.exec(`INSERT INTO hris.employee_placements (employee_id, branch_id, is_primary, start_date) VALUES ($1, $2, true, '2025-01-10')`, e, branch)
	h.exec(`UPDATE hris.employees SET nip = '0202500001', ktp = '3273012345678901', gender = 'male', marital_status = 'married' WHERE id = $1`, e)
	rec := getFile(t, h, &hr, "/api/hris/employees/export?search=Bolak")
	pre := uploadEmployees(t, h, &hr, map[string]string{"mode": "replace", "step": "preview"}, rec.Body.Bytes())
	expect(t, pre, http.StatusOK, "")
	sum := pre.data()["summary"].(map[string]any)
	if sum["update"] != float64(1) || len(pre.data()["errors"].([]any)) != 0 {
		t.Fatalf("summary %v errors %v", sum, pre.data()["errors"])
	}
	commit := uploadEmployees(t, h, &hr, map[string]string{"mode": "replace", "step": "commit"}, rec.Body.Bytes())
	expect(t, commit, http.StatusOK, "")
	if h.scalar(`SELECT count(*)::text FROM audit.audit_log WHERE entity_id = $1 AND action = 'employee.import' AND after <> '{}'::jsonb`, e) != "0" {
		t.Fatal("round trip must change nothing (no audit with changes)")
	}
}
```

`uploadEmployees` = salinan `upload` (Task 11) dengan path `/api/hris/employees/import` dan nama file `data.xlsx`.

> **Catatan implementasi round-trip:** saat `update`, `Set` hanya memuat kolom yang **nilainya berbeda** dari data sekarang. Bandingkan nilai ter-normalisasi; audit hanya ditulis bila `Set` tidak kosong. Hasilnya nol perubahan dan nol audit.

**Frontend** `employee-import-dialog.tsx` (pola `coa-import-dialog.tsx`):
- tautan "Unduh template" → `/api/hris/employees/import-template`;
- pilihan mode radio **Tambah** ("hanya karyawan baru; NIP yang sudah ada ditolak") / **Timpa** ("NIP yang ada diperbarui; sel kosong tidak mengubah data");
- input file `.xlsx,.csv` dengan label **"File data karyawan"**;
- tombol **"Periksa file"** → ringkasan "N baru · M diperbarui · K dilewati", daftar error/peringatan `Baris {line}, kolom {column}: {message}`, dan tombol "Unduh file dengan keterangan error";
- bila ada peringatan email resign: checkbox **"Lepas email dari data karyawan resign (N)"**;
- tombol **"Simpan"** disabled bila ada error, atau ada peringatan email tapi checkbox belum dicentang;
- setelah sukses: `toast.success(message)` dan `queryClient.invalidateQueries({ queryKey: ["users"] })` (pakai key list yang ada).

**Konfirmasi penggantian (mode Timpa):** bila `summary.update > 0`, tombol "Simpan" membuka `ConfirmDialog`:
- judul "Timpa data karyawan?";
- isi "{update} karyawan akan diperbarui" + tabel maksimal 50 baris `changes` (Karyawan · Data · Sebelum → Sesudah) + catatan "Sel kosong di file tidak mengubah data";
- tombol "Ya, timpa data" / "Batal".

Commit baru dikirim setelah "Ya, timpa data". Mode Tambah tanpa baris update langsung disimpan.

Test dialog: preview mode Timpa dengan `update: 2` → klik Simpan → muncul "2 karyawan akan diperbarui" dan baris `Feti · Tipe Jadwal · Shift → Non-Shift`; commit belum dipanggil sebelum "Ya, timpa data" diklik. Test dialog: preview dengan error → Simpan disabled; dengan peringatan email → Simpan baru aktif setelah checkbox dicentang dan commit dikirim dengan `release_emails=true`.

- [ ] **Step 4: Jalankan test**

Run:
```bash
cd backend && go test ./internal/modules/hris/domain -count=1 && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./internal/modules/hris -run 'TestEmployeeExport|TestEmployeeImport|TestEmployeeExportImportRoundTrip' -count=1
cd ../frontend && npx vitest run src/features/users && npx tsc --noEmit -p .
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/modules/hris frontend/src/features/users
git commit -m "feat(hris): import data karyawan mode Tambah/Timpa dengan preview & file keterangan error"
```

---

### Task 17: Finalisasi (route manifest, skrip ops HQ/Warehouse, dokumen, uji stack salinan)

**Files:**
- Modify: `frontend/src/lib/go-routes.generated.json` (regenerasi)
- Create: `backend/database/sql/fixes/2026-10-21_non_shift_hq_warehouse.sql`
- Create: `docs/epics/EPIC-056-hris-golive-karyawan-jadwal.md`
- Modify: `docs/epics/README.md` (baris registry)

- [ ] **Step 1: Regenerasi manifest route Go**

Run: `make -C backend generate && git diff --stat frontend/src/lib/go-routes.generated.json`
Expected: route baru ada:
- `/api/hris/schedules*`
- `/api/hris/employees/export`
- `/api/hris/employees/import`
- `/api/hris/employees/import-template`
- `/api/hris/employees/schedule-type/bulk`
- `/api/users/email-owner`

Route `{id}/{sub}` sudah tercakup.

- [ ] **Step 2: Skrip ops Non-Shift HQ & Warehouse (dijalankan manual setelah daftar disetujui user)**

```sql
-- backend/database/sql/fixes/2026-10-21_non_shift_hq_warehouse.sql
-- Spec §2.2: karyawan aktif dengan penempatan utama berjalan di
-- "Paddy HQ Bandung" dan "Warehouse Paddy" menjadi Non-Shift.
-- Jalankan bagian 1 dulu, tunjukkan daftarnya ke user, baru bagian 2.

-- 1. Daftar (baca saja)
SELECT b.name AS cabang, e.nip, e.full_name, e.schedule_type
FROM hris.employees e
JOIN hris.employee_placements p ON p.employee_id = e.id AND p.is_primary
  AND p.start_date <= current_date AND (p.end_date IS NULL OR p.end_date >= current_date)
JOIN configuration.branches b ON b.id = p.branch_id
WHERE e.is_active AND b.name IN ('Paddy HQ Bandung', 'Warehouse Paddy')
ORDER BY b.name, e.full_name;

-- 2. Ubah tipe (hanya kolom schedule_type; jadwal tetap diterapkan dari
--    halaman Jadwal Kerja → "Terapkan jadwal tetap" per cabang)
BEGIN;
UPDATE hris.employees e SET schedule_type = 'non_shift', updated_at = now()
FROM hris.employee_placements p, configuration.branches b
WHERE p.employee_id = e.id AND p.is_primary
  AND p.start_date <= current_date AND (p.end_date IS NULL OR p.end_date >= current_date)
  AND b.id = p.branch_id AND e.is_active AND b.name IN ('Paddy HQ Bandung', 'Warehouse Paddy')
  AND e.schedule_type <> 'non_shift';
-- Periksa jumlah baris (live 19-10: 66 + 71 = 137) sebelum COMMIT.
COMMIT;
```

- [ ] **Step 3: Dokumen epic**

Buat `docs/epics/EPIC-056-hris-golive-karyawan-jadwal.md` mengikuti format EPIC-055:
- frontmatter `status: coding`, `environment: dev`, `retries: 0`;
- Goal (ringkas dari spec), daftar task 1–17, Acceptance Criteria (dari spec), dan Automation Log berisi keputusan user 19-10.

Tambahkan satu baris di tabel `docs/epics/README.md`:
```
| [EPIC-056](./EPIC-056-hris-golive-karyawan-jadwal.md) | HRIS Go-Live — Data Karyawan & Jadwal Shift (`MODULE-HRIS`) | coding | 2026-10-19 |
```

- [ ] **Step 4: Semua test**

Run:
```bash
cd backend && go vet ./... && TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./... -count=1 2>&1 | tail -40
cd ../frontend && npx vitest run && npx tsc --noEmit -p . && npx eslint src/features/users src/features/hris src/lib/hris
```
Expected: hanya kegagalan lama yang sudah diketahui (Global Constraints).

- [ ] **Step 5: Uji di stack salinan DB live (tanpa menyentuh live)**

Ikuti pola sesi sebelumnya:
- dump `paddydev-db` → container `ui-db` di jaringan `ui-net`;
- terapkan migrasi baru ke `ui-db` (`go run ./cmd/migrate -apply` dengan `DATABASE_URL` ke container itu lewat port lokal);
- build image web & API dari branch ini;
- jalankan `ui-api` + `ui-web` di `127.0.0.1:8148`.

Lalu dengan Playwright (login `paddyhroperation@gmail.com`):
1. **Karyawan:**
   - badge Shift/Non-Shift tampil dan filter Tipe Jadwal bekerja;
   - Export mengunduh file, dan judul kolom sesuai Spec §3.2 (buka dengan excelize di skrip).
2. **Detail karyawan uji:**
   - Ubah tipe jadwal ke Non-Shift, lalu tab Jadwal Shift terkunci;
   - tab Riwayat Perubahan menampilkan entrinya.
3. **Resign** satu karyawan uji: hilang dari daftar bawaan dan pemilih cuti.
4. **Jalankan skrip ops bagian 1–2 di `ui-db`**, lalu Jadwal Kerja → Warehouse Paddy → "Terapkan jadwal tetap".
5. **Jadwal Kerja → satu toko (mis. PPJA)**, rentang 14 hari:
   - unduh template → isi via excelize → unggah → preview → centang peringatan → simpan;
   - grid menampilkan kode baru;
   - clock-in uji di tanggal yang diunggah memakai shift tersebut (cek `hris.attendance.shift_id`).
6. **Import mode Timpa** dari file export tanpa perubahan → ringkasan "0 diperbarui".

Simpan screenshot ke `.share/` dan kirim ke user. **Jangan deploy** sebelum user menyetujui.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/go-routes.generated.json backend/database/sql/fixes/2026-10-21_non_shift_hq_warehouse.sql docs/epics/EPIC-056-hris-golive-karyawan-jadwal.md docs/epics/README.md
git commit -m "chore(hris): manifest route, skrip Non-Shift HQ/Warehouse, EPIC-056"
```

---

## Rollout ke live (setelah user menyetujui hasil stack uji)

1. Backup DB: `docker exec paddydev-db pg_dump -Fc > ~/Desktop/paddydev-backups/paddydev-db-before-epic056-<ts>.dump`.
2. Merge branch ke `main`, push ke `paddydev` dan `origin`.
3. Migrasi: `go run ./cmd/migrate -apply` lalu `-verify` ke `127.0.0.1:5485`. Tampilkan baris yang berubah (jumlah shift ber-kode, `DEF`/`NS`, menu).
4. Jalankan skrip ops bagian 1, tunjukkan daftar ke user, lalu jalankan bagian 2 setelah disetujui.
5. Ganti container API & web (pola `tools/deploy-paddydev.sh` / swap manual dengan rollback ke image lama).
6. Cek ulang halaman Karyawan, Jadwal Kerja, dan Shift Kerja di live.
7. Tulis Automation Log EPIC-056, lalu status `ready-for-qa`.
