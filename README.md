# Mizu Spa System

Sistem operasional untuk **Mizu Family Massage & Reflexology**, tempat massage dan refleksi di Bandung
dengan outlet milik sendiri: **Mizu 1.0** (Jl. Westhoff No. 1) dan **Mizu Signature** (Jl. Riau No. 142).

*Rest. Relax. Rejuvenate.*

Satu aplikasi mencakup booking treatment, penugasan terapis, kasir, komisi terapis, karyawan, stok,
pembelian, akuntansi, CRM, dan website publik dengan booking online.

## Fitur utama

### Spa (`/dashboard/spa`)

| Menu | Fungsi |
|---|---|
| Booking | Booking walk-in, reservasi, dan online. Status layanan (belum ditugaskan → ditugaskan → berjalan → selesai) ditampilkan terpisah dari status pembayaran. |
| Book Order | Papan harian per outlet: treatment yang belum ditugaskan dan jadwal setiap terapis lengkap dengan shift, cuti, dan perbantuan. |
| Treatment | Master treatment dan varian durasi, jeda persiapan antar-tamu, harga per outlet. |
| Terapis | Data terapis, perbantuan antar-outlet, dan PIC outlet. |
| Komisi Terapis | Aturan komisi (persen atau nominal per treatment/varian/outlet) dan laporan komisi dengan ekspor CSV. |
| Outlet Spa | Stall POS, jam buka, booking online, dan sinkron produk POS. |

**Aturan inti:**
- **Jadwal terapis tidak boleh bentrok.** Durasi treatment ditambah jeda dicek di dalam transaksi.
- **Checkout masuk ke kasir.** Checkout membuat tagihan di POS, dan booking otomatis lunas setelah dibayar di kasir.
- **Komisi dibekukan saat treatment selesai.** Aturan yang paling spesifik yang dipakai, dan komisi baru masuk laporan setelah booking lunas.

### Untuk terapis dan pelanggan

- **Tugas Terapis** (`/dashboard/me/spa`): terapis memulai dan menyelesaikan treatment dari HP, serta melihat komisinya bulan ini.
- **Booking online** (`/booking/spa`): pelanggan memilih outlet, treatment, dan jam tanpa login. Pembayaran dilakukan di outlet.
- **Website publik:** beranda, menu treatment dengan harga per outlet (`/treatments`), lokasi, suasana, tentang, berita, dan kontak.

### Modul pendukung

POS (kasir, shift, laporan), HRIS (karyawan, shift, absensi, cuti, payroll, KPI), pembelian dan inventori,
akuntansi (COA, jurnal, AP/AR, laporan keuangan), CRM dan loyalty, serta pengaturan tampilan (tema Mizu).

## Teknologi

| Bagian | Teknologi |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4, shadcn/ui, TanStack Query |
| Backend API | Go modular monolith (`backend/`), pgx, satu modul per bounded context (`MODULES=`) |
| Database | PostgreSQL, schema per domain (`spa`, `pos`, `hris`, `item`, `accounting`, …) |
| Deploy | Docker: image web (`Dockerfile`) dan image API (`backend/Dockerfile`) |

Frontend meneruskan path `/api` milik Go ke `BACKEND_URL` (`frontend/src/lib/backend-routes.ts`),
sehingga browser tetap memanggil satu origin.

## Struktur repo

| Path | Isi |
|---|---|
| `frontend/` | Aplikasi Next.js: dashboard staf, area karyawan, website publik, booking online, aplikasi member. |
| `backend/` | API Go. Modul spa ada di `internal/modules/spa`, adapter lintas modul di `internal/app/adapters_spa.go`. |
| `backend/database/` | Migrasi SQL (`migrations/deltas`), seeder (termasuk demo Mizu), skrip ops. |
| `docs/` | Dokumentasi. Rancangan modul spa: `docs/epics/EPIC-052-mizu-spa-booking-terapis.md`. |
| `services/`, `tools/`, `mobile/` | WhatsApp gateway, bridge NFC dan print worker POS, aplikasi Expo. |

## Menjalankan secara lokal

Prasyarat: Node.js 22 + pnpm 9, Go 1.26, dan PostgreSQL 16 atau lebih baru.

1. Salin `frontend/.env.example` ke `frontend/.env.local` dan `backend/.env.example` ke `backend/.env.local`.
2. Isi `DATABASE_URL` dan `MIGRATE_DATABASE_URL` di kedua file, lalu set `NEXT_PUBLIC_APP_NAME=Mizu`.
3. Pasang dependensi, terapkan migrasi, isi data demo, lalu jalankan aplikasi:

```bash
pnpm --dir frontend install && pnpm --dir backend/database install
pnpm db:migrate:apply                      # terapkan migrasi SQL
pnpm db:seed db:seed:super-admin           # akun super admin
pnpm db:seed db:seed:mizu-spa-demo         # data demo Mizu: outlet, treatment, terapis, transaksi
pnpm backend:dev                           # API Go di :8080
pnpm dev                                   # Next.js di :3000 (set BACKEND_URL=http://localhost:8080)
```

### Data demo

`db:seed:mizu-spa-demo` menjalankan dua seeder:

- **`mizu-spa.js` (master):**
  - dua outlet beserta profil publiknya, 12 treatment dengan 23 varian, aturan komisi;
  - 17 terapis dengan pola shift mingguan, resepsionis, dan manajer;
  - login demo, 80 pelanggan, dan produk POS.
- **`mizu-spa-transactions.js` (transaksi):**
  - riwayat booking 45 hari ke belakang sampai 7 hari ke depan, ditambah order POS lunas, shift kasir, dan komisi;
  - datanya deterministik dan selalu dibuat ulang relatif terhadap tanggal hari itu.

Password login demo diatur lewat env `MIZU_DEMO_PASSWORD`. Kalau env itu tidak diisi, seeder membuat password acak dan mencetaknya sekali.

## Perintah lain

```bash
pnpm test                                  # tes frontend + go test ./...
pnpm lint                                  # eslint + go vet
make -C backend generate                   # perbarui prefix IAM & manifest rute Go setelah menambah route
node frontend/scripts/generate-brand-assets.mjs   # buat ulang logo, favicon, dan ikon Mizu (butuh playwright-core)
```

## Brand

Logo tumpukan batu dengan wordmark **MIZU**, palet emas `#d6b47a`, mocha `#3d2b20`, espresso `#241b16`,
dan ivory `#fffaf2`, serta judul memakai Playfair Display. Referensinya Instagram
[@mizufamily.id](https://instagram.com/mizufamily.id). Aset ada di `frontend/public/brand`, dan token tema
di `frontend/src/app/globals.css` serta preset `mizu` (`frontend/src/lib/theme/presets.ts`).
