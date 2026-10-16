# Uji Payroll paddydev vs Rule Penggajian Odoo

Tujuan: memastikan payroll paddydev menghasilkan slip yang sama dengan Odoo untuk karyawan hasil import HRIS Odoo
(16-10-2026), atau mengetahui persis di rule mana dan kenapa hasilnya berbeda.

- **Periode uji: September 2026.** Ini bulan penuh terakhir yang ada di export Odoo, dan periode absensinya sudah closing di paddydev.
- **Data September di paddydev:**
  - 6.730 absensi;
  - 602 lembur approved;
  - 159 cuti approved;
  - 15 pinjaman aktif.
- **Data acuan:** rule Odoo dari export `hr_salary_rule.csv` (44 rule) dan `hr_payroll_structure.csv` (19 struktur).

Kode mesin paddydev ada di `backend/internal/modules/payroll/domain/calculator.go` dan `inputs.go`.

Status per rule:
- **SAMA**: rumus sama, hasil harus identik.
- **BEDA**: fitur ada tapi rumusnya lain, jadi selisihnya diperkirakan.
- **TIDAK ADA**: paddydev belum punya fiturnya.

---

## Langkah 0 — Prasyarat (wajib sebelum uji angka)

1. **Minta export slip gaji Odoo September 2026**, yaitu tabel `hr_payslip`, `hr_payslip_line`,
   `hr_payslip_worked_days` dan `hr_payslip_input`.
   - Export 15-10-2026 **tidak memuat slip gaji**, sehingga belum ada angka acuan per karyawan.
   - Tanpa slip Odoo, uji hanya bisa memeriksa rumus, bukan membandingkan hasil.
   - Slip ini juga diperlukan untuk memastikan rumus di dalam modul Odoo yang tidak ikut ter-export:
     `_l10n_id_calc_bpjs` (tarif & batas BPJS), `_l10n_id_calc_pph21_ter_formula` (tabel TER),
     `_paddy_get_lateness_tier_amount`, `_paddy_get_work_month_days` dan `_paddy_get_allowance_days`.
2. **Backup DB** sebelum menjalankan Hitung/Paid di live, ke `~/Desktop/paddydev-backups/`.
   Lebih aman lagi, uji dulu di salinan DB.
3. **Jangan Mark Paid run uji.** Paid akan memotong saldo pinjaman sungguhan dan memposting jurnal.
4. **Run September entitas Paddy sudah ada (draft, data demo 23 karyawan).** Hitung ulang akan ikut memasukkan semua
   karyawan aktif hasil import yang struktur gajinya di entitas Paddy (134 orang). Entitas Paddy Kantor Pusat
   (129 orang) belum punya run September, jadi buat dulu dari HRIS → Payroll → tab entitas.

## Langkah 1 — Samakan setting & data dengan Odoo

`hris.payroll_settings` masih kosong, jadi semua nilai di bawah adalah default kode paddydev. Ubah di halaman `/dashboard/hris/payroll/settings`.

| # | Item | Odoo | paddydev sekarang | Tindakan sebelum uji |
|---|---|---|---|---|
| 1.1 | Tapera | Tidak ada rule Tapera | **Dipotong 2,5% karyawan + 0,5% perusahaan**: `tapera_enrolled = true` di 263 gaji hasil import | **Sudah dijalankan 17-10-2026:** `tapera_enrolled = false` di 602 gaji hasil import |
| 1.2 | Dasar BPJS | `BASIC + ALW_FIXED_TAX + ALW_FIXED_NONTAX` (input tetap). Tunj. jabatan & subsidi kesehatan **tidak** ikut | `base + fixed_allowance`. Import mengisi `fixed_allowance` = tunj. jabatan + kesehatan, jadi ikut jadi dasar BPJS | **Sudah dijalankan 17-10-2026:** 189 baris (111 aktif, total Rp94.053.100) dipindah ke `variable_allowance` (tetap kena pajak, tidak jadi dasar BPJS) |
| 1.3 | Tarif BPJS | Di modul Odoo (lihat slip) | JHT 2%/3,7% · JP 1%/2% · JKK 0,24% · JKM 0,30% · Kes 1%/4% | Cocokkan dengan baris BPJS slip Odoo; JKK Odoo = `very_low` = 0,24% |
| 1.4 | Batas upah BPJS | Di modul Odoo | TK 10.414.000 (tetap di kode, juga berlaku untuk JHT) · Kes 12.000.000 | Cocokkan dengan slip gaji di atas batas |
| 1.5 | JP karyawan | Di modul Odoo | Hanya dipotong bila upah ≥ 5.000.000 | Cocokkan dengan slip gaji < 5 jt |
| 1.6 | Lembur | Pembagi 173; 1,5× hari biasa; 2× libur/istirahat mingguan | Pembagi 173; 1,5×; 2× hanya libur nasional | Default sudah sama; selisih hari istirahat mingguan lihat 2.7 |
| 1.7 | Potongan telat | Bertingkat per bulan (2.15) | `late_deduction_mode = off` | Tidak bisa disamakan; biarkan `off`, catat selisihnya |
| 1.8 | PTKP | `l10n_id_ptkp_id` kosong untuk 337 dari 339 karyawan aktif | Semua gaji `TK/0` | Pastikan kategori TER di slip Odoo; isi PTKP yang benar per karyawan bila ada datanya |

> 1.1 dan 1.2 sudah dijalankan 17-10-2026. Backup sebelumnya: `paddydev-db-before-salary-tapera-allowance-20261017-005045.dump`; nilai lama per baris di `~/Desktop/paddydev-exports/salary-adjustment-before-20261017.csv`. Run draft (Sep Paddy, Nov Paddy & Kantor Pusat) perlu **Hitung ulang**.

## Langkah 2 — Uji per rule Odoo (urut `sequence` Odoo)

Contoh karyawan per kasus dipilih dengan query di Langkah 5. Setiap kasus diuji pada run September: buka detail
slip paddydev, bandingkan dengan baris yang sama di slip Odoo.

| # | Rule Odoo | Rumus Odoo | paddydev | Status | Cara uji & hasil yang diharapkan |
|---|---|---|---|---|---|
| 2.1 | **GP** standard (214 kontrak) | `wage` penuh | `base_salary`, diprorata kalau kontrak tidak menutup satu periode penuh | SAMA* | Karyawan kontrak penuh September: gaji pokok = wage Odoo. *Kontrak mulai/akhir di tengah bulan: Odoo bayar penuh, paddydev prorata, jadi catat selisihnya |
| 2.2 | **GP** monthly_prorated (32) | `wage / hari struktur × hari hadir` | Tidak memakai hari hadir | TIDAK ADA | Karyawan dengan hari hadir < hari struktur: Odoo < penuh, paddydev penuh |
| 2.3 | **GP** daily (18; Rp60.000–115.000/hari) | `wage × hari hadir` | `base_salary` dianggap bulanan, jadi gaji pokok = 60–115 ribu | TIDAK ADA | Gaji pokok paddydev jauh di bawah Odoo; **wajib ditangani sebelum dipakai** (lihat Gap G1) |
| 2.4 | **TJ_TRANS** (214 basic / 50 flat) | basic: `transport / hari struktur × hari tunjangan`; flat: penuh | Selalu penuh (flat) | BEDA | Karyawan basic yang absen/cuti: Odoo < penuh, paddydev penuh. Karyawan flat: SAMA |
| 2.5 | **TJ_MKN** (230 basic / 34 flat) | sama seperti 2.4 | Selalu penuh | BEDA | sama seperti 2.4 |
| 2.6 | **TJ_JAB** (244 basic / 20 flat; 55 kontrak berisi) | sama seperti 2.4 | Dari `variable_allowance` (setelah 1.2), penuh | BEDA | sama seperti 2.4 |
| 2.7 | **OT_HKB** | `1,5 × wage/173 × jam lembur hari biasa` | `1,5 × base/173 × jam` | SAMA* | Lembur hari kerja: identik. *Lembur Sabtu/Minggu (158 dari 602 di September) dibayar 1,5× di paddydev, Odoo 2× bila hari itu istirahat mingguan |
| 2.8 | **OT_HLN** | `2 × wage/173 × jam libur nasional/istirahat mingguan` | `2 × base/173 × jam`, hanya tanggal di Hari Libur (status aktif) | BEDA | Lembur di libur nasional: SAMA. Di hari istirahat mingguan: selisih 0,5 × upah per jam |
| 2.9 | Syarat lembur dibayar | Dari jam lembur di worked days Odoo | Hanya bila ada absensi **dengan clock-out** di tanggal itu; jam = min(pengajuan, lembur absensi) | BEDA | 50 lembur approved September tidak dibayar paddydev (32 tanpa absensi, 18 lupa check-out) |
| 2.10 | **OT_PROD** (6 kontrak production) | `18.000 × (jam biasa + 2 × jam akhir pekan)` | Rumus umum 1,5×/2× upah/173 | TIDAK ADA | Bandingkan karyawan tipe Production |
| 2.11 | **OT_RET_FREE** (freelance) | `(upah harian / 8) × jam akhir pekan` | Rumus umum | TIDAK ADA | Bandingkan karyawan tipe Freelance |
| 2.12 | **OT_DAILY_WORKER** | `(upah harian / 5) × total jam` | Rumus umum | TIDAK ADA | Bandingkan karyawan tipe Daily Worker |
| 2.13 | **INSURANCE** (Rp100.000, 90 kontrak) | Dibayar hanya bila masa kerja ≥ 365 hari sejak kontrak pertama | Selalu dibayar (dari `variable_allowance`) | BEDA | Karyawan masa kerja < 1 tahun: Odoo 0, paddydev 100.000 |
| 2.14 | **BPJS** JHT/JP/JKK/JKM/Kes (perusahaan & karyawan) | Dasar `BASIC + input tetap` | Dasar `base + fixed` (lihat 1.2–1.5) | SAMA setelah 1.2 | Cocokkan 5 baris BPJS per slip untuk gaji < 5 jt, 5–10,4 jt, > 12 jt |
| 2.15 | **PT / PH / PS** potongan telat (onsite 247 / hybrid 7 / shift 10) | Toleransi 15 menit; per bulan: 0–3× telat = 0, 4–6× = 1 hari THP, 7–9× = 2 hari gaji pokok, > 9× = 3 hari gaji pokok | `off`; mode lain hanya per menit/per kejadian | TIDAK ADA | 122 karyawan telat di September (333 hari). Odoo memotong untuk yang ≥ 4×, paddydev 0 |
| 2.16 | **PIP** potongan izin pribadi | `THP / hari struktur × hari izin pribadi` | Izin Pribadi diimport sebagai `emergency`, tidak dipotong | TIDAK ADA | 27 cuti `emergency` approved di September (Izin Pribadi & Cuti Menikah Odoo; cek tag `[Odoo: Izin Pribadi]` di alasan) |
| 2.17 | **PIS** potongan izin sakit | `(transport + makan) / hari struktur × hari sakit` | Tidak ada potongan sakit | TIDAK ADA | 70 cuti sakit approved di September |
| 2.18 | Cuti Unpaid | Mengurangi hari kerja di worked days | `base / hari kerja × hari kalender` cuti unpaid | BEDA | Tidak ada cuti unpaid approved di September; uji dengan data buatan bila perlu |
| 2.19 | **LOAN** | Input manual per slip | Otomatis: `min(cicilan, sisa)` mulai `first_installment` | BEDA (sumber) | 15 pinjaman aktif: nominal potongan = cicilan baris Odoo bulan itu |
| 2.20 | **POS_FEE** biaya jabatan | `−min(5% × bruto, 500.000)` dan **ikut mengurangi NET** di rule NET Odoo | Hanya pengurang pajak tahunan (5%, maks 6 jt/tahun), tidak mengurangi gaji bersih | BEDA | Pastikan dengan slip Odoo apakah gaji bersih memang dipotong POS_FEE |
| 2.21 | **PPH21** | TER bulanan (PP 58/2023): DPP = GP + tunjangan kena pajak + BPJS (basis `both`: perusahaan + karyawan) | Disetahunkan progresif tiap bulan, tanpa TER, tanpa koreksi Desember | BEDA | Selisih pajak pasti ada; catat per karyawan. Metode Odoo `gross` (bukan gross-up) |
| 2.22 | Input manual: BONUS, INSENTIF, NATURA_TAX, TJ_TRANS_LOCATION, ALW_*, DND, DED_OTHER, DED_ABSENCE, DED_UNION, DED_PENSION | Diisi per slip | Tidak ada input manual di payroll HRIS | TIDAK ADA | Catat slip Odoo yang punya input ini (dari `hr_payslip_input`) |
| 2.23 | THR (rule nonaktif di Odoo) | Tidak dipakai | Opsi centang `include_thr` | — | Jangan centang THR saat Hitung September |
| 2.24 | **NET** | Jumlah pendapatan + potongan (termasuk POS_FEE) + PPh21 | Bruto − BPJS karyawan − PPh21 − pinjaman − telat − unpaid | — | Selisih NET = jumlah selisih 2.1–2.22 |

## Langkah 3 — Uji ujung ke ujung (run September per entitas)

1. HRIS → Payroll → tab **Paddy** → run September → **Hitung**. Ulangi untuk tab **Paddy Kantor Pusat** (buat run dulu).
2. **Jumlah karyawan:** Paddy 134 dan Kantor Pusat 129 hasil import, ditambah data demo.
   - Karyawan aktif tanpa struktur gaji aktif (Paddy 32, Kantor Pusat 42) harus muncul dengan alasan skip "Belum ada struktur gaji aktif".
3. **Pilih 10 karyawan contoh per entitas** (query Langkah 5), mencakup:
   - standard, monthly_prorated, daily;
   - transport basic dan flat;
   - onsite dan shift;
   - punya lembur akhir pekan;
   - punya pinjaman;
   - telat ≥ 4×;
   - masa kerja < 1 tahun.
4. **Isi lembar banding per karyawan:** baris slip Odoo vs paddydev untuk GP, TJ_TRANS, TJ_MKN, TJ_JAB, INSURANCE, lembur,
   5 BPJS, PPh21, potongan telat/izin, pinjaman, NET. Tandai selisih yang dijelaskan oleh status BEDA/TIDAK ADA di Langkah 2.
   - **Lulus** bila semua baris berstatus SAMA identik dan setiap selisih lain tercatat penyebabnya.
5. **Total run:** bandingkan total bruto, BPJS, PPh21 dan NET per entitas dengan rekap payroll Odoo September.
6. **Slip PDF & ESS:** buka slip satu karyawan dari HRIS → Payslip, lalu login ESS karyawan tersebut (kalau punya akun) dan cek Area Karyawan → Slip Gaji.
7. **Biaya per Toko:** buka laporan Biaya Gaji per Toko run itu dan pastikan karyawan muncul di toko penempatannya (cabang `ODOO-*`).

## Langkah 4 — Hasil yang tidak boleh terjadi

- **Proses/Completed saat periode absensi masih open:** harus ditolak (September sudah closing).
- **Pinjaman terpotong dua kali** (di run Paddy dan Kantor Pusat sekaligus): hanya boleh di entitas utama.
- **Karyawan non-aktif (274 hasil import) masuk run.**
- **Error halaman atau Hitung gagal** ("Gagal menyimpan detail").

## Langkah 5 — Query memilih karyawan contoh (read-only)

```sql
-- Kontrak aktif hasil import + atribut Odoo yang menentukan rule (dibaca dari catatan kontrak)
SELECT e.nip, e.full_name, co.name AS entitas, b.code AS cabang,
       substring(c.notes FROM 'tipe Odoo: ([^;]+)')      AS tipe_odoo,
       substring(c.notes FROM 'aturan gaji: ([^;]+)')    AS aturan_gaji,
       substring(c.notes FROM 'pola kerja: ([^;]+)')     AS pola_kerja,
       s.base_salary, s.transport_allowance, s.meal_allowance, s.fixed_allowance, e.join_date,
       (SELECT count(*) FROM hris.attendance a WHERE a.employee_id = e.id AND a.is_late
          AND a.date BETWEEN '2026-09-01' AND '2026-09-30') AS telat_sep,
       (SELECT count(*) FROM hris.overtime_requests o WHERE o.employee_id = e.id AND o.status = 'approved'
          AND o.date BETWEEN '2026-09-01' AND '2026-09-30' AND extract(isodow FROM o.date) IN (6, 7)) AS lembur_akhir_pekan_sep,
       (SELECT count(*) FROM hris.loans l WHERE l.employee_id = e.id AND l.status = 'approved' AND l.remaining_balance > 0) AS pinjaman_aktif
FROM hris.employees e
JOIN hris.employment_contracts c ON c.employee_id = e.id AND c.status = 'active'
JOIN hris.employee_salary s ON s.employee_id = e.id AND s.is_active
JOIN configuration.companies co ON co.id = s.company_id
JOIN hris.employee_placements p ON p.employee_id = e.id AND p.is_primary
JOIN configuration.branches b ON b.id = p.branch_id
WHERE e.is_active AND e.notes LIKE 'Import Odoo%'
ORDER BY aturan_gaji, pola_kerja, telat_sep DESC;
```

Mode tunjangan (basic/flat), struktur gaji (pembagi 20/25/26 hari) dan tanggal kontrak pertama **tidak tersimpan di
paddydev**. Ambil dari `hr_contract.csv` Odoo: kolom `transport_allowance_rule`, `meal_allowance_rule`,
`position_allowance_rule`, `struct_id`, dan `first_contract_date` di `hr_employee.csv`. ID kontrak Odoo ada di
catatan kontrak paddydev (`hr.contract #<id>`).

## Gap yang perlu dikembangkan agar payroll setara Odoo

Urut menurut dampak ke karyawan:

| Gap | Rule Odoo | Dampak | Usulan |
|---|---|---|---|
| G1 | GP daily (18 karyawan) | Gaji pokok hanya Rp60–115 ribu sebulan | Tambah mode gaji `daily` di struktur gaji (upah × hari hadir) |
| G2 | Tunjangan basic per hari hadir (± 214 kontrak) | Tunjangan dibayar penuh walau absen | Mode tunjangan `flat`/`per hari hadir` + pembagi hari struktur per karyawan |
| G3 | Potongan telat bertingkat (122 karyawan telat di September) | Tidak ada potongan | Mode `tier` (0–3/4–6/7–9/>9, toleransi 15 menit) |
| G4 | Lembur hari istirahat mingguan 2× + rumus Production/Freelance/Daily Worker | Lembur akhir pekan kurang bayar | Hari istirahat dari jadwal karyawan; rumus lembur per tipe kontrak |
| G5 | PPh21 TER | Pajak bulanan berbeda | Metode TER PP 58/2023 + koreksi Desember |
| G6 | PIP/PIS & input manual (bonus, insentif, denda, dll.) | Potongan/tambahan tidak ada | Input komponen manual per slip |
| G7 | INSURANCE ≥ 365 hari | Subsidi dibayar terlalu dini | Syarat masa kerja pada komponen tunjangan |
| G8 | GP monthly_prorated (32) | Gaji tidak diprorata hari hadir | Mode prorata hari hadir |
| G9 | Lembur tanpa clock-out (50 di September) | Lembur approved tidak dibayar | HR melengkapi clock-out, atau aturan pembayaran lembur tanpa absensi |
