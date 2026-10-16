# Uji Manual — Payroll Multi-Entitas (EPIC-054)

Data uji: seeder `backend/database/seeders/payroll-multi-entity-qa.js` (`pnpm db:seed:payroll-qa`).
Periode uji: **Desember 2026**. Absensinya sudah di-closing oleh seeder, jadi payroll bisa dihitung dan diproses.

> ⚠️ **Wajib dibersihkan sebelum 1 Desember 2026.** Closing Desember mengunci absensi Desember untuk *semua*
> karyawan (clock-in asli akan ditolak). Bersihkan dengan:
> `cd backend/database && pnpm db:seed:payroll-qa -- --cleanup`
> Perintah ini menghapus karyawan & akun uji, run payroll Desember yang belum dibayar, dan periode absensi
> Desember buatan seeder. Jangan **Mark Paid** run Desember: cicilan kasbon & jurnal akan terposting sungguhan,
> dan cleanup akan menolak berjalan.

## Data yang dibuat seeder

| NIP | Nama | Toko yang dijaga (Desember) | Struktur gaji aktif | Lainnya |
|---|---|---|---|---|
| QA054-01 | QA Rina Full Paddy | Paddy Store PVJ (Sen–Sab) | Paddy: pokok 4.500.000, transport 300.000, makan 400.000 | telat 2 hari (3 & 10 Des) |
| QA054-02 | QA Dimas Dua Entitas | PVJ Sen–Rab, Paddy HQ Bandung Kam–Sab | Paddy 1.000.000 + Paddy Kantor Pusat 1.000.000 | kasbon 300.000, cicilan 100.000 mulai Des 2026; telat 2 hari (2 & 9 Des) |
| QA054-03 | QA Sari Multi Toko | PVJ Sen/Rab/Jum, Kopo Sel/Kam/Sab | Paddy: pokok 4.000.000, transport 300.000, makan 400.000 | — |

- Penempatan utama ketiganya di Paddy Store PVJ (entitas Paddy). Dimas juga ditempatkan di HQ Bandung (Kantor Pusat).
- Jadwal: Shift Pagi 08:00–16:00, Senin–Sabtu. Absensi tervalidasi, dan libur nasional 24 & 25 Des dilewati.
- Akun ESS: `qa054.rina@paddy.id`, `qa054.dimas@paddy.id`, `qa054.sari@paddy.id`.
  - Password ada di `~/.config/paddydev/qa054.env` di server.

## Urutan uji

### 1. Struktur Gaji (HRIS → Penggajian → Salary)
1. **Tab Paddy:** Rina, Dimas, dan Sari tampil.
2. **Tab Paddy Kantor Pusat:** hanya Dimas yang tampil (1.000.000).
3. **Edit gaji Dimas di salah satu tab:** entitas tampil read-only.

### 2. Buat & hitung payroll (HRIS → Penggajian → Run Penggajian)
1. **Tab Paddy:** pilih Desember 2026, klik **Buat Payroll Paddy**, lalu **Hitung** → **Hitung Payroll**.
   - Panel hasil menampilkan jumlah karyawan dihitung dan karyawan yang dilewati. Tidak ada peringatan "periode terbuka".
2. **Tab Paddy Kantor Pusat:** pilih Desember 2026, klik **Buat Payroll Paddy Kantor Pusat**, lalu Hitung.
   - Hanya karyawan bergaji Kantor Pusat yang dihitung (termasuk Dimas).
   - Karyawan Paddy lainnya terhitung sebagai "hanya digaji entitas lain".
3. **Buat lagi Desember 2026 di tab yang sama:** ditolak dengan "Payroll untuk periode ini sudah ada".

### 3. Hasil yang diharapkan per karyawan (detail run & slip)

| Karyawan | Run Paddy | Run Paddy Kantor Pusat |
|---|---|---|
| Rina | 1 slip, gross 5.200.000, biaya 100% PVJ | tidak ada slip |
| Dimas | gross 1.000.000, **cicilan 100.000**, biaya 100% PVJ | gross 1.000.000, **cicilan 0**, biaya 100% HQ Bandung |
| Sari | 1 slip, gross 4.700.000, biaya ±48% PVJ / ±52% Kopo | tidak ada slip |

- **PPh21/BPJS** tiap slip Dimas dihitung dari porsi entitasnya saja. Pada uji di DB salinan, BPJS Kesehatan karyawan untuk masing-masing slip 1.000.000 adalah 10.000.
- **Potongan telat** hanya muncul bila potongan telat diaktifkan di **Pengaturan Payroll**. Kalau aktif, untuk Dimas potongan itu hanya ada di slip Paddy.
- **Hadir 25/27:** jadwal Senin–Sabtu Desember = 27 hari, termasuk 24 & 25 Des yang libur, sedangkan absensi = 25 hari.

### 4. Slip gaji & ESS
1. **Slip Dimas dari kedua run:** badge memuat nama entitas, dan kop PDF berisi nama entitas.
2. **Login sebagai Dimas → Slip Gaji:** dua slip Desember 2026, "· Paddy" dan "· Paddy Kantor Pusat".

### 5. Biaya Gaji per Toko
1. **Pilih run Desember Paddy:** biaya Sari terbagi ke PVJ dan Kopo, dan biaya Dimas masuk PVJ.
2. **Pilih run Desember Kantor Pusat:** biaya Dimas masuk HQ Bandung, tidak masuk toko Paddy.

### 6. Proses (tanpa Mark Paid)
1. **Klik Process di salah satu run Desember:** berhasil, karena absensi Desember sudah closed.
2. **Berhenti sebelum Mark Paid.** Lihat peringatan di atas.

### 7. Bersihkan
1. **Jalankan cleanup:** `pnpm db:seed:payroll-qa -- --cleanup` dari `backend/database`.
2. **Periksa hasilnya:**
   - run Desember 2026 hilang;
   - karyawan QA054-* hilang;
   - periode absensi Desember kembali terbuka.
