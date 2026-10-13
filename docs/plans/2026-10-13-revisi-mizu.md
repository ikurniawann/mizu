# Revisi Mizu — 13 Oktober 2026

Daftar revisi dari owner, dirapikan dan dipetakan ke kondisi sistem saat ini.
Status: **Sudah ada** (tinggal dicek), **Sebagian** (fondasi ada, perlu fitur), **Baru**.

| # | Revisi | Status | Modul |
|---|--------|--------|-------|
| R1 | Payroll terapis: tipe gaji tetap + komisi vs komisi saja; 2× gajian per bulan (bonus/komisi tgl 15, gaji reguler tgl 30; tanggal bisa dikonfigurasi) | Sebagian | payroll · spa (commission_rules) · hris |
| R2 | Reservasi online (web & WA) wajib DP dulu | Sudah ada | spa · wabot — cek kehalusan alur & UX |
| R3 | Urutan booking ke terapis mengikuti urutan absensi (yang datang duluan dapat order duluan bila customer tidak memilih terapis) | Sebagian | hris (shift & absensi ada) · spa (assignment) |
| R4 | Tambah treatment saat treatment berlangsung / setelah selesai, sebelum bayar | Baru | spa · pos |
| R5 | ESS: terapis memilih 2 hari libur per minggu; HRD menetapkan kuota minimal terapis wanita & pria per shift; pengajuan ditolak bila kuota tidak terpenuhi | Baru | hris (leaves, shifts, employee_shifts ada) |
| R6 | Master room per outlet + harga room; room dipilih saat booking; monitoring room mana yang terisi dan statusnya | Baru | spa (belum ada tabel room) |
| R7 | Bayar parkir lewat sistem: kategori "Parkir / Valet mobil" di POS | Baru (kecil) | pos |
| R8 | Banned member: member berstatus banned selalu diberi tahu jadwal tidak tersedia (web & WA) | Baru | pos_customers · spa · wabot |
| R9 | Timer room: tombol Start memunculkan hitung mundur total durasi treatment | Sebagian | spa (`started_at` sudah ada; UI hitung mundur belum) |
| R10 | Harga treatment berbeda per outlet (multiple price) | Sudah ada | spa (`variant_outlet_prices`, UI harga per outlet) |

## Rincian pemahaman & pertanyaan

### R1 — Payroll terapis (komisi & bonus)
- Dua tipe terapis: **gaji tetap + komisi** dan **komisi saja**. Tipe disimpan di profil terapis/kontrak.
- Dua kali pembayaran per bulan: **tgl 15** untuk komisi/bonus, **tgl 30** untuk gaji reguler. Tanggal dapat dikonfigurasi per perusahaan.
- Komisi dihitung dari treatment yang selesai & lunas (laporan komisi sudah ada di spa).
- Pertanyaan: (a) komisi tgl 15 menghitung periode apa, bulan sebelumnya penuh atau 1–15? (b) terapis "komisi saja" apakah tetap punya slip gaji tgl 30 (misal tunjangan)? (c) apakah ada bonus selain komisi per treatment, misal target bulanan?

### R2 — DP untuk reservasi online
- Sudah live: DP Rp100.000 per booking, jadwal ditahan 60 menit, sisa dibayar di outlet.
- Tindak lanjut: audit UX alur web & WA (copy, langkah, halaman bayar, pengingat DP hampir kedaluwarsa), lalu perbaiki yang kasar.

### R3 — Urutan terapis mengikuti absensi
- Butuh **antrian kedatangan terapis** per outlet per hari: terapis yang absen masuk lebih dulu berada di urutan atas.
- Saat customer tidak memilih terapis, sistem memberi booking ke terapis teratas yang kosong dan cocok (shift, gender, jam), lalu ia turun ke urutan bawah (rotasi) atau tetap sesuai kedatangan.
- Pertanyaan: (a) setelah dapat order, terapis pindah ke belakang antrian (rotasi adil) atau urutan tetap kedatangan? (b) sumber absensi: absensi HRIS yang sudah ada, atau tombol "hadir" di aplikasi terapis? (c) berlaku juga untuk booking online yang dibuat H-1 (terapis belum absen)? Usulan: penugasan final dilakukan saat hari H setelah absensi.

### R4 — Tambah treatment saat/setelah treatment
- Dari halaman booking/visit yang sedang berjalan atau selesai (belum checkout), kasir/terapis bisa menambah treatment; total, komisi, dan durasi ikut bertambah; terapis bisa sama atau beda.
- Pertanyaan: siapa yang boleh menambah, terapis dari aplikasinya atau hanya kasir?

### R5 — Jadwal libur mingguan di ESS dengan kuota gender per shift
Pemahaman saya:
- Setiap terapis mengajukan **2 hari libur per minggu** lewat Employee Self Service, per bulan.
- HRD menetapkan **kuota minimal** per outlet per shift: misal minimal 3 wanita dan 2 pria.
- Saat pengajuan, sistem menghitung terapis yang masih masuk pada hari & shift itu; bila libur ini membuat jumlah wanita/pria turun di bawah kuota, pengajuan **ditolak otomatis**.
- Pertanyaan: (a) kuota per outlet per shift, atau per outlet per hari? (b) siapa yang lebih dulu mengajukan dapat prioritas (first come), atau HRD yang memutuskan? (c) apakah libur yang disetujui masuk ke jadwal shift (hris.employee_shifts) dan otomatis menutup slot booking terapis itu?

### R6 — Monitoring room
- Master room per outlet (nama, kapasitas, tipe), room dipasang ke booking saat treatment dimulai, papan status: kosong / terisi (siapa, treatment, sisa waktu) / dibersihkan.
- Pertanyaan: apakah room dipilih saat booking (customer/kasir) atau saat Start treatment?

### R7 — Parkir di POS
- Kategori produk "Parkir" dengan item seperti Valet mobil, Parkir motor; masuk ke bill yang sama atau bill terpisah.
- Pertanyaan: masuk ke bill treatment customer, atau transaksi terpisah?

### R8 — Banned member
- Flag `banned` (+ alasan, tanggal, oleh siapa) di data customer; backoffice bisa ban/unban.
- Dampak: booking web & WA untuk nomor/member tersebut selalu menjawab "jadwal tidak tersedia" tanpa menyebut ban; kasir tetap melihat label banned.
- Pertanyaan: ban berdasarkan nomor WhatsApp, akun member, atau keduanya?

### R9 — Timer room / hitung mundur treatment
- Saat terapis/kasir menekan **Start**, tampil hitung mundur total durasi treatment (jumlah semua item), berubah warna saat hampir habis, dan tercatat waktu mulai/selesai.
- Tampil di aplikasi terapis dan papan monitoring room (R6).

### R10 — Harga per outlet
- Sudah ada: setiap varian treatment punya harga default dan harga khusus per outlet; booking web/WA memakai harga outlet yang dipilih.
- Tindak lanjut: pastikan semua halaman (POS, laporan, komisi) memakai harga outlet, bukan harga default.

## Keputusan owner (13 Okt 2026)

| # | Keputusan |
|---|-----------|
| R1 | Komisi/bonus tgl 15 menghitung periode **tgl 1–15** bulan berjalan; gaji reguler tgl 30. |
| R3 | **Rotasi adil**: terapis yang baru dapat order pindah ke belakang antrian. Penugasan final booking online dilakukan **pada hari H setelah terapis absen**. |
| R4 | **Terapis dan kasir** sama-sama bisa menambah treatment. |
| R5 | Kuota minimal wanita/pria dihitung **per hari** (per outlet). **Yang mengajukan lebih dulu mendapat prioritas** (first come). |
| R6 | Room **dipilih saat booking**. Room **punya harga**: perlu master data room + harga per room (ikut masuk total booking). |
| R7 | Parkir sebagai **transaksi terpisah** di POS (bukan di bill treatment). |
| R8 | Ban pada **akun member**. Web booking & bot WA mengecek status member; bila banned, jadwal selalu dijawab tidak tersedia. |

## Usulan urutan pengerjaan
1. R2 audit UX DP (cepat, sudah live)
2. R10 verifikasi harga per outlet (cepat)
3. R7 kategori parkir (kecil)
4. R8 banned member
5. R4 tambah treatment saat berlangsung
6. R6 + R9 room & timer (satu epic)
7. R3 antrian terapis berdasarkan absensi
8. R5 pengajuan libur dengan kuota gender
9. R1 payroll 2× sebulan & tipe gaji
