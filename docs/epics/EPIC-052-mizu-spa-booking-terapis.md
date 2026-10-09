# EPIC-052: Mizu Spa — Booking, Terapis, dan Komisi (Fase 1)

status: ready-for-qa
environment: dev
retries: 0

## Goal

Menjadikan ERP ini sistem operasional untuk **Mizu**, jaringan tempat massage dengan
**outlet milik sendiri** (tanpa kerja sama hotel, tanpa revenue sharing). Fase 1
mengirim inti operasional spa yang belum ada sama sekali di sistem: booking treatment,
penugasan terapis per treatment, pelaksanaan layanan, checkout ke POS, dan komisi
terapis.

Referensi kebutuhan: PRD Alaya (`/home/wit/Desktop/alaya.md`) bagian 6 (BKG-01..08),
14 (HR-08, HR-09, HR-12), 10 (CAT-05, harga outlet + komisi), 18 (PUB-01).
Fitur Alaya yang **tidak** dipakai: partner/hotel, kontrak partnership, revenue
sharing, billing client, channel "Charge in Room", booking tamu hotel, dashboard HR
Mitra.

## Keputusan bisnis (dikonfirmasi pemilik, 2026-10-07)

| Topik | Keputusan |
| --- | --- |
| Model outlet | Outlet milik sendiri; tidak ada bagi hasil. |
| Status layanan | Terapis mengubah sendiri dari HP (Area Karyawan `/dashboard/me/spa`); resepsionis dapat override dari dashboard. |
| Jadwal bentrok | Sistem **menolak** penugasan terapis yang bentrok waktu. Ruangan/bed tidak dijadwalkan. |
| Komisi | Diatur per treatment/varian: persentase **atau** nominal tetap, dapat berbeda per outlet. |

## Konsep dan pemetaan ke ERP

| Konsep spa | Implementasi |
| --- | --- |
| Outlet | `configuration.branches` + baris `spa.outlets` (stall POS, jam buka, booking publik). |
| Treatment + varian durasi | `spa.treatments` + `spa.treatment_variants` (durasi, buffer, harga dasar). Harga per outlet di `spa.variant_outlet_prices`. |
| Produk POS | Dibuat otomatis per (varian, outlet) — `item.products` + `pos.pos_products`, station `spa` — dan dipetakan di `spa.variant_pos_products`. |
| Terapis | `spa.therapists` → `hris.employees` (outlet asal). Perbantuan antar-outlet: `spa.therapist_assists`. |
| PIC outlet | `spa.outlet_pics` (outlet ↔ karyawan). |
| Pelanggan | `pos.pos_customers` (find-or-create berdasarkan nomor HP). |
| Checkout | Booking membuat **open bill** POS (pending/unpaid, berisi item treatment) lalu kasir membayarnya di `/dashboard/pos/cashier-new?orderId=…&pay=1`. |
| Status pembayaran | Diperbarui dari event outbox `pos.sale.completed` / `pos.orders.voided`, plus sinkronisasi saat dibaca. |

## Status

**Item treatment** (`spa.booking_items.status`):

```
unassigned ──assign──► assigned ──start──► in_treatment ──complete──► completed
    ▲                     │  │                                           ▲
    └──────unassign───────┘  └──────────complete (override staf)─────────┘
unassigned|assigned ──cancel──► cancelled
```

**Booking** (`spa.bookings.status`) diturunkan dari item:
`cancelled` (dibatalkan) · `expired` (lewat jadwal tanpa dimulai) · `in_treatment` (ada item berjalan) ·
`completed` (semua item aktif selesai) · `unassigned` (ada item aktif belum ditugaskan) · `assigned`.

**Pembayaran** (`spa.bookings.payment_status`) terpisah: `unpaid` · `paid` · `void`.
Booking selesai **tidak** berarti lunas.

Aturan:
- Penugasan terapis ditolak bila interval `[starts_at, ends_at + buffer)` bentrok dengan item aktif
  (`assigned`/`in_treatment`) terapis tersebut, di bawah advisory lock per terapis.
- Terapis yang boleh ditugaskan di outlet X pada tanggal D: outlet asal = X, atau punya perbantuan
  aktif ke X yang mencakup D.
- Checkout butuh: booking tidak `cancelled`/`expired`, tidak ada item aktif `unassigned`, belum ada
  open bill aktif (jika ada, checkout mengembalikan order yang sama).
- Item yang sudah dimulai/selesai tidak dapat dibatalkan/dihapus; booking `paid` tidak dapat dibatalkan.
- Booking `unassigned`/`assigned` yang jam selesainya lewat > 2 jam ditandai `expired` (sweep saat dibaca).
- Komisi item dibekukan saat item `completed` (aturan yang berlaku saat itu). Komisi diakui di laporan
  hanya bila booking `paid`.

Resolusi aturan komisi (paling spesifik menang): varian+outlet → varian → treatment+outlet →
treatment → default+outlet → default. `percent`: `harga × nilai / 100`; `fixed`: `nilai`.

## Skema (`spa`, migrasi `20261008100000_spa_booking.sql`)

- `spa.outlets(branch_id PK, warehouse_id, open_time, close_time, slot_minutes, public_booking, is_active)`
- `spa.treatments(id, code UNIQUE, name, category, description, is_active, sort_order)`
- `spa.treatment_variants(id, treatment_id, name, duration_min, buffer_min, price_idr, is_active, sort_order)`
- `spa.variant_outlet_prices(variant_id, branch_id, price_idr)`
- `spa.variant_pos_products(variant_id, branch_id, pos_product_id)`
- `spa.therapists(id, employee_id UNIQUE, home_branch_id, gender, is_active)`
- `spa.therapist_assists(id, therapist_id, branch_id, start_date, end_date, note)`
- `spa.outlet_pics(branch_id, employee_id)`
- `spa.bookings(id, booking_code, company_id, branch_id, warehouse_id, booking_type, source, customer_id,
  customer_name, customer_phone, therapist_gender_pref, notes, scheduled_at, status, payment_status,
  pos_order_id, checked_out_at, paid_at, cancelled_at, cancel_reason, created_by)`
- `spa.booking_items(id, booking_id, variant_id, treatment_name, variant_name, duration_min, buffer_min,
  price_idr, therapist_id, starts_at, ends_at, status, started_at, completed_at, commission_type,
  commission_value, commission_idr)`
- `spa.booking_events(id, booking_id, item_id, action, from_status, to_status, actor_user_id, note, created_at)`
- `spa.commission_rules(id, treatment_id, variant_id, branch_id, commission_type, value, is_active)`

Station POS baru `spa` (tidak dikirim ke dapur/printer). Role baru: `spa_frontdesk` (Resepsionis Spa),
`spa_therapist` (Terapis).

## Menu IAM

| Code | Menu | Route |
| --- | --- | --- |
| `spa` | Spa (group) | — |
| `spa.bookings` | Booking | `/dashboard/spa/bookings` |
| `spa.book-order` | Book Order | `/dashboard/spa/book-order` |
| `spa.treatments` | Treatment | `/dashboard/spa/treatments` |
| `spa.therapists` | Terapis | `/dashboard/spa/therapists` |
| `spa.commissions` | Komisi Terapis | `/dashboard/spa/commissions` |
| `spa.outlets` | Outlet Spa | `/dashboard/spa/outlets` |
| `ess.spa` | Tugas Terapis | `/dashboard/me/spa` |

## API

Semua respons memakai amplop `{"success":true,"data":…}` / `{"success":false,"error":"…"}`. Daftar
berhalaman menambah `"pagination":{"page","limit","total","totalPages"}`. Waktu dalam ISO UTC
(`2026-10-08T03:00:00.000Z`); tanggal `YYYY-MM-DD` (WIB). Uang dalam angka (rupiah).

### Referensi (izin: menu `spa.*` apa pun)

- `GET /api/spa/outlets` → `Outlet[]` — semua branch aktif; `configured=false` bila belum jadi outlet spa.
  `Outlet = {branch_id, branch_name, company_id, configured, warehouse_id, warehouse_name, open_time:"10:00",
  close_time:"22:00", slot_minutes, public_booking, is_active, warehouses:[{id,name,code}]}`
- `GET /api/spa/treatments?active=true` → `Treatment[]`
  `Treatment = {id, code, name, category, description, is_active, sort_order, variants: Variant[]}`
  `Variant = {id, name, duration_min, buffer_min, price_idr, is_active, sort_order, outlet_prices:[{branch_id, price_idr}]}`
- `GET /api/spa/therapists?branch_id=&active=true` → `Therapist[]`
  `Therapist = {id, employee_id, full_name, nip, phone, photo_url, home_branch_id, home_branch_name, gender, is_active}`
- `GET /api/spa/customers?q=` → `[{id, name, phone, email}]` (maks 20)

### Outlet (`spa.outlets`)

- `PUT /api/spa/outlets/{branchId}` body `{warehouse_id, open_time, close_time, slot_minutes, public_booking, is_active}` → `Outlet`
- `POST /api/spa/outlets/{branchId}/sync-pos` → `{synced: n}` — buat/perbarui produk POS semua varian aktif.

### Treatment (`spa.treatments`)

- `POST /api/spa/treatments` body `{code, name, category, description, is_active, sort_order, variants:[{id?, name, duration_min, buffer_min, price_idr, is_active, sort_order}]}` → `Treatment`
- `PATCH /api/spa/treatments/{id}` body sama (semua opsional; `variants` bila dikirim = set lengkap: id lama diperbarui, varian tanpa id dibuat, varian yang hilang dinonaktifkan) → `Treatment`
- `PUT /api/spa/treatments/{id}/prices` body `{prices:[{variant_id, branch_id, price_idr|null}]}` (`null` = hapus override) → `Treatment`

### Terapis (`spa.therapists`)

- `GET /api/spa/employees?q=` → `[{id, full_name, nip, position_title, is_therapist}]` (kandidat)
- `POST /api/spa/therapists` body `{employee_id, home_branch_id, gender|null, is_active}` → `Therapist`
- `PATCH /api/spa/therapists/{id}` body `{home_branch_id?, gender?, is_active?}` → `Therapist`
- `GET /api/spa/assists?branch_id=&from=&to=` → `[{id, therapist_id, therapist_name, branch_id, branch_name, start_date, end_date, note}]`
- `POST /api/spa/assists` body `{therapist_id, branch_id, start_date, end_date, note}` → assist
- `DELETE /api/spa/assists/{id}` → `{id}`
- `GET /api/spa/outlet-pics?branch_id=` → `[{branch_id, branch_name, employee_id, full_name}]`
- `POST /api/spa/outlet-pics` body `{branch_id, employee_id}`; `DELETE /api/spa/outlet-pics?branch_id=&employee_id=`

### Booking (`spa.bookings`, `spa.book-order`)

- `GET /api/spa/bookings?branch_id=&from=&to=&status=&payment_status=&q=&page=&limit=` → `BookingSummary[]` + pagination
  `BookingSummary = {id, booking_code, branch_id, branch_name, booking_type, source, customer_name, customer_phone,
  scheduled_at, status, payment_status, item_count, total_idr, therapist_names:[…], pos_order_id, created_at}`
- `POST /api/spa/bookings` body
  `{branch_id, booking_type:"walk_in"|"reservation", customer_id?, customer_name, customer_phone, therapist_gender_pref:"any"|"male"|"female", notes?, scheduled_at, items:[{variant_id, starts_at?, therapist_id?}]}` → `Booking`
- `GET /api/spa/bookings/{id}` → `Booking`
  `Booking = BookingSummary + {company_id, warehouse_id, customer_id, therapist_gender_pref, notes, checked_out_at, paid_at,
  cancelled_at, cancel_reason, pos_order_number, items: Item[], events: Event[]}`
  `Item = {id, variant_id, treatment_name, variant_name, duration_min, buffer_min, price_idr, therapist_id, therapist_name,
  starts_at, ends_at, status, started_at, completed_at, commission_idr}`
  `Event = {id, item_id, action, from_status, to_status, actor_name, note, created_at}`
- `PATCH /api/spa/bookings/{id}` body `{customer_name?, customer_phone?, notes?, therapist_gender_pref?}` → `Booking`
- `POST /api/spa/bookings/{id}/items` body `{variant_id, starts_at?, therapist_id?}` → `Booking`
- `PATCH /api/spa/bookings/{id}/items/{itemId}` body `{action:"assign", therapist_id}` | `{action:"unassign"|"start"|"complete"|"cancel"}` |
  `{action:"reschedule", starts_at}` → `Booking`
- `POST /api/spa/bookings/{id}/cancel` body `{reason}` → `Booking`
- `POST /api/spa/bookings/{id}/checkout` → `{booking: Booking, order_id, order_number}`
- `GET /api/spa/availability?branch_id=&starts_at=&ends_at=&exclude_item_id=` → `TherapistAvailability[]`
  `{therapist: Therapist, available, conflicts:[{item_id, booking_code, starts_at, ends_at}], on_leave, shift:{name,start_time,end_time}|null, day_off, assisting}`
- `GET /api/spa/board?branch_id=&date=` → `{date, branch_id, therapists:[{therapist, shift, on_leave, items: BoardItem[]}], unassigned: BoardItem[]}`
  `BoardItem = Item + {booking_id, booking_code, customer_name, booking_status}`

### Komisi (`spa.commissions`)

- `GET /api/spa/commission-rules` → `[{id, treatment_id, treatment_name, variant_id, variant_name, branch_id, branch_name, commission_type:"percent"|"fixed", value, is_active}]`
- `POST /api/spa/commission-rules` body `{treatment_id|null, variant_id|null, branch_id|null, commission_type, value, is_active}`
- `PATCH /api/spa/commission-rules/{id}`; `DELETE /api/spa/commission-rules/{id}`
- `GET /api/spa/commissions?from=&to=&branch_id=&therapist_id=` →
  `{from, to, total_idr, therapists:[{therapist_id, full_name, nip, treatment_count, revenue_idr, commission_idr,
  lines:[{item_id, booking_id, booking_code, branch_name, completed_at, treatment_name, variant_name, price_idr, commission_type, commission_value, commission_idr}]}]}`
  (hanya item `completed` dari booking `paid`, berdasarkan `completed_at` dalam rentang WIB)

### Terapis — self service (login terapis)

- `GET /api/spa/me` → `{therapist: Therapist|null}`
- `GET /api/spa/me/assignments?date=` → `BoardItem[]` milik terapis login
- `PATCH /api/spa/me/assignments/{itemId}` body `{action:"start"|"complete"}` → `BoardItem`
- `GET /api/spa/me/commissions?month=YYYY-MM` → baris komisi seperti laporan (hanya diri sendiri)

### Publik (tanpa login)

- `GET /api/public/spa/outlets` → `[{branch_id, name, address, city, phone, open_time, close_time, slot_minutes}]`
- `GET /api/public/spa/outlets/{branchId}/treatments` → `[{id, name, category, description, variants:[{id, name, duration_min, price_idr}]}]`
- `POST /api/public/spa/bookings` body `{branch_id, scheduled_at, customer_name, customer_phone, therapist_gender_pref, notes, variant_ids:[…]}` →
  `{booking_code, scheduled_at, branch_name, items:[{treatment_name, variant_name, duration_min, price_idr}], total_idr}`

## Halaman

| Route | Isi |
| --- | --- |
| `/dashboard/spa/bookings` | Daftar booking + filter + buat booking |
| `/dashboard/spa/bookings/[id]` | Detail: item, assign terapis (dengan ketersediaan), mulai/selesai, batal, checkout → POS |
| `/dashboard/spa/book-order` | Papan harian per outlet: order belum ditugaskan + jadwal tiap terapis |
| `/dashboard/spa/treatments` | Master treatment + varian + harga per outlet |
| `/dashboard/spa/therapists` | Terapis, perbantuan, PIC outlet |
| `/dashboard/spa/commissions` | Aturan komisi + laporan komisi (ekspor CSV) |
| `/dashboard/spa/outlets` | Konfigurasi outlet spa + sinkron produk POS |
| `/dashboard/me/spa` | Tugas terapis hari ini (mulai/selesai) + komisi bulan ini |
| `/booking/spa` | Booking publik: outlet → treatment → waktu → kontak |

## Acceptance Criteria

- [ ] Outlet dan order tidak tertukar; filter outlet/periode terlihat jelas.
- [ ] Assign terapis yang bentrok ditolak dengan pesan yang menyebut booking bentrok.
- [ ] Perubahan terapis/treatment tampil di detail dan riwayat (events).
- [ ] Order `completed`/`cancelled` tidak menawarkan aksi yang tidak diizinkan.
- [ ] Status layanan dan pembayaran ditampilkan terpisah.
- [ ] Checkout membuat open bill POS berisi treatment; setelah dibayar di kasir, booking menjadi `paid`.
- [ ] Terapis dapat memulai/menyelesaikan tugas sendiri dari HP; resepsionis dapat override.
- [ ] Komisi dihitung sesuai aturan paling spesifik; laporan hanya memuat booking lunas.
- [ ] Booking publik tercatat sebagai `unassigned` dengan sumber `public`.

## Tasks

1. Migrasi skema `spa`, station `spa`, menu + role IAM.
2. Modul Go `spa` (domain + service + postgres + http) dan adapter `internal/app`.
3. Integrasi frontend (prefix IAM, rute Go, allow-list publik).
4. Halaman dashboard spa, area terapis, booking publik.
5. Tes domain + integrasi; deploy ke `mizu.reddie.id`.

## Automation Log

- 2026-10-07 — PRD Alaya dipetakan ke modul ERP yang ada; keputusan bisnis di atas dikonfirmasi pemilik.
- 2026-10-08 — Fase 1 selesai dan dideploy ke `mizu.reddie.id` (image `mizu:spa-1`, `mizu-api:spa-1`).
  - Backend: modul Go `backend/internal/modules/spa` + adapter `internal/app/adapters_spa.go`
    (produk POS dibuat per varian×outlet, open bill POS, pelanggan POS, roster HRIS).
  - Station POS `spa` ditambahkan (Go, TS, CHECK DB) — tidak dikirim ke dapur/printer.
  - Pembayaran booking: subscriber outbox `pos.sale.completed`/`pos.orders.voided` + sinkronisasi saat baca.
  - Kode produk POS: `item.products.kode` varchar(20) → `SPA-<12 hex varian>`; SKU POS `SPA-<kode>-<8 hex varian>-<6 hex outlet>`.
  - Bukti: `go test ./internal/modules/spa/...` PASS (unit + integrasi: alur booking, tolak bentrok terapis,
    checkout→POS, status bayar, komisi, booking publik, izin). Suite Go penuh: 13 paket gagal identik
    dengan baseline commit 8c9f757c di DB salinan produksi (pra-ada, bukan regresi). Frontend: tsc 0 error,
    eslint bersih, vitest 5222 lulus. E2E Playwright di staging: semua halaman spa tanpa error,
    checkout → kasir POS → bayar tunai → booking `paid`, wizard booking publik (mobile) sampai kode booking.
  - Catatan frontend: ganti terapis = "Lepas" lalu "Tugaskan"; item baru tanpa jam mengikuti item sebelumnya.
  - Klon DB: role `authenticated`/`service_role` (NOLOGIN) dibuat di mizu-db agar `migrate -verify` lulus;
    `search_path` level database disamakan dengan NüHabit.
- 2026-10-08 — Seeder demo Spa: `backend/database/seeders/mizu-spa.js` (master) dan `mizu-spa-transactions.js`
  (transaksi), data bersama di `seeders/lib/mizu-spa-data.js`; script `db:seed:mizu-spa`, `db:seed:mizu-spa-transactions`,
  `db:seed:mizu-spa-demo`.
  - Master: 3 outlet (Dago, Riau, Setiabudi), 12 treatment / 23 varian, harga premium Setiabudi, 6 aturan komisi,
    23 staf (17 terapis dengan pola shift + 1 hari libur), perbantuan akhir pekan, PIC outlet, 6 login demo,
    80 pelanggan, 69 produk POS (format kode sama dengan `ensureProduct` Go).
  - Transaksi (deterministik, MIZU_SEED): 45 hari lalu s.d. 7 hari ke depan — ±1.600 booking, ±1.960 treatment,
    ±1.370 order POS lunas, 135 shift kasir. Idempoten: hapus baris ber-`created_by` SEED_ACTOR + shift `MZS-*` lalu buat ulang.
  - Bukti (mizu-db): 0 bentrok jadwal terapis (termasuk jeda), 0 selisih total order vs treatment, 0 treatment di luar
    jam outlet / di hari libur terapis; total komisi API = SQL (Sep 2026: Rp28.717.500); akses per role diuji
    (resepsionis hanya outletnya, terapis hanya halaman tugas).
  - Belum: jurnal akuntansi untuk order POS hasil seeder (laporan Accounting belum memuat omzet spa demo).
- 2026-10-08 — Rebrand NüHabit → Mizu (referensi instagram.com/mizufamily.id): nama tampil "Mizu" di frontend & backend
  (identifier teknis seperti cookie `nuhabit_session`, kunci localStorage, header `X-NuHabit-Signature` sengaja tidak diubah);
  preset tema baru `mizu` (default; id lama `nuhabit` dipetakan ke `mizu`) — emas #d6b47a, mocha #3d2b20, espresso #241b16,
  ivory #fffaf2 — di `globals.css`, `presets.ts`, `theme-script.tsx`, `appearance-tokens.ts` dan default Go
  `settings/domain/appearance.go`; judul memakai Playfair Display; logo tumpukan batu + wordmark MIZU dihasilkan oleh
  `frontend/scripts/generate-brand-assets.mjs` (wordmark 640×165, lockup 1200×165, mark 210×210, ikon app, pola, wallpaper).
  Default venue CRM di mizu-db diarahkan ke Mizu Spa / Mizu Dago. Deploy image `mizu:brand-1`, `mizu-api:brand-1`.
- 2026-10-08 — Outlet demo disesuaikan ke outlet asli (bio Instagram): Mizu 1.0 (Jl. Westhoff No. 1, `MZ-WESTHOFF`) dan
  Mizu Signature (Jl. Riau No. 142, `MZ-RIAU`, harga & komisi premium); Dago/Setiabudi + login demo lamanya dinonaktifkan.
  Jam buka 10:00–22:00 masih asumsi (belum dikonfirmasi pemilik); telepon & koordinat sengaja kosong.
- 2026-10-08 — Website publik diubah dari gym ke spa: konten default Go + TS, halaman `/treatments` (katalog live per outlet),
  navigasi spa, `/training` `/equipment` `/franchise` → `/treatments`, `/join` → `/booking/spa`. Kode gym lama (join/plans,
  timetable, panel trial) masih ada tetapi tidak terhubung — kandidat pembersihan terpisah.
  Deploy `mizu:site-1`, `mizu-api:site-1`; commit `fab1145b`.

- 2026-10-09 — Book Order punya tiga tampilan: **Kalender per terapis** (bawaan; kolom per terapis + "Belum ditugaskan",
  ekor jeda, arsiran di luar shift/cuti/libur, garis "sekarang", seret blok untuk menugaskan, klik slot kosong untuk
  booking baru berisi jam & terapis), **Kartu** (papan lama), **Daftar** (tabel). Server hanya menolak bentrok, jadi
  seret ke terapis di luar shift/cuti/libur meminta konfirmasi dulu. Tata letak di `features/spa/calendar.ts` (12 tes).
  Seret HTML5 tidak berlaku di layar sentuh — di ponsel pakai klik blok → "Tugaskan terapis". Deploy `mizu:demo-3`.
- 2026-10-09 — Halaman booking publik `/booking/spa` dirombak total ke desain Mizu: dibungkus header/footer situs, hero
  wallpaper Mizu, 4 langkah bernomor, ringkasan menempel (desktop) / bilah aksi bawah (ponsel), filter kategori, deret
  tanggal 14 hari + "Tanggal lain", jam dikelompokkan Pagi/Siang/Sore/Malam, layar sukses dengan kode bisa disalin.
  Tombol Booking di menu treatment membawa `?outlet=&treatment=` (treatment langsung terpilih). Logika murni di
  `features/spa/public-booking.ts` (12 tes). Judul halaman di top bar dashboard dihapus (sudah ada di breadcrumb &
  header halaman); top bar kini tanggal + lokasi. Deploy `mizu:demo-5`.
- 2026-10-09 — `/` kini selalu website publik Mizu, juga untuk staf yang sedang login (dulu staf mendapat desktop OS,
  sehingga logo/"Beranda" di halaman booking membuka desktop). Desktop staf tetap di `/os`, tujuan login yang sudah ada.
  Dicek sebagai admin: dari `/booking/spa` dan `/` tidak ada tautan ke `/os`, `/dashboard`, `/login` atau `/pos`.
  Deploy `mizu:demo-6`.
- 2026-10-09 — Merge PR #1 (mizu/main) dideploy: 2 migrasi `spa_public_booking_token` & `spa_public_booking_management`
  diterapkan ke DB live (backup `~/backups/mizu/mizu-before-merge-pr1-20261009-134911.dump`, `-verify` bersih);
  `mizu-api:demo-7`. Alur booking dicek ujung ke ujung: jam dari server, link outlet via slug, halaman status.
- 2026-10-09 — Beranda disederhanakan mengikuti referensi odiliainfinity.id: hero penuh bersudut bawah membulat dengan
  header transparan di atasnya, "Tentang kami" di tengah, satu kartu menu (teks + gambar), "Penawaran & momen"
  (kartu lebar bertumpuk: promo 60+, ritual signature, Better together), dan ajakan penutup. Bagian pilar, panduan
  kebutuhan, kutipan, Instagram, galeri, cerita member, grid outlet dan berita dihapus dari beranda
  (`home-discovery.tsx` tak terpakai lagi, dihapus). Foto memakai CMS bila ada, selain itu art wallpaper Mizu.
  Deploy `mizu:demo-8`.
