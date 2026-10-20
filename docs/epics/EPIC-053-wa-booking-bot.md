# EPIC-053: Chatbot Booking WhatsApp (`MODULE-WABOT`)

status: on-progress
environment: dev
retries: 0

## Goal

Customer Mizu bisa **booking lewat chat WhatsApp** tanpa dibantu admin: bot menyapa,
menanyakan outlet, berapa orang, paket treatment, tanggal/jam, terapis (pilih sendiri
atau dipilihkan), mengecek **ketersediaan jadwal yang sebenarnya** di sistem,
mencarikan alternatif bila penuh, lalu membuat booking dan menawarkan **metode
pembayaran** (bayar di outlet atau link Xendit). Percakapan tetap tercatat di Inbox
WhatsApp dan sewaktu-waktu bisa **diambil alih admin** (seperti SleekFlow).

Referensi: SleekFlow (chatbot + inbox + handover). Dasar yang dipakai ulang:
Inbox WA (EPIC-012), booking publik spa (EPIC-052: `/api/public/spa/*`), pembayaran
online Xendit, dan klien OpenAI yang sudah ada untuk asisten "Do".

## Keputusan (default pemilik, 2026-10-12 — "jalankan")

| Topik | Keputusan |
| --- | --- |
| Jalur WhatsApp | **Baileys** (gateway yang sudah ada) dulu: balasan teks + menu angka. Desain siap pindah ke **Meta Cloud API** (tombol/list interaktif, template) di Fase 4. |
| AI | **OpenAI** yang sudah terpasang (`openai_api_key` di Settings → Integrasi; model `gpt-4o-mini`). AI hanya **memahami** pesan bebas; balasan disusun sistem dari template, bukan dikarang AI. Tanpa API key, bot tetap jalan dalam mode menu angka. |
| Sumber kebenaran | Jadwal, harga, terapis, dan pembayaran **selalu** dari service spa (aturan sama dengan website); booking dibuat hanya setelah konfirmasi eksplisit customer dan dicek ulang ketersediaannya saat itu. |
| Serah ke admin | Customer ketik `admin`/`cs`/`manusia`, bot bingung 2× berturut-turut, atau topik di luar booking → bot berhenti; admin membalas dari Inbox → bot otomatis nonaktif di percakapan itu sampai dinyalakan lagi. |
| Lebih dari 1 orang | Fase 2: satu booking per orang di jam yang sama (batas 3 booking aktif per nomor). Setelah fitur *booking grup* (sesi lain) selesai, diganti ke satu booking grup. |
| Kecepatan balas | Target median < 3 dtk, p95 < 8 dtk: balasan angka/menu tanpa AI (< 1 dtk); AI hanya untuk kalimat bebas, 1 panggilan per pesan, JSON mode, timeout 8 dtk → fallback menu. |

## Mekanisme

```
Customer (WA) → /api/wa/inbound → Inbox mencatat pesan
   → bot aktif untuk percakapan ini? (setelan global + tidak sedang dipegang admin)
      ├─ tidak → aturan CS lama (auto-reply di luar jam) / admin membalas
      └─ ya → WABOT engine
            ├─ pesan = angka menu / kata kunci  → langsung diproses (tanpa AI)
            └─ kalimat bebas → OpenAI ekstraksi slot (JSON) → diproses
            → state machine: outlet → orang → paket → tanggal/jam → terapis
              → konfirmasi → (buat booking) → pembayaran → selesai
            → balasan template (ID) dikirim via WA & dicatat di Inbox (message_type 'bot')
```

Alur:
1. Sapaan + pilih outlet.
2. Berapa orang.
3. Paket per orang (daftar treatment & harga dari sistem; "semua sama" atau beda per orang).
4. Tanggal & jam: hanya jam yang masih ada terapis kosong (`PublicSlots`); untuk >1 orang
   butuh ≥ N terapis kosong (`PublicTherapists`).
5. Terapis: pilih nama (yang kosong di jam itu), cukup pria/wanita, atau "pilihkan Mizu".
6. Ringkasan + konfirmasi "ya" → booking dibuat (`PublicBook`).
7. Pembayaran: **bayar di outlet** atau **link Xendit** (`PublicPay`); lunas → bot kirim konfirmasi.
8. Kode booking + link status (QR, ubah jadwal sampai 1 jam sebelum).

Cari solusi bila penuh, berurutan: jam terdekat di hari yang sama (±3 pilihan) →
preferensi gender dilonggarkan → outlet lain di jam sama → hari lain jam sama →
(grup) dipecah berurutan → daftar tunggu / sambungkan admin.

## Tasks

### Fase 1 — Fondasi
- [x] T-531 Migrasi: `crm.wa_bot_sessions` (state per percakapan), kolom `bot_active`/`bot_handover_*` di `crm.wa_conversations`, `message_type` `bot`, setelan `bot_*` di `crm.crm_settings`.
- [x] T-532 Modul Go `wabot`: engine (state machine + parser menu/kata kunci), port ke spa/WA/LLM, hook di `/api/wa/inbound` (bot mendahului auto-reply CS), serah ke admin saat admin membalas.
- [x] T-533 Backoffice: setelan bot (aktif, nama, sapaan, kata kunci admin) di Pengaturan CRM; label **Bot** + tombol bot on/off + ringkasan sesi di Inbox.
- [x] T-534 Simulator: `POST /api/wa-bot/simulate` (staf) untuk menguji percakapan tanpa nomor WA (balasan dicatat sebagai `simulasi`).

### Fase 2 — Booking 1 orang (dan N orang sederhana)
- [x] T-535 Outlet → paket → tanggal/jam → terapis → konfirmasi → booking (`PublicBook`, terapis pilihan via `assignBooking`).
- [x] T-536 Pembayaran: bayar di outlet / link Xendit; konfirmasi lunas lewat status booking.
- [x] T-537 Ekstraksi AI (OpenAI JSON mode) untuk kalimat bebas: outlet, jumlah orang, treatment, tanggal/jam (bahasa Indonesia: "besok sore", "sabtu jam 3"), preferensi terapis, ya/tidak, minta admin. *Catatan:* parser lokal (angka menu, "2 orang", "besok sore", "jam 3 sore", ya/ubah/admin) sudah menutup alur utama; jalur OpenAI dipakai hanya bila kalimat tidak terbaca lokal dan kunci `openai_api_key` terisi — belum diuji dengan kunci nyata.
- [x] T-538 Tes: unit (parser, state machine) + integrasi (percakapan penuh di DB uji dengan LLM palsu).

### Fase 3 — Grup & solusi saat penuh
- [x] T-539a Booking grup *all-or-nothing* (`spa.PublicBookGroup`: satu transaksi, gagal satu = batal semua) dan **bergantian**: bila tak ada jam untuk N orang sekaligus, bot menawarkan dua gelombang ("10.00 (2 orang) & 11.00 (1 orang)"); tiap tamu punya jam sendiri di ringkasan & kode booking.
- [x] T-539b Alternatif saat penuh: 3 hari terdekat (dengan jumlah jam), **outlet lain di hari yang sama** (dicek sungguhan, paket dicocokkan ulang ke katalog outlet itu), perintah *ganti outlet*.
- [x] T-539c **Daftar tunggu** `spa.booking_waitlist`: bot menawarkan saat penuh (atau ketik *daftar tunggu*); pengawas tiap 10 menit mengecek ulang dan mengabari lewat WA sekali ("Kabar baik… balas *ambil*"), sesi diisi ulang sehingga *ambil* langsung ke pilihan jam; booking apa pun (bot/web) menutup entri otomatis. Backoffice: Spa → Booking History → **Daftar tunggu** (`/dashboard/spa/waitlist`, hak `spa.bookings`): daftar, catat tamu manual, tandai jadi booking/batal. Rute `GET/POST /api/spa/waitlist`, `POST /api/spa/waitlist/{id}/status`.
- [ ] T-539d Tautan ke tabel `spa.booking_groups` (satu tagihan POS) — menunggu fitur grup FO di-commit; bot sekarang membuat N booking terpisah bernama "Nama (1)…(N)".

### Notifikasi ke customer (disepakati 2026-10-13, sebelum Fase 4)
- [x] T-542 Konfirmasi WA saat pembayaran online lunas (event outbox `spa.booking.paid_online` → pelanggan `wabot.customer-paid-notice`) dan pengingat kunjungan H-1 & ±2 jam sebelum (pengawas bot tiap 10 menit, jendela 22–26 jam & 90–150 menit). Hanya booking `source` website/chat; dedup lewat `configuration.wa_notif_log` (`spa_paid`, `spa_remind_h1`, `spa_remind_2h`); saklar `bot_notify_customer` di Pengaturan CRM (bawaan aktif).

### Tanya-jawab (disepakati 2026-10-13, dari uji WA pemilik)
- [x] T-543 Pertanyaan alamat/lokasi (+ link Maps), jam buka, daftar harga, cara bayar, ubah jadwal dijawab dari data sistem tanpa mengubah draf booking, lalu pertanyaan booking yang tertunda diulang ("Lanjut booking — …"). Pertanyaan lain dijawab AI hanya dari FAKTA sistem (outlet, katalog, kebijakan); bila tidak tahu → arahkan ke *admin*. "jam 3" tanpa keterangan = 15.00.

### Bahasa & nama di awal (permintaan pemilik 2026-10-13)
- [x] T-544 Pesan pertama: sapaan dwibahasa + pilihan **1. Bahasa Indonesia / 2. English** (dilewati bila pesan pertama jelas berbahasa Inggris, atau pesan Indonesia yang sudah memuat isi booking/pertanyaan); lalu **nama ditanya dulu** (opsi 1 = nama profil WhatsApp, atau ketik nama) sebelum outlet. Semua template, label menu, tanggal, ringkasan, notifikasi lunas/pengingat, kabar daftar tunggu, dan jawaban AI mengikuti bahasa sesi; parser memahami kata Inggris (tomorrow, Saturday, 3pm, 2 people, female therapist, yes/no, where/how much, waitlist…). Bahasa & nama dipertahankan saat *booking baru*.

### Fase 4 — Meta Cloud API
- [x] T-540 Meta Cloud API: webhook `GET/POST /api/wa/meta` (hub.challenge + HMAC app secret; balasan tombol/daftar `k:<n>` dibaca sebagai angka menu), kredensial & provider dari `configuration.app_settings` (Settings → WhatsApp Gateway → **Meta Cloud API**, cek nomor via Graph), menu bot sebagai **tombol/daftar interaktif** (≤3 tombol, ≤10 baris, selebihnya teks), notifikasi lunas/pengingat memakai **template** di luar jendela 24 jam (`meta_wa_reminder_template`, `meta_wa_paid_template`). Runbook: `docs/crm/RUNBOOK-META-CLOUD-API.md`. *Menunggu pemilik:* WABA + nomor + token + template disetujui.

### Fase 5 — Laporan
- [ ] T-541 Funnel bot (chat → paket → booking → bayar) & waktu balas per pesan.

## Acceptance Criteria

- Bot nonaktif secara bawaan (`bot_enabled=false`); saat aktif, pesan masuk di WA dijawab bot
  dalam ≤ 8 dtk; angka menu dijawab tanpa memanggil AI.
- Customer dapat menyelesaikan booking 1 orang dari chat: hasilnya booking `source='whatsapp'`
  yang tampil di Spa → Booking & Book Order, dengan terapis sesuai pilihan (atau belum
  ditugaskan), dan link status/pembayaran yang valid.
- Jam yang ditawarkan bot = jam yang ditawarkan website untuk input yang sama; jam penuh
  tidak pernah ditawarkan; bila penuh bot menawarkan alternatif.
- Booking hanya dibuat setelah customer mengonfirmasi; ketersediaan dicek ulang saat membuat.
- Admin membalas dari Inbox → bot berhenti di percakapan itu; admin bisa menyalakan lagi.
- Semua pesan bot tercatat di Inbox dan tidak pernah berisi harga/jam yang tidak berasal
  dari sistem.
- Tanpa API key OpenAI, bot tetap berfungsi dengan menu angka.

## Automation Log

- 2026-10-12 — EPIC dibuat; survei kode: Inbox WA (Baileys, `/api/wa/inbound`), klien OpenAI
  "Do" (tool calling), API booking publik spa lengkap; belum ada bot/flow/pesan interaktif.
  Keputusan default: Baileys dulu, OpenAI, mulai Fase 1–2.
- 2026-10-12 — Fase 1–2 selesai di kode. Modul Go `wabot` (`engine.go` state machine, `domain/parse.go`
  parser Indonesia, `domain/reply.go` template, `llm.go` ekstraksi OpenAI, `store.go`, `module.go`
  rute `/api/wa-bot/*`), port `spa.PublicBookingInput` (+`Source: "whatsapp"`), hook di webhook WA
  (`integrations/webhooks/inbound.go`: bot mendahului auto-reply CS), agent membalas → `bot_active=false`
  (`crm/inbox/conversations.go`). Frontend: `features/crm/inbox/components/bot-panel.tsx` (status sesi,
  booking bot, tombol ambil alih/serahkan), label **Bot** di daftar & gelembung bot hijau-teal di thread,
  setelan bot di `cs-settings-section.tsx`.
  Keputusan: booking grup (2–3 orang) = N booking dengan nama "Nama (1)", "Nama (2)", terapis dipilihkan
  Mizu (tanya terapis hanya untuk 1 orang); bila pembayaran online tidak tersedia, pertanyaan metode bayar
  dilewati (langsung "bayar di outlet"); "besok sore" hanya menawarkan jam sore bila ≥3 slot.
  Bukti: `go test ./internal/modules/wabot/...` PASS (unit parser + 5 tes integrasi di DB uji: booking 2
  orang via menu, 1 orang pilih terapis dengan "besok jam 2 siang", serah ke admin + bot diam, 3× tidak
  paham → serah, bot nonaktif = diam); simulasi `POST /api/wa-bot/simulate` di image `mizu-api:wabot-1`
  terhadap DB uji: 9 giliran, balasan 35–112 ms tanpa AI, 2 booking `source='whatsapp'` + link Xendit mock.
  Migrasi `20261012150000_wa_booking_bot.sql` sudah diterapkan di DB live (backup
  `~/backups/mizu/mizu-before-wabot-20261012-230953.dump`); image `mizu:wabot-1` & `mizu-api:wabot-2`
  sudah dibangun — penukaran container live menunggu pemilik (diblokir classifier). `bot_enabled`
  bawaan **false**; nyalakan di Pengaturan CRM → Customer Service. Fase 3–5 (grup terintegrasi, Meta
  Cloud API, laporan funnel) belum.
- 2026-10-12 — Live: pemilik menukar container ke `mizu-api:wabot-2` + `mizu:wabot-2` (perbaikan
  `b9086954`: prefix `/api/wa-bot` harus didaftarkan di `GO_BACKEND_PREFIXES`, kalau tidak Next
  membalas 404). Simulasi penuh di mizu.reddie.id: 9 giliran, balasan 157–511 ms, booking
  MZ-261012-KNBH/LR22 (uji; dibatalkan). `bot_enabled` dinyalakan untuk demo.
- 2026-10-13 — Fase 3 selesai (T-539a–c). Keputusan: grup lewat chat tetap N booking terpisah (belum
  ditautkan ke `spa.booking_groups` yang masih uncommitted di sesi lain); gelombang kedua dimulai
  setelah treatment terlama gelombang pertama selesai (tanpa tumpang tindih terapis); daftar tunggu
  satu entri aktif per nomor+outlet+tanggal (ulang = perbarui); pengawas hanya mengabari entri yang
  punya percakapan WA (entri FO ditangani staf) dan menutup otomatis yang tanggalnya lewat.
  Bukti: `go test ./internal/modules/wabot/...` (5 tes lama + `TestBotStaggersGroupWhenNoCommonSlot`,
  `TestBotWaitlistAndAlternatives`: penuh → opsi hari/outlet lain/daftar tunggu → pembatalan → pengawas
  mengabari → *ambil* → booking → entri `booked`), tes spa publik tetap lulus; frontend tsc/eslint/vitest
  (`waitlist-page.test.tsx`). Migrasi `20261013000000_spa_booking_waitlist.sql`.
- 2026-10-13 — T-542 notifikasi customer: konfirmasi lunas via outbox (dikirim ulang otomatis bila
  gateway gagal, klaim dedup ikut transaksi pengiriman) dan pengingat dari pengawas bot (klaim
  dilepas bila kirim gagal supaya dicoba lagi). Keputusan: booking front office tidak dikirimi (nomor
  tidak diberikan lewat kanal WA); pesan pengingat memuat link status/QR & ubah jadwal. Bukti:
  `TestBotRemindsUpcomingBookingsOnce`, `TestBotPaidNoticeOnce`.
- 2026-10-13 — T-540 Meta Cloud API selesai di kode (belum diuji dengan WABA nyata — pemilik belum punya
  akun Meta Business; diuji dengan stub Graph API & webhook bertanda tangan). Keputusan: kredensial di
  app_settings agar bisa diubah tanpa deploy; provider dipilih di halaman setelan (env sebagai cadangan);
  gateway Baileys tetap tersedia berdampingan. Bukti: `TestMetaMenusAndTemplates`, `TestWaMeta`,
  `TestBotOffersMenusInteractively`. Kunci OpenAI (pemahaman kalimat bebas) diaktifkan pemilik 2026-10-13
  lewat `openai_api_key`.
- 2026-10-13 — Penyetelan AI dari uji live dengan kunci OpenAI nyata (gpt-4o-mini, 1,5–3,4 dtk/pesan):
  AI dipanggil untuk kalimat panjang meski parser lokal membaca sebagian dan hanya mengisi field kosong;
  tebakan tanpa isyarat (outlet/tanggal/jam/jumlah orang yang tak disebut) dibuang; daftar outlet dimuat
  sebelum pesan pertama dibaca; treatment yang disebut sebelum outlet disimpan; pencocokan nama memberi
  skor kata khas dan mengabaikan kata umum ("massage", "pijat", "menit") — "thai massage 60 menit" →
  Thai 60, "pijat buat istri" tidak lagi memilih Pijat Tradisional. Bukti: `TestSanitizeAIDropsUnmentionedFields`,
  `TestMatchNameScoresDistinctiveWords`, `TestBotKeepsTreatmentsNamedBeforeOutlet`.
- 2026-10-13 — T-543 tanya-jawab: pemilik bertanya "alamat mizu 1.0 dimana?" lewat WA dan bot menjawab "belum
  paham". Kini kelas pertanyaan dideteksi (`DetectQuestion`), dijawab dari `PublicOutlet` (alamat, kota, telp,
  jam) dan katalog; pertanyaan bebas ke OpenAI dengan prompt "hanya dari FAKTA, kalau tidak ada jawab
  TIDAK_TAHU". Bukti: `TestDetectQuestion`, `TestBotAnswersQuestionsFromSystemData`, `TestParseTimeDaytimeDefault`.
- 2026-10-13 — Dari uji WA pemilik (grup 3 orang ditolak "terlalu banyak booking aktif" lalu bot diam):
  (1) batas 3 booking aktif per nomor kini menghitung satu rombongan sebagai satu kunjungan;
  (2) mencapai batas tidak lagi menyerahkan percakapan ke admin — bot menjelaskan dan tetap menjawab
  (percakapan pemilik diaktifkan kembali manual); (3) bug spa: daftar terapis kosong publik tidak
  mengurangi booking yang belum ditugaskan sehingga jam yang sudah terisi masih ditawarkan — diperbaiki
  (`freeTherapists` kini memotong `unassignedOverlaps`, selaras `publicCapacity`); (4) preferensi terapis
  kosong = "any". Bukti: `TestBotGroupCountsOnceAgainstCap`.
- 2026-10-13 — T-544 dwibahasa + nama di awal. Keputusan: pertanyaan bahasa hanya untuk sapaan kosong
  ("halo"); pesan berisi langsung diproses dalam bahasa yang terdeteksi; jawaban tak jelas setelah menu
  bahasa = Indonesia; nama bebas diterima hanya bila ≥3 huruf dan bukan kata perintah/ya/tidak. Bukti:
  `TestBotEnglishFlow`, `TestBotLanguageMenu`, seluruh tes lama disesuaikan (helper `start()`).
- 2026-10-13 — Pesan di luar alur ("Halo coba ulang ya" dijawab "belum paham"): perintah ulang/kembali/
  status/admin dikenali di mana pun dalam kalimat ≤6 kata; sisanya ke AI *Converse* (JSON: intent
  restart|back|status|admin|none + balasan singkat dari FAKTA dalam bahasa sesi) sebelum dihitung
  "tidak paham"; pertanyaan tertunda diulang setelah balasan. Bukti: `TestBotOffScriptMessages`,
  `TestIntentAnywhereInShortMessages`.
- 2026-10-20 — Revisi bot dari pemilik (8 poin). Keputusan pemilik: rombongan sampai 10 orang di chat;
  gift voucher dibeli penuh lewat chat; last order diatur per outlet; perbedaan outlet dari kolom
  deskripsi outlet. Hasil: (1) treatment rombongan ditanya per tamu ("Tamu 2: … / 0 = sama dengan Tamu 1",
  "2 semua" = semua sama; *kembali* mundur satu tamu); (2) `spa.outlets.description` + jawaban "bedanya
  apa" (deskripsi, jam, last order, selisih harga, treatment khusus); (3) `MaxPeople`/`MaxPublicGroup` = 10,
  >10 dijelaskan & diarahkan ke admin; (4) gift voucher: `spa.gift_orders` → invoice Xendit `spa-gv-` →
  gift card `source_type = xendit_invoice` di outlet pilihan → kode via outbox `spa.gift_order.paid`
  (sekali, `wa_notif_log`) atau "sudah bayar"; halaman `/booking/spa/gift/<token>`; tanpa pembayaran
  online bot menjawab beli di kasir/admin; (5) `spa.outlets.last_order_time`: slot & booking/reschedule
  publik ditolak setelahnya, ditampilkan di menu outlet, jam buka & daftar jam; (6) daftar jam memuat
  terapis kosong per gender; (7) sapaan & menu bahasa menyebut "balasan otomatis (bot), bukan admin";
  (8) jam admin live dari `cs_business_hours_start/end` di sapaan/handover/"tidak paham"; handover di luar
  jam memberi tahu admin membalas di jam kerja berikutnya. Migrasi: `20261020090000_spa_outlet_description_last_order.sql`,
  `20261020091000_spa_gift_orders.sql` (juga memperluas `gift_card_ledger.context_type`). Bukti:
  `revisi_integration_test.go` (6 tes, gift butuh `XENDIT_MOCK=1`), `domain/revisi_test.go`, seluruh tes
  wabot/giftcards/app hijau; kegagalan `TestCustomerReportUsesPaidPOSOrdersAndWIB` sudah ada sebelumnya.
