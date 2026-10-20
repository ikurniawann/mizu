#!/usr/bin/env node
/**
 * Seeder produk PARKIR Mizu (revisi R7, 13 Okt 2026) — parkir dibayar lewat POS
 * sebagai transaksi terpisah atau item tambahan di bill treatment Spa.
 *
 * Mengisi (idempoten, satu transaksi):
 *   - pos.pos_categories "Parkir"
 *   - item.products + pos.pos_products per outlet spa aktif: Valet Mobil, Parkir Mobil, Parkir Motor
 *     (harga awal di bawah = angka sementara; ubah lewat Master Data → Produk / POS → Produk)
 *
 * Usage:
 *   pnpm db:seed:mizu-parkir
 *   node seeders/mizu-parkir.js --allow-remote   untuk target non-lokal (mis. container docker lain)
 */
"use strict";

const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { assertLocalOrAllowed } = require("./lib/seed-password");
const D = require("./lib/mizu-spa-data");

const CATEGORY = "Parkir";
const PRODUCTS = [
  { code: "PARK-VALET", name: "Valet Mobil", price: 25000, description: "Parkir valet mobil" },
  { code: "PARK-MOBIL", name: "Parkir Mobil", price: 10000, description: "Parkir mobil" },
  { code: "PARK-MOTOR", name: "Parkir Motor", price: 5000, description: "Parkir motor" },
];

async function ensureCategory(c) {
  const found = await c.query(`SELECT id FROM pos.pos_categories WHERE lower(name) = lower($1) ORDER BY display_order LIMIT 1`, [CATEGORY]);
  if (found.rowCount) {
    await c.query(`UPDATE pos.pos_categories SET is_active = true, updated_at = NOW() WHERE id = $1`, [found.rows[0].id]);
    return found.rows[0].id;
  }
  const ins = await c.query(`INSERT INTO pos.pos_categories (name, display_order, is_active) VALUES ($1, 91, true) RETURNING id`, [CATEGORY]);
  return ins.rows[0].id;
}

async function activeOutlets(c) {
  const r = await c.query(
    `SELECT b.id AS branch_id, b.company_id, b.code, b.name, o.warehouse_id
       FROM spa.outlets o JOIN configuration.branches b ON b.id = o.branch_id
      WHERE o.is_active AND b.is_active ORDER BY b.code`);
  return r.rows;
}

async function seedProducts(c, categoryId, outlets) {
  let n = 0;
  for (const o of outlets) {
    const branch = String(o.branch_id).replace(/-/g, "").toUpperCase().slice(0, 6);
    for (const p of PRODUCTS) {
      const kode = p.code; // item.products.kode: varchar(20), unik per stall
      const sku = `${p.code}-${branch}`; // pos.pos_products.sku: unik global
      let master = await c.query(`SELECT id FROM item.products WHERE warehouse_id = $1 AND kode = $2 AND deleted_at IS NULL LIMIT 1`,
        [o.warehouse_id, kode]);
      if (master.rowCount) {
        await c.query(`UPDATE item.products SET nama = $2, kategori = $3, station = 'merchandise', is_active = true, updated_at = NOW()
          WHERE id = $1`, [master.rows[0].id, p.name, CATEGORY]);
      } else {
        master = await c.query(
          `INSERT INTO item.products (kode, nama, kategori, harga_jual, harga_modal, markup_persen, company_id, branch_id, warehouse_id,
             station, production_output_type, is_active)
           VALUES ($1, $2, $3, $4, 0, 0, $5, $6, $7, 'merchandise', 'FINISHED_GOOD', true) RETURNING id`,
          [kode, p.name, CATEGORY, p.price, o.company_id, o.branch_id, o.warehouse_id]);
      }
      const masterId = master.rows[0].id;
      const pos = await c.query(`SELECT id FROM pos.pos_products WHERE source_product_id = $1 OR sku = $2
        ORDER BY (source_product_id = $1) DESC NULLS LAST LIMIT 1`, [masterId, sku]);
      if (pos.rowCount) {
        // Harga yang sudah diubah operator dipertahankan; hanya nama/kategori/status yang disegarkan.
        await c.query(`UPDATE pos.pos_products SET name = $2, category_id = $3, is_active = true, is_available = true,
          station = 'merchandise', source_product_id = $4, updated_at = NOW() WHERE id = $1`, [pos.rows[0].id, p.name, categoryId, masterId]);
      } else {
        await c.query(
          `INSERT INTO pos.pos_products (sku, name, description, category_id, base_price, cost_price, is_active, is_available,
             inventory_tracking, station, source_product_id, sales_channels)
           VALUES ($1, $2, $3, $4, $5, 0, true, true, false, 'merchandise', $6, ARRAY['pos'])`,
          [sku, p.name, p.description, categoryId, p.price, masterId]);
      }
      n++;
    }
  }
  return n;
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
    const categoryId = await ensureCategory(c);
    const outlets = await activeOutlets(c);
    const n = await seedProducts(c, categoryId, outlets);
    await c.query("COMMIT");
    console.log("kategori POS     :", CATEGORY);
    console.log("outlet           :", outlets.map((o) => o.name).join(", "));
    console.log("produk parkir    :", n, `(${PRODUCTS.map((p) => `${p.name} Rp${p.price.toLocaleString("id-ID")}`).join(", ")})`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
