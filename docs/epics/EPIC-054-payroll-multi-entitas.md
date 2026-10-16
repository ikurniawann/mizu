# EPIC-054: Payroll Multi-Entitas — Filter Entitas & Slip per Entitas (`MODULE-PAYROLL`)

status: ready-for-qa
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
- [x] T1 Migrasi company_id (struktur gaji & run) + backfill
- [x] T2 Entitas utama & lingkup alokasi · T3 Kebijakan multi-entitas
- [x] T4 Port & endpoint entitas · T5 Run per entitas · T6 Struktur gaji per entitas + konsumen lain
- [x] T7 Kalkulasi per entitas · T8 Jurnal & slip
- [x] T9 UI Struktur Gaji (tab entitas) · T10 UI Payroll tanpa popup (tab entitas, form & hitung inline)

## Acceptance Criteria
- Given karyawan bergaji Paddy Rp1jt & Kantor Pusat Rp1jt, When run Paddy dan run Kantor Pusat dihitung, Then ia punya dua slip masing-masing gross Rp1jt.
- Given slip entitas X, Then PPh21 & BPJS-nya sama dengan karyawan yang hanya digaji X dengan nominal yang sama.
- Given cicilan pinjaman, Then hanya dipotong di slip entitas utama dan dilunasi tepat sekali saat Paid.
- Given run lama tanpa entitas pada periode P, Then run entitas untuk P ditolak dan run lama tidak bisa dihitung ulang.
- Given slip entitas B, Then tidak dialokasikan ke toko entitas A; jurnal diposting ke company B.

## Follow-up (di luar scope)
TS twin total ESS (`lib/hris/me-profile.ts`) dan dasbor eksekutif (`lib/dashboard/executive.ts`) yang masih membaca satu run (Go sudah menjumlahkan semua entitas) · menampilkan tombol Proses untuk run draft lama (diputuskan disembunyikan; draft lama sebaiknya dihapus) · effective-dating versi gaji terhadap periode payroll · business_scope per user · identitas legal per entitas (NPWP, alamat) di kop slip/laporan pajak · payroll_settings per entitas · mode K5/K6 lain · parity route TS fallback.

## Automation Log
- 2026-10-15 — Analisa + klarifikasi user (K1–K6). Data lokal: 2 entitas (Paddy, Paddy Kantor Pusat), 23 karyawan bergaji (1 versi aktif masing-masing, backfill ke entitas penempatan utama). Plan: `docs/superpowers/plans/2026-10-15-payroll-entity-filter.md`.
- 2026-10-15 — Implementasi T1–T10 selesai dan lolos review per task. Status `review`; review akhir seluruh branch masih menunggu, setelah itu naik ke `ready-for-qa`.
- 2026-10-15 — Keputusan (R2): migrasi dan tes hanya dijalankan pada salinan DB terisolasi; DB dev/live belum dimigrasi dan tetap perlu `migrate-apply` saat deploy.
- 2026-10-15 — Keputusan (R5): `db:pull` hanya membaca skema public/iam, jadi snapshot skema hris tidak diregenerasi. File delta migrasi adalah sumber kebenaran untuk `hris.employee_salary` dan `hris.payroll_runs`.
- 2026-10-15 — Keputusan (R6/R8): sinkron gaji dari kontrak (Go `SyncFromContract` dan TS `syncSalaryFromContract`) mengikuti unique index per entitas `(employee_id, company_id, effective_date)`. Karyawan yang digaji lebih dari satu entitas dilewati, tidak ditimpa otomatis; guard ini menghitung gaji tanpa entitas (NULL) sebagai grup tersendiri (R9).
- 2026-10-15 — Keputusan (R9): gaji tanpa entitas dianggap "belum ada entitas" dan digantikan saat gaji entitas dibuat (HR menginput ulang per entitas). Batas pinjaman memakai total semua gaji aktif, termasuk yang tanpa entitas.
- 2026-10-15 — Keputusan (R10/R11): ada guard lintas run pada periode yang sama; cicilan pinjaman dan potongan telat tidak pernah terulang di run entitas lain. Dalam kasus terburuk potongan sementara tidak ada di slip mana pun sampai run entitas utama dihitung ulang (hanya under-deduct, tidak pernah dobel).
- 2026-10-15 — Gate: tes Go modul payroll, app, dan accounting hijau. Dua kegagalan baseline sudah ada sebelum perubahan dan bergantung data: spa `TestTherapistPayrollTwiceAMonth` dan hris `TestAttendancePeriodClosing`. Frontend `tsc`, lint, dan vitest hijau.
- 2026-10-15 — Verifikasi in-app (Playwright, DB uji terisolasi): 28 PASS; 2 FAIL (1 false negative: teks trigger dropdown memuat glyph chevron, nilainya benar; 1 temuan nyata — sudah diperbaiki). Terbukti: karyawan bersama mendapat dua slip (Paddy dan Kantor Pusat), run entitas ganda ditolak, tab run lama tanpa form/Hitung, tab struktur gaji dan prefill berfungsi, tanpa dialog dan tanpa error halaman.
- 2026-10-15 — Temuan nyata: halaman detail payroll overflow horizontal di lebar 375px karena tombol header ("Biaya per Toko", "Export CSV") tidak wrap. Diperbaiki di gelombang fix akhir (header wrap).
- 2026-10-15 — Catatan deploy: jalankan `make -C backend migrate` lalu `migrate-apply` pada DB target. Sebelum menerapkan di data nyata, cek `SELECT count(*) FROM hris.employee_salary WHERE company_id IS NULL` setelah backfill, dan berapa baris aktif yang akan dinonaktifkan oleh dedup. Setelah `migrate-apply`, daftar karyawan dengan gaji aktif tanpa entitas (`WHERE is_active AND company_id IS NULL`): mereka tidak ikut run entitas mana pun sampai HR menetapkan entitas, dan hitung menampilkan alasan skip "Struktur gaji belum punya entitas — buat versi dengan entitas pembayar". Hapus run draft lama periode Sep & Nov 2026 sebelum periode itu diproses per entitas. Beri tahu HR bahwa run yang sudah ada kini tampil di tab "Run lama".
- 2026-10-15 — Gelombang fix akhir (review seluruh branch): (1) laporan Biaya Gaji per Toko membawa nama entitas run (field `run.company_name`; pilihan run, header, dan nama file ekspor `biaya-gaji-per-toko-<yyyy>-<mm>-<slug-entitas>`); (2) slip ESS terbaru dan "payroll terakhir" dasbor eksekutif menjumlahkan run periode terbaru (slip ESS: hanya run berstatus paid; dasbor: semua run periode itu, seperti sebelumnya); nama run, status, dan tanggal bayar tetap milik satu run (terbaru), tes ditambahkan; (3) karyawan yang hanya punya gaji aktif tanpa entitas dilewati dengan alasan "Struktur gaji belum punya entitas — buat versi dengan entitas pembayar", tes ditambahkan; (4) header detail run memakai `PageHeader` sehingga tidak overflow di 375px; (7) tab entitas diurutkan menurut nama perusahaan; (8) tab "Belum ada entitas" hanya untuk gaji aktif tanpa entitas; (9) nama file CSV detail run memuat slug entitas; (10) gagal memuat entitas menampilkan pesan galat, bukan "Belum ada entitas aktif". Item (6): tes potongan telat tidak terulang antar run entitas ditambahkan.
- 2026-10-15 — Review akhir seluruh branch: bersih setelah gelombang fix (semua 10 temuan tertangani, tanpa temuan Critical/Important baru). Verifikasi in-app ulang (Playwright, API dibangun ulang): 32/32 PASS, termasuk tanpa scroll horizontal di 375/768px pada Payroll, Struktur Gaji, dan detail run. Status → ready-for-qa; QA manusia diperlukan sebelum deploy.
- 2026-10-16 — Data uji manual: seeder `payroll-multi-entity-qa.js` (`pnpm db:seed:payroll-qa`) dijalankan di paddydev-db — 3 karyawan uji (QA054-01 full Paddy; QA054-02 Paddy + Kantor Pusat, 2 slip, kasbon; QA054-03 PVJ + Kopo, 1 slip dibagi per toko), absensi Desember 2026 di-closing. WAJIB `--cleanup` sebelum 1 Desember 2026. Panduan: `docs/qa/EPIC-054-payroll-multi-entitas-uji-manual.md`. Seeder `paddy-placements.js` disesuaikan: gaji demo ber-entitas (toko utama) dan run payroll per entitas.
