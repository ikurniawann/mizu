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
- [ ] T-539 Booking grup (setelah fitur grup di-commit), alternatif jam/outlet/hari, daftar tunggu.

### Fase 4 — Meta Cloud API
- [ ] T-540 Tombol/list interaktif, template pesan, pengingat H-1, jendela 24 jam.

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

