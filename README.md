# Paddy System

Sistem operasional untuk **Paddy** ([paddy.id](https://paddy.id), Instagram [@paddy.id](https://www.instagram.com/paddy.id/)),
brand custom phone case & *adorable goods* asal Bandung sejak 2016, dengan toko **Paddy Store PVJ**
(Paris Van Java Mall) dan **Paddy Store Kopo**. Instance dev: https://paddydev.reddie.id

*Your Adorable Companion.*

Fitur disalin persis dari Mizu Spa System (fork `ikurniawann/mizu`), lalu seluruh branding,
data demo, dan katalog produk diganti ke Paddy. Modul "spa" tetap ada sebagai **Paddy Experience**:
layanan in-store yang bisa dibooking — saat ini satu layanan, **Custom Case** (Rp119.000) dengan desain sendiri
ala The Experience Room (tipe HP, layout 2/3 gambar, stiker dari 16 tema, nama + font, 11 background)
dengan crew studio, jadwal, komisi, dan checkout ke kasir.

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
akuntansi (COA, jurnal, AP/AR, laporan keuangan), CRM dan loyalty, serta pengaturan tampilan (tema Paddy).

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
| `backend/database/` | Migrasi SQL (`migrations/deltas`), seeder (termasuk demo Paddy: `paddy-*.js`), skrip ops. |
| `docs/` | Dokumentasi. Rancangan modul spa: `docs/epics/EPIC-052-mizu-spa-booking-terapis.md`. |
| `services/`, `tools/`, `mobile/` | WhatsApp gateway, bridge NFC dan print worker POS, aplikasi Expo. |

## Menjalankan secara lokal

Prasyarat: Node.js 22 + pnpm 9, Go 1.26, dan PostgreSQL 16 atau lebih baru.

1. Salin `frontend/.env.example` ke `frontend/.env.local` dan `backend/.env.example` ke `backend/.env.local`.
2. Isi `DATABASE_URL` dan `MIGRATE_DATABASE_URL` di kedua file, lalu set `NEXT_PUBLIC_APP_NAME=Paddy`.
3. Cluster Postgres baru butuh dua role sebelum migrasi: `CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;`
4. Pasang dependensi, terapkan migrasi, isi data demo, lalu jalankan aplikasi:

```bash
pnpm --dir frontend install && pnpm --dir backend/database install
pnpm db:migrate:apply                      # terapkan migrasi SQL
pnpm db:seed db:seed:super-admin           # akun super admin (SUPER_USER_EMAIL / SUPER_USER_PASSWORD)
pnpm db:seed:paddy-full                    # IAM + data demo Paddy lengkap
pnpm backend:dev                           # API Go di :8080
pnpm dev                                   # Next.js di :3000 (set BACKEND_URL=http://localhost:8080)
```

### Data demo Paddy

`db:seed:paddy-full` menjalankan IAM, lalu `db:seed:paddy-demo` (`paddy-spa` → `paddy-products` →
`paddy-spa-transactions` → `paddy-branding`), parkir, user demo, user purchasing per toko, supplier, COA, bahan baku & produksi
(`paddy-materials`), data demo rekrutmen (`paddy-recruitment`), dan payroll multi-toko (`paddy-placements`).

- **Toko:** Paddy Store PVJ (Paris Van Java Mall) dan Paddy Store Kopo, jam 10:00–22:00 (asumsi demo).
- **Paddy Experience:** satu layanan "Custom Case" (customizable, varian "Sesi desain" 30 menit, Rp119.000);
  layanan demo lama dinonaktifkan. Katalog desain: `backend/internal/modules/spa/catalog/experience.json`
  (di-embed API, `GET /api/public/spa/experience-catalog`), gambar di `frontend/public/experience/`.
  Booking online wajib menyertakan desain; booking toko/WhatsApp diisi crew lewat dialog "Desain" di Book Order.
- **Katalog:** 57 produk Paddy asli (case, catalogue case, pods, pop socket, bags, watch, aksesoris) dengan foto
  di `frontend/public/products/paddy/`, tampil di kasir POS kedua toko dan storefront "Paddy Official Store".
- **Transaksi:** booking 45 hari ke belakang sampai 7 hari ke depan, order POS lunas, shift kasir, dan komisi.
- **Bahan baku, WIP & BOM** (`pnpm db:seed db:seed:paddy-materials`, ikut di `paddy-full`): 78 bahan baku `RM-PDY-…`
  (blank case 5 keluarga × 3 grup model, tinta UV CMYK/White/varnish/primer, stiker & resin, beads/charm, bahan tas,
  kemasan, bahan penolong) dengan satuan beli supplier (botol, pack, roll…) dan supplier utama; 11 WIP `WIP-PDY-…`
  (case tercetak UV, case + varnish, Custom Case tercetak, stiker die-cut, top pop socket, pods tercetak, charm terangkai,
  badan tas) beserta resepnya; BOM 42 produk katalog di kedua toko + layanan Custom Case (HPP case ±Rp24–37 rb, tas
  ±Rp84–137 rb; `harga_modal` disamakan dengan HPP resep); stok per gudang (Gudang PVJ, workshop/toko PVJ, meja
  Paddy Experience Kopo, Gudang Kopo) dan 15 order produksi `PROD-PDY-…`. Produk beli jadi (Paddy Watch, strap, apparel,
  parfum, tempered glass, sanitizer) sengaja tanpa BOM. Satuan dasar stok = satuan pakai resep (konversi 1); satuan beli
  ada di konversi satuan. Idempoten: stok & order seeder ditulis ulang, data buatan staf tidak disentuh.
- `paddy-branding.js` menimpa teks bermerek lama yang ditanam migrasi (menu, pengaturan, konten situs).
- **Payroll multi-toko** (`pnpm db:seed db:seed:paddy-placements`, ikut di `paddy-full`): satu karyawan bisa bekerja di
  beberapa toko — satu slip & satu PPh 21/BPJS, biayanya dibagi per toko sesuai jam/hari hadir. Seeder mengisi
  Penempatan Karyawan (`hris.employee_placements`: crew dari toko asal + perbantuan, store manager PD-201/PD-202 di PVJ &
  Kopo, staf kantor di HQ), absensi demo 2 bulan terakhir dengan toko (`hris.attendance.branch_id`), gaji demo untuk yang
  belum punya, lalu menghitung run payroll bulan lalu lewat API Go (`PADDY_API_URL`, default `http://127.0.0.1:8080`;
  dilewati bila API mati). `--paid-run` juga membayar run bulan sebelumnya (jurnal beban gaji/BPJS per toko; membuat
  tahun buku Paddy bila belum ada). Lihat HRIS → Master Data → Penempatan Karyawan dan HRIS → Penggajian → Biaya Gaji per Toko.
- **Rekrutmen** (`pnpm db:seed db:seed:paddy-recruitment`, ikut di `paddy-full`): 8 lowongan Paddy (crew Paddy Experience
  PVJ, sales Kopo, graphic designer, operator cetak UV, content creator, CS online, store manager, admin gudang;
  published/closed/draft) yang tampil di `/career` dan Job Portal, departemen & posisi pendukung, serta 47 kandidat fiktif
  (`…+paddyseed@example.com`, HP 0812-9xxx) di semua tahap pipeline lengkap dengan screening, analisis CV AI, psikotes
  online (skor PAPI/Aritmatika/Matematika, gambar Baum/DAP/Wartegg + insight), interview AI (transkrip + kesimpulan),
  interview HR, offer, catatan, dan timeline. Seeder juga mengisi bank soal Aritmatika (33), Matematika (33), dan
  90 pasangan PAPI. **Pernyataan PAPI adalah butir demo original, bukan butir PAPI Kostick resmi — ganti dengan butir
  berlisensi sebelum dipakai untuk seleksi sungguhan.** Idempoten: hanya kandidat `+paddyseed` yang dihapus & dibuat ulang;
  lowongan di-upsert per slug dan soal per id tetap. Gambar tes ditulis ke storage API: di server pakai
  `PADDY_STORAGE_VOLUME=paddydev-storage` (disalin lewat `docker run alpine`), lokal ke `STORAGE_DIR` atau `frontend/storage`.

Password demo diatur lewat `PADDY_DEMO_PASSWORD` dan `PADDY_STALL_PASSWORD` (nama lama `MIZU_*` tetap diterima).
Tanpa env itu, seeder membuat password acak dan mencetaknya sekali. Di server, nilainya ada di
`~/.config/paddydev/demo.env`.

## Perintah lain

### Build dan deploy ke paddydev.reddie.id

```bash
cd /home/wit/Desktop/paddydev
bash tools/deploy-paddydev.sh
```

Skrip memakai kode lokal, termasuk perubahan yang belum di-commit. Konfigurasi server dibaca dari
`~/.config/paddydev/web.env` dan `api.env`; rahasia tidak disimpan di repository.
Skrip membangun image web dan API, menerapkan migrasi, memeriksa skema, lalu mengganti container
`paddydev` (port host `127.0.0.1:8145`) dan `paddydev-api`. Database `paddydev-db` dan volume
`paddydev-storage` tetap dipakai; jika pemeriksaan layanan gagal, image sebelumnya dijalankan lagi.

Domain dilayani Cloudflare tunnel tersendiri `paddydev` (container `paddydev-tunnel`, config
`~/.cloudflared/paddydev-config.yml`), terpisah dari tunnel utama reddie.id dan tunnel Mizu.

```bash
docker ps --filter name=paddydev --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
curl -f https://paddydev.reddie.id/login -o /dev/null
```

```bash
pnpm test                                  # tes frontend + go test ./...
pnpm lint                                  # eslint + go vet
make -C backend generate                   # perbarui prefix IAM & manifest rute Go setelah menambah route
node frontend/scripts/generate-brand-assets.mjs   # buat ulang logo, favicon, dan ikon Paddy
```

## Brand

Wordmark **Paddy** bulat berwarna magenta `#e3066f`, gaya playful dengan doodle/sticker (mata bulat, bintang, hati)
dan aksen kuning, ungu, hijau, oranye di atas latar krem. Judul memakai Roundo. Referensi: [paddy.id](https://paddy.id)
dan Instagram [@paddy.id](https://www.instagram.com/paddy.id/). Aset ada di `frontend/public/brand`, token tema di
`frontend/src/app/globals.css`, dan preset `paddy` (`frontend/src/lib/theme/presets.ts`).
