# Training dan level terapis

Disetujui melalui percakapan 26 Oktober 2026 ("oke kerjakan").

## Perilaku
- Spa → Training berisi tab Training dan Pengaturan Level. Admin membuat training dengan nama, kode materi, periode, tanggal, trainer dan catatan; memilih peserta secara massal; menandai selesai/menunggu keputusan dan menyetujui lulus atau tidak lulus berdasarkan penilaian di luar aplikasi.
- Pengaturan Level menentukan semua training wajib untuk Level 0 → Level 1 dan Level 1 → Level 2. Tidak ada syarat masa kerja/nilai numerik yang diasumsikan. Aturan kosong tidak menaikkan level. Kelulusan dan penyimpanan syarat mengevaluasi kenaikan otomatis, berurutan, tanpa menurunkan level yang sudah diperoleh.
- Level tampil di Spa → Terapis, filter level/status kepegawaian/outlet, dan daftar calon peserta. Kandidat default aktif dan belum lulus/belum terdaftar; semua kandidat tetap dapat dilihat dengan alasan tidak dapat dipilih. Riwayat lulus pada kode materi sama di periode lain ditampilkan sebagai informasi, bukan larangan.
- Satu training yang telah lulus tidak dapat diulang, bahkan setelah masuk kembali. Training baru dengan materi serupa dan periode berbeda dapat diikuti. Peserta tidak lulus/dibatalkan dapat didaftarkan ulang dengan catatan percobaan baru.
- Area Karyawan → Training Saya hanya memperlihatkan keikutsertaan sendiri, level, progres syarat, riwayat kelulusan dan perubahan level.
- Resign tetap nilai employment_status HRIS, terpisah dari aktif/nonaktif. Resign menonaktifkan pegawai dan terapis. Masuk kembali (status bukan resign dan pegawai aktif) memulai siklus kerja baru dengan Level 0; kelulusan dan peserta dari siklus lama tidak dihitung. Nonaktif sementara mempertahankan level.

## Pendekatan
Memperluas modul Spa Go/PostgreSQL dan frontend Next.js yang ada. Training dan syarat menggunakan ID training per periode, bukan LMS atau duplikasi modul HRIS. Sinkronisasi HRIS memakai trigger transaksional agar perubahan dari API HRIS, frontend lama, dan offboarding memiliki perilaku sama. Alternatif event asinkron ditolak karena dapat menyisakan jendela peserta/level lama setelah resign.

## Keputusan implementasi
- Terapis lama mulai Level 0; tidak mengarang data kelulusan atau level lama.
- Kode materi menghubungkan training serupa; kombinasi kode materi dan periode unik.
- Hanya izin update menu spa.training dapat mengubah hasil/aturan; create untuk training/peserta; read untuk daftar. Akses sendiri memakai identitas login, tanpa parameter therapist_id.
- Penyimpanan aturan berlaku bagi semua terapis aktif yang masih di bawah level target; tidak ada penurunan karena aturan berubah. Periode baru dipilih admin secara eksplisit.
- Simpan alasan, pelaku, waktu persetujuan dan riwayat level. Kelulusan final tidak bisa diubah menjadi gagal melalui API biasa.
- Tidak mengubah komisi/payroll, tidak memasukkan nilai trainer, tidak deploy tanpa permintaan.

## Penerimaan
Test API nyata dengan PostgreSQL: tolak akses tanpa izin, duplikasi peserta/lulus, aturan kosong/parsial, approval berulang, training periode baru, resign dan rehire bertahap, nonaktif tanpa reset, serta pembatasan data sendiri. Test UI: tab pengaturan, penyaringan level dan kelayakan peserta, informasi periode, dan halaman sendiri.

## Cara penggunaan
1. Buka **Spa → Training → Training**, pilih **Training baru**. Isi nama, kode materi, periode, tanggal, trainer, dan catatan. Materi serupa memakai kode yang sama; periode baru dibuat sebagai training baru. Kode/periode tidak dapat diganti setelah ada peserta.
2. Buka tab **Pengaturan Level**. Pilih training wajib beserta periodenya untuk Level 0 → Level 1 dan Level 1 → Level 2. Semua pilihan wajib lulus. Tidak memilih apa pun berarti kenaikan tersebut belum diaktifkan. Simpan untuk memeriksa ulang seluruh terapis aktif.
3. Buka detail training, pilih **Tambah peserta**. Filter level/outlet/nama, lihat syarat yang kurang dan kelulusan materi serupa. Secara default hanya kandidat yang dapat didaftarkan ditampilkan. **Tampilkan semua terapis** memperlihatkan juga peserta yang tidak dapat dipilih beserta alasannya. Pilih beberapa peserta lalu daftarkan.
4. Setelah pelaksanaan, **Proses hasil** peserta → **Selesai — menunggu persetujuan**. Sesudah meninjau penilaian trainer, pilih **Setujui kelulusan** atau **Tidak lulus**, isi ringkasan/referensi penilaian, lalu simpan. Admin juga boleh langsung menetapkan hasil jika penilaian sudah diterima. Lulus memicu evaluasi kenaikan otomatis.
5. Terapis melihat jadwal, hasil, progres syarat dan riwayat level di **Area Karyawan → Training Saya**. Admin melihat seluruh level di **Spa → Terapis**, dengan filter level, outlet, dan kepegawaian.
6. Atur **Resign** melalui status kepegawaian pada profil karyawan atau alur offboarding HRIS. Terapis dan pegawai otomatis nonaktif; keikutsertaan yang belum final dibatalkan. Untuk masuk kembali, ubah status kepegawaian ke status kerja yang sesuai dan aktifkan pegawai. Langkah ini memulai periode kerja baru, Level 0. Nonaktif sementara tanpa resign tidak melakukan reset.

## Rilis
- Terapkan [migrasi training dan level](../../../backend/database/migrations/deltas/20261026090000_spa_training_levels.sql) sebelum menjalankan backend baru; rilis frontend dengan manifest route yang diperbarui.
- Migrasi memberi semua terapis awal Level 0, menambah pilihan Resign jika belum ada, dan menambahkan menu Training serta Training Saya. Akses menu mengikuti grant Terapis/Tugas Terapis yang sudah ada; perubahan hasil dan syarat tetap memerlukan aksi `update` pada `spa.training`.
- Syarat awal kosong; admin harus membuat training dan mengatur syarat. Tidak ada kelulusan/kenaikan historis yang dibuat otomatis.
- Implementasi diuji pada database scratch `mizu_training_test`. Atas permintaan pengguna, build dan deployment produksi selesai pada 26 Oktober 2026 dengan release `local-20261026-013429`. Backup database dibuat sebelum migrasi; migrasi training diterapkan dan verifikasi skema tidak menemukan perbedaan. Web/API sehat, login dan readiness publik merespons HTTP 200, dan endpoint training tanpa login merespons HTTP 401.
