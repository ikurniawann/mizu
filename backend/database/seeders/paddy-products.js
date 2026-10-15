#!/usr/bin/env node
/**
 * Seeder KATALOG RETAIL Paddy (paddy.id) — case HP, Paddy Pods, pop socket,
 * aksesoris, tas, Paddy Watch, strap, apparel, parfum — untuk POS kasir di
 * tiap toko Paddy dan toko online (storefront).
 *
 * Data dari seeders/data/paddy-catalog.json, dibangkitkan dari katalog publik
 * paddy.id (WooCommerce Store API) 2026-10-04: nama, harga jual, dan foto =
 * data paddy.id. HPP, stok awal, dan barcode internal (prefiks GS1 in-store
 * 200/201) = ASUMSI demo. Foto: frontend/public/products/paddy/pdy-*.webp,
 * disimpan sebagai path "/products/paddy/<file>" (pos_products.image_url +
 * pos_product_images).
 *
 * Model merchandise POS (sama dengan fitur yang dipakai produk lain):
 *   - item.units / item.product_categories / item.products  master produk per toko (stall = gudang
 *     default toko dari seeders/paddy-spa.js) — kasir yang terikat stall hanya melihat produk stall-nya
 *   - pos.pos_categories + pos.pos_products                  product_kind 'merchandise', inventory_tracking,
 *     source_product_id → item.products (satu produk POS per produk master)
 *   - pos.pos_product_skus                                   varian (Warna × Tipe HP, dst.) dengan
 *     barcode & stok sendiri; produk tanpa varian diberi satu SKU "Standar" agar bisa di-scan
 *   - pos.pos_inventory_settings, pos.pos_product_images, inventory.finished_goods_inventory
 *   - shop.product_channels 'web'                            produk toko pertama (Paddy Store PVJ)
 *     tampil di toko online; toko lain hanya kanal kasir
 *   - shop.storefronts 'toko'                                nama & deskripsi toko online Paddy
 *
 * SKU POS & barcode unik global: toko pertama memakai SKU/barcode katalog apa
 * adanya; toko berikutnya memakai akhiran "-<KODE TOKO>" dan barcode prefiks 201.
 *
 * Idempoten: upsert per SKU. Prasyarat: seeders/paddy-spa.js (toko + stall).
 *
 * Usage:
 *   pnpm db:seed:paddy-products
 *   node seeders/paddy-products.js --allow-remote   untuk target non-lokal
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { assertLocalOrAllowed } = require("./lib/seed-password");
const D = require("./lib/paddy-spa-data");

const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "paddy-catalog.json"), "utf-8"));
const LOW_STOCK_THRESHOLD = 3;
const STOREFRONT = { slug: "toko", name: "Paddy Official Store", description: "Customized Phone Cases & Adorable Goods dari Bandung — paddy.id" };

/** Hash stabil — stok toko kedua sama persis tiap seeder dijalankan. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** EAN-13 dengan prefiks lain (mis. 201) dan check digit dihitung ulang. */
function ean13WithPrefix(barcode, prefix) {
  if (!barcode || !/^\d{13}$/.test(barcode)) return null;
  const body = (prefix + barcode.slice(prefix.length, 12)).slice(0, 12);
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

async function loadOutlets(c) {
  const { rows } = await c.query(
    `SELECT b.id AS branch_id, b.code, b.name, b.company_id, so.warehouse_id
       FROM configuration.branches b
       JOIN configuration.companies co ON co.id = b.company_id
       JOIN spa.outlets so ON so.branch_id = b.id
      WHERE co.code = $1 AND b.code = ANY($2) AND b.is_active`,
    [D.COMPANY.code, D.OUTLETS.map((o) => o.code)]);
  if (rows.length !== D.OUTLETS.length) throw new Error("Toko Paddy belum lengkap — jalankan seeders/paddy-spa.js dulu");
  // Urutan sama dengan D.OUTLETS: toko pertama = toko utama (SKU katalog + kanal web).
  return D.OUTLETS.map((o, i) => ({ ...rows.find((r) => r.code === o.code), short: o.short, primary: i === 0 }));
}

async function ensurePcs(c, companyId) {
  const found = await c.query(
    `SELECT id FROM item.units WHERE upper(kode) = 'PCS' AND company_id = $1 AND deleted_at IS NULL LIMIT 1`, [companyId]);
  if (found.rowCount) return found.rows[0].id;
  return (await c.query(
    `INSERT INTO item.units (kode, nama, tipe, deskripsi, company_id, is_active)
     VALUES ('PCS', 'Pieces', 'KECIL', 'Satuan barang jadi', $1, true) RETURNING id`, [companyId])).rows[0].id;
}

/** pos_categories tidak punya kunci unik — cocokkan per nama. */
async function upsertPosCategory(c, name, order) {
  const { rows } = await c.query(`SELECT id FROM pos.pos_categories WHERE lower(name) = lower($1) ORDER BY display_order LIMIT 1`, [name]);
  if (rows[0]) {
    await c.query(`UPDATE pos.pos_categories SET name = $2, display_order = $3, is_active = true, updated_at = NOW() WHERE id = $1`,
      [rows[0].id, name, order]);
    return rows[0].id;
  }
  return (await c.query(`INSERT INTO pos.pos_categories (name, display_order, is_active) VALUES ($1, $2, true) RETURNING id`,
    [name, order])).rows[0].id;
}

const UPSERT_ITEM_PRODUCT_SQL = `
  INSERT INTO item.products (kode, nama, deskripsi, kategori, satuan_id, harga_jual, harga_modal, markup_persen, station,
     production_output_type, warehouse_id, company_id, branch_id, is_active)
  VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'merchandise', 'FINISHED_GOOD', $8, $9, $10, true)
  ON CONFLICT (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
               COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), warehouse_id, kode)
    WHERE deleted_at IS NULL
  DO UPDATE SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, kategori = EXCLUDED.kategori,
    satuan_id = EXCLUDED.satuan_id, harga_jual = EXCLUDED.harga_jual, harga_modal = EXCLUDED.harga_modal,
    station = 'merchandise', is_active = true, updated_at = NOW()
  RETURNING id`;

async function upsertPosProduct(c, row) {
  const params = [row.sku, row.name, row.description, row.longDescription, row.categoryId, row.price, row.cost,
    row.stock, LOW_STOCK_THRESHOLD, row.itemId, row.image, row.weight];
  const existing = await c.query(`SELECT id FROM pos.pos_products WHERE source_product_id = $1 OR sku = $2
    ORDER BY (source_product_id = $1) DESC NULLS LAST LIMIT 1`, [row.itemId, row.sku]);
  if (existing.rowCount) {
    await c.query(
      `UPDATE pos.pos_products SET sku = $2, name = $3, description = $4, long_description = $5, category_id = $6, base_price = $7,
         cost_price = $8, inventory_quantity = $9, inventory_min_stock = $10, source_product_id = $11, image_url = $12,
         weight_gram = $13, station = 'merchandise', product_kind = 'merchandise', inventory_tracking = true,
         sales_channels = ARRAY['pos']::text[], is_active = true, is_available = true, updated_at = NOW()
       WHERE id = $1`, [existing.rows[0].id, ...params]);
    return existing.rows[0].id;
  }
  return (await c.query(
    `INSERT INTO pos.pos_products (sku, name, description, long_description, category_id, base_price, cost_price,
       inventory_quantity, inventory_min_stock, source_product_id, image_url, weight_gram, station, product_kind,
       inventory_tracking, sales_channels, is_active, is_available)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'merchandise', 'merchandise', true, ARRAY['pos']::text[], true, true)
     RETURNING id`, params)).rows[0].id;
}

async function upsertSku(c, productId, v) {
  const { rows } = await c.query(`SELECT id FROM pos.pos_product_skus WHERE lower(sku) = lower($1) LIMIT 1`, [v.sku]);
  const params = [productId, v.sku, v.name.slice(0, 120), JSON.stringify(v.options || {}), v.barcode || null, v.stock];
  if (rows[0]) {
    await c.query(
      `UPDATE pos.pos_product_skus SET product_id = $2, sku = $3, name = $4, options = $5::jsonb, barcode = $6,
         stock_quantity = $7, is_active = true, updated_at = NOW() WHERE id = $1`, [rows[0].id, ...params]);
    return rows[0].id;
  }
  return (await c.query(
    `INSERT INTO pos.pos_product_skus (product_id, sku, name, options, barcode, stock_quantity, is_active)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, true) RETURNING id`, params)).rows[0].id;
}

async function ensureStorefront(c) {
  const upd = await c.query(
    `UPDATE shop.storefronts SET name = $2, description = $3, is_active = true, updated_at = NOW()
      WHERE lower(slug) = lower($1)`, [STOREFRONT.slug, STOREFRONT.name, STOREFRONT.description]);
  if (!upd.rowCount) {
    await c.query(`INSERT INTO shop.storefronts (slug, name, description, is_active) VALUES ($1, $2, $3, true)`,
      [STOREFRONT.slug, STOREFRONT.name, STOREFRONT.description]);
  }
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
    const outlets = await loadOutlets(c);
    const companyId = outlets[0].company_id;
    const pcsId = await ensurePcs(c, companyId);

    const posCategory = new Map();
    for (const [i, cat] of CATALOG.categories.entries()) {
      await c.query(
        `INSERT INTO item.product_categories (code, nama, deskripsi, company_id, is_active) VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL AND company_id IS NOT NULL
         DO UPDATE SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, is_active = true, updated_at = NOW()`,
        [cat.code, cat.name, cat.description, companyId]);
      posCategory.set(cat.code, await upsertPosCategory(c, cat.name, 10 + i));
    }
    const catName = new Map(CATALOG.categories.map((cat) => [cat.code, cat.name]));

    let products = 0;
    let skus = 0;
    let web = 0;
    let units = 0;
    for (const o of outlets) {
      for (const p of CATALOG.products) {
        const suffix = o.primary ? "" : `-${o.short}`;
        const baseVariants = p.variants.length
          ? p.variants
          : [{ sku: `${p.sku}-STD`, name: "Standar", options: {}, barcode: p.barcode, stock: p.stock }];
        const variants = baseVariants.map((v) => ({
          sku: `${v.sku}${suffix}`,
          name: v.name,
          options: v.options,
          barcode: o.primary ? v.barcode : ean13WithPrefix(v.barcode, "201"),
          stock: o.primary ? Number(v.stock ?? 10) : hash(`${v.sku}@${o.code}`) % 9,
        }));
        const stock = variants.reduce((s, v) => s + v.stock, 0);

        const itemId = (await c.query(UPSERT_ITEM_PRODUCT_SQL, [p.sku, p.name.slice(0, 255), p.description, catName.get(p.category),
          pcsId, p.price, p.cost, o.warehouse_id, companyId, o.branch_id])).rows[0].id;

        const longDescription = [
          p.description,
          p.compare_at_price ? `Harga normal Rp ${p.compare_at_price.toLocaleString("id-ID")}.` : null,
          p.variants.length ? `Varian: ${[...new Set(p.variants.flatMap((v) => Object.keys(v.options)))].join(", ")}.` : null,
          "Original Paddy — paddy.id",
        ].filter(Boolean).join(" ");
        const posId = await upsertPosProduct(c, {
          sku: `${p.sku}${suffix}`, name: p.name, description: p.description, longDescription,
          categoryId: posCategory.get(p.category), price: p.price, cost: p.cost, stock, itemId,
          image: p.image || null, weight: p.weight_gram ?? null,
        });

        await c.query(
          `INSERT INTO pos.pos_inventory_settings (product_id, allow_negative_stock, low_stock_threshold) VALUES ($1, false, $2)
           ON CONFLICT (product_id) DO UPDATE SET allow_negative_stock = false, low_stock_threshold = EXCLUDED.low_stock_threshold,
             updated_at = NOW()`, [posId, LOW_STOCK_THRESHOLD]);
        await c.query(`DELETE FROM pos.pos_product_images WHERE product_id = $1`, [posId]);
        if (p.image) await c.query(`INSERT INTO pos.pos_product_images (product_id, url, display_order) VALUES ($1, $2, 0)`, [posId, p.image]);

        for (const v of variants) {
          await upsertSku(c, posId, v);
          skus++;
        }
        await c.query(
          `INSERT INTO inventory.finished_goods_inventory (product_id, qty_available, unit_cost, last_movement_at, is_active)
           VALUES ($1, $2, $3, NOW(), true)
           ON CONFLICT (product_id) DO UPDATE SET qty_available = EXCLUDED.qty_available, unit_cost = EXCLUDED.unit_cost,
             last_movement_at = NOW(), is_active = true, updated_at = NOW()`, [itemId, stock, p.cost]);

        // Toko online: produk toko utama didistribusikan ke kanal web (+ kasir); toko lain kasir saja.
        await c.query(
          `INSERT INTO shop.product_channels (product_id, channel_code, is_distributed) VALUES ($1, 'kasir', true)
           ON CONFLICT (product_id, channel_code) DO UPDATE SET is_distributed = true, updated_at = NOW()`, [posId]);
        await c.query(
          `INSERT INTO shop.product_channels (product_id, channel_code, is_distributed) VALUES ($1, 'web', $2)
           ON CONFLICT (product_id, channel_code) DO UPDATE SET is_distributed = EXCLUDED.is_distributed, updated_at = NOW()`,
          [posId, o.primary]);
        if (o.primary) web++;
        products++;
        units += stock;
      }
    }
    await ensureStorefront(c);
    await c.query("COMMIT");
    console.log("toko              :", outlets.map((o) => o.name).join(", "));
    console.log("kategori          :", CATALOG.categories.length);
    console.log("produk POS        :", products, `(${CATALOG.products.length} produk katalog × ${outlets.length} toko)`);
    console.log("SKU/varian        :", skus, "| total stok:", units, "pcs");
    console.log("toko online (web) :", web, "produk di", STOREFRONT.name);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
