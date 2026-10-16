# EPIC-055: Payroll Paritas Rule Odoo — G1–G9 (`MODULE-PAYROLL`)

status: coding
environment: dev
retries: 0

## Goal
Slip gaji paddydev untuk karyawan hasil import HRIS Odoo (16-10-2026) mengikuti rule penggajian Odoo (`hr_salary_rule`, 44 rule; 19 struktur), sehingga payroll bisa pindah dari Odoo tanpa selisih yang tidak dijelaskan. Rencana uji: `docs/qa/payroll-odoo-parity-uji.md`.

## Keputusan user (2026-10-17)
- **PPh21:** TER persis Odoo. Ada setting basis BPJS dasar pajak, default `both` (iuran perusahaan + karyawan), plus koreksi Pasal 17 di Desember.
- **Izin Pribadi:** tipe cuti baru `personal` yang memotong gaji. Cuti hasil import bertanda `[Odoo: Izin Pribadi]` dipindah ke tipe ini; Cuti Menikah tetap `emergency`.
- **Lembur tanpa clock-out (G9):** jadi setting. Default tetap wajib clock-out; HR yang menyalakan.
- **Hari istirahat mingguan:** ditandai di pengajuan lembur (`day_type`). Data import memakai penanda Odoo `holiday_special`. Juga dihitung sebagai hari istirahat: hari tanpa shift di jadwal karyawan, dan libur nasional.

## Desain
Semua kolom/setting baru punya **default yang mempertahankan perilaku lama**, sehingga tenant lain dan data demo tidak berubah sampai dikonfigurasi.

**Struktur gaji (`hris.employee_salary`)**
- `pay_basis` (G1, G8): `monthly` | `monthly_prorated` | `daily`.
  - `monthly_prorated`: gaji pokok = pokok / pembagi × hari hadir.
  - `daily`: gaji pokok = upah × hari hadir.
- `working_days_divisor`: pembagi hari struktur Odoo (20/24/25/26). NULL = hari kerja hasil hitung (jadwal → absensi → 20).
- Mode tunjangan (G2): `transport_mode`, `meal_mode`, `position_mode` = `flat` | `per_day`.
  - `per_day`: tunjangan / pembagi × hari tunjangan.
- `position_allowance` (Tunj. Jabatan) dan `health_allowance` (Subsidi BPJS Kes). Keduanya kena pajak dan **bukan** dasar BPJS.
  - `health_min_service_days` (G7): tunjangan kesehatan hanya dibayar bila masa kerja sejak `join_date` ≥ nilai ini.
- `overtime_scheme` (G4): `standard` | `production` | `freelance` | `daily_worker`.

**Setting payroll (`hris.payroll_settings`)**
- Potongan telat (G3): `late_deduction_mode` menerima nilai baru `tier`.
  - `late_tier_rules` jsonb, default rule Odoo: 4–6× = 1 hari THP, 7–9× = 2 hari pokok, ≥10× = 3 hari pokok.
  - `late_min_minutes`: telat baru dihitung bila menitnya ≥ nilai ini.
- PPh21 (G5): `pph21_method` (`annualized` | `ter`) dan `pph21_bpjs_basis` (`employer` | `employee` | `both`).
- Lembur (G4, G9): `overtime_production_rate` (18.000) dan `overtime_requires_clockout` (true).
- Potongan cuti (G6): `personal_leave_deduction` (PIP: THP / pembagi × hari) dan `sick_leave_deduction` (PIS: (transport + makan) / pembagi × hari). Keduanya boolean.

**Pengajuan lembur (`hris.overtime_requests.day_type`)**: `regular` | `rest_day`.

**Rumus lembur per skema (G4)**

| Skema | Rumus |
|---|---|
| standard | 1,5 × pokok/173 × jam biasa + 2 × pokok/173 × jam istirahat/libur |
| production | tarif × (jam biasa + 2 × jam istirahat) |
| freelance | upah harian / 8 × jam istirahat |
| daily_worker | upah harian / 5 × total jam |

**Komponen manual (G6):** tabel `hris.payroll_inputs` per run × karyawan × kode. Jenisnya:
- `earning_taxable`: Bonus, Insentif, Natura, Tunj. Transport Lokasi, Tunjangan Lain;
- `earning_nontax`;
- `deduction`: Denda, Potongan Absen, Iuran Serikat, Potongan Lain;
- `late_override`: menggantikan potongan telat otomatis, seperti input PT di Odoo.

**Cuti:** enum `public.leave_type` mendapat nilai baru `personal` (Izin Pribadi).

**PPh21 TER (G5)**
- Tarif dari PP 58/2023 Lampiran A/B/C, diverifikasi dari PDF resmi BPK.
- Kategori: A = TK/0, TK/1, K/0; B = TK/2, TK/3, K/1, K/2; C = K/3.
- DPP = bruto kena pajak + BPJS sesuai basis.
- Desember: Pasal 17 setahun dikurangi PPh21 Januari–November dari slip entitas yang sama.

**Slip (`hris.payroll_details`):** kolom baru untuk tunj. jabatan, tunj. kesehatan, potongan izin pribadi, potongan sakit, hari hadir, hari tunjangan, dan rincian komponen manual (jsonb). Metode PPh21, kategori TER, tarif TER dan DPP disimpan untuk audit.

## Tasks
- [ ] T1 Migrasi skema (salary, settings, overtime day_type, leave `personal`, payroll_inputs, payroll_details)
- [ ] T2 Domain: basis gaji & hari hadir (G1, G8), mode tunjangan (G2), syarat masa kerja (G7)
- [ ] T3 Domain: skema lembur, hari istirahat, setting clock-out (G4, G9)
- [ ] T4 Domain: potongan telat bertingkat (G3)
- [ ] T5 Domain: PIP/PIS & komponen manual (G6)
- [ ] T6 Domain: PPh21 TER + koreksi Desember (G5)
- [ ] T7 Wiring: load field baru, input manual, YTD PPh21, simpan detail; validasi setting
- [ ] T8 API: CRUD + import CSV komponen manual; `day_type` lembur; tipe cuti `personal`; field struktur gaji
- [ ] T9 Frontend: form struktur gaji, halaman setting, jenis hari lembur, label Izin Pribadi
- [ ] T10 Frontend: komponen manual di detail run, baris slip & PDF
- [ ] T11 Skrip data Odoo → field baru (paket, diuji di salinan DB)
- [ ] T12 Verifikasi: kalkulator referensi rule Odoo vs paddydev di salinan DB (September), review, uji in-app

## Acceptance Criteria
- Given upah harian Rp100.000 dan 20 hari hadir, Then gaji pokok Rp2.000.000.
- Given transport Rp500.000 `per_day`, pembagi 26, 20 hari tunjangan, Then transport Rp384.615.
- Given tunjangan kesehatan Rp100.000 dengan syarat 365 hari dan masa kerja 200 hari, Then tunjangan 0.
- Given lembur 2 jam di `rest_day` dengan pokok Rp3.460.000 (skema standard), Then lembur 2 × 3.460.000/173 × 2 = Rp80.000.
- Given 5× telat dalam sebulan (mode tier), Then potongan = 1 hari THP; given 8×, Then 2 hari gaji pokok.
- Given DPP Rp10.000.000 status TK/0 (TER), Then PPh21 = 2% = Rp200.000.
- Given setting default, Then hasil semua tes payroll lama tidak berubah.

## Belum diputuskan / perlu slip Odoo
- Definisi "hari tunjangan" Odoo (`_paddy_get_allowance_days`): sementara = hari hadir. Verifikasi dengan `hr_payslip_worked_days`.
- POS_FEE di rule NET Odoo ikut mengurangi gaji bersih. Ini tidak diikuti sampai dikonfirmasi lewat slip.
- Pembulatan TER Odoo: sementara dibulatkan ke rupiah terdekat.

## Automation Log
- 2026-10-17 — Epic dibuat dari gap G1–G9 di `docs/qa/payroll-odoo-parity-uji.md`. Keputusan user tercatat di atas. Tabel TER diambil dari PDF resmi PP 58/2023 (BPK): A 44 lapisan, B 40, C 41; dicek ulang dengan gambar halaman lampiran.
