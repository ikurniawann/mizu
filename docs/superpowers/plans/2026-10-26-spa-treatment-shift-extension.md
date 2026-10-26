# Batas Treatment dan Warna Perpanjangan Shift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dokumen ini hanya rencana, bukan instruksi implementasi atau deployment.

**Goal:** Terapis dapat menerima booking yang mulai sebelum akhir shift dan seluruh treatment aktifnya selesai paling lambat akhir shift +60 menit; area tambahan tersebut terlihat berbeda dari area tanpa shift pada Book Order.

**Architecture:** Gunakan helper aturan waktu pada domain spa untuk validasi server, lalu samakan perhitungan di helper kalender frontend. Perluas pewarnaan latar kolom kalender dan legenda; pertahankan data shift HRIS asli.

**Tech Stack:** Go, PostgreSQL/pgx, Next.js/React/TypeScript, Tailwind, Vitest, tes integrasi Go.

**Spec:** [Desain dan aturan bisnis](#desain-dan-aturan-bisnis) dalam dokumen ini.

**Status:** Diimplementasikan setelah persetujuan pengguna. Penugasan mulai sebelum akhir shift; treatment selesai maksimal +1 jam. Catatan implementasi berikut mengoreksi rincian teknis rencana awal sesuai perubahan workspace terbaru.

## Hasil implementasi

- [domain/schedule.go](../../../backend/internal/modules/spa/domain/schedule.go): `WithinTreatmentShift(visit, shift Interval) error` memakai interval shift bertanggal, batas mulai eksklusif, batas selesai inklusif +60 menit, dan batas tengah malam hari booking. Helper bertanggal mempertahankan dukungan shift malam dari perubahan roster terbaru.
- [work_schedule.go](../../../backend/internal/modules/spa/work_schedule.go): aturan digunakan melalui `workingRosters` yang kini sudah menjadi jalur bersama penugasan, availability, kapasitas publik, pilihan terapis, dan antrean. `checkWorkingRosters` menyimpan alasan penolakan untuk [assignment.go](../../../backend/internal/modules/spa/assignment.go). Antrean tetap memeriksa waktu di dalam shift asli.
- [calendar.ts](../../../frontend/src/features/spa/calendar.ts) dan [book-order-calendar.tsx](../../../frontend/src/features/spa/components/book-order-calendar.tsx): area tambahan berwarna kuning muda dengan legenda “Hanya penyelesaian treatment”; tanpa shift/cuti/libur tetap diarsir. Klik waktu mulai pada/selepas akhir shift ditolak; drag memakai aturan yang sama. Warna status kartu tidak berubah.
- Tes: 222 tes frontend spa, ESLint terarah, dan TypeScript lulus. Tes integrasi baru penugasan, rollback reschedule/tambah treatment, antrean, pilihan terapis publik, serta reservasi kapasitas lulus pada database uji terpisah. Tes domain mencakup batas detik dan tengah malam. Tes regresi juga terbukti gagal ketika aturan server lama digunakan melalui Go overlay, tanpa mengubah source kerja.
- Regresi seluruh backend spa menemukan kegagalan terpisah pada `TestCustomerReportUsesPaidPOSOrdersAndWIB`: fixture nomor telepon 23 karakter melebihi kolom `varchar(20)`. Tes deposit lulus setelah dijalankan dengan `XENDIT_MOCK=1`.
- Tidak menjalankan deployment atau pemeriksaan visual browser. Interaksi kalender diverifikasi melalui tes komponen.

Rincian task di bawah merupakan rencana awal; signature `TreatmentShiftWindow` digantikan oleh `WithinTreatmentShift` dan adapter roster bersama di atas agar tidak menduplikasi validasi yang sudah ditambahkan pekerjaan lain.

## Desain dan aturan bisnis

- Ketentuan pengguna: batas **selesai treatment** adalah akhir shift +1 jam. Shift berakhir 16:00 berarti treatment selesai tepat 17:00 diterima; setelah 17:00 ditolak.
- Gunakan jumlah durasi seluruh treatment aktif dalam satu booking, bukan durasi satu item. Item dibatalkan tidak ikut dihitung, mengikuti `bookingInterval` yang tersedia.
- Ketentuan pengguna: penugasan hanya berlaku **sebelum akhir shift**. Untuk shift 09:00–16:00, waktu mulai booking harus memenuhi `09:00 <= mulai < 16:00` dan waktu selesai `<= 17:00`. Mulai tepat 16:00 maupun 16:30 ditolak meskipun selesai sebelum 17:00. Contoh 15:30–17:00 diterima; 15:30–17:01 ditolak.
- Antrean penugasan tetap berakhir pada akhir shift asli. Area tambahan satu jam hanya untuk menyelesaikan treatment yang dimulai sebelum akhir shift, bukan untuk memulai booking baru.
- Waktu mulai sebelum awal shift tetap ditolak. Tambahan waktu tidak memperpanjang jam operasional outlet, last order, atau periode perbantuan lintas outlet.
- Pertahankan batas booking pada satu hari WIB. Untuk shift malam, pertahankan normalisasi akhir hari yang ada; tambahan tidak membuka dukungan booking lintas hari. Akhir efektif dibatasi 24:00. Pembenahan model shift lintas hari berada di luar lingkup.
- Shift asli pada HRIS, absensi, penggajian, kuota roster, dan label jam shift tidak berubah. Tambahan satu jam khusus batas treatment.
- Aturan cuti/libur, bentrok booking, preferensi gender, status booking, dan kewenangan outlet tetap berlaku. Ketiadaan shift tidak memperoleh area perpanjangan; jangan diam-diam mengubah kebijakan penugasan tanpa shift yang sudah ada.
- Tampilan usulan: jam shift biasa memakai latar standar; [akhir shift, akhir shift +60 menit) memakai kuning muda; area lain memakai abu-abu berarsir. Cuti/libur/tanpa shift mengarsir seluruh kolom tanpa area kuning.
- Legenda menambahkan “Perpanjangan shift +1 jam” dengan keterangan “Hanya penyelesaian treatment”. Warna status kartu booking tetap seperti sekarang. Latar perpanjangan tidak boleh menutupi kartu atau menangkap klik/drag; handler kalender mencegah pemilihan waktu mulai baru pada atau setelah akhir shift.

### Pendekatan

Rekomendasi: perluas batas treatment pada pemeriksaan bersama dan tampilkan band tambahan. Mengubah jam akhir shift di HRIS akan turut mengubah makna roster/absensi, sehingga tidak sesuai kebutuhan. Pengaturan toleransi per outlet tidak diperlukan karena permintaan menetapkan satu jam secara tetap.

### Temuan kode saat ini

- [assignment.go](../../../backend/internal/modules/spa/assignment.go): `checkBookingTherapist` menolak selesai setelah akhir shift; dipakai penugasan, reschedule, dan perubahan treatment.
- [public_payment.go](../../../backend/internal/modules/spa/public_payment.go): `freeTherapists` memiliki salinan pemeriksaan batas shift.
- [service.go](../../../backend/internal/modules/spa/service.go): `publicCapacity` belum memfilter batas shift; perlu konsisten agar slot publik tidak menawarkan kapasitas yang tidak bisa ditugaskan.
- [queue.go](../../../backend/internal/modules/spa/queue.go): `arrivalQueueIn` mengeluarkan terapis dari antrean saat akhir shift. Perilaku ini dipertahankan sesuai klarifikasi pengguna.
- [calendar.ts](../../../frontend/src/features/spa/calendar.ts): `shiftMismatch` membatasi akhir shift asli; `offShiftBands` mengarsir seluruh area setelahnya.
- [use-booking-dnd.tsx](../../../frontend/src/features/spa/components/use-booking-dnd.tsx): penugasan booking tanpa terapis dikirim ke antrean server; perpindahan antarterapis memeriksa `shiftMismatch` di klien.

## Global Constraints

- Toleransi selesai tepat 60 menit, batas selesai inklusif; batas mulai akhir shift eksklusif (`mulai < akhir shift`), waktu WIB.
- Tidak ada migrasi, dependency baru, pengaturan toleransi, atau perubahan jadwal HRIS.
- Workspace memiliki banyak perubahan yang belum di-commit, termasuk file yang disentuh rencana ini. Baca ulang versi terbaru sebelum implementasi dan pertahankan perubahan pekerjaan lain.
- Tahap ini hanya menulis rencana. Tidak memperpanjang jendela penugasan/antrean melewati akhir shift asli.

## Review Focus

- Akhir treatment tepat batas versus lewat satu menit, serta total beberapa treatment (Task 1).
- Mulai tepat akhir shift atau sesudahnya ditolak; antrean berakhir pada akhir shift asli, termasuk kasus sudah clock-out (Task 1).
- Slot publik dan pemilihan terapis menggunakan kapasitas sesuai batas baru, termasuk reservasi belum ditugaskan (Task 1).
- Cuti/libur/tanpa shift, batas perbantuan, dan booking sampai akhir hari tidak mendapat kelonggaran tambahan yang tidak diminta (Task 1–2).
- Band terpotong oleh rentang kalender, shift di luar viewport, klik slot, dan dua jalur drag booking tetap benar (Task 2).

## Task 1: Batas treatment konsisten di server

**Files:**
- Modify: [domain/schedule.go](../../../backend/internal/modules/spa/domain/schedule.go), [assignment.go](../../../backend/internal/modules/spa/assignment.go), [public_payment.go](../../../backend/internal/modules/spa/public_payment.go), [service.go](../../../backend/internal/modules/spa/service.go).
- Inspect/regression only: [queue.go](../../../backend/internal/modules/spa/queue.go); batas antrean asli tidak diperpanjang.
- Create: `backend/internal/modules/spa/domain/treatment_shift_test.go`.
- Test: [booking_shift_integration_test.go](../../../backend/internal/modules/spa/booking_shift_integration_test.go), [queue_integration_test.go](../../../backend/internal/modules/spa/queue_integration_test.go), [public_payment_integration_test.go](../../../backend/internal/modules/spa/public_payment_integration_test.go).

**Interfaces:** Tambahkan `domain.TreatmentShiftExtensionMinutes = 60` dan `domain.TreatmentShiftWindow(date, startClock, endClock string) (shift Interval, treatmentEnd time.Time, ok bool)`. `shift` adalah interval shift asli untuk batas mulai `[shift.Start, shift.End)`; `treatmentEnd` adalah akhir shift +60 menit, dibatasi tengah malam berikutnya. Input clock/tanggal tidak valid menghasilkan `ok = false`. Helper mengembalikan timestamp agar perbandingan tidak membuang detik. Caller memeriksa mulai berada di interval shift asli dan selesai `<= treatmentEnd`. Kebijakan caller untuk shift nil/format tak valid dipertahankan. Tidak mengubah kontrak endpoint.

- [ ] Tulis tes helper untuk shift 09:00–16:00 → interval shift asli 09:00–16:00 dan batas selesai 17:00 WIB; jam dengan detik nol; akhir 23:30 → batas selesai 24:00 dengan batas mulai tetap 23:30; shift malam dengan normalisasi lama; input tidak valid.
- [ ] Tambah tes integrasi `TestBookingShiftExtension` untuk shift sampai 16:00: 15:00 +120 menit diterima, 15:30 +90 diterima, 15:30 +91 ditolak; 16:00 +30 dan 16:30 +30 ditolak; sebelum awal shift ditolak. Uji total dua treatment, item dibatalkan, tambah/perpanjang treatment, dan rollback assignment/reschedule saat ditolak. Sesuaikan kasus lama 16:00–18:00 untuk shift sampai 17:00 menjadi berhasil; gunakan 16:30–18:30 sebagai kasus penolakan baru.
- [ ] Tambah tes regresi `TestArrivalQueueShiftExtension`: shift selesai 16:00 dengan absensi aktif eligible sebelum 16:00, tetapi tepat 16:00 dan 16:30 tidak eligible. Clock-out, cuti, dan libur tetap tidak eligible. Booking yang sudah ditugaskan sebelum akhir shift dapat berlanjut sampai batas selesai 17:00 tanpa assignment dilepas. Penugasan tetap memeriksa seluruh durasi booking dan urutan prioritas.
- [ ] Tambah tes `TestPublicShiftExtension`: pilihan terapis, slot publik, dan write booking konsisten untuk mulai 15:30 dengan selesai 17:00 versus 17:01; mulai 16:00 dan 16:30 tidak eligible meskipun selesai <=17:00. Uji kapasitas yang sudah direservasi, bentrok, dan periode perbantuan yang berakhir sebelum treatment selesai tetap menolak.
- [ ] Jalankan tes baru, pastikan kegagalan berasal dari perilaku yang belum tersedia. Tes integrasi membutuhkan `TEST_DATABASE_URL` ke database uji yang sudah mengikuti migrasi workspace, bukan database produksi.
- [ ] Implementasikan helper dan gunakan pada `checkBookingTherapist`, `freeTherapists`, serta filter hitung kapasitas `publicCapacity`. Validasi mulai `>= shift.Start` dan `< shift.End`, selesai `<= treatmentEnd`; pertahankan pemeriksaan satu hari, penguncian dan rollback yang ada. Pesan konflik membedakan “Booking harus dimulai sebelum 16:00 WIB (akhir shift)” dari “Booking harus selesai paling lambat 17:00 WIB (akhir shift +1 jam)”.
- [ ] Pertahankan filter akhir shift asli di `arrivalQueueIn`, syarat absensi, dan cakupan outlet. Jangan memakai batas selesai tambahan sebagai batas antrean atau memperpanjang helper shift umum yang dipakai kuota/roster/perbantuan.
- [ ] Verifikasi: `go -C backend test ./internal/modules/spa/domain -run TestTreatmentShift -count=1` dan `go -C backend test ./internal/modules/spa -run 'TestBooking.*Shift|TestArrivalQueue.*|TestAutoAssignSingleBooking|TestPublicShiftExtension' -count=1 -v`. Wajib PASS; SKIP integrasi berarti belum terverifikasi.

## Task 2: Validasi klien dan warna Book Order

**Files:**
- Modify: [calendar.ts](../../../frontend/src/features/spa/calendar.ts), [book-order-calendar.tsx](../../../frontend/src/features/spa/components/book-order-calendar.tsx).
- Test: [calendar.test.ts](../../../frontend/src/features/spa/calendar.test.ts), [book-order-calendar.test.tsx](../../../frontend/src/features/spa/components/book-order-calendar.test.tsx).
- Inspect callers: [use-booking-dnd.tsx](../../../frontend/src/features/spa/components/use-booking-dnd.tsx).

**Interfaces:** Pertahankan `shiftMismatch(item: Timed, shift: Shift | null): string | null`, `availabilityWarning`, dan `offShiftBands` untuk caller yang ada. Tambahkan `SHIFT_EXTENSION_MINUTES = 60` serta `shiftExtensionBand(shift: Shift | null, unavailable: boolean, range: DayRange, pxPerMin = PX_PER_MIN): Band | null`. `offShiftBands` mulai mengarsir area setelah batas tambahan, bukan setelah akhir shift asli. `Column` menerima `extensionBand?: Band | null`.

- [ ] Tulis tes helper dengan nilai sama seperti server: mulai sebelum akhir shift dan selesai tepat batas diterima; lewat batas selesai, mulai tepat akhir shift, mulai sesudah akhir shift, dan mulai sebelum shift ditolak. Ubah ekspektasi lama 21:30–22:30 pada shift sampai 22:00 menjadi diterima, tetapi 22:00–22:30 ditolak.
- [ ] Tulis tes band: shift 09:00–16:00 dan range 10:00–22:00 menghasilkan band tambahan `top = 360 * PX_PER_MIN`, `height = 60 * PX_PER_MIN`; arsiran setelahnya dimulai `420 * PX_PER_MIN`. Tanpa shift/cuti/libur → tidak ada tambahan. Clip semua band ke range, buang band tinggi nol, uji shift sepenuhnya di luar range dan akhir hari.
- [ ] Tambah tes komponen untuk legenda, perbedaan kelas warna tambahan versus tanpa shift, posisi band, serta klik slot sebelum akhir shift yang tetap membuka booking. Klik slot kosong tepat/sesudah akhir shift tidak membuka booking baru untuk terapis tersebut. Uji booking sudah assigned yang mulai sebelum akhir shift dan selesai dalam toleransi dapat dipindah ke terapis lain; mulai pada/sesudah akhir shift atau selesai lewat toleransi ditolak. Jalur unassigned tetap meminta validasi antrean server; reschedule ke 16:00 atau 16:30 untuk shift sampai 16:00 ditolak server.
- [ ] Jalankan tes terarah dan pastikan gagal pada perilaku baru.
- [ ] Samakan `shiftMismatch` dengan dua batas server (mulai sebelum akhir shift asli, selesai maksimal +60 menit); implementasikan helper band dan rendering latar kuning muda yang kompatibel dengan light/dark theme. Gunakan `pointer-events-none`, pertahankan warna kartu booking dan jam shift asli di header. Pada handler `onEmptyClick` kolom terapis, tolak waktu mulai pada/sesudah akhir shift asli dengan pesan jelas. Tambahkan legenda teks “Hanya penyelesaian treatment”; jangan hanya mengandalkan perbedaan warna.
- [ ] Verifikasi: `pnpm --dir frontend test src/features/spa/calendar.test.ts src/features/spa/components/book-order-calendar.test.tsx` → PASS.

## Verifikasi akhir saat implementasi

- [ ] Jalankan regresi modul spa: `pnpm --dir frontend test src/features/spa` dan `go -C backend test ./internal/modules/spa/... -count=1 -v`; laporkan kegagalan dari perubahan workspace lain secara terpisah dan jangan menyebut integrasi SKIP sebagai lulus.
- [ ] Cek manual Book Order untuk shift sampai 16:00: area 16:00–17:00 berbeda dari tanpa shift; booking 15:30–17:00 bisa ditugaskan sebelum akhir shift; 15:30–17:01, 16:00–16:30, dan 16:30–17:00 ditolak dengan pesan jelas. Cek reschedule, drag antarterapis, klik area tambahan, dan terapis tidak masuk antrean pada 16:00 maupun 16:30.
- [ ] Review diff hanya untuk lingkup ini. Rencana tidak membutuhkan deployment atau perubahan konfigurasi operasional.
