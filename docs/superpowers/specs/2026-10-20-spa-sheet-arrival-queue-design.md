# Spa Sheet + antrean check-in — desain

## Tujuan

Petugas melihat urutan kedatangan terapis dan prioritas penugasan di Sheet yang sama. Posisi kolom tidak berubah ketika booking ditugaskan, tetapi prioritas otomatis berotasi agar pembagian adil. Pilihan terapis yang diminta pelanggan tetap dapat dilakukan secara manual.

## Perilaku

- Tab Antrian terpisah dilebur ke Sheet. Informasi antrean dan tombol **Tugaskan otomatis sekarang** tetap tersedia di Sheet.
- Kolom terapis yang sudah check-in ditempatkan lebih dulu, urut berdasarkan waktu check-in pertama pada tanggal/outlet yang dipilih (seri: ID terapis). Terapis belum check-in berada di belakang, urut nama lalu ID. Terapis yang baru check-in ditambahkan sesuai waktu kedatangannya. Perubahan prioritas penugasan tidak memindahkan kolom.
- Header kolom menampilkan jam check-in dan prioritas rotasi saat ini. Terapis belum check-in diberi penanda dan tidak masuk calon penugasan otomatis. Kolomnya tetap tersedia untuk pilihan manual, dengan validasi booking yang sudah berlaku.
- Booking baru dari cell Sheet memakai terapis kolom tersebut sebagai pilihan manual, walaupun bukan prioritas pertama. Booking baru dari tombol umum tanpa terapis masuk alur penugasan otomatis yang sudah ada; pilihan terapis eksplisit pada formulir umum tidak diubah oleh fitur ini.
- DnD **Belum ditugaskan → kolom terapis** hanya berhasil jika kolom tujuan adalah prioritas rotasi pertama yang valid untuk booking tersebut. Server menghitung ulang prioritas dalam transaksi dan menolak kolom lain tanpa mengubah booking; notifikasi menyebut nama terapis yang diprioritaskan. Jika tidak ada kandidat, booking tetap belum ditugaskan dan alasan tampil.
- DnD **kolom A → kolom B** adalah pindah terapis manual ke B. DnD dalam kolom yang sama tetap mengubah jam; DnD kembali ke Belum ditugaskan tetap melepas terapis. Validasi shift, cuti, gender, bentrok, status booking, dan otorisasi yang sudah ada tetap berlaku.
- Penugasan manual dan otomatis sama-sama memperbarui prioritas rotasi menurut penugasan efektif saat ini; kolom tetap pada urutan check-in. Penugasan otomatis tidak memilih terapis yang belum check-in, cuti, atau libur. Pilihan manual tetap memakai validasi yang sudah ada.
- Otomatisasi berkala yang sudah ada (hari-H, booking hingga tiga jam ke depan) dan tombol batch tetap memakai aturan yang sama. Tidak ada perubahan skema database yang direncanakan.

## Batasan dan kegagalan

- Aksi DnD satu booking tidak boleh memproses booking lain. Pemilihan terapis dan pengecekan konflik dilakukan ulang dalam transaksi server untuk menghindari data Sheet yang sudah kedaluwarsa.
- Tanggal/outlet yang berubah tidak boleh menampilkan antrean dari query sebelumnya sebagai dasar label atau penugasan.
- Booking untuk tanggal tanpa check-in tidak memperoleh terapis otomatis; petugas dapat memakai pembuatan booking pada cell untuk pilihan terapis yang eksplisit.

## Kriteria penerimaan

Dengan tiga terapis yang check-in A, B, C: urutan kolom tetap A–B–C setelah A mendapat booking; prioritas berubah menjadi B–C–A. Drop booking belum ditugaskan ke kolom C ditolak bila B tersedia, dengan pesan yang menyebut B; drop ke B berhasil. Create pada cell C memilih C. Pindah booking dari A ke C memilih C secara manual. Terapis yang belum check-in tidak dipilih otomatis. Seluruh aksi yang berhasil memperbarui papan dan badge antrean.
