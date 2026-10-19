# HRIS Go-Live: Data Karyawan & Jadwal Shift

Tanggal: 2026-10-19 · Target live: **2026-10-21**

## Tujuan

Merapikan dua revisi user sebelum go-live modul Karyawan, Jadwal Kerja, Branch, Absensi, Izin/Cuti, dan Pinjaman. Payroll tidak termasuk go-live ini.

1. **Data Karyawan:**
   - export & import (mode Add/Replacement);
   - karyawan resign tidak tampil;
   - email bisa dipakai lagi untuk data karyawan baru;
   - audit log tampil.
2. **Jadwal Shift:**
   - bulk upload jadwal per branch untuk 7–45 hari;
   - shift default;
   - checklist Shift/Non-Shift;
   - jadwal tetap untuk HQ & Warehouse.

Prinsipnya perubahan sekecil mungkin. Kita memakai ulang pola yang sudah ada: impor preview→commit COA, `platform/xlsx`, `audit.audit_log`, dan `SaveShiftPattern`. Tidak ada refactor besar.

## Keputusan user (19-10)

| Topik | Keputusan |
|---|---|
| Import mode **Add** | Hanya menambah karyawan baru. Baris dengan NIP yang sudah ada ditolak. |
| Import mode **Replacement** | Timpa per NIP: NIP yang ada diperbarui sesuai file, NIP baru ditambahkan. Karyawan yang tidak ada di file **tidak disentuh**. |
| Resign | Ada aksi **Resign**. Karyawan resign hilang dari daftar bawaan dan dari semua pilihan karyawan (jadwal, absensi, cuti, pinjaman). Data tetap bisa dicari lewat filter "Nonaktif". |
| Masuk kerja lagi (email sama) | **Buat data baru (NIP baru). Email dilepas** dari data lama yang resign. |
| Jadwal tetap HQ & Warehouse | **Senin–Jumat 09.00–18.00** (9 jam termasuk istirahat 1 jam). Sabtu & Minggu libur. |
| Shift / Non-Shift | Checklist ada di **data karyawan** dan wajib untuk semua karyawan. Karyawan Non-Shift **tidak muncul** saat penugasan di Jadwal Kerja. Ada validasi pencegah human error (2.6). |
| Format file Excel | Judul kolom dan isi pilihan memakai bahasa sehari-hari seperti di aplikasi, **bukan nama field database**. Ada dropdown, petunjuk, dan pesan error per baris/kolom (Bagian 3). |

## Bagian 1: Data Karyawan

### 1.1 Aksi Resign

- **Lokasi tombol:** di Detail Karyawan, tombol **Resign**. Dialognya berisi tanggal efektif (wajib), jenis (resign / PHK / kontrak berakhir), dan alasan.
- **Endpoint baru:** `POST /api/hris/employees/{id}/resign` (Go, modul hris). Dalam satu transaksi endpoint ini:
  - mengisi `employment_status = 'resigned'` (atau `'terminated'` untuk PHK), `is_active = false`, dan `end_date = tanggal efektif`;
  - menutup penempatan (`employee_placements.end_date`) dan pola shift (`employee_shifts.effective_to`) per tanggal efektif;
  - memblokir akun login bila ada, memakai mekanisme `revokeAccount` yang sudah ada (`banned_until` + `configuration.users.status = inactive`);
  - mencatat `employment_history` (change_type `resign`) dan audit log (1.3).
- **Hak akses:** sama dengan ubah karyawan (`hris.kepegawaian.users` update).
- **Daftar yang harus menyaring `is_active = true`:**
  - pemilih karyawan di jadwal, bulk upload, absensi (adjust/monitoring), cuti, dan pinjaman;
  - daftar Shift Tim.
- **Cara cek:** grep semua sumber dropdown karyawan. Daftar yang sudah menyaring tidak diubah.

### 1.2 Email dilepas saat karyawan masuk kerja lagi

- **Saat membuat karyawan baru**, cek apakah email sudah dipakai:
  - dipakai karyawan **aktif** → tetap ditolak (409, seperti sekarang);
  - hanya dipakai karyawan **nonaktif** → form menampilkan konfirmasi "Email ini milik {nama} (NIP …, resign {tanggal}). Lepas email dari data lama dan buat karyawan baru?". Bila HR setuju, kirim `release_email: true`.
- **Pelepasan email**, dalam transaksi yang sama dengan pembuatan karyawan baru:
  - email data lama diganti `arsip-{nip}@resign.invalid`. Kolom email `NOT NULL`, dan domain `.invalid` memang khusus untuk alamat yang tidak bisa dikirimi;
  - email asli disimpan di audit log;
  - bila data lama punya akun login, akun itu **dipindahkan** ke karyawan baru (`user_id`) dan blokirnya dibuka, supaya orang yang sama tetap login dengan email & password lamanya. HR bisa reset password;
  - data lama (NIP, riwayat, absensi, slip) tidak berubah selain kolom email.
- **Endpoint yang diubah:** `POST /api/users` (create di `configuration/accounts`) dan cek `EmailTaken` / `EmployeeExists`.
- **Data live:** ada 26 email yang dipakai bersama data aktif & nonaktif (hasil import Odoo). Data ini tidak diubah otomatis. Aturan baru hanya berlaku saat membuat karyawan baru.

### 1.3 Audit log karyawan

- **Penulisan:** `audit.audit_log` dengan entity `hris.employees`. Aksi yang dicatat:
  - `employee.create`, `employee.update` (field yang berubah: sebelum → sesudah);
  - `employee.resign`, `employee.email_released`, `employee.import` (satu entri per baris).
- **Titik tulis:** service create/update `configuration/accounts/employees.go`, resign (1.1), dan import (1.5).
- **Tampilan:**
  - tab **Riwayat Perubahan** di Detail Karyawan, dari `GET /api/audit?entity=hris.employees&entity_id={id}` yang sudah ada;
  - label aksi baru ditambahkan di `features/audit/audit-labels.ts`, supaya juga terbaca di halaman Settings → Audit.
- **Batasan:** audit hanya ada untuk perubahan setelah fitur ini live. Riwayat lama tetap di tab Employment History.

### 1.4 Export karyawan (xlsx)

- **Lokasi:** tombol **Export** di halaman Karyawan, mengikuti filter & pencarian yang sedang aktif.
- **Endpoint:** `GET /api/users/export?...filter` (Go). Dibangun dengan `platform/xlsx.Build`.
- **Kolom & format:** mengikuti **Bagian 3.2**, sama persis dengan template import. Hasil export bisa langsung diedit lalu di-import ulang dengan mode Replacement.
- **Tidak diekspor:** gaji dan data akun login.

### 1.5 Import karyawan (Add / Replacement)

- **Alur:** dialog Import → unduh template → pilih mode → unggah xlsx/csv → **preview** (baris dibuat / diperbarui / dilewati / error beserta alasannya) → **commit**.
  - Commit ditolak bila masih ada error.
  - Seluruh baris diproses dalam satu transaksi.
  - Polanya sama dengan impor COA (`accounting/coa_import.go`).
- **Endpoint:** `POST /api/users/import` dengan field `mode=add|replace` dan `step=preview|commit`.
- **Validasi baris:**
  - NIP dan Nama wajib. Email wajib untuk baris baru;
  - email tidak boleh bentrok dengan karyawan aktif lain. Bila bentrok dengan karyawan resign, muncul **peringatan di preview**. HR memilih "Lepas email dari data lama" per baris atau sekaligus (aturan 1.2), tanpa kolom tambahan di file;
  - Departemen, Jabatan, dan Cabang dicocokkan dengan nama master; nama yang tidak dikenal menjadi error;
  - format kolom & nilai mengikuti **Bagian 3.2**.
- **Replacement:** hanya kolom yang **terisi** di file yang ditimpa. Sel kosong berarti tidak diubah, supaya data tidak terhapus tanpa sengaja.
- **Cabang Utama:** bila berbeda dari penempatan utama sekarang, penempatan lama ditutup kemarin dan penempatan baru dimulai hari ini (memakai `BulkPlacement`/placements yang sudah ada).
- **Batasan:** maksimal 1.000 baris per file. Import tidak membuat akun login, karena akun dibuat lewat seeder/Manajemen User.

## Bagian 2: Jadwal Shift

### 2.1 Master shift: kode & shift default

- **Kolom baru** `hris.shifts.code` (unik, wajib). Kode ini dipakai di file upload karena nama shift live ada yang kembar (2× "Shift Pagi", 2× "Shift Siang" dengan jam berbeda).
- **Backfill kode** dibuat dari nama shift supaya mudah dibaca, bukan nomor urut. Contohnya:
  - `SPG1` untuk "SPG Store 1 - 08.00-16.00";
  - `CS2` untuk "CS Shift 2";
  - `PRF1` untuk "PERFUMER Shift 1";
  - `PAGI8` / `PAGI9` untuk dua "Shift Pagi" (08.00 / 09.00).
- Daftar usulan kode ditampilkan dulu sebelum migrasi. HR bisa mengubahnya di halaman Shift Kerja.
- **Shift baru dari seed:**
  - `DEF` **Default 08.00–17.00** (istirahat 60 menit). Dipakai sebagai isi bawaan sel kosong di template upload;
  - `NS` **Non-Shift 09.00–18.00** (istirahat 60 menit). Dipakai untuk jadwal tetap HQ & Warehouse.
- **Penanda bawaan:** `hris.shifts.is_default` (maksimal satu baris).

### 2.2 Checklist Shift / Non-Shift per karyawan

**Prinsip:** tipe jadwal adalah atribut **karyawan**. Setiap karyawan aktif wajib punya salah satu nilai, tidak boleh kosong. Hanya karyawan **Shift** yang bisa ditugaskan di Jadwal Kerja.

- **Kolom baru:** `hris.employees.schedule_type`, isinya `shift` atau `non_shift`, `NOT NULL DEFAULT 'shift'`, dengan CHECK constraint.
- **Data live (migrasi):**
  - karyawan dengan penempatan utama **Paddy HQ Bandung (66)** dan **Warehouse Paddy (71)** menjadi `non_shift`;
  - karyawan lainnya menjadi `shift`.
  - Daftarnya ditampilkan dulu dan DB di-backup sebelum dijalankan.
- **Tempat checklist tampil di data karyawan:**
  - **Form tambah/ubah karyawan** (bagian Kepegawaian): pilihan **Shift / Non-Shift**, wajib diisi, default Shift.
  - **Detail karyawan:** badge "Shift" / "Non-Shift" di header, plus info jadwal yang berlaku.
  - **Daftar Karyawan:** kolom badge dan filter "Tipe Jadwal".
  - **Export/Import (1.4–1.5):** kolom `Tipe Jadwal`, nilainya hanya `Shift` atau `Non-Shift`. Nilai lain dianggap error.
  - **Ubah massal:** pilih beberapa karyawan di daftar → "Set Shift / Non-Shift". Untuk HR merapikan data awal.
- **Efek di Jadwal Kerja:**
  - karyawan **Non-Shift tidak muncul** di grid Jadwal Kerja, template upload, maupun pilihan penugasan shift;
  - di halaman Jadwal ditampilkan keterangan "N karyawan Non-Shift di branch ini memakai jadwal tetap", dengan tautan ke daftarnya;
  - tab Jadwal Shift di detail karyawan Non-Shift **dikunci (read-only)**. Isinya jadwal tetap dan tombol "Terapkan jadwal tetap" saja; shift tidak bisa dipilih bebas;
  - **Shift Tim (ESS atasan)** hanya bisa mengatur jadwal bawahan yang Shift. Bawahan Non-Shift tampil read-only.
- **Validasi saat tipe jadwal diubah:**
  - **Shift → Non-Shift:** bila karyawan punya jadwal per tanggal mulai hari ini ke depan, muncul konfirmasi "X jadwal per tanggal akan dihapus dan diganti jadwal tetap mulai {tanggal}". Bila disetujui, jadwal per tanggal ke depan dihapus dan jadwal tetap diterapkan dalam satu transaksi.
  - **Non-Shift → Shift:** jadwal tetap berhenti per tanggal yang dipilih. Muncul peringatan "Karyawan belum punya jadwal shift mulai {tanggal}; tugaskan di Jadwal Kerja".
  - Perubahan ini dicatat di audit log.

### 2.3 Jadwal tetap Non-Shift

- **Aksi:** **Terapkan jadwal tetap**, di halaman Jadwal (2.5) untuk semua karyawan Non-Shift di satu branch, dan di tab Jadwal Shift per karyawan.
- **Isi jadwal:** pola mingguan Sen–Jum = `NS` (09.00–18.00), Sab–Min = libur, berlaku mulai tanggal yang dipilih. Tanggal ini tidak boleh berada di periode absensi yang sudah closing.
- **Cara simpan:** memakai `SaveShiftPattern` yang sudah ada. Tidak ada reader baru, sehingga clock-in, roster, dan payroll otomatis ikut.
- **Karyawan Shift:** aksi ini menolak mereka.

### 2.4 Jadwal per tanggal (lapisan baru)

Sekarang jadwal hanya berupa pola mingguan. Upload 7–45 hari (rotasi toko) butuh jadwal per tanggal.

- **Tabel baru** `hris.employee_shift_days`:
  - kolom: `employee_id`, `work_date`, `shift_id` (NULL = libur), `branch_id`, `batch_id`, `created_by_name`, `created_at`;
  - `UNIQUE (employee_id, work_date)`.
- **Urutan resolve jadwal:** **jadwal per tanggal → pola mingguan → tanpa jadwal** (perilaku tanpa jadwal tidak berubah).
- **Reader yang diubah untuk go-live** (di Go, satu fungsi resolver bersama di `hris/domain/schedule.go` plus query repo-nya):
  1. snapshot shift saat clock-in (`attendance_clock.go` `shiftSnapshot`), yang menentukan telat;
  2. adjust absensi (`attendance_adjust.go`);
  3. roster harian / monitoring (`postgres_attendance.go` daily-roster);
  4. jadwal ESS dan kalender saya (`selfservice.go` `ESSSchedule`, `/attendance/schedule`).
- **Tahap 2 (sesudah 21-10, karena payroll belum live):** reader payroll (`ScheduledDays`, hari istirahat lembur), KPI on-time, dan roster spa. Sampai tahap itu modul tersebut tetap membaca pola mingguan saja. Ini aman karena payroll tidak termasuk go-live.

### 2.5 Halaman Jadwal per Branch + bulk upload

- **Halaman baru** `/dashboard/hris/schedules`, menu "Jadwal Kerja", menggantikan redirect lama. Halaman ini memakai guard yang sama dengan Shift Kerja.
- **Isi halaman:**
  1. Pilih **branch** dan **rentang tanggal** (min 7, maks 45 hari) → tampilan grid per karyawan × tanggal (read-only). Isinya hanya karyawan **aktif, bertipe Shift**, dengan penempatan di branch itu pada rentang tersebut.
  2. **Unduh template** xlsx (format lengkap di **Bagian 3.3**):
     - sheet *Jadwal* berisi baris NIP, Nama (karyawan Shift di branch itu), kolom tanggal, dan sel kode shift yang sudah terisi dari jadwal yang ada;
     - sheet *Kode Shift* berisi daftar kode, nama, dan jam (hanya shift aktif);
     - sheet tersembunyi *Info* berisi branch, rentang tanggal, dan waktu unduh. Dipakai untuk memastikan file yang diunggah memang template branch & rentang ini;
     - sel tanggal memakai dropdown (data validation Excel) berisi daftar kode shift dan `L`, supaya HR tidak salah ketik.
  3. **Unggah** → **preview** → **commit**:
     - preview menampilkan ringkasan (sel baru / berubah / sama) dan perbandingan jadwal lama → baru per karyawan, beserta **error** dan **peringatan** (lihat 2.6);
     - commit **mengganti** jadwal per tanggal karyawan-karyawan di file untuk rentang itu, dalam satu transaksi dengan satu `batch_id`, dan mencatat audit `schedule.bulk_upload`;
     - karyawan yang tidak ada di file **tidak diubah**.
- **Isi sel template:**
  - kode shift, misalnya `SPG1`;
  - `L` atau `OFF` = libur;
  - template sudah terisi: jadwal yang ada, atau **`DEF` (Default 08.00–17.00)** bila belum ada jadwal;
  - **sel kosong saat diunggah = error** ("isi kode shift atau L"), supaya sel yang terhapus tanpa sengaja tidak diam-diam menjadi shift default.
- **Endpoint (Go, modul hris):**
  - `GET /api/hris/schedules?branch_id&from&to` (grid);
  - `GET /api/hris/schedules/template?branch_id&from&to`;
  - `POST /api/hris/schedules/import` dengan `step=preview|commit`.

### 2.6 Validasi pencegah human error (Jadwal Kerja)

Commit **ditolak** bila masih ada **error**. **Peringatan** tidak memblokir, tapi HR harus mencentang "Saya sudah memeriksa peringatan" sebelum commit.

**Error (blokir):**

| Cek | Pesan contoh |
|---|---|
| File bukan template branch/rentang yang dipilih (sheet *Info* tidak cocok / hilang) | "File ini template PPJA 1–14 Nov, bukan PLMR 1–14 Nov" |
| Rentang < 7 atau > 45 hari | "Rentang 7–45 hari" |
| Tanggal sudah lewat, atau berada di periode absensi yang sudah closing | "Tanggal 18-10 sudah lewat / periode Oktober sudah closing" |
| NIP tidak dikenal, nonaktif/resign, atau tidak ditempatkan di branch ini pada tanggal tsb | "202505272 tidak ditempatkan di PPJA pada 03-11" |
| Karyawan bertipe **Non-Shift** | "Nuruz Z. Non-Shift, pakai jadwal tetap" |
| NIP muncul dua kali di file | "NIP 2025… ganda (baris 5 & 12)" |
| Kode shift tidak dikenal atau shift nonaktif (huruf besar/kecil & spasi diabaikan) | "Kode 'SPG 1' tidak ada; maksud Anda SPG1?" |
| Sel kosong | "Isi kode shift atau L" |
| Kolom tanggal diubah/digeser dari template | "Kolom tanggal tidak sesuai template" |
| Jadwal berubah sejak preview (upload lain masuk lebih dulu) | "Jadwal sudah diubah orang lain, unggah ulang" |

**Peringatan (boleh lanjut setelah dicentang):**

| Cek | Pesan contoh |
|---|---|
| Masuk lebih dari 6 hari berturut-turut tanpa libur | "Mario K. masuk 9 hari berturut-turut (3–11 Nov)" |
| Jeda antar shift < 8 jam (mis. shift malam lalu pagi) | "Jeda 6 jam antara 04-11 malam dan 05-11 pagi" |
| Diberi shift pada tanggal cuti/izin yang sudah disetujui | "Feti P. cuti 07-11 tapi diberi SPG1" |
| Diberi shift pada hari libur nasional | "10-11 libur nasional" |
| Tidak ada satu pun karyawan masuk di suatu tanggal | "Tidak ada yang masuk di PPJA 09-11" |
| Mengubah jadwal hari ini (sudah ada yang clock-in) | "3 karyawan sudah clock-in hari ini; telatnya tidak dihitung ulang" |

**Validasi lain:**

- **Master shift:**
  - kode wajib, unik, huruf besar tanpa spasi;
  - `DEF` dan `NS` tidak bisa dihapus/dinonaktifkan;
  - shift yang masih dipakai di jadwal ke depan tidak bisa dinonaktifkan, dengan pesan berisi jumlah pemakaiannya.
- **Hak akses:**
  - upload hanya untuk HR (guard Shift Kerja);
  - atasan di Shift Tim hanya bisa mengubah bawahan Shift.
- **Batas file:** maksimal 300 karyawan × 45 hari per file, format xlsx/csv.

## Bagian 3: Format file Excel (template upload & export)

File dipakai HR, bukan programmer: **tidak ada nama field database** (tidak ada `employment_status`, `is_active`, `snake_case`, atau ID). Semua judul kolom dan isi pilihan memakai bahasa sehari-hari yang sama dengan tampilan aplikasi.

### 3.1 Aturan umum semua file

- **Sheet *Petunjuk* di urutan pertama.** Isinya:
  - cara mengisi;
  - arti setiap kolom;
  - daftar nilai yang boleh;
  - **contoh baris yang benar**.
  - Contoh hanya ada di sheet ini, tidak di sheet data, supaya tidak ikut ter-import.
- **Judul kolom:**
  - bahasa Indonesia baku sehari-hari;
  - kolom wajib diberi tanda **\*** dan warna judul berbeda;
  - baris judul dibekukan (freeze), lebar kolom pas dengan isi.
- **Kolom pilihan memakai dropdown** (data validation Excel). Isinya diambil dari master yang aktif pada saat file diunduh: Status Kepegawaian, Tipe Jadwal, Jenis Kelamin, Status Pernikahan, Cabang, Departemen, Jabatan, dan kode shift.
- **Tanggal:** sel bertipe tanggal dengan tampilan **DD/MM/YYYY** (contoh `21/10/2026`).
  - Saat import diterima: tanggal Excel, `21/10/2026`, `21-10-2026`, dan `2026-10-21`.
  - Tanggal yang tidak masuk akal ditolak dengan pesan jelas, misalnya `31/02/2026` atau tanggal lahir di masa depan.
- **Angka panjang disimpan sebagai teks:** NIP, NIK, NPWP, No. HP, No. Rekening, No. BPJS.
  - Tujuannya supaya Excel tidak mengubahnya menjadi `3,27E+15` atau membuang angka 0 di depan.
  - Saat import, spasi/titik/strip dibersihkan, lalu panjangnya dicek: NIK 16 digit, NPWP 15–16 digit, No. HP diawali `08`/`62`/`+62`.
- **Pilihan Ya/Tidak** ditulis `Ya` / `Tidak`, bukan `true`/`false` atau `1`/`0`.
- **Import toleran:**
  - urutan kolom bebas;
  - huruf besar/kecil, tanda \*, dan spasi di judul diabaikan;
  - kolom tambahan diabaikan;
  - nilai pilihan dicocokkan tanpa peduli huruf besar/kecil, misalnya `kontrak (pkwt)` = `Kontrak (PKWT)`.
- **Pesan error memakai bahasa user:** "Baris 12, kolom *Tanggal Masuk*: format tanggal harus DD/MM/YYYY", bukan nama field.
  - Hasil preview bisa diunduh sebagai file yang sama ditambah kolom **Keterangan Error** di paling kanan.
  - HR cukup memperbaiki baris yang ditandai lalu mengunggah ulang.
- **Nama file jelas:**
  - `Template Import Karyawan.xlsx`;
  - `Data Karyawan - 21-10-2026.xlsx`;
  - `Jadwal Kerja - PPJA - 03-11 sd 16-11-2026.xlsx`.

### 3.2 File Karyawan (export = template import)

Sheet *Data Karyawan*, satu baris per karyawan. Urutannya mengikuti form karyawan:

| Judul kolom | Wajib | Isi / format | Contoh |
|---|---|---|---|
| NIP | Wajib di Replacement; kosong di Add = dibuat otomatis | Teks | `202505272` |
| Nama Lengkap \* | Ya | Teks | `Feti Puspitasari` |
| Email \* | Ya (karyawan baru) | Alamat email | `feti@gmail.com` |
| No. HP | | Teks, diawali 08/62 | `081234567890` |
| Tanggal Masuk \* | Ya | DD/MM/YYYY | `01/06/2025` |
| Status Kepegawaian \* | Ya | Dropdown: Masa Percobaan, Kontrak (PKWT), Tetap (PKWTT), Magang, Freelance, Pekerja Harian | `Kontrak (PKWT)` |
| Tipe Jadwal \* | Ya | Dropdown: Shift, Non-Shift | `Shift` |
| Cabang Utama \* | Ya (karyawan baru) | Dropdown nama cabang | `PPLN` |
| Departemen | | Dropdown | `Retail Operational` |
| Jabatan | | Dropdown | `Shopkeeper Staff` |
| NIP Atasan | | Teks (NIP atasan langsung) | `202310037` |
| NIK (KTP) | | 16 digit, teks | `3273…` |
| NPWP | | 15–16 digit, teks | |
| Tanggal Lahir | | DD/MM/YYYY | `14/02/2001` |
| Jenis Kelamin | | Dropdown: Laki-laki, Perempuan | `Perempuan` |
| Status Pernikahan | | Dropdown: Belum Menikah, Menikah, Cerai Hidup, Cerai Mati | `Belum Menikah` |
| Alamat · Kota · Provinsi · Kode Pos | | Teks | |
| Nama Bank · No. Rekening | | Teks | `BCA` · `1234567890` |
| No. BPJS Ketenagakerjaan · No. BPJS Kesehatan | | Teks | |
| Kontak Darurat (Nama) · (No. HP) · (Hubungan) | | Teks | `Ibu` |

**Kolom khusus export** (di paling kanan, judul berwarna abu-abu dengan catatan "hanya informasi, tidak dibaca saat import"):

- **Nama Atasan**;
- **Status Aktif** (`Aktif` / `Resign`);
- **Tanggal Keluar**;
- **Terakhir Diubah**.

**Tidak ada di file:** status Resign (resign hanya lewat aksi Resign), gaji, data akun login, dan ID sistem.

### 3.3 File Jadwal Kerja per cabang

**Sheet *Jadwal*:**

- **Baris 1–2:** judul `Jadwal Kerja — PPJA — 03/11/2026 s/d 16/11/2026` dan keterangan singkat "Isi dengan kode shift (lihat sheet *Kode Shift*). L = Libur."
- **Baris judul kolom:**
  - `NIP`, `Nama Karyawan`, `Jabatan`;
  - satu kolom per tanggal dengan judul hari + tanggal, misalnya `Sen 03/11`, `Sel 04/11`;
  - di akhir, `Hari Masuk` dan `Hari Libur` (dihitung otomatis).
- **Penanda visual:**
  - kolom hari Minggu dan libur nasional diberi warna;
  - sel `L` berwarna abu-abu.
- **Isi sel tanggal:**
  - dropdown kode shift + `L`;
  - sudah terisi dengan jadwal yang ada, atau `DEF` bila belum ada jadwal.
- **Kunci sheet (tanpa password):** hanya sel tanggal yang bisa diubah. NIP, nama, jabatan, judul tanggal, dan kolom hitungan terkunci, supaya tidak tergeser atau terhapus tanpa sengaja.
- **Baris karyawan:** hanya karyawan **Shift** yang aktif dan ditempatkan di cabang itu (2.2), diurutkan per jabatan lalu nama.

**Sheet *Kode Shift*:** Kode, Nama Shift, Jam Masuk, Jam Pulang, Istirahat (menit), ditambah baris `L` = Libur.

**Sheet *Petunjuk*:**

- langkah unduh → isi → unggah;
- daftar error & peringatan (2.6) dalam bahasa sederhana;
- contoh satu baris yang benar.

**Sheet tersembunyi *Info*:** cabang, rentang tanggal, dan waktu unduh. Dipakai untuk validasi; isinya tidak perlu dilihat HR.

## Pengujian

- **Go unit:**
  - resolver jadwal (per tanggal > mingguan > kosong) dan parser template jadwal;
  - **setiap error & peringatan di 2.6**: satu kasus negatif per baris tabel;
  - Non-Shift tidak ikut di grid/template dan ditolak saat upload;
  - perubahan tipe Shift ↔ Non-Shift;
  - validasi import karyawan (Add/Replace, sel kosong tidak menimpa, nilai `Tipe Jadwal`);
  - format file (Bagian 3):
    - judul kolom & nilai pilihan sesuai tabel 3.2/3.3, tanpa nama field;
    - export → import ulang menghasilkan 0 perubahan;
    - NIK/NIP/No. HP tetap teks, termasuk angka 0 di depan;
    - variasi format tanggal yang diterima;
    - pesan error menyebut baris & judul kolom;
  - aturan pelepasan email.
- **Go integrasi** (DB salinan, pola test hris yang ada):
  - resign menutup penempatan & pola shift dan memblokir login;
  - clock-in memakai shift per tanggal untuk hitung telat;
  - commit upload mengganti rentang.
- **Frontend vitest:**
  - checklist Shift/Non-Shift di form (wajib), badge di detail, filter di daftar, tab jadwal terkunci untuk Non-Shift;
  - dialog resign, konfirmasi lepas email;
  - dialog import (preview/error), grid jadwal, centang peringatan sebelum commit.
- **Uji di stack salinan DB live** (seperti sebelumnya) + screenshot sebelum deploy:
  - upload 14 hari untuk satu toko;
  - clock-in di tanggal yang di-upload;
  - roster harian;
  - resign 1 karyawan uji;
  - export → import Replacement tanpa perubahan (hasilnya 0 baris diubah).

## Rollout ke live

1. Backup DB.
2. Jalankan migrasi:
   - `shifts.code` + `is_default` + seed `DEF`/`NS`;
   - `employees.schedule_type`;
   - `employee_shift_days`.
3. Migrasi data: `non_shift` untuk HQ & Warehouse. Daftar ditampilkan dulu.
4. Ganti container API & web, lalu cek ulang halaman.
5. Jadwal tetap Non-Shift **tidak** diterapkan otomatis. HR menekan "Terapkan jadwal tetap" per branch, atau kita jalankan atas persetujuan.

## Di luar cakupan

- Reader payroll/KPI/spa untuk jadwal per tanggal (tahap 2).
- Tipe branch (HQ/Warehouse/Toko) di master branch. Cukup checklist Shift/Non-Shift per karyawan.
- Mengubah 26 email bersama yang sudah ada di data live.
- Tukar shift / pengajuan ganti jadwal oleh karyawan.

## Urutan kerja (kalau waktu mepet, yang di atas didahulukan)

1. 2.1 + 2.2 + 2.3: kode shift, checklist Shift/Non-Shift di data karyawan (form, detail, daftar, ubah massal), jadwal tetap HQ/Warehouse.
2. 1.1 Resign + filter aktif di semua pemilih karyawan.
3. 2.4 + 2.5 + 2.6: jadwal per tanggal + bulk upload per branch + validasi.
4. 1.2 Lepas email + 1.3 audit log.
5. 1.4 Export, lalu 1.5 Import.
