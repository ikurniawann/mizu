# Mizu Spa System

Sistem operasional untuk **Mizu Family Massage & Reflexology**, tempat massage dan refleksi di Bandung
dengan outlet milik sendiri: **Mizu 1.0** (Jl. Westhoff No. 1), **Mizu Signature** (Jl. Riau No. 142),
dan **Mizu Pasteur**.

*Rest. Relax. Rejuvenate.*

Satu aplikasi mencakup booking treatment, penugasan terapis, kasir, komisi terapis, karyawan, stok,
pembelian, akuntansi, CRM, website publik dengan booking online, dan bot booking WhatsApp.

## Fitur utama

### Spa (`/dashboard/spa`)

| Menu | Fungsi |
|---|---|
| Book Order | Papan harian per outlet (Sheet, daftar, room) dengan antrean kedatangan terapis, booking bersama sampai 10 orang, dan badge booking yang belum ditugaskan. Drop ke kolom terapis divalidasi server. |
| Booking History | Riwayat booking walk-in, reservasi, online, dan WhatsApp; daftar tunggu (waitlist). Status layanan ditampilkan terpisah dari status pembayaran dan DP. |
| Customer | Direktori pelanggan, riwayat treatment, dan blokir pelanggan. |
| Treatment & Kategori | Master treatment, varian durasi, jeda persiapan antar-tamu, dan harga per outlet. Produk POS tersinkron otomatis saat disimpan. |
| Terapis | Data terapis (gender mengikuti HRIS), level, perbantuan antar-outlet, PIC outlet, jadwal libur, dan Jadwal Shift Terapis dengan *Generate jadwal* bulanan. |
| Training | Training per periode dengan persetujuan admin; level terapis 0/1/2 naik otomatis dan direset setelah resign. |
| Pengaturan Komisi | Komisi nominal per kombinasi level × varian treatment, sama di semua outlet. |
| Room Spa | Room Public/Private per outlet dengan kapasitas dan harga. |
| Outlet Spa | Stall POS, jam buka, slot, last order, keunggulan outlet (dipakai bot WhatsApp), booking publik, dan pengaturan DP online. |
| Laporan | Trend, Rating, Rush Hour, Customer, dan Komisi (ekspor CSV). |

**Aturan inti:**
- **Jadwal terapis tidak boleh bentrok.** Durasi treatment ditambah jeda dicek di dalam transaksi. Booking boleh mulai sebelum akhir shift asal semua treatment selesai paling lambat akhir shift +60 menit.
- **Room ikut dihitung.** Kapasitas room dicek per jendela booking; pindah room sebelum selesai memakai tarif penuh room tujuan.
- **Checkout masuk ke kasir.** Checkout (per booking atau per grup) membuat tagihan di POS. DP online menjadi potongan tagihan, dan booking otomatis lunas setelah dibayar di kasir.
- **DP mengunci slot online.** Booking website dan WhatsApp memegang slot hanya sampai DP dibayar (invoice Xendit); treatment tidak bisa dimulai selagi DP masih pending.
- **Komisi dibekukan saat treatment selesai** sesuai level terapis dan varian, dan baru masuk laporan setelah booking lunas.

### Untuk terapis dan pelanggan

- **Area karyawan:** Tugas Terapis (`/dashboard/me/spa`) untuk memulai dan menyelesaikan treatment dari HP serta melihat komisi, Jadwal Libur (`/dashboard/me/jadwal-libur`), dan Training Saya (`/dashboard/me/training`).
- **Booking online** (`/booking/spa`): pelanggan memilih outlet, treatment, jam, terapis, dan room tanpa login, lalu membayar DP atau di outlet. Status dan ubah jadwal lewat link booking.
- **Bot booking WhatsApp:** dwibahasa (Indonesia/Inggris); booking rombongan sampai 10 orang dengan treatment per tamu, perbandingan outlet, last order, jam kosong beserta jumlah terapis pria/wanita, gift voucher (`/booking/spa/gift/<token>`), daftar tunggu, pengingat, dan QR booking. Bot memperkenalkan diri sebagai balasan otomatis dan menyerahkan ke admin live di jam kerja CS. Diaktifkan di Pengaturan CRM → Customer Service.
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
| `backend/` | API Go. Modul spa di `internal/modules/spa`, bot WhatsApp di `internal/modules/wabot`, adapter lintas modul di `internal/app/adapters_*.go`. |
| `backend/database/` | Migrasi SQL (`migrations/deltas`), seeder (termasuk demo Mizu), skrip ops. |
| `docs/` | Dokumentasi. Modul spa: `docs/epics/EPIC-052-mizu-spa-booking-terapis.md`; bot WhatsApp: `docs/epics/EPIC-053-wa-booking-bot.md`; rencana per fitur di `docs/superpowers/`. |
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
  - dua outlet demo (Mizu 1.0 dan Mizu Signature) beserta profil publiknya, 12 treatment dengan 23 varian, komisi nominal per varian × level;
  - 17 terapis dengan pola shift mingguan, resepsionis, dan manajer;
  - login demo, 80 pelanggan, dan produk POS.
- **`mizu-spa-transactions.js` (transaksi):**
  - riwayat booking 45 hari ke belakang sampai 7 hari ke depan, ditambah order POS lunas, shift kasir, dan komisi;
  - datanya deterministik dan selalu dibuat ulang relatif terhadap tanggal hari itu.

Password login demo diatur lewat env `MIZU_DEMO_PASSWORD`. Kalau env itu tidak diisi, seeder membuat password acak dan mencetaknya sekali.

## Perintah lain

### Build dan deploy ke mizu.reddie.id

Jalankan dari mesin yang saat ini menjalankan Docker Mizu:

```bash
cd /home/wit/Desktop/Mizu
bash tools/deploy-mizu.sh
```

Skrip memakai kode lokal, termasuk perubahan yang belum di-commit. Untuk rilis yang
hanya berisi commit, jalankan dari salinan bersih:

```bash
D=$(mktemp -d) && git archive HEAD | tar -x -C "$D" && bash "$D/tools/deploy-mizu.sh"
```

Konfigurasi
server dibaca dari `~/.config/mizu/web.env` dan `api.env`; rahasia tidak disimpan
di repository. Docker, curl, ripgrep (`rg`), dan flock harus tersedia.

Skrip membangun image frontend dan API, menerapkan migrasi SQL yang belum
dijalankan, memeriksa skema, lalu mengganti container `mizu` dan `mizu-api`.
Database `mizu-db` dan volume unggahan `mizu-storage` tetap dipakai.
Jika build atau migrasi gagal, container lama tetap melayani. Jika pemeriksaan
layanan setelah penggantian gagal, skrip mencoba menjalankan image sebelumnya;
migrasi yang sudah diterapkan tidak dibatalkan.

Perubahan file lokal, `pnpm build`, atau `docker restart mizu` saja tidak
memperbarui image yang melayani domain. Setelah deploy selesai, muat ulang
browser dengan **Ctrl+Shift+R**. Periksa layanan dengan:

```bash
docker ps --filter name=mizu --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
curl -f https://mizu.reddie.id/login -o /dev/null
```

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
