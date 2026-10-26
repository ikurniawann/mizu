# Kategori dan Perpindahan Room Spa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Dokumen ini adalah rencana; belum merupakan instruksi menjalankan migrasi atau deployment.

**Goal:** Mengategorikan room sebagai Public/Private dan memungkinkan admin memindahkan booking sebelum selesai, dengan biaya otomatis sebesar tarif penuh room tujuan.

**Architecture:** Perluas tabel room, endpoint pengaturan room booking, dialog pemilihan room, dan pencatatan event yang sudah ada. Harga dihitung server dan disimpan pada booking; checkout membaca harga tersimpan tersebut. Gunakan IAM dan transaksi PostgreSQL yang sudah tersedia, tanpa dependensi baru.

**Tech Stack:** Go, PostgreSQL/pgx, Next.js/React/TypeScript, TanStack Query, Vitest, tes integrasi Go.

**Spec:** [Desain dan aturan bisnis dalam dokumen ini](#desain-dan-aturan-bisnis).

**Status:** Implementasi disetujui pengguna dan selesai di workspace pada 26 Oktober 2026. Belum di-deploy; migrasi hanya diuji pada database scratch.

## Desain dan aturan bisnis

### Ketentuan pengguna

- Room memiliki kategori **Public** atau **Private**.
- Booking dari Public dapat dipindahkan ke Public lain atau VIP.
- Perpindahan diperbolehkan sebelum booking selesai, termasuk saat treatment berjalan.
- Hanya admin boleh memindahkan room; terapis tidak boleh.
- Jika pindah saat berjalan, gunakan **tarif penuh room tujuan**.
- **Admin tidak boleh menentukan biaya charge** pada perpindahan.

### Penjabaran perhitungan

- `room_price_idr_baru = price_idr_room_tujuan` yang dibaca server pada transaksi perpindahan. Tarif ini menggantikan biaya room lama, bukan menambahkan tarif kedua atau menghitung prorata.
- `total_booking_baru = total_treatment_aktif + room_price_idr_baru`. Pembayaran/DP yang sudah tercatat tidak ditulis ulang menjadi biaya room; sisa pembayaran mengikuti mekanisme pembayaran yang ada.
- Tarif tujuan Rp0 berarti otomatis tanpa charge. Public dan Private sama-sama memakai tarif master masing-masing; kategori tidak menyiratkan gratis atau berbayar.
- Tidak ada input nominal, diskon room, checkbox charge, atau pilihan pembebasan biaya dalam dialog/API perpindahan.
- Contoh treatment Rp200.000, room asal Rp25.000, tujuan Rp100.000: total berubah dari Rp225.000 menjadi Rp300.000, meskipun treatment telah berjalan setengah durasi. Jika tujuan Rp0, total menjadi Rp200.000.
- Pengiriman ulang room tujuan yang sudah terpasang tidak menghitung ulang tarif atau membuat event perpindahan baru. Perubahan tarif master sesudah perpindahan tidak mengubah tagihan booking tersebut.

### Pilihan teknis yang digunakan

- **VIP termasuk Private**, bukan kategori ketiga. Nama room seperti VIP 1 tetap bisa digunakan.
- Perluas endpoint `PUT /api/spa/bookings/{id}/room`; tidak perlu endpoint transfer kedua karena operasi, transaksi, dan pencatatan event sudah tersedia. Alternatif ledger biaya per segmen waktu tidak diperlukan untuk aturan tarif penuh.
- Izin admin menggunakan aksi `update` pada menu operasional booking yang sudah ada (`iam.SpaBookings`), disertai penolakan identitas terapis dan pemeriksaan cakupan outlet. Memiliki akses baca menu saja tidak cukup. Akun terapis tetap ditolak walaupun salah diberi grant update.
- Master tarif room tetap dikelola melalui hak pengaturan room yang terpisah. Hak memindahkan booking tidak otomatis memberi hak mengedit tarif master.
- Status yang boleh pindah: `unassigned`, `assigned`, `in_treatment`. Status `completed`, `cancelled`, `expired`, atau sudah dikirim ke kasir ditolak. Gunakan aturan khusus room; jangan mengubah arti `IsOpenBooking` untuk seluruh modul.
- Pertahankan dukungan perpindahan yang sudah tersedia dari room Private; permintaan ini tidak menetapkan larangan arah tersebut. Semua perpindahan mengikuti aturan status, akses, dan tarif yang sama.
- Validasi room tujuan aktif, satu outlet, dan kapasitas mencukupi memakai interval jadwal booking yang saat ini dipakai sistem. Ini bersifat konservatif: room yang pernah penuh pada bagian awal jadwal tetap dapat ditolak walaupun kini kosong. Perhitungan reservasi hanya untuk sisa waktu adalah perubahan terpisah, bukan asumsi tersembunyi dalam implementasi ini.
- Tidak mengubah penugasan terapis, treatment, `started_at`, durasi, atau jadwal booking. Room board berpindah mengikuti room terbaru tanpa mengulang timer.
- Pelepasan room sebelum treatment dimulai tetap memakai perilaku lama. Saat treatment berjalan, tujuan harus room konkret; pilihan “Tanpa room” ditolak agar tidak menjadi cara membebaskan charge.
- Pertahankan aturan otomatis saat pembuatan booking bersama yang sudah mengenakan biaya room sekali. Perpindahan ke room berbeda mengenakan tarif penuh tujuan pada booking yang dipindahkan; tidak menyediakan waiver lewat endpoint transfer. Tes regresi memastikan initial assignment dan retry tidak menghasilkan tagihan ganda. Jangan menambahkan redistribusi biaya antaranggota grup tanpa keputusan bisnis terpisah.

### Migrasi kategori

Tambahkan `category` dengan nilai `public | private` dan constraint database. Usulan kompatibilitas: nilai awal `public` untuk record lama yang belum dipetakan; kategori ini tidak boleh mengubah tarif, kapasitas, atau snapshot biaya booking. Sebelum rollout, buat daftar mapping ID room lama ke kategori dan koreksi VIP/Private berdasarkan data fasilitas yang benar. Jangan menebak kategori dari harga atau nama saja. Form baru mengharuskan pilihan kategori; pembaruan dari klien lama yang tidak mengirim kategori mempertahankan kategori yang tersimpan.

### Batas lingkup

Tidak membuat mesin tarif baru, prorata, perpindahan lintas outlet, pengaturan charge per transaksi, alur refund baru, atau perubahan kapasitas otomatis berdasarkan kategori. Situs booking publik tetap boleh menampilkan kedua kategori; kata Public pada kategori fisik tidak sama dengan akses endpoint publik.

## Global Constraints

- Jika pindah saat berjalan, gunakan **tarif penuh room tujuan**.
- **Admin tidak boleh menentukan biaya charge** pada perpindahan.
- Hanya admin boleh memindahkan room; terapis tidak boleh.
- Implementasi telah diizinkan pengguna; perubahan layanan operasional dan rollout tetap terpisah.
- Workspace sudah memiliki perubahan fitur lain. Saat implementasi, pertahankan perubahan tersebut dan batasi diff/commit ke pekerjaan ini.

## Review Focus

- Terapis dengan grant menu update yang keliru tetap menerima HTTP 403; baca saja dan outlet di luar scope juga tidak boleh menulis (Task 2).
- `completed` sebelum checkout tetap tidak bisa pindah; pelepasan room ketika berjalan tidak bisa menjadi pembebasan charge (Task 2).
- Retry ke room yang sama dan perubahan tarif master tidak menimpa snapshot; payload tarif/waiver tidak dipercaya (Task 2).
- Dua transaksi berebut kapasitas terakhir menghasilkan satu keberhasilan; create booking dan transfer wajib memakai penguncian yang kompatibel (Task 2).
- Tampilan detail, board, booking bersama, dan kasir tetap konsisten; initial assignment grup dan DP tidak berubah karena perpindahan (Task 3–4).

## Task 1: Kategori pada master room dan kontrak API

**Files:**
- Create: `backend/database/migrations/deltas/<timestamp>_spa_room_categories.sql` — pilih timestamp berikutnya yang belum dipakai saat implementasi.
- Modify: [rooms.go](../../../backend/internal/modules/spa/rooms.go), [http_rooms.go](../../../backend/internal/modules/spa/http_rooms.go), [types.ts](../../../frontend/src/features/spa/types.ts).
- Test: [rooms_integration_test.go](../../../backend/internal/modules/spa/rooms_integration_test.go).

**Interfaces:** `Room`, `roomInput`, `PublicRoom`, serta `RoomInput` TypeScript memperoleh `category`; API memakai `"public" | "private"`. Kolom scan/insert/update harus konsisten. Board mewarisi kategori dari `Room`; public picker memperoleh kategori dari `PublicRoom`.

- [x] Tambah tes `TestRoomCategories`: create/read/update Public dan Private berhasil; kategori lain ditolak 400; pembaruan tanpa kategori mempertahankan nilai lama; tarif Rp0 dan nonzero tidak menentukan kategori.
- [x] Jalankan tes tersebut terhadap database uji sebelum implementasi dan pastikan gagal karena kontrak kategori belum tersedia.
- [x] Buat migrasi additive dan implementasikan serialisasi, validasi, serta persistence kategori sesuai desain. Verifikasi migrasi tidak memperbarui snapshot biaya booking lama.
- [x] Jalankan ulang `go test ./internal/modules/spa -run TestRoomCategories -count=1 -v` dari folder backend dengan `TEST_DATABASE_URL` database uji yang telah dimigrasi; hasil harus PASS, bukan SKIP.

## Task 2: Perpindahan admin, tarif otomatis, dan transaksi

**Files:**
- Modify: [rooms.go](../../../backend/internal/modules/spa/rooms.go), [http_rooms.go](../../../backend/internal/modules/spa/http_rooms.go), [http.go](../../../backend/internal/modules/spa/http.go), [service.go](../../../backend/internal/modules/spa/service.go), [postgres.go](../../../backend/internal/modules/spa/postgres.go).
- Create: `backend/internal/modules/spa/domain/room.go`, `backend/internal/modules/spa/domain/room_test.go`, `backend/internal/modules/spa/room_transfer_integration_test.go`.
- Modify test fixtures: [spa_integration_test.go](../../../backend/internal/modules/spa/spa_integration_test.go) untuk grant update admin yang eksplisit.

**Interfaces:** Pertahankan `SetBookingRoom(ctx context.Context, userID, bookingID, roomID string) (*Booking, error)`. Tambahkan `domain.CanChangeRoom(status string, checkedOut bool, releasing bool) error` sebagai aturan khusus room. Body endpoint hanya menerima identitas tujuan `room_id`; tidak menerima nilai biaya/waiver. Gunakan grant IAM yang ada pada route dan pemeriksaan identitas terapis pada jalur service perpindahan, tanpa memblokir helper internal pembuatan booking publik.

- [x] Tulis tes domain tabel: tiga status aktif diizinkan; tiga status akhir dan checked-out ditolak; release saat `in_treatment` ditolak.
- [x] Tambah tes integrasi `TestRoomTransferPricing`, `TestRoomTransferAccess`, `TestRoomTransferRetry`, `TestRoomTransferCapacity`: Public→Public, Public→Private/VIP, tujuan Rp0, contoh total Rp300.000 di atas, direct API terapis 403, read-only 403, outlet salah, room nonaktif/penuh, completed sebelum checkout 409, retry tanpa event/harga tambahan, dan payload charge/waiver tidak dapat mengubah tarif.
- [x] Jalankan tes baru dan pastikan kegagalan berasal dari perilaku yang belum tersedia, bukan konfigurasi database.
- [x] Terapkan aturan khusus room dan izin server. Tarif tujuan dibaca server dalam transaksi; update booking dan event bersifat atomik. Catat ID/nama room asal-tujuan, nominal sebelum/sesudah, aktor, dan waktu melalui event booking yang ada.
- [x] Serialisasikan pemeriksaan kapasitas dan perubahan room memakai row lock room tujuan pada helper assignment bersama; pemeriksaan room saat create/reschedule harus mengikuti protokol yang sama. Gunakan urutan room ID yang konsisten jika mengunci lebih dari satu room. Baca ulang kapasitas setelah memperoleh lock; jangan hanya mengandalkan lock booking masing-masing.
- [x] Tes konkurensi harus memakai dua transaksi/koneksi sungguhan pada database uji, bukan satu fixture transaksi bersama: dua booking berebut slot terakhir, dan create bersamaan dengan transfer. Assert satu sukses, satu konflik, tanpa deadlock atau event parsial.
- [x] Verifikasi dengan `go test ./internal/modules/spa/domain -run TestCanChangeRoom -count=1` dan `go test ./internal/modules/spa -run TestRoomTransfer -count=1 -v`; semua kasus harus berjalan dan PASS.

## Task 3: Kategori dan dialog perpindahan tanpa edit charge

**Files:**
- Modify: [rooms-page.tsx](../../../frontend/src/features/spa/components/rooms-page.tsx), [room-select-dialog.tsx](../../../frontend/src/features/spa/components/room-select-dialog.tsx), [booking-detail-page.tsx](../../../frontend/src/features/spa/components/booking-detail-page.tsx), [room-board.tsx](../../../frontend/src/features/spa/components/room-board.tsx), [rooms.ts](../../../frontend/src/features/spa/rooms.ts), [mutations.ts](../../../frontend/src/features/spa/mutations.ts).
- Capability dikirim backend pada detail booking untuk seluruh pemanggil, termasuk mode embedded Book Order. Tidak perlu menggandakan pengecekan IAM pada server pages.
- Test: [rooms-page.test.tsx](../../../frontend/src/features/spa/components/rooms-page.test.tsx), [booking-detail-navigation.test.tsx](../../../frontend/src/features/spa/components/booking-detail-navigation.test.tsx).
- Create: `frontend/src/features/spa/components/room-select-dialog.test.tsx`.

**Interfaces:** `Booking` menerima `can_change_room?: boolean` dari backend; hanya nilai true yang mengaktifkan tombol/dialog. `RoomSelectDialog` menerima booking berisi status, room asal, harga tersimpan, dan total sehingga dapat menampilkan tarif tujuan serta perubahan total tanpa input nominal. Payload mutation tetap identitas room saja.

- [x] Baca panduan Next lokal yang diwajibkan [AGENTS.md](../../../frontend/AGENTS.md) sebelum menulis komponen/server pages.
- [x] Tambah tes form kategori, label Public/Private, preview Rp25.000→Rp100.000 dengan total Rp300.000, tujuan Rp0, tidak adanya input charge/waiver, larangan memilih tanpa room saat berjalan, dan tombol yang tersembunyi untuk terapis/read-only/completed.
- [x] Jalankan tes baru dan pastikan gagal sebelum implementasi.
- [x] Implementasikan form dan label kategori; tampilkan room asal-tujuan, tarif penuh tujuan, dan total baru. Sertakan teks: “Biaya room mengikuti tarif penuh room tujuan dan dihitung otomatis.” Tombol simpan dinonaktifkan untuk tujuan yang sama atau permintaan berjalan.
- [x] Sinkronkan capability UI dengan kebijakan backend pada detail standalone maupun embedded. Setelah berhasil, refresh detail booking, board, daftar booking, dan ringkasan grup yang terdampak; gunakan respons server sebagai nilai final.
- [x] Jalankan `pnpm --dir frontend test src/features/spa/components/rooms-page.test.tsx src/features/spa/components/room-select-dialog.test.tsx src/features/spa/components/booking-detail-navigation.test.tsx`; seluruh tes harus PASS.

## Task 4: Regresi tagihan dan pemeriksaan akhir

**Files:**
- Test/inspect: [rooms_integration_test.go](../../../backend/internal/modules/spa/rooms_integration_test.go), [booking_group_integration_test.go](../../../backend/internal/modules/spa/booking_group_integration_test.go), [public_group.go](../../../backend/internal/modules/spa/public_group.go), [service.go](../../../backend/internal/modules/spa/service.go), [public_payment.go](../../../backend/internal/modules/spa/public_payment.go), [deposit.go](../../../backend/internal/modules/spa/deposit.go).

**Interfaces:** `room_price_idr` yang tersimpan menjadi sumber biaya room di total booking dan checkout. DP tetap mengikuti ledger yang sudah ada; perpindahan tidak mengubah jumlah uang yang telah diterima.

- [x] Tambah tes transfer sebelum dan sesudah start sampai checkout: POS memiliki satu biaya room terbaru, tarif lama tidak ikut tertagih, tarif master yang berubah belakangan tidak menulis ulang snapshot, dan tujuan gratis tidak menghasilkan charge.
- [x] Tambah regresi booking bersama: initial room sharing tetap sekali charge; anggota yang berpindah ke room berbeda memakai tarif penuh tujuan; retry/simpan room yang sama tidak menambah biaya. Uji DP yang sudah dibayar tetap tercatat dan sisa tagihan memakai total baru.
- [x] Periksa alur pembayaran online yang sudah memiliki invoice. Jika nominal invoice lama dapat menjadi usang, dokumentasikan perilaku konkret dan selesaikan desain rekonsiliasinya sebelum menyatakan fitur siap; jangan diam-diam mengubah invoice atau membuat refund otomatis.
- [x] Jalankan tes domain, transfer, room, group, dan deposit pada database uji yang telah dimigrasi. Hasil SKIP karena `TEST_DATABASE_URL` kosong bukan bukti lulus. Jalankan tes frontend terfokus di Task 3, ESLint pada file yang berubah, dan `pnpm --dir frontend exec tsc --noEmit`.
- [x] Periksa migrasi additive pada database scratch: tidak mengubah harga atau snapshot booking. Tinjau diff akhir terhadap ketentuan pengguna.
- [ ] Sebelum rollout: petakan kategori room lama berdasarkan data fasilitas aktual. Record lama mendapat default Public; koreksi Private/VIP melalui master room. Deployment tidak termasuk permintaan ini.

## Hasil implementasi dan batas operasional

- Kategori Public/Private tersedia pada master, room board, dan pemilihan room. VIP termasuk Private.
- Backend membatasi perpindahan ke operator dengan grant update booking, menolak identitas terapis, dan menghitung tarif penuh dari master room. Tidak menerima payload nominal atau waiver.
- Snapshot tarif, timer treatment, retry, kapasitas, sisa DP, checkout individu, serta checkout grup tercakup pengujian. Dua koneksi nyata menguji perebutan kapasitas dan urutan lock multi-room.
- **Invoice penuh yang sudah diterbitkan atau booking yang sudah lunas:** perpindahan dengan perubahan harga ditolak karena memerlukan rekonsiliasi pembayaran. Perpindahan dengan harga sama tetap diperbolehkan. Booking DP biasa tetap dapat berpindah dan sisa tagihannya diperbarui. Tidak ada refund atau penggantian invoice otomatis.
- Penerbitan invoice memegang lock booking sampai respons provider tersimpan; kegagalan provider me-rollback transaksi dan tidak meninggalkan reservasi nominal yang memblokir perpindahan. Review akhir juga memperbaiki urutan lock room saat membuat booking grup.
- Capability dari backend dipertahankan pada cache detail; perubahan room memperbarui daftar, board, detail, dan ringkasan grup.

### Verifikasi

- Tes kategori/perpindahan, pembayaran publik, grup, DP, dan konkurensi dijalankan pada database scratch yang sudah dimigrasi. Regresi baru diuji gagal sebelum perbaikan, lalu lulus.
- 203 tes frontend Spa (28 file) lulus; TypeScript dan ESLint terfokus lulus. Pemeriksaan diagnostics pada kode fitur tidak menemukan error.
- Domain room lulus secara terisolasi. Suite domain penuh masih terhalang tes fitur shift dari pekerjaan lain yang merujuk fungsi belum tersedia.
- Suite integrasi Spa lulus dengan mengecualikan kegagalan fixture lama `TestCustomerReportUsesPaidPOSOrdersAndWIB` (nomor telepon melampaui batas 20 karakter). Ini bukan klaim bahwa seluruh suite repository lulus.
- Tidak menjalankan commit, deployment, atau migrasi database operasional.
