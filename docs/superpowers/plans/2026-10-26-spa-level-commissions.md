# Rencana komisi berdasarkan level terapis

Status: implementasi selesai, diuji, dan dideploy pada 26 Oktober 2026 atas permintaan pengguna. Reset komisi operasional telah diterapkan; tarif baru menunggu pengisian admin. Komisi mengikuti kombinasi Level 0/1/2 dan varian treatment. Kombinasi yang sama memiliki nominal sama di semua outlet. Pengaturan berada di halaman baru, terpisah dari Training dan Treatment.

## Keputusan pengguna

- Tarif nominal rupiah per kombinasi **level × varian treatment**, dibayarkan per item treatment selesai. Varian berbeda boleh memiliki tarif berbeda, termasuk durasi berbeda.
- Outlet tidak menjadi pembeda tarif komisi. Nominal diisi satu kali dan berlaku di seluruh outlet.
- Pengaturan komisi dibuat sebagai halaman baru. Input komisi di halaman Treatment/Harga Outlet dihilangkan.
- Riwayat data komisi lama boleh direset. Tidak perlu mempertahankan skema lama atau membuat mekanisme aktivasi dua skema.
- Nominal baru diisi admin; tidak ditebak atau disalin otomatis dari tarif outlet lama yang mungkin berbeda.

## Pengalaman pengguna

- Usulan lokasi: **Spa → Pengaturan Komisi**. Training tetap memiliki tab Training dan Pengaturan Level untuk syarat kenaikan.
- Tabel input: **Treatment | Varian/durasi | Level 0 (Rp) | Level 1 (Rp) | Level 2 (Rp)**. Satu baris per varian, tanpa pilihan outlet. Tampilkan keterangan tarif berlaku untuk semua outlet.
- Pencarian treatment/varian dan filter tarif belum lengkap; simpan perubahan secara massal dengan validasi seluruh perubahan dalam satu transaksi. Varian baru otomatis muncul sebagai belum diatur.
- Tarif belum diisi dibedakan dari nilai nol eksplisit. Nilai harus rupiah bulat dan tidak negatif; varian yang diatur harus memiliki ketiga tarif level lengkap.
- Daftar terapis tetap menampilkan level, dengan akses melihat rincian tarif per varian bagi pengguna berizin; jangan menampilkan satu nominal seolah semua treatment memiliki tarif sama. Area karyawan menampilkan tarif sesuai level sendiri dan estimasi komisi tiap jadwal.
- Hilangkan seluruh input, validasi wajib komisi, dan pengiriman nilai komisi dari halaman Treatment/Harga Outlet. Harga jual tetap dapat berbeda antar-outlet. Laporan Komisi dan Payroll Terapis tetap di tempat sekarang.
- Detail laporan/ekspor menampilkan level ketika komisi diperoleh, varian treatment, dan nominal yang tersimpan.

## Aturan perhitungan

1. Ambil level terapis yang ditugaskan dan varian pada item ketika treatment selesai. Pilih tarif untuk pasangan tersebut; simpan level, sumber tarif, dan nominal secara atomik bersama penyelesaian item.
2. Nominal dipengaruhi level dan varian treatment, bukan outlet, harga jual, atau diskon. Varian dengan durasi berbeda dapat memiliki tarif berbeda.
3. Perubahan tarif atau kenaikan level hanya memengaruhi item yang selesai setelah perubahan berlaku. Treatment yang telah selesai mempertahankan nominalnya, termasuk yang belum lunas.
4. Estimasi jadwal menggunakan level/tarif saat ini dan diberi label estimasi. Laporan dan payroll membaca nominal yang tersimpan, bukan menghitung ulang.
5. Item batal tidak memperoleh komisi; pengulangan permintaan penyelesaian tidak menggandakan komisi.
6. Resign dan kembali aktif mengikuti mekanisme reset Level 0 yang sudah ada. Nonaktif sementara tidak mereset level.

## Penyimpanan dan reset data lama

- Utamakan penyesuaian tabel aturan komisi yang ada: satu aturan unik untuk setiap pasangan varian dan level 0–2, nominal rupiah, tanpa dimensi outlet. Tambah kolom level dan batasan database yang diperlukan; perubahan UI saja belum cukup karena aturan lama belum menyimpan level.
- Reset aturan dan hasil komisi lama beserta relasi/alokasi serta total komisi pada payroll secara konsisten. Periksa dependensi sebelum menentukan SQL reset; jangan menghapus data treatment, booking, pembayaran pelanggan, pegawai, training, atau komponen gaji nonkomisi.
- Tandai batas reset atau item historis secara eksplisit agar item selesai sebelum reset tidak dihitung ulang sebagai komisi baru, estimasi, ataupun calon payroll. Nol hasil reset tidak boleh berubah menjadi tarif terbaru.
- Simpan snapshot level dan nominal pada setiap item baru yang selesai, serta admin/waktu perubahan tarif. Tidak memerlukan status aktivasi atau fallback ke aturan outlet lama.
- Endpoint aturan komisi lama disesuaikan/dihentikan agar tidak bisa membuat aturan per outlet. Endpoint penyimpanan harga tidak lagi menulis komisi; payload komisi lama ditolak secara jelas agar tidak dianggap berhasil tersimpan.
- Terapis tanpa penugasan atau tarif pasangan level-varian yang belum diatur menghasilkan kesalahan jelas saat penyelesaian, bukan komisi nol diam-diam. Estimasi menampilkan **Belum diatur**; nilai nol eksplisit tetap diperbolehkan.
- Terapkan pembacaan/locking yang konsisten agar penyelesaian bersamaan dengan kenaikan level atau perubahan tarif menghasilkan snapshot yang utuh.

## Pekerjaan implementasi

1. Periksa dependensi reset komisi/payroll, buat migrasi aturan varian-level dan snapshot, serta menu/izin Pengaturan Komisi. Hanya admin berizin komisi dapat mengubah tarif; hak mengelola training tidak otomatis memberi hak ini.
2. API baca/simpan matriks tarif dan penghitungan berdasarkan level-varian pada penyelesaian serta estimasi jadwal.
3. Halaman baru Pengaturan Komisi, hapus input/validasi/payload komisi dari Treatment/Harga Outlet, sesuaikan rincian tarif terapis dan area karyawan, serta snapshot level pada laporan/CSV.
4. Pengujian integrasi dan UI: pasangan level-varian sama lintas outlet mendapat nominal sama, level/varian berbeda mengikuti tarifnya, harga/diskon tidak mengubah komisi, kenaikan level/reset rehire, snapshot baru tidak berubah setelah tarif diedit, tarif belum lengkap/nilai negatif ditolak, varian baru belum diatur, hak akses, isolasi data sendiri, konkurensi, reset konsisten, item historis tidak muncul kembali, dan payroll tanpa duplikasi.
5. Build dan verifikasi migrasi/reset pada database uji sebelum rollout. Backup sebelum reset operasional; isi tarif baru sebelum melanjutkan penyelesaian treatment dengan skema baru.

## Titik perubahan utama

- [Resolver komisi](../../../backend/internal/modules/spa/domain/commission.go)
- [Penyelesaian treatment](../../../backend/internal/modules/spa/service.go)
- [Penyimpanan dan laporan](../../../backend/internal/modules/spa/postgres.go)
- [Estimasi jadwal karyawan](../../../backend/internal/modules/spa/my_schedule.go)
- [Payroll](../../../backend/internal/modules/spa/payroll.go)
- Halaman baru Pengaturan Komisi beserta route, menu, dan hak akses.
- [Pengaturan harga treatment](../../../frontend/src/features/spa/treatment-form.ts)
- [Laporan komisi](../../../frontend/src/features/spa/components/commissions-page.tsx)

## Hasil implementasi dan penggunaan

- Admin membuka **Spa → Pengaturan Komisi**, mencari varian, mengisi Level 0/1/2, lalu menekan **Simpan komisi**. Perubahan di baris yang tersembunyi oleh pencarian tetap ikut disimpan. Nilai kosong berarti belum diatur; nol berarti tanpa komisi. Tidak ada pilihan outlet.
- Halaman Treatment/Harga Outlet hanya menyimpan harga. Payload komisi lama ditolak dengan petunjuk halaman penggantinya. Endpoint aturan lama tidak dapat menulis tarif.
- Daftar Terapis memberi tautan pengaturan tarif kepada pengguna yang berhak. **Area Karyawan → Tugas Terapis → Tarif komisi saya** menunjukkan tarif level sendiri; perkiraan yang belum memiliki tarif diberi keterangan, tidak dianggap nol.
- Penyelesaian treatment menggunakan level yang dikunci selama transaksi dan satu pembacaan tarif yang sudah committed. Snapshot level/nominal dicatat bersama penyelesaian; tarif tidak dikunci lintas item agar tidak berlawanan urutan dengan pengeditan massal.
- Migrasi `20261026100000_spa_level_commissions.sql` mengosongkan aturan lama, menandai item historis sebagai hasil reset, menghapus alokasi komisi payroll, dan menghitung ulang total tanpa menghapus komponen gaji lain. Item hasil reset tidak dihitung ulang ke estimasi, laporan atau calon payroll.
- Tarif operasional baru tetap kosong untuk diisi admin. Seeder demo disesuaikan dengan struktur baru dan hanya menyediakan contoh tarif ketika seeder dijalankan secara eksplisit; seeder tidak dijalankan dalam pekerjaan ini.

## Verifikasi 26 Oktober 2026

- 226 tes frontend Spa dan proxy API lulus, termasuk tabel tiga level, penyimpanan draft tersembunyi, validasi nol/kosong, hak baca, dan penghapusan komisi dari Harga Outlet.
- Integrasi Spa/HRIS/app lulus di `mizu_training_test`, dengan tes lama `TestCustomerReportUsesPaidPOSOrdersAndWIB` dikecualikan karena fixture nomor telepon 23 karakter untuk kolom varchar(20), sebagaimana dicatat pada pekerjaan training sebelumnya.
- Tes baru membuktikan kesamaan tarif lintas outlet walaupun harga jual berbeda, snapshot setelah perubahan tarif, Level 2 setelah kenaikan, Level 0 setelah resign/masuk kembali, tarif belum diatur, nilai nol eksplisit, batas nominal, hak akses, penyimpanan atomik, serta reset payroll yang mempertahankan pembayaran pelanggan dan gaji lain.
- Tes dua transaksi `TestCommissionCompletionDuringTariffEdit` lulus: penyelesaian membaca tarif committed sebelumnya saat perubahan tarif belum commit, tanpa menunggu lock aturan atau mengubah snapshot setelahnya.
- Seluruh tes unit Go lulus; binary API dan migrator berhasil dibangun. ESLint pada berkas frontend yang berubah dan `tsc --noEmit` pada workspace saat pemeriksaan akhir lulus. Build Docker mengikuti konfigurasi proyek yang sudah memakai `ignoreBuildErrors`.
- Verifikasi ulang seluruh migrasi: 10.367 objek, nol hilang/berbeda/tambahan. Reset hanya diuji pada database scratch.
- Build frontend melalui Docker berhasil, termasuk route `/dashboard/spa/commission-settings`, image lokal `mizu:commission-level-check`. Percobaan build langsung gagal karena Turbopack tidak dapat membuka port proses loader pada lingkungan ini; Docker memakai alur build proyek yang normal.
- Tidak melakukan deployment, commit atau push. Sebelum rollout, backup database operasional; jalankan migrasi bersama penggantian aplikasi, lalu isi tarif baru sebelum melanjutkan penyelesaian treatment.

## Deployment 26 Oktober 2026

- Pengguna meminta build dan deploy. Skrip deployment selesai dengan exit 0; release web/API `local-20261026-021833`.
- Backup database dibuat dan arsipnya diverifikasi sebelum migrasi (3.064.809 byte, 3.745 entri arsip).
- Migrasi komisi diterapkan. Sebanyak 76 aturan lama dikosongkan, 1.332 item historis ditandai reset, dan 1.325 alokasi komisi payroll dihapus. Pemeriksaan total payroll setelah reset menemukan nol ketidaksesuaian dengan komponen nonkomisi.
- Verifikasi skema produksi: 10.367 objek, nol hilang/berbeda/tambahan. Menu Pengaturan Komisi aktif dengan grant untuk dua role.
- Container web/API sehat; login dan readiness publik HTTP 200, endpoint pengaturan komisi serta tarif sendiri tanpa login HTTP 401.
- Tarif baru masih kosong. Admin mengisi tiga tarif level per varian di **Spa → Pengaturan Komisi** sebelum menyelesaikan treatment berikutnya. Tidak melakukan commit atau push.
