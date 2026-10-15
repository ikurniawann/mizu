#!/usr/bin/env node
/**
 * Seeder BRANDING Paddy — mengganti data bermerek lama (Mizu / NüHabit) yang
 * ditanam migrasi, tanpa mengubah file migrasi (checksum diverifikasi).
 *
 * Yang diperbarui (idempoten, satu transaksi). Kode/ID tidak diubah karena
 * dipakai migrasi dan modul Go (mis. company MIZU / cabang MIZU-BANDUNG,
 * role mizu_bandung_demo); hanya nama & teks yang tampil ke pengguna:
 *   - configuration.holdings/companies/branches : Prologe → Mizu → Mizu Bandung (dari migrasi
 *     business_hierarchy) menjadi CV Cipta Kreasi Kreatif → Paddy Kantor Pusat → Paddy HQ Bandung
 *   - item.brands                              : brand cabang lama → "Paddy"; brand cabang Paddy → industri Retail
 *   - crm.crm_settings                         : auto-reply CS, nama & sapaan bot WhatsApp booking
 *   - crm.wa_reply_templates                   : salam pembuka CS
 *   - crm.crm_forms                            : teks formulir publik (NüHabit → Paddy)
 *   - shop.storefronts 'toko'                  : Paddy Official Store
 *   - performance.behavioral_standards         : standar pelayanan
 *   - iam.roles                                : nama role demo/spa
 *   - iam.menus (modul spa)                    : label menu → Paddy Experience (layanan, crew, toko)
 *   - pos.pos_categories                       : "Spa Treatment" → "Paddy Experience"
 *
 * Teks yang sudah diubah admin (tidak lagi memuat merek lama) tidak ditimpa.
 * Jalankan SETELAH seeder IAM (db:seed:iam) karena seeder IAM menulis ulang nama role.
 *
 * Usage:
 *   pnpm db:seed:paddy-branding
 *   node seeders/paddy-branding.js --allow-remote   untuk target non-lokal
 */
"use strict";

const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { assertLocalOrAllowed } = require("./lib/seed-password");
const D = require("./lib/paddy-spa-data");

const OLD_BRAND = "(mizu|n[uü]habit|wonderland|wounderland)";

const SCOPE = {
  holding: { code: "PROLOGE", name: "CV Cipta Kreasi Kreatif" },
  company: { code: "MIZU", name: "Paddy Kantor Pusat" },
  branch: { code: "MIZU-BANDUNG", name: "Paddy HQ Bandung", slug: "paddy-hq-bandung" },
};

const CRM_SETTINGS = {
  cs_auto_reply_text: "Terima kasih sudah menghubungi Paddy! Saat ini di luar jam operasional kami (10.00-22.00 WIB). " +
    "Pesan kamu sudah kami terima dan akan dibalas pada jam operasional berikutnya ya, Paddy Besties 💛",
  bot_name: "Paddy Assistant",
  bot_greeting: "Halo! Saya asisten booking Paddy Experience. Saya bantu pilih toko, layanan, dan jamnya ya 🙏",
};

const MENU_LABELS = {
  spa: "Paddy Experience",
  "ess.spa": "Tugas Experience",
  "spa.categories": "Kategori Layanan",
  "spa.commissions": "Komisi Crew",
  "spa.outlets": "Toko Experience",
  "spa.therapists": "Crew Experience",
  "spa.treatments": "Layanan Experience",
};

const ROLES = {
  spa_frontdesk: ["Front Store Experience", "Front store Paddy: booking layanan experience, penugasan crew, checkout ke kasir"],
  spa_therapist: ["Crew Experience", "Crew Paddy Experience: melihat dan menjalankan tugas layanan sendiri"],
  mizu_bandung_demo: ["Paddy Bandung Demo", "Demo cabang Paddy Bandung: Items, Inventory, POS"],
};

async function run(c) {
  const out = {};
  const count = (k, r) => { out[k] = (out[k] || 0) + r.rowCount; };

  // ── Struktur bisnis lama dari migrasi ─────────────────────────────────────
  count("holding", await c.query(`UPDATE configuration.holdings SET name = $2, updated_at = NOW() WHERE code = $1 AND name <> $2`,
    [SCOPE.holding.code, SCOPE.holding.name]));
  count("company", await c.query(`UPDATE configuration.companies SET name = $2, updated_at = NOW() WHERE code = $1 AND name ~* $3`,
    [SCOPE.company.code, SCOPE.company.name, OLD_BRAND]));
  count("cabang", await c.query(
    `UPDATE configuration.branches b SET name = $3, slug = $4, updated_at = NOW()
       FROM configuration.companies co
      WHERE co.id = b.company_id AND co.code = $1 AND b.code = $2 AND (b.name ~* $5 OR b.slug ~* $5)`,
    [SCOPE.company.code, SCOPE.branch.code, SCOPE.branch.name, SCOPE.branch.slug, OLD_BRAND]));
  count("gudang", await c.query(`UPDATE configuration.warehouses SET name = regexp_replace(name, 'Mizu', 'Paddy', 'gi'), updated_at = NOW()
    WHERE name ~* $1`, [OLD_BRAND]));
  count("brand", await c.query(`UPDATE item.brands SET name = $1, industry = 'Retail', is_active = true WHERE name ~* $2`,
    [D.BRAND.name, OLD_BRAND]));
  // Brand per cabang (dibuat trigger dengan industri F&B): cabang Paddy = Retail.
  count("brand", await c.query(
    `UPDATE item.brands br SET industry = 'Retail'
       FROM configuration.branches b JOIN configuration.companies co ON co.id = b.company_id
      WHERE br.id = b.id AND co.code = ANY($1) AND br.industry IS DISTINCT FROM 'Retail'`,
    [[D.COMPANY.code, SCOPE.company.code]]));

  // ── CRM / WhatsApp ────────────────────────────────────────────────────────
  for (const [key, value] of Object.entries(CRM_SETTINGS)) {
    count("pengaturan CRM", await c.query(
      `UPDATE crm.crm_settings SET value = to_jsonb($2::text), updated_at = NOW() WHERE key = $1 AND value::text ~* $3`, [key, value, OLD_BRAND]));
  }
  count("template WA", await c.query(
    `UPDATE crm.wa_reply_templates SET body = $1, updated_at = NOW() WHERE body ~* $2`,
    ["Halo! Terima kasih sudah menghubungi Paddy 💛 Ada yang bisa kami bantu? Mau tanya produk, custom case, atau booking Paddy Experience?",
      OLD_BRAND]));
  count("formulir publik", await c.query(
    `UPDATE crm.crm_forms SET
       title = regexp_replace(regexp_replace(title, 'a N[uü]Habit', 'a Paddy store', 'gi'), 'N[uü]Habit', 'Paddy', 'gi'),
       description = regexp_replace(regexp_replace(description, 'a N[uü]Habit', 'a Paddy store', 'gi'), 'N[uü]Habit', 'Paddy', 'gi'),
       success_message = regexp_replace(success_message, 'N[uü]Habit', 'Paddy', 'gi'),
       fields = regexp_replace(fields::text, 'N[uü]Habit', 'Paddy', 'gi')::jsonb,
       updated_at = NOW()
     WHERE title ~* $1 OR description ~* $1 OR success_message ~* $1 OR fields::text ~* $1`, [OLD_BRAND]));

  // ── Toko online ───────────────────────────────────────────────────────────
  count("storefront", await c.query(
    `UPDATE shop.storefronts SET name = 'Paddy Official Store',
       description = 'Customized Phone Cases & Adorable Goods dari Bandung — paddy.id', updated_at = NOW()
     WHERE lower(slug) = 'toko' AND (name ~* $1 OR description ~* $1 OR name = 'Online Store')`, [OLD_BRAND]));

  // ── HR / performa ─────────────────────────────────────────────────────────
  count("standar perilaku", await c.query(
    `UPDATE performance.behavioral_standards SET standard_description = regexp_replace(standard_description, 'Mizu', 'Paddy', 'gi')
      WHERE standard_description ~* $1`, [OLD_BRAND]));

  // ── IAM ───────────────────────────────────────────────────────────────────
  for (const [code, [name, description]] of Object.entries(ROLES)) {
    count("role", await c.query(`UPDATE iam.roles SET name = $2, description = $3, updated_at = NOW()
      WHERE code = $1 AND (name <> $2 OR description IS DISTINCT FROM $3)`, [code, name, description]));
  }
  for (const [code, label] of Object.entries(MENU_LABELS)) {
    count("menu", await c.query(`UPDATE iam.menus SET menu_name = $2, updated_at = NOW()
      WHERE code = $1 AND deleted_at IS NULL AND menu_name <> $2`, [code, label]));
  }

  // ── POS ───────────────────────────────────────────────────────────────────
  // Nama lama: "Spa Treatment" (Mizu), lalu "Paddy Studio" (sebelum rename 2026-10-14).
  const studio = await c.query(`SELECT id FROM pos.pos_categories WHERE lower(name) = 'paddy experience' LIMIT 1`);
  if (!studio.rowCount) {
    count("kategori POS", await c.query(`UPDATE pos.pos_categories SET name = 'Paddy Experience', updated_at = NOW()
      WHERE lower(name) IN ('spa treatment', 'paddy studio')`));
  }
  count("kategori produk", await c.query(`UPDATE item.products SET kategori = 'Paddy Experience', updated_at = NOW()
    WHERE kategori IN ('Spa Treatment', 'Paddy Studio')`));
  return out;
}

async function main() {
  D.loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL");
    process.exit(1);
  }
  assertLocalOrAllowed(url);
  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const out = await run(c);
    await c.query("COMMIT");
    console.log("Branding Paddy diterapkan (baris diperbarui):");
    for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(18)}: ${v}`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
