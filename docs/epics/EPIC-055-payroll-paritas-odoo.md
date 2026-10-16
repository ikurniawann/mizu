# EPIC-055: Payroll Paritas Rule Odoo — G1–G9 (`MODULE-PAYROLL`)

status: ready-for-qa
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
- [x] T1 Migrasi skema (salary, settings, overtime day_type, leave `personal`, payroll_inputs, payroll_details)
- [x] T2 Domain: basis gaji & hari hadir (G1, G8), mode tunjangan (G2), syarat masa kerja (G7)
- [x] T3 Domain: skema lembur, hari istirahat, setting clock-out (G4, G9)
- [x] T4 Domain: potongan telat bertingkat (G3)
- [x] T5 Domain: PIP/PIS & komponen manual (G6)
- [x] T6 Domain: PPh21 TER + koreksi Desember (G5)
- [x] T7 Wiring: load field baru, input manual, YTD PPh21, simpan detail; validasi setting
- [x] T8 API: CRUD + import CSV komponen manual; `day_type` lembur; tipe cuti `personal`; field struktur gaji
- [x] T9 Frontend: form struktur gaji, halaman setting, jenis hari lembur, label Izin Pribadi
- [x] T10 Frontend: komponen manual di detail run, baris slip & PDF
- [x] T11 Skrip data Odoo → field baru (paket, diuji di salinan DB)
- [x] T12 Verifikasi: kalkulator referensi rule Odoo vs paddydev di salinan DB (September), review, uji in-app

## Acceptance Criteria
- Given upah harian Rp100.000 dan 20 hari hadir, Then gaji pokok Rp2.000.000.
- Given transport Rp500.000 `per_day`, pembagi 26, 20 hari tunjangan, Then transport Rp384.615.
- Given tunjangan kesehatan Rp100.000 dengan syarat 365 hari dan masa kerja 200 hari, Then tunjangan 0.
- Given lembur 2 jam di `rest_day` dengan pokok Rp3.460.000 (skema standard), Then lembur 2 × 3.460.000/173 × 2 = Rp80.000.
- Given 5× telat dalam sebulan (mode tier), Then potongan = 1 hari THP; given 8×, Then 2 hari gaji pokok.
- Given DPP Rp10.000.000 status TK/0 (TER), Then PPh21 = 2% = Rp200.000.
- Given setting default, Then hasil semua tes payroll lama tidak berubah.

## Belum diputuskan / perlu slip Odoo
- Kontrak yang mulai/berakhir di tengah bulan: paddydev memprorata gaji pokok & tunjangan flat sesuai masa kontrak, rule Odoo `standard` membayar penuh (2 slip September). Perlu keputusan HR.
- Definisi "hari tunjangan" Odoo (`_paddy_get_allowance_days`): sementara = hari hadir. Verifikasi dengan `hr_payslip_worked_days`.
- POS_FEE di rule NET Odoo ikut mengurangi gaji bersih. Ini tidak diikuti sampai dikonfirmasi lewat slip.
- Pembulatan TER Odoo: sementara dibulatkan ke rupiah terdekat.

## Automation Log
- 2026-10-17 — Epic dibuat dari gap G1–G9 di `docs/qa/payroll-odoo-parity-uji.md`. Keputusan user tercatat di atas. Tabel TER diambil dari PDF resmi PP 58/2023 (BPK): A 44 lapisan, B 40, C 41; dicek ulang dengan gambar halaman lampiran.
- 2026-10-17 — T1–T10 selesai. Migrasi `20261017090000_leave_type_personal.sql` dan `20261017090100_payroll_odoo_parity.sql` diuji di salinan DB live (`migrate -verify`: 0 objek hilang/berbeda). Semua default mempertahankan perilaku lama; tes referensi lama (net 10.861.155) tidak berubah. Tes baru: `domain/parity_test.go` (16 kasus G1–G9, termasuk jumlah lapisan TER 44/40/41) dan `parity_integration_test.go`.
- 2026-10-17 — Keputusan teknis: hari tunjangan = hari hadir (sementara, menunggu slip Odoo). Jadwal shift karyawan ikut menentukan hari istirahat, jadi berlaku juga untuk 26 karyawan demo yang punya pola shift. Upah harian tanpa pembagi struktur: aturan per hari tidak berlaku (Odoo base_days 0). Komponen manual hanya untuk karyawan yang digaji entitas run. Tabel alokasi per toko tidak diubah: komponen baru ikut terbagi lewat total bruto/potongan/bersih.
- 2026-10-17 — T11: `tools/payroll_rules.py` → `payroll_rules.sql`. Isinya: aturan perhitungan per kontrak Odoo untuk 602 struktur gaji import, 194 lembur `rest_day` (holiday_special), 157 cuti → `personal`, dan setting payroll (TER both, telat tier min 15 menit, PIP/PIS on, tarif produksi 18.000). Trigger notifikasi cuti dimatikan sementara saat update cuti.
- 2026-10-17 — T12: payroll September dihitung di salinan DB dengan API branch, lalu dibandingkan dengan kalkulator referensi independen yang menghitung rule Odoo dari CSV mentah. Hasilnya 261/263 slip identik di semua komponen. Sisa 2 slip = prorata kontrak tengah bulan (lihat "Belum diputuskan"). Temuan yang diperbaiki: potongan Izin Pribadi untuk freelancer upah harian tanpa struktur. Uji UI (Playwright, stack branch di DB salinan): halaman pengaturan, struktur gaji, detail run (komponen manual), slip, dan lembur tampil tanpa error. Kegagalan bawaan yang identik dengan `main` di DB salinan: hris TestAttendancePeriodClosing & TestLeaves, site/storedvalue/auth (403), spa TestTherapistPayrollTwiceAMonth; shop timeout (tidak bergantung pada payroll/hris).
- 2026-10-17 — Review independen (agent terpisah): 9 temuan terkonfirmasi, semuanya diperbaiki.
  - Sinkron kontrak mereset aturan perhitungan.
  - Jadwal sebagai hari istirahat mengubah perilaku default → jadi setting `overtime_rest_from_schedule` (default off; Paddy on lewat `payroll_rules.sql`).
  - Cuti tanpa upah terpotong ganda pada upah harian/prorata.
  - LATE_OVERRIDE 0 tidak bisa disimpan.
  - Nominal desimal ×100.
  - Basis "employer" memasukkan JHT/JP perusahaan → sekarang standar DJP (JKK, JKM, Kes).
  - Penghasilan tidak kena pajak tidak masuk total bruto/alokasi → masuk; kolom komponen baru ditambahkan ke `payroll_detail_allocations`.
  - Keterangan PPh21 Desember.
  - Minor: UUID, hari istirahat hanya HR.
  - Kombinasi upah harian + lembur standar dipertahankan demi paritas Odoo (1 struktur), dengan peringatan di form.
  - Uji ulang di salinan DB baru: migrate -verify bersih; tes payroll/app/accounting lolos; referensi September tetap 261/263; total bruto alokasi = total slip.
- 2026-10-17 — Deploy ke live (paddydev.reddie.id) atas persetujuan user.
  - Backup sebelum deploy: `~/Desktop/paddydev-backups/paddydev-db-before-epic055-deploy-20261017-023514.dump`.
  - `main` di-push (a7ac857), lalu `tools/deploy-paddydev.sh` → image `local-20261017-023533`. 2 migrasi diterapkan, `-verify` 0 berbeda.
  - `payroll_rules.sql` (paket import) dijalankan: ringkasan sama persis dengan uji di salinan DB.
  - Perubahan jumlah baris hanya `hris.payroll_inputs` (tabel baru, 0 baris), `hris.payroll_settings` 0→1, dan `schema_migrations` +2.
  - Tidak ada notifikasi yang terkirim; trigger aktif; struktur gaji non-import tidak berubah.
  - Uji halaman live sebagai Admin HRIS lolos: pengaturan, struktur gaji, detail run, lembur, Beranda.
  - Status → ready-for-qa.
  - Run payroll yang sudah ada belum dihitung ulang (tindakan HR).
