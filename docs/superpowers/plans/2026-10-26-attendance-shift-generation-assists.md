# Attendance: Generate Jadwal Bulanan dan Validasi Perbantuan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Status:** Implementasi attendance sudah dikerjakan setelah instruksi pengguna “oke kerjakan” dan “lanjutkan”. Tes fitur dan regresi backend lulus di database uji. Perubahan room dan perpanjangan treatment dikerjakan bersamaan oleh sesi lain; status pemeriksaan gabungan dicatat di bagian hasil verifikasi. Belum di-deploy.

**Goal:** Admin dapat menghasilkan jadwal terapis satu bulan sesuai kebutuhan outlet dan hak libur, serta memindahkan terapis sebelum/sesudah clock-in dengan validasi jadwal yang sama.

**Architecture:** Perluas modul Spa dan integrasi roster HRIS yang ada. Gunakan jadwal harian sebagai pengecualian atas pola mingguan, resolver jadwal bersama, dan validasi backend yang digunakan saat preview, penerapan jadwal, serta perubahan perbantuan. Perbantuan tetap memakai fitur yang ada dengan interval waktu efektif dan riwayat pembatalan.

**Tech Stack:** Go, PostgreSQL, Next.js/React, TanStack Query, Vitest; tidak menambah layanan terpisah pada usulan awal.

**Spec:** Kebutuhan pengguna, klarifikasi total per hari, dan keputusan implementasi dalam bagian Kebijakan.

## Temuan dan perbandingan

| Area | Implementasi saat ini | Perubahan yang diperlukan |
|---|---|---|
| Jadwal Shift | Tampilan mingguan dan mapping manual; penyimpanan mengubah pola berulang mulai tanggal efektif | Generate satu bulan, preview, edit hasil, validasi, dan terapkan secara atomik |
| Syarat jumlah terapis | Kuota perempuan/laki-laki per outlet per hari, dipakai untuk pengajuan libur | Gunakan kuota total harian yang sama untuk generator, mapping manual, dan perbantuan |
| Libur mingguan | `max_per_week`, default 2, membatasi maksimum libur | Tambahkan minimum libur; jangan mengubah arti maksimum yang sudah ada |
| Perbantuan | Terapis, outlet tujuan, tanggal mulai/selesai, catatan; outlet asal dikecualikan saat diperbantukan | Jam efektif, validasi kapasitas kedua outlet, bentrok booking/perbantuan, dan pembatalan berjejak |
| Setelah clock-in | Antrean membaca absensi berdasarkan karyawan/tanggal; clock-in tidak terikat outlet tujuan | Pertahankan absensi, tetapi hitung outlet operasional berdasarkan waktu efektif perpindahan |
| Validasi simpan perbantuan | Memeriksa keberadaan terapis/outlet, tujuan berbeda dari outlet asal, urutan tanggal | Validasi syarat shift dan libur, ketersediaan aktual, hak akses kedua outlet, serta konkurensi |

Sumber utama: [halaman jadwal](../../../frontend/src/features/spa/components/therapist-schedule-page.tsx), [mapping manual](../../../frontend/src/features/spa/components/therapist-shift-mapping-dialog.tsx), [perbantuan](../../../backend/internal/modules/spa/service.go), [kuota libur](../../../backend/internal/modules/spa/dayoff.go), [antrean](../../../backend/internal/modules/spa/queue.go), [adapter roster](../../../backend/internal/app/adapters_spa.go), dan [clock-in](../../../backend/internal/modules/hris/attendance_clock.go).

## Kebijakan dan ruang lingkup implementasi

1. Sasaran awal adalah terapis pada halaman Jadwal Shift Spa. Perluasan ke seluruh jabatan HRIS belum diasumsikan.
2. **Dikonfirmasi pengguna:** minimum perempuan/laki-laki berlaku untuk total terapis yang dijadwalkan bekerja per hari di masing-masing outlet, digabung dari semua shift. Hitung terapis unik, bukan jumlah baris mapping atau jumlah shift. Gunakan pengaturan kuota harian yang sudah ada; tidak ada minimum gender per shift atau kewajiban hadir bersamaan sepanjang hari. Contoh: minimum 2 perempuan terpenuhi oleh 1 perempuan pada shift pagi dan 1 perempuan lain pada shift sore.
3. Minimum libur dapat diatur per outlet; nilai harus 0–7 dan tidak melebihi maksimum libur jika maksimum berlaku. Nilai bisnis aktual diisi admin, tidak disimpulkan dari default maksimum 2 yang ada.
4. Periode minggu: Senin–Minggu, WIB, mengikuti fungsi minggu yang sudah ada. Perhitungan mencakup tanggal sebelum/sesudah bulan yang berada dalam minggu yang sama. Bila jadwal di batas bulan belum tersedia, tandai belum dapat divalidasi dan minta kelengkapan; jangan menganggap hari kosong sebagai libur.
5. Libur roster dan libur yang disetujui dihitung satu kali per tanggal. Cuti memblokir penjadwalan, tetapi tidak menggantikan minimum libur mingguan.
6. Aturan minimum gender wajib dipenuhi untuk masing-masing gender yang diatur; nilai 0 menonaktifkan minimum gender tersebut. Data gender kosong tidak dihitung sebagai perempuan atau laki-laki.
7. Jadwal terbit, booking, cuti/libur disetujui, dan perbantuan menjadi batasan tetap secara default. Admin dapat mengizinkan penggantian jadwal masa depan melalui opsi `replace_existing`, lalu mengedit kandidat sebelum validasi; hasil generator tidak menimpa riwayat atau pola mingguan tanpa pemberitahuan.
8. Tidak ada perubahan otomatis outlet asal terapis. Generator tidak membuat perbantuan antar-outlet secara otomatis; jika kurang orang, tampilkan kebutuhan tambahan dan gunakan fitur perbantuan yang sama.
9. Usulan perbantuan setelah clock-in berlaku sejak waktu perpindahan, atau waktu mendatang yang dipilih, hingga akhir interval yang disepakati. Tidak berlaku surut. Sebelum clock-in, terapis terdaftar di roster tujuan tetapi belum masuk antrean hadir.
10. Terapis yang sudah clock-in dan belum clock-out dapat menerima tugas di tujuan sejak waktu efektif jika sedang dalam shift, tidak cuti/libur, dan tidak bentrok. Tidak membuat clock-in kedua atau mengubah lokasi/waktu absensi lama. Usulan awal tidak memerlukan konfirmasi kedatangan kedua; kebutuhan waktu perjalanan/konfirmasi tiba merupakan keputusan bisnis tambahan.
11. Booking/treatment asal yang bertabrakan dengan perpindahan memblokir perbantuan; admin menyelesaikan atau mengalihkan penugasan melalui alur yang ada. Tidak memindahkan booking pelanggan atau treatment berjalan secara diam-diam.
12. Validasi minimum gender menghitung ulang total harian kedua outlet pada setiap tanggal yang terdampak perubahan perbantuan. Pemeriksaan jam shift, bentrok booking, dan outlet efektif tetap memakai interval waktu; pemeriksaan tersebut tidak mengubah kuota gender menjadi minimum per shift atau per jam. Kegagalan kuota disertai outlet, tanggal, gender, kebutuhan, aktual, dan kekurangan; konflik waktu menyertakan interval/shift terkait. Usulan awal tidak menyediakan override yang melewati syarat wajib. Untuk transfer tengah hari, satu terapis dihitung pada outlet dengan durasi kerja terpanjang dalam shift tanggal tersebut; durasi sama dihitung di outlet asal. Availability tetap mengikuti interval aktual. Kebijakan ini dicatat selama implementasi dan tidak menghitung terapis yang sama pada dua outlet.

## Pendekatan yang dipertimbangkan

- **Direkomendasikan: generator terintegrasi dan validator bersama.** Jadwal harian, pembagian kerja yang seimbang, pencarian kandidat dengan batas waktu, lalu pemeriksaan semua syarat wajib. Memakai arsitektur yang ada dan tidak membutuhkan layanan optimasi baru.
- **Solver optimasi eksak.** Tepat bila bisnis membutuhkan bukti optimum global atau kombinasi aturan yang jauh lebih kompleks. Memerlukan evaluasi dependensi/integrasi serta batas waktu dan status solver.
- **Pengulangan pola mingguan saja.** Lebih kecil perubahannya, tetapi tidak cukup untuk variasi jadwal tiap tanggal, cuti, minggu lintas bulan, dan perpindahan tengah hari; tidak direkomendasikan.

Arti optimal pada usulan awal: syarat wajib dipenuhi terlebih dahulu; kemudian minimalkan selisih hari kerja antarterapis, ketimpangan pembagian jenis shift, dan perubahan atas jadwal lama, berurutan. Hasil valid dari pencarian terbatas tidak boleh disebut terbukti paling optimal secara matematis. Bedakan `valid`, `infeasible` jika ada bukti kendala tidak mungkin terpenuhi, dan `search_limit` bila pencarian belum menemukan solusi dalam batas yang ditetapkan. Batas runtime ditetapkan melalui benchmark ukuran outlet aktual sebelum rilis.

## Alur yang dituju

Admin membuka Jadwal Shift → memilih bulan/outlet → mengatur syarat → menekan **Generate jadwal** → melihat preview beserta rekap dan konflik → mengedit sel yang diperlukan → menekan **Terapkan jadwal**. Server membaca ulang keadaan terkini dan memvalidasi sebelum menyimpan seluruh perubahan dalam satu transaksi.

Admin membuka Perbantuan → memilih terapis, tujuan, dan waktu efektif → melihat dampak ke outlet asal/tujuan → menyimpan. Server memvalidasi ulang dalam transaksi; roster, board, availability, dan antrean menggunakan interval yang baru. Pembatalan mengikuti validasi yang sama dan mempertahankan sejarah yang sudah terjadi.

## Global Constraints

- Semua tanggal dan minggu mengikuti WIB; interval waktu memakai awal inklusif dan akhir eksklusif.
- Minimum perempuan/laki-laki adalah total terapis unik per outlet per hari dari seluruh shift, bukan minimum per shift atau jumlah kehadiran serentak. Status clock-in dipakai untuk penerimaan tugas saat ini, bukan prasyarat menghitung roster bulan mendatang.
- Satu terapis tidak boleh dialokasikan ke dua outlet pada waktu yang sama atau memiliki shift yang bertumpang tindih, termasuk lintas tengah malam.
- Jadwal kosong berbeda dari libur eksplisit. Hari kosong tidak memenuhi kuota kerja maupun minimum libur.
- Snapshot absensi dan penugasan treatment historis tidak ditulis ulang akibat penerapan jadwal atau perbantuan.
- Backend menjadi otoritas validasi; preview frontend bukan jaminan bahwa penyimpanan akan diterima.
- Aturan berlaku juga pada jalur manual, persetujuan/pembatalan libur, dan pembatalan perbantuan yang mengubah kapasitas.
- Hak membaca/mengubah outlet asal dan tujuan diperiksa server; gunakan izin Spa/HRIS yang ada sesuai tanggung jawab.
- Pertahankan perubahan lain yang sedang ada di working tree; dokumen ini tidak mengotorisasi reset, deploy, atau perubahan data produksi.

## Review Focus

- Minggu lintas bulan/tahun dan shift melewati tengah malam: hitung konteks lengkap, jangan menyimpulkan libur dari tanggal kosong — tugas 1–2.
- Dua admin memindahkan terapis/generate jadwal bersamaan: validasi ulang dan locking yang sama mencegah kuota terlewati — tugas 3–4.
- Perpindahan tengah hari dengan booking atau attendance yang sudah ada: outlet ditentukan per interval tanpa merusak sejarah — tugas 4.
- Terapis tidak aktif, gender kosong, cuti, tanpa jadwal, atau sudah clock-out: tidak menjadi pemenuh kapasitas atau penerima tugas yang tidak valid — tugas 1, 2, 4.
- Pengubahan pola manual atau pembatalan libur/perbantuan setelah jadwal terbit: tidak menjadi jalan untuk melewati validator — tugas 3–5.

## Task 1: Aturan dan pembacaan jadwal efektif

**Files:** Migrasi baru di [deltas](../../../backend/database/migrations/deltas); perluas [domain jadwal HRIS](../../../backend/internal/modules/hris/domain/schedule.go), [pembacaan absensi](../../../backend/internal/modules/hris/postgres_attendance.go), [snapshot clock-in](../../../backend/internal/modules/hris/attendance_clock.go), [self-service](../../../backend/internal/modules/hris/selfservice.go), [adapter Spa](../../../backend/internal/app/adapters_spa.go), dan [kuota libur](../../../backend/internal/modules/spa/dayoff.go).

**Interfaces:** Jadwal harian memiliki `employee_id`, `date`, `shift_id`, dan jenis `work|off`, unik per karyawan/tanggal, beserta metadata audit. Pembacaan jadwal efektif memakai pengecualian harian terlebih dahulu lalu pola mingguan; cuti/libur disetujui tetap memblokir kerja. Kontrak hasil memisahkan `unscheduled`, `work`, `off`, dan `leave` serta interval shift. Tambahkan minimum libur pada konfigurasi; gunakan `min_female` dan `min_male` yang sudah ada sebagai kebutuhan total per outlet per hari.

- [x] Uji prioritas override harian, libur eksplisit, dan fallback mingguan dengan RED→GREEN; regresi pembaca HRIS/adapter serta tes perbantuan mencakup shift malam.
- [x] Tambahkan migrasi dan pembacaan bersama; sesuaikan seluruh konsumen pola yang relevan termasuk halaman karyawan, rekap absensi, dan jadwal pribadi agar tidak menampilkan pola lama sebagai hasil efektif.
- [x] Jalankan tes HRIS dan adapter; pastikan tanpa pengecualian harian perilaku lama tetap berlaku dan snapshot absensi yang sudah ada tetap utuh.

## Task 2: Generator dan validator murni

**Files:** Buat `backend/internal/modules/spa/domain/roster_generation.go` dan `roster_generation_test.go`.

**Interfaces:** `GenerateMonthlyRoster(input GenerationInput) GenerationResult` menghasilkan kandidat tanpa menulis database. `ValidateRoster(input ValidationInput) []RosterViolation` memeriksa roster efektif sebelum/sesudah perubahan. Input mencakup bulan, kebutuhan gender harian per outlet, karyawan/gender, shift aktif, tanggal kerja/libur/cuti terkunci, perbantuan, booking, dan konteks minggu batas bulan. Hasil memuat status pencarian, assignment, skor pembagian kerja, dan pelanggaran terstruktur (`code`, `branch_id`, `date`, interval, `shift_id`, `employee_id`, kebutuhan/aktual bila relevan). Pelanggaran kuota gender berlingkup outlet/tanggal; `shift_id` dan interval hanya diisi untuk pelanggaran yang terkait waktu kerja.

- [x] Uji dataset kecil untuk gender, libur, sel terkunci, status valid/infeasible/search_limit, serta determinisme hasil. Cuti/booking/absensi menjadi sel tetap pada pembacaan server.
- [x] Uji perempuan pada dua shift tetap memenuhi total harian, duplikasi karyawan ditolak, serta minimum laki-laki dan gender kosong.
- [x] Implementasikan validasi dahulu, lalu pemilihan kandidat berurutan berdasarkan kebutuhan paling terbatas, pembagian beban, serta pencarian perbaikan terbatas. Semua kandidat akhir wajib melewati validator.
- [x] Uji minggu lintas bulan/tahun, shift bertumpang tindih, tidak ada shift aktif, gender kosong, dan konflik minimum/maksimum libur. Jalankan `go -C backend test ./internal/modules/spa/domain`.

## Task 3: Preview dan penerapan jadwal bulanan

**Files:** Buat `backend/internal/modules/spa/roster_generation.go`, `http_roster_generation.go`, dan `roster_generation_integration_test.go`; perluas [registrasi HTTP](../../../backend/internal/modules/spa/http.go), [penyimpanan pola manual](../../../backend/internal/modules/hris/postgres_employees.go), serta integrasi roster tugas 1.

**Interfaces:** Usulan `POST /api/spa/rosters/preview` dengan bulan, outlet, aturan, dan sel yang boleh diganti; mengembalikan candidate, violation, dan revision. Usulan `POST /api/spa/rosters/apply` menerima candidate serta revision; server tidak mempercayai hasil validasi klien. Respons stale/conflict menggunakan HTTP 409 dengan rincian. Terapkan jadwal hanya pada bulan dan karyawan yang diotorisasi.

- [x] Tulis tes API: preview tidak mengubah data, apply valid tersimpan seluruhnya, kandidat tidak valid/stale/di luar scope ditolak tanpa penyimpanan sebagian, pengulangan apply tidak membuat duplikasi.
- [x] Implementasikan pembacaan bulk, validasi dan penyimpanan atomik. Tetapkan protokol lock berurutan per outlet/tanggal dan karyawan yang digunakan bersama operasi perbantuan serta perubahan libur/jadwal manual; baca ulang setelah lock.
- [x] Integrasikan validator pada jalur manual dan perubahan libur agar aturan tidak bisa dilewati lewat endpoint lama. Jadwal harian tidak ditulis melalui operasi penggantian pola mingguan yang menghapus pola masa depan.
- [x] Jalankan tes integrasi Spa/HRIS dengan database uji yang disiapkan sesuai harness; tes yang dilewati karena `TEST_DATABASE_URL` tidak tersedia bukan bukti integrasi lulus.

## Task 4: Perbantuan sebelum dan sesudah clock-in

**Files:** Migrasi baru perbantuan; perluas [service](../../../backend/internal/modules/spa/service.go), [query kelayakan](../../../backend/internal/modules/spa/postgres.go), [antrean](../../../backend/internal/modules/spa/queue.go), [assignment](../../../backend/internal/modules/spa/assignment.go), [pembayaran booking publik](../../../backend/internal/modules/spa/public_payment.go), [jadwal pribadi](../../../backend/internal/modules/spa/my_schedule.go), dan tambah `assists_integration_test.go`.

**Interfaces:** Perluas perbantuan dengan `starts_at`, `ends_at`, status pembatalan, actor, dan waktu perubahan. Konversikan rentang tanggal lama ke interval WIB satu hari penuh, inklusif hari terakhir. Semua pembaca menentukan outlet efektif untuk interval treatment, bukan hanya tanggal mulai. Riwayat yang bentrok dilaporkan untuk rekonsiliasi saat migrasi, tidak dipilih pemenangnya secara diam-diam.

- [x] Tulis tes perpindahan sebelum clock-in (tujuan terjadwal tetapi belum hadir) dan sesudah clock-in (eligible di tujuan sejak waktu efektif, tidak eligible di asal sesudahnya, satu rekaman absensi).
- [x] Uji penolakan kuota asal, overlap perbantuan, minggu kedua tanpa libur, treatment berjalan yang sudah melewati akhir terjadwal, serta pembatalan dengan booking di tujuan. Uji nyata dua koneksi membuktikan pembatalan menunggu lock penugasan; implementasi memeriksa akses kedua outlet dan menserialisasi perubahan perbantuan.
- [x] Implementasikan validasi dampak kedua outlet di bawah protokol lock tugas 3, serta pembatalan yang tidak menghapus sejarah. Existing booking/completed treatment tetap muncul di outlet historis.
- [x] Gunakan resolver interval yang sama untuk availability, board, arrival queue, assignment manual/otomatis, dan jalur booking publik. Antrean hanya menganggap hadir jika clock-in aktif dan belum clock-out; perbantuan tidak mengubah jam absensi. Usulan urutan antrean tujuan dihitung sejak waktu efektif/kedatangan yang dipilih, bukan memberi prioritas karena clock-in lebih pagi di asal.
- [x] Jalankan tes baru dan regresi booking, queue, day-off, dan shift; pastikan calon booking masa depan dan kelayakan menerima tugas saat ini tetap dibedakan.

## Task 5: UI jadwal, perbantuan, dan verifikasi menyeluruh

**Files:** Perluas [Jadwal Shift](../../../frontend/src/features/spa/components/therapist-schedule-page.tsx), [mapping](../../../frontend/src/features/spa/components/therapist-shift-mapping-dialog.tsx), [Terapis/Perbantuan](../../../frontend/src/features/spa/components/therapists-page.tsx), [kuota libur](../../../frontend/src/features/spa/components/day-off-admin-tab.tsx), [API](../../../frontend/src/features/spa/api.ts), [tipe](../../../frontend/src/features/spa/types.ts), [mutations](../../../frontend/src/features/spa/mutations.ts), [query keys](../../../frontend/src/features/spa/query-keys.ts), dan tes komponennya. Tambahkan dialog preview generator terpisah bila diperlukan agar halaman tetap terbaca.

**Interfaces:** Tombol **Generate jadwal**; pilihan bulan/outlet; input syarat; preview work/off/leave/unscheduled; rekap gender dan libur; edit/lock sel; tombol **Terapkan jadwal** aktif hanya ketika kandidat valid. Perbantuan menampilkan waktu efektif, status clock-in, dan dampak kuota. Invalidasi cache kedua outlet, roster, day-off, board, availability, arrival queue, dan jadwal pribadi setelah perubahan.

- [x] Uji komponen preview tanpa simpan, edit wajib validasi ulang, stale/error, label libur, dan preview dampak perbantuan sebelum simpan. Skenario clock-in diverifikasi pada tes integrasi backend.
- [x] Implementasikan UI menggunakan komponen dan cache yang ada; validasi server tetap diperlihatkan jika keadaan berubah setelah preview.
- [x] Jalankan `pnpm --dir frontend exec vitest run src/features/spa src/lib/hris` dan tes Go untuk paket Spa, HRIS, serta app; lakukan lint/typecheck pada bagian yang berubah.
- [x] Uji API pada database uji: generate/apply 30 hari, rollback kandidat invalid, stale, larangan menulis roster karyawan outlet lain, transfer sebelum/sesudah clock-in, penugasan setelah tengah malam, serta pembatalan valid/ditolak. Benchmark 30 terapis ×42 tanggal memakai 64 percobaan.
- [x] Catat hasil tes aktual, batas algoritma, serta kebutuhan pengisian aturan sebelum rollout. Review diff untuk memastikan perubahan kerja lain tidak ikut diubah.

## Kriteria penerimaan

- Satu bulan dapat dihasilkan, ditinjau, dan diterapkan tanpa mengubah bulan lain atau merusak pola mingguan.
- Tidak ada jadwal/perbantuan tersimpan yang melanggar syarat wajib dalam ruang lingkup perubahan; alasan kegagalan menunjukkan kekurangan secara spesifik.
- Minimum libur benar untuk minggu yang melintasi batas bulan; maksimum lama tetap memiliki arti semula.
- Minimum perempuan/laki-laki terpenuhi dari total terapis unik per outlet per hari; pembagian pada shift berbeda tetap sah dan terapis yang sama tidak dihitung dua kali pada outlet/tanggal yang sama.
- Setelah perbantuan berlaku, terapis eligible hanya di outlet yang benar pada interval terkait; tugas tetap tunduk pada status hadir, shift, cuti/libur, dan konflik booking.
- Clock-in dan riwayat treatment sebelum perpindahan tetap utuh; tidak ada kehadiran ganda akibat transfer.
- Penulisan bersamaan, pengubahan manual, dan pembatalan tidak melewati validator.
- Hasil pencarian terbatas tidak diklaim sebagai optimum global atau bukti bahwa solusi mustahil.


## Hasil implementasi dan verifikasi

- Pengaturan minimum perempuan/laki-laki menggunakan total karyawan unik **per outlet per hari**, bukan per shift. Minimum libur baru default **0** untuk menjaga kompatibilitas; admin mengisinya pada tab **Jadwal Libur**, terpisah dari maksimum lama.
- **Jadwal Shift → Generate jadwal bulanan** menyediakan pilihan bulan/shift, preview, edit work/off, validasi ulang, dan apply atomik. Riwayat, booking, cuti/libur disetujui, absensi, perbantuan, serta karyawan outlet lain terkunci. Tidak ada toggle untuk membuka batasan wajib. Endpoint mapping mingguan lama mengarahkan terapis dengan aturan/override/perbantuan aktif ke editor tervalidasi.
- Konteks Senin–Minggu di luar bulan harus sudah tersedia bila minimum libur aktif. Untuk outlet baru, siapkan pola mingguan dasar sebelum mengaktifkan aturan minimum; tanggal tanpa jadwal tidak dihitung sebagai libur.
- Perbantuan dapat mulai saat disimpan atau pada waktu mendatang. Preview menunjukkan perubahan kuota kedua outlet. Simpan memeriksa ulang jadwal, libur, booking, treatment berjalan, interval perbantuan, dan akses kedua outlet. Clock-in lama tetap digunakan; pembatalan mempertahankan jejak historis.
- Perubahan roster dan pengajuan/pembatalan libur menghormati gabungan syarat mingguan outlet asal dan outlet tujuan pada minggu yang terkena perbantuan. Persetujuan cuti HRIS tetap merupakan alur tersendiri; cuti yang sudah disetujui menjadi input terkunci pada validasi generator dan perbantuan.
- Generator memakai **64 percobaan deterministik**, meminimalkan selisih hari kerja pada kandidat valid. Hasil valid bukan bukti optimum global. Benchmark lokal 30 terapis ×42 tanggal: **811 ms** untuk satu generasi (satu sampel, bukan jaminan latency produksi).

Verifikasi aktual pada checkout bersama:

- `TEST_DATABASE_URL=.../mizu_attendance_test XENDIT_MOCK=1 go test ./internal/modules/spa ./internal/modules/hris ./internal/modules/hris/domain ./internal/app -skip TestCustomerReportUsesPaidPOSOrdersAndWIB -count=1`: lulus. Database uji terpisah dibuat dari template uji; migrasi attendance dan migrasi room sesi lain diterapkan hanya di database tersebut.
- `go test ./internal/modules/spa/domain -count=1`: lulus. Tes tambahan attendance terakhir juga lulus setelah perubahan validasi interval dan syarat minggu outlet tujuan.
- Tes UI terfokus: **16 lulus**, termasuk preview/apply, stale, serta perbantuan mulai saat disimpan.
- Suite frontend Spa/HRIS setelah perubahan perpanjangan shift dari sesi lain terintegrasi: **626 tes lulus (83 file)**. Typecheck seluruh frontend (`tsc --noEmit`) juga lulus. Kegagalan sementara pada fungsi shift yang belum selesai sudah teratasi oleh pekerjaan sesi tersebut.
- ESLint pada file attendance yang berubah: bersih. `git diff --check`: bersih. Diagnostik editor tidak merespons; pemeriksaan dilakukan melalui compiler, linter, dan test runner.
- Satu kegagalan baseline backend dikecualikan secara eksplisit: `TestCustomerReportUsesPaidPOSOrdersAndWIB` membuat nomor telepon lebih panjang dari `varchar(20)`, sudah tercatat pada pekerjaan komisi. Tidak mengubah implementasi laporan pelanggan.

Rollout belum dilakukan. Jalankan [migrasi roster](../../../backend/database/migrations/deltas/20261026120000_spa_monthly_rosters.sql) melalui prosedur migrasi proyek sebelum aplikasi memakai view/kolom baru. Migrasi menolak interval perbantuan lama yang bertumpang tindih agar direkonsiliasi secara eksplisit. Perubahan room, DP, training/komisi, dan perpanjangan treatment milik sesi lain dipertahankan; tidak ada deployment atau commit campuran dari pekerjaan ini.
