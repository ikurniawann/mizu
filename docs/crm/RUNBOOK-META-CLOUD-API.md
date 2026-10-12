# Runbook — WhatsApp Meta Cloud API (jalur resmi) untuk bot booking Mizu

EPIC-053 Fase 4. Gateway Baileys (`services/wa-gateway`) tetap bisa dipakai;
Meta Cloud API adalah jalur resmi tanpa risiko nomor diblokir, dengan tombol /
daftar interaktif dan template untuk pesan di luar jendela 24 jam.

## Yang harus disiapkan pemilik (sekali)

1. **Akun Meta Business** + aplikasi di <https://developers.facebook.com>
   (tipe *Business*, produk *WhatsApp*).
2. **WhatsApp Business Account (WABA)** dan **nomor telepon** yang didaftarkan
   ke WABA. Nomor ini **tidak boleh** sedang dipakai di aplikasi WhatsApp /
   WhatsApp Business biasa (hapus akun di HP dulu, atau pakai nomor baru).
   Untuk uji coba, Meta menyediakan **nomor tes** gratis (maks. 5 penerima
   yang didaftarkan).
3. **Verifikasi bisnis** (dokumen legal) bila ingin lepas dari batas awal
   (nama tampilan & kuota percakapan) — biasanya beberapa hari–minggu.
4. **Access token permanen**: buat *System User* di Business Settings, beri
   akses ke aplikasi & WABA, generate token dengan izin
   `whatsapp_business_messaging` dan `whatsapp_business_management`.
5. **Template pesan** (Business Manager → WhatsApp Manager → Message
   templates), kategori *Utility*, bahasa `id`, dengan parameter berurutan:
   - `spa_reminder` (pengingat kunjungan):
     `{{1}}` nama, `{{2}}` kode booking, `{{3}}` outlet, `{{4}}` jadwal,
     `{{5}}` treatment, `{{6}}` link status.
     Contoh isi: *"Halo {{1}}, pengingat booking {{2}} di {{3}} pada {{4}}
     ({{5}}). Status & QR: {{6}}"*
   - `spa_paid` (konfirmasi lunas): `{{1}}` nama, `{{2}}` kode, `{{3}}`
     outlet, `{{4}}` jadwal, `{{5}}` total, `{{6}}` link status.

## Konfigurasi di Mizu

Login sebagai Super Admin → **Settings → WhatsApp Gateway → Meta Cloud API**:

| Isian | Dari mana |
|---|---|
| Phone Number ID | Developers → WhatsApp → API Setup |
| Access token | token System User (permanen) |
| Verify token | bebas (mis. hasil `openssl rand -hex 16`), dipakai saat mendaftarkan webhook |
| App secret | Developers → App settings → Basic |
| Template pengingat / lunas | nama template yang sudah *Approved* |
| Provider pengiriman | `meta` setelah terhubung (atau *Otomatis*) |

Nilai disimpan di `configuration.app_settings` (`meta_wa_*`, `whatsapp_provider`);
env `META_WA_ACCESS_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_VERIFY_TOKEN`,
`META_WA_APP_SECRET`, `WHATSAPP_PROVIDER` tetap berlaku sebagai cadangan.

## Webhook

Developers → WhatsApp → Configuration → Webhook:

- Callback URL: `https://mizu.reddie.id/api/wa/meta`
- Verify token: sama dengan isian di Mizu
- Subscribe field: **messages**

Mizu menjawab `hub.challenge` (GET) dan memverifikasi `X-Hub-Signature-256`
(POST, HMAC app secret). Pesan teks, balasan tombol/daftar (`id` `k:<nomor>` →
dibaca bot sebagai angka menu), dan media masuk ke Inbox + bot seperti
pesan dari gateway. Status pengiriman (delivered/read) diabaikan.

## Perilaku bot di Meta

- Menu ≤ 3 pilihan pendek → **tombol**; ≤ 10 pilihan → **daftar** (judul
  baris ≤ 24 karakter, deskripsi berisi label lengkap); > 10 → teks bernomor.
- Konfirmasi lunas & pengingat: teks biasa bila customer mengirim pesan dalam
  24 jam terakhir; di luar itu memakai template (bila nama template kosong,
  notifikasi dilewati dan dicatat *gagal* dengan alasan).
- Percakapan yang dimulai customer gratis dalam jendela 24 jam; pesan
  template berbayar per percakapan (lihat tarif Meta).

## Pindah antar provider

Ubah *Provider pengiriman* di halaman yang sama; tidak perlu deploy ulang.
Keduanya dapat dikonfigurasi bersamaan; hanya satu yang mengirim.
