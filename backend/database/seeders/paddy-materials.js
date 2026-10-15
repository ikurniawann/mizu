#!/usr/bin/env node
/**
 * Seeder demo BAHAN BAKU, WIP (barang setengah jadi), BOM, stok, dan PRODUKSI Paddy.
 *
 * Paddy mencetak case HP sendiri (printer UV di workshop toko PVJ) dan menjalankan layanan
 * Paddy Experience "Custom Case" di kedua toko. Data di lib/paddy-materials-data.js:
 *   - item.units / item.raw_material_categories    satuan & 9 kategori bahan (Blank Case, Tinta UV, …, WIP)
 *   - item.raw_materials 'PURCHASED'               78 bahan baku (RM-PDY-…): blank case per keluarga
 *       model, tinta UV, stiker & dekor, beads/charm, bahan tas, kemasan, bahan penolong
 *   - item.raw_materials 'WIP'                     11 barang setengah jadi (WIP-PDY-…)
 *   - item.raw_material_unit_conversions           satuan dasar + satuan beli supplier (botol, pack, roll…)
 *   - purchasing.supplier_price_lists              harga & supplier utama (supplier purchasing-paddy-suppliers)
 *   - manufacturing.raw_material_bom_items         resep WIP
 *   - manufacturing.bom_items                      BOM 42 produk katalog × 2 toko + layanan Custom Case
 *   - inventory.inventory (+ inventory_movements)  stok per gudang: saldo awal, pemakaian & hasil produksi
 *   - manufacturing.production_orders (+ materials, batches)  15 order PROD-PDY-… (selesai, berjalan,
 *       dirilis, draft, batal); order produk selesai menulis kartu stok produk jadi
 *   - item.products.harga_modal (+ pos_products.cost_price, finished_goods_inventory.unit_cost)
 *       disamakan dengan HPP resep untuk produk yang punya BOM
 *
 * Satuan: stok & HPP aplikasi memakai satuan dasar bahan (lihat catatan di lib). Satuan dasar
 * dicatat sebagai satuan_besar (konversi 1); satuan beli ada di konversi satuan.
 *
 * Idempoten: bahan di-upsert per kode; resep, konversi, daftar harga, dan baris BOM yang
 * memakai bahan seeder ditulis ulang; pergerakan stok seeder (created_by = SEED_ACTOR) dan
 * order PROD-PDY-… dihapus lalu dibuat ulang, saldo inventory bahan seeder di-set ulang.
 * Bahan, BOM, stok, dan order lain tidak disentuh.
 *
 * Prasyarat: paddy-spa (toko + stall), paddy-products (katalog), paddy-stall-purchasing
 * (gudang GDG-*), purchasing-paddy-suppliers, accounting-paddy-coa.
 *
 * Usage:
 *   pnpm db:seed:paddy-materials
 *   node seeders/paddy-materials.js --allow-remote   untuk target non-lokal
 */
"use strict";

const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { assertLocalOrAllowed } = require("./lib/seed-password");
const S = require("./lib/paddy-spa-data");
const M = require("./lib/paddy-materials-data");

const DAY = 24 * 3600 * 1000;

/** Hash stabil — variasi stok sama persis tiap dijalankan. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Timestamp WIB `daysAgo` hari lalu pada jam "HH:MM". */
function at(daysAgo, hhmm) {
  const wib = new Date(Date.now() + 7 * 3600 * 1000 - daysAgo * DAY);
  const ymd = wib.toISOString().slice(0, 10);
  return `${ymd}T${hhmm}:00+07:00`;
}

/** Pembulatan ke atas sesuai satuan dasar. */
function roundUp(qty, unit) {
  const step = unit === "ML" || unit === "GR" ? 10 : unit === "M" ? 0.5 : 1;
  return r3(Math.ceil(qty / step - 1e-9) * step);
}

/** Pembulatan qty stok sesuai satuan dasar. */
function roundQty(qty, unit) {
  if (unit === "ML" || unit === "GR") return Math.round(qty / 10) * 10;
  if (unit === "M") return Math.round(qty * 2) / 2;
  return Math.round(qty);
}

async function loadScope(c) {
  const { rows } = await c.query(
    `SELECT b.id AS branch_id, b.code, b.company_id, so.warehouse_id
       FROM configuration.branches b
       JOIN configuration.companies co ON co.id = b.company_id
       JOIN spa.outlets so ON so.branch_id = b.id
      WHERE co.code = $1 AND b.code = ANY($2) AND b.is_active`,
    [S.COMPANY.code, S.OUTLETS.map((o) => o.code)]);
  const pvj = rows.find((r) => r.code === "PD-PVJ");
  const kopo = rows.find((r) => r.code === "PD-KOPO");
  if (!pvj || !kopo) throw new Error("Toko Paddy belum lengkap — jalankan seeders/paddy-spa.js dulu");
  const gdg = async (branchId, code, fallback) => {
    const r = await c.query(`SELECT id FROM configuration.warehouses WHERE branch_id = $1 AND upper(code) = $2 AND is_active LIMIT 1`,
      [branchId, code]);
    if (!r.rowCount) console.warn(`  ! gudang ${code} tidak ada — stok dialihkan ke stall default toko (jalankan paddy-stall-purchasing)`);
    return r.rows[0]?.id || fallback;
  };
  const warehouses = {
    MAIN_PVJ: { id: pvj.warehouse_id, branch: pvj.branch_id },
    GDG_PVJ: { id: await gdg(pvj.branch_id, "GDG-PVJ", pvj.warehouse_id), branch: pvj.branch_id },
    MAIN_KOPO: { id: kopo.warehouse_id, branch: kopo.branch_id },
    GDG_KOPO: { id: await gdg(kopo.branch_id, "GDG-KOPO", kopo.warehouse_id), branch: kopo.branch_id },
  };
  return { companyId: pvj.company_id, pvj, kopo, warehouses };
}

async function ensureUnits(c, companyId) {
  for (const [kode, nama, tipe, deskripsi] of M.UNITS) {
    await c.query(
      `INSERT INTO item.units (kode, nama, tipe, deskripsi, company_id, is_active) VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (company_id, kode) WHERE deleted_at IS NULL AND company_id IS NOT NULL DO NOTHING`,
      [kode, nama, tipe, deskripsi, companyId]);
  }
  const { rows } = await c.query(`SELECT id, upper(kode) AS kode FROM item.units WHERE company_id = $1 AND deleted_at IS NULL`, [companyId]);
  const map = new Map(rows.map((r) => [r.kode, r.id]));
  return (kode) => {
    const id = map.get(kode);
    if (!id) throw new Error(`Satuan ${kode} tidak ditemukan`);
    return id;
  };
}

const UPSERT_MATERIAL_SQL = `
  INSERT INTO item.raw_materials
    (kode, nama, kategori, deskripsi, satuan_besar_id, satuan_kecil_id, konversi_factor, stok_minimum, stok_maximum,
     shelf_life_days, storage_condition, harga_beli, material_type, coa, coa_asset, coa_production,
     company_id, branch_id, is_active)
  VALUES ($1, $2, $3, $4, $5, NULL, 1, $6, $7, $8, $9, $10, $11, 'PRODUCTION', $12, $13, $14, $15, true)
  ON CONFLICT (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
               COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), kode) WHERE deleted_at IS NULL
  DO UPDATE SET nama = EXCLUDED.nama, kategori = EXCLUDED.kategori, deskripsi = EXCLUDED.deskripsi,
    satuan_besar_id = EXCLUDED.satuan_besar_id, satuan_kecil_id = NULL, konversi_factor = 1,
    stok_minimum = EXCLUDED.stok_minimum, stok_maximum = EXCLUDED.stok_maximum, shelf_life_days = EXCLUDED.shelf_life_days,
    storage_condition = EXCLUDED.storage_condition, harga_beli = EXCLUDED.harga_beli, material_type = EXCLUDED.material_type,
    coa = 'PRODUCTION', coa_asset = EXCLUDED.coa_asset, coa_production = EXCLUDED.coa_production,
    is_active = true, updated_at = NOW()
  RETURNING id`;

/** Biaya standar per satuan dasar: bahan = harga beli / isi; WIP = Σ komponen × (1+waste) + ongkos. */
function standardCosts() {
  const cost = new Map(M.MATERIALS.map((m) => [m[0], m[6] / m[5]]));
  const wipByKode = new Map(M.WIPS.map((w) => [w.kode, w]));
  const resolve = (kode, stack = []) => {
    if (cost.has(kode)) return cost.get(kode);
    const w = wipByKode.get(kode);
    if (!w) throw new Error(`Komponen ${kode} tidak dikenal`);
    if (stack.includes(kode)) throw new Error(`Resep WIP melingkar: ${[...stack, kode].join(" → ")}`);
    const conv = (w.conversion.labor || 0) + (w.conversion.overhead || 0);
    const total = w.lines.reduce((s, [k, q, waste]) => s + q * (1 + waste) * resolve(k, [...stack, kode]), conv);
    cost.set(kode, Math.round(total));
    return cost.get(kode);
  };
  for (const w of M.WIPS) resolve(w.kode);
  return cost;
}

async function upsertMaterials(c, scope, uid, std) {
  const ids = new Map();
  const suppliers = new Map((await c.query(
    `SELECT kode, id FROM purchasing.suppliers WHERE company_id = $1 AND kode LIKE 'SUP-PDY-%' AND deleted_at IS NULL`,
    [scope.companyId])).rows.map((r) => [r.kode, r.id]));
  const coaFor = (kat) => M.COA[kat] || M.COA.default;

  for (const cat of M.CATEGORIES) {
    await c.query(
      `INSERT INTO item.raw_material_categories (code, nama, deskripsi, company_id, is_active) VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (company_id, code) WHERE company_id IS NOT NULL AND deleted_at IS NULL
       DO UPDATE SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, is_active = true, updated_at = NOW()`,
      [cat.code, cat.nama, cat.deskripsi, scope.companyId]);
  }

  let prices = 0;
  for (const [kode, nama, kat, base, buy, isi, harga, min, supplier, shelf, storage, desk] of M.MATERIALS) {
    const coa = coaFor(kat);
    const id = (await c.query(UPSERT_MATERIAL_SQL, [kode, nama, kat, desk, uid(base), min, min * 4, shelf, storage,
      r2(harga / isi), "PURCHASED", coa.asset, coa.production, scope.companyId, scope.pvj.branch_id])).rows[0].id;
    ids.set(kode, id);
    await c.query(`DELETE FROM item.raw_material_unit_conversions WHERE raw_material_id = $1`, [id]);
    await c.query(
      `INSERT INTO item.raw_material_unit_conversions (raw_material_id, satuan_id, qty_in_base_unit, is_base, is_issue_default, is_purchase_default)
       VALUES ($1, $2, 1, true, true, $3)`, [id, uid(base), buy === base]);
    if (buy !== base) {
      await c.query(
        `INSERT INTO item.raw_material_unit_conversions (raw_material_id, satuan_id, qty_in_base_unit, is_base, is_issue_default, is_purchase_default)
         VALUES ($1, $2, $3, false, false, true)`, [id, uid(buy), isi]);
    }
    const supplierId = suppliers.get(supplier);
    if (supplierId) {
      await c.query(
        `INSERT INTO purchasing.supplier_price_lists (supplier_id, bahan_baku_id, harga, satuan_id, minimum_qty, lead_time_days,
           is_preferred, is_active, berlaku_dari, catatan, company_id, branch_id)
         VALUES ($1, $2, $3, $4, 1, $5, true, true, (now() AT TIME ZONE 'Asia/Jakarta')::date - 60, $6, $7, $8)
         ON CONFLICT (supplier_id, bahan_baku_id) DO UPDATE SET harga = EXCLUDED.harga, satuan_id = EXCLUDED.satuan_id,
           lead_time_days = EXCLUDED.lead_time_days, is_preferred = true, is_active = true, deleted_at = NULL,
           catatan = EXCLUDED.catatan, updated_at = NOW()`,
        [supplierId, id, harga, uid(buy), M.SUPPLIER_LEAD[supplier] ?? 3, `Harga per ${buy === base ? base : `${buy} isi ${isi} ${base}`} (demo)`,
          scope.companyId, scope.pvj.branch_id]);
      prices++;
    }
  }
  if (suppliers.size === 0) console.warn("  ! supplier SUP-PDY-* belum ada — daftar harga dilewati (jalankan purchasing-paddy-suppliers)");

  const wipCoa = coaFor("WIP");
  for (const w of M.WIPS) {
    const id = (await c.query(UPSERT_MATERIAL_SQL, [w.kode, w.nama, "WIP", w.deskripsi, uid("PCS"), w.min, w.min * 4, null,
      "SUHU_RUANG", std.get(w.kode), "WIP", wipCoa.asset, wipCoa.production, scope.companyId, scope.pvj.branch_id])).rows[0].id;
    ids.set(w.kode, id);
    await c.query(`DELETE FROM item.raw_material_unit_conversions WHERE raw_material_id = $1`, [id]);
    await c.query(
      `INSERT INTO item.raw_material_unit_conversions (raw_material_id, satuan_id, qty_in_base_unit, is_base, is_issue_default, is_purchase_default)
       VALUES ($1, $2, 1, true, true, false)`, [id, uid("PCS")]);
  }
  return { ids, prices };
}

const DISCRETE = new Set(["PCS", "LBR"]);
const BASE_UNIT = new Map([...M.MATERIALS.map((m) => [m[0], m[3]]), ...M.WIPS.map((w) => [w.kode, "PCS"])]);

async function writeRecipes(c, scope, uid, ids) {
  let wipLines = 0;
  for (const w of M.WIPS) {
    await c.query(`DELETE FROM manufacturing.raw_material_bom_items WHERE output_raw_material_id = $1`, [ids.get(w.kode)]);
    for (const [kode, qty, waste] of w.lines) {
      await c.query(
        `INSERT INTO manufacturing.raw_material_bom_items (output_raw_material_id, component_raw_material_id, qty_required, satuan_id, waste_factor, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`, [ids.get(w.kode), ids.get(kode), qty, uid(BASE_UNIT.get(kode)), waste]);
      wipLines++;
    }
  }

  // Produk katalog (kedua toko) + layanan Custom Case.
  const skus = Object.keys(M.PRODUCT_BOMS);
  const { rows: products } = await c.query(
    `SELECT id, kode, warehouse_id, branch_id FROM item.products
      WHERE company_id = $1 AND kode = ANY($2) AND deleted_at IS NULL`, [scope.companyId, skus]);
  const custom = await c.query(
    `SELECT p.id, p.kode, p.warehouse_id, p.branch_id FROM item.products p
      WHERE p.company_id = $1 AND p.deleted_at IS NULL AND p.kode IN (
        SELECT 'SPA-' || left(upper(replace(v.id::text, '-', '')), 12)
          FROM spa.treatment_variants v JOIN spa.treatments t ON t.id = v.treatment_id WHERE t.code = 'CUSTOM')`,
    [scope.companyId]);
  const missing = skus.filter((k) => !products.some((p) => p.kode === k));
  if (missing.length) throw new Error(`Produk katalog belum ada: ${missing.join(", ")} — jalankan paddy-products dulu`);
  if (!custom.rowCount) console.warn("  ! produk Custom Case (Paddy Experience) belum ada — jalankan paddy-spa dulu");

  const ours = [...ids.values()];
  let lines = 0;
  const targets = [...products.map((p) => ({ ...p, bom: M.PRODUCT_BOMS[p.kode] })),
    ...custom.rows.map((p) => ({ ...p, bom: M.CUSTOM_CASE_BOM }))];
  for (const p of targets) {
    // Hanya baris yang memakai bahan seeder yang ditulis ulang; baris lain (buatan user) dibiarkan.
    await c.query(`DELETE FROM manufacturing.bom_items WHERE product_id = $1 AND raw_material_id = ANY($2::uuid[])`, [p.id, ours]);
    for (const [kode, qty, waste] of p.bom) {
      await c.query(
        `INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required, satuan_id, waste_factor, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`, [p.id, ids.get(kode), qty, uid(BASE_UNIT.get(kode)), waste]);
      lines++;
    }
  }
  return { wipLines, lines, products: targets };
}

/* ── stok & produksi ─────────────────────────────────────────────────── */

async function cleanup(c, ids) {
  const ours = [...ids.values()];
  const orders = await c.query(`SELECT id FROM manufacturing.production_orders WHERE nomor_produksi LIKE $1`, [`${M.ORDER_PREFIX}%`]);
  await c.query(`DELETE FROM inventory.finished_goods_movements WHERE created_by = $1 AND reference_number LIKE $2`,
    [S.SEED_ACTOR, `${M.ORDER_PREFIX}%`]);
  await c.query(`DELETE FROM manufacturing.production_orders WHERE nomor_produksi LIKE $1`, [`${M.ORDER_PREFIX}%`]);
  const seeded = `SELECT id FROM inventory.inventory_movements WHERE created_by = $1 AND raw_material_id = ANY($2::uuid[])`;
  await c.query(`DELETE FROM inventory.stock_batches WHERE source_movement_id IN (${seeded})`, [S.SEED_ACTOR, ours]);
  const mv = await c.query(`DELETE FROM inventory.inventory_movements WHERE created_by = $1 AND raw_material_id = ANY($2::uuid[])`,
    [S.SEED_ACTOR, ours]);
  return { orders: orders.rowCount, movements: mv.rowCount };
}

/** Rencana stok akhir per (bahan, gudang) dalam satuan dasar. */
function finalStock() {
  const plan = new Map(); // kode → { WH: qty }
  for (const [kode, , kat, base, , isi, , min] of M.MATERIALS) {
    let total;
    if (M.STOCK_HABIS.has(kode)) total = 0;
    else if (M.STOCK_MENIPIS.has(kode)) total = min * (0.5 + (hash(kode) % 30) / 100);
    else total = Math.max(min * (2 + (hash(kode) % 20) / 10), isi);
    let splitKey = kat;
    if (kat === "BLANK_CASE" && !kode.startsWith("RM-PDY-BC-TPU")) splitKey = "BLANK_CASE_OTHER";
    if (kat === "KEMASAN" && M.BAG_PACKAGING.has(kode)) splitKey = "KEMASAN_TAS";
    const split = M.SPLIT[splitKey];
    plan.set(kode, Object.fromEntries(Object.entries(split).map(([wh, share]) => [wh, roundQty(total * share, base)])));
  }
  return plan;
}

function orderNumber(o) {
  const d = at(o.days, "08:30");
  return `${M.ORDER_PREFIX}${d.slice(2, 4)}${d.slice(5, 7)}-${String(o.n).padStart(2, "0")}`;
}

async function seedStockAndProduction(c, scope, uid, ids, std, userId) {
  const W = scope.warehouses;
  const productRows = (await c.query(
    `SELECT p.id, p.kode, p.nama, f.id AS fg_id, f.qty_available FROM item.products p
       LEFT JOIN inventory.finished_goods_inventory f ON f.product_id = p.id
      WHERE p.company_id = $1 AND p.warehouse_id = $2 AND p.deleted_at IS NULL`,
    [scope.companyId, W.MAIN_PVJ.id])).rows;
  const productBySku = new Map(productRows.map((p) => [p.kode, p]));

  // Biaya berjalan per bahan (WIP mengikuti HPP produksi terakhir), stok per (bahan, gudang).
  const cost = new Map(std);
  const events = []; // { kode, wh, tipe, qty, cost, at, ref }
  const consumedAt = new Map(); // `${kode}|${wh}` → qty
  const wipBalance = new Map(); // kode → { qty, value }

  for (const [kode, qty] of Object.entries(M.WIP_OPENING)) {
    events.push({ kode, wh: "MAIN_PVJ", tipe: "in", qty, cost: std.get(kode), at: at(30, "09:00"), ref: "opening" });
    wipBalance.set(kode, { qty, value: qty * std.get(kode) });
  }

  const orders = [];
  for (const o of M.PRODUCTION_ORDERS) {
    const isProduct = typeof o.item === "object";
    const wip = isProduct ? null : M.WIPS.find((w) => w.kode === o.item);
    const product = isProduct ? productBySku.get(o.item.sku) : null;
    if (isProduct && !product) throw new Error(`Produk ${o.item.sku} (PVJ) tidak ditemukan`);
    const bom = isProduct ? M.PRODUCT_BOMS[o.item.sku] : wip.lines;
    const nomor = orderNumber(o);
    const created = at(o.days, "08:30");
    const done = at(o.days, "15:30");
    const completed = o.status === "COMPLETED";
    const materials = bom.map(([kode, q, waste]) => {
      const planned = r3(q * (1 + waste) * o.qty);
      // Pemakaian riil barang satuan utuh (pcs, lembar) dibulatkan ke atas saat order selesai.
      const actual = completed && DISCRETE.has(BASE_UNIT.get(kode)) ? Math.ceil(planned - 1e-9) : planned;
      const unit = r2(cost.get(kode));
      return { kode, planned, actual, unit, total: r2(actual * unit) };
    });
    const plannedCost = r2(materials.reduce((s, m) => s + m.planned * m.unit, 0));
    const materialCost = r2(materials.reduce((s, m) => s + m.total, 0));
    const labor = isProduct ? 1000 * o.qty : (wip.conversion.labor || 0) * o.qty;
    const overhead = isProduct ? 0 : (wip.conversion.overhead || 0) * o.qty;
    const hpp = Math.round((materialCost + labor + overhead) / o.qty);
    const order = { ...o, isProduct, wip, product, nomor, created, done, materials, plannedCost, materialCost, labor, overhead, hpp };
    orders.push(order);

    if (!completed) continue;
    for (const m of materials) {
      events.push({ kode: m.kode, wh: o.wh, tipe: "out", qty: m.actual, cost: m.unit, at: done, ref: order, line: m });
      const key = `${m.kode}|${o.wh}`;
      consumedAt.set(key, r3((consumedAt.get(key) || 0) + m.actual));
      const wb = wipBalance.get(m.kode);
      if (wb) {
        if (wb.qty + 1e-9 < m.actual) throw new Error(`Stok ${m.kode} kurang untuk ${nomor}`);
        wb.value -= m.actual * (wb.value / wb.qty);
        wb.qty = r3(wb.qty - m.actual);
      } else if (M.WIPS.some((w) => w.kode === m.kode)) {
        throw new Error(`${nomor} memakai ${m.kode} sebelum WIP itu diproduksi`);
      }
    }
    if (!isProduct) {
      const outAt = at(o.days, "15:31");
      events.push({ kode: wip.kode, wh: "MAIN_PVJ", tipe: "in", qty: o.qty, cost: hpp, at: outAt, ref: order, output: true });
      const wb = wipBalance.get(wip.kode) || { qty: 0, value: 0 };
      wb.qty += o.qty;
      wb.value += o.qty * hpp;
      wipBalance.set(wip.kode, wb);
      cost.set(wip.kode, Math.round(wb.value / wb.qty));
    }
  }

  // Saldo awal bahan baku = stok akhir rencana + total pemakaian di gudang itu.
  const plan = finalStock();
  const rows = new Map(); // `${kode}|${wh}` → { kode, wh, final }
  let rakIdx = 0;
  for (const [kode, perWh] of plan) {
    const whs = new Set([...Object.keys(perWh), ...[...consumedAt.keys()].filter((k) => k.startsWith(`${kode}|`)).map((k) => k.split("|")[1])]);
    for (const wh of whs) {
      const used = consumedAt.get(`${kode}|${wh}`) || 0;
      // Saldo awal dibulatkan ke atas (ml/gr per 10, meter per 0,5) supaya terbaca seperti hasil opname.
      const opening = roundUp((perWh[wh] || 0) + used, BASE_UNIT.get(kode));
      const final = r3(opening - used);
      if (opening <= 0) continue;
      rows.set(`${kode}|${wh}`, { kode, wh, final, rak: M.RAK[wh](rakIdx++) });
      events.push({ kode, wh, tipe: "in", qty: opening, cost: std.get(kode), at: at(30, "09:00"), ref: "opening" });
    }
  }
  for (const w of M.WIPS) {
    const wb = wipBalance.get(w.kode);
    if (wb) rows.set(`${w.kode}|MAIN_PVJ`, { kode: w.kode, wh: "MAIN_PVJ", final: r3(wb.qty), rak: "Rak WIP Workshop", wipCost: Math.round(wb.value / (wb.qty || 1)) });
  }

  // Order produksi (sebelum pergerakan, supaya reference_id terisi).
  for (const o of orders) {
    const status = o.status;
    const started = ["IN_PROGRESS", "COMPLETED"].includes(status) ? at(o.days, "09:00") : null;
    const completed = status === "COMPLETED";
    const res = await c.query(
      `INSERT INTO manufacturing.production_orders (nomor_produksi, product_id, output_raw_material_id, production_context, output_type,
         planned_qty, actual_qty, status, planned_material_cost, actual_material_cost, overhead_cost, labor_cost, packaging_cost, waste_cost,
         hpp_per_unit, catatan, started_at, completed_at, cancelled_at, created_by, updated_by, created_at, updated_at, company_id, branch_id)
       VALUES ($1, $2, $3, $4, 'FINISHED_GOOD', $5, $6, $7, $8, $9, $10, $11, 0, 0, $12, $13, $14, $15, $16, $17, $17, $18, $19, $20, $21)
       RETURNING id`,
      [o.nomor, o.isProduct ? o.product.id : null, o.isProduct ? null : ids.get(o.wip.kode), o.isProduct ? "product" : "raw_material",
        o.qty, completed ? o.qty : 0, status, o.plannedCost, completed ? o.materialCost : 0, o.overhead, o.labor, o.hpp, o.catatan,
        started, completed ? o.done : null, status === "CANCELLED" ? at(o.days, "11:00") : null, userId, o.created,
        completed ? o.done : status === "CANCELLED" ? at(o.days, "11:00") : started || o.created, scope.companyId, scope.pvj.branch_id]);
    o.id = res.rows[0].id;
    for (const m of o.materials) {
      const r = await c.query(
        `INSERT INTO manufacturing.production_order_materials (production_order_id, raw_material_id, satuan_id, qty_planned, qty_actual,
           waste_qty, unit_cost, total_cost, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $8) RETURNING id`,
        [o.id, ids.get(m.kode), uid(BASE_UNIT.get(m.kode)), m.planned, m.actual, m.unit, m.total, o.created]);
      m.id = r.rows[0].id;
    }
    if (completed) {
      await c.query(
        `INSERT INTO manufacturing.production_batches (production_order_id, product_id, output_raw_material_id, batch_number, qty_produced,
           hpp_per_unit, total_cost, status, created_by, created_at, output_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'AVAILABLE', $8, $9, 'FINISHED_GOOD')`,
        [o.id, o.isProduct ? o.product.id : null, o.isProduct ? null : ids.get(o.wip.kode), `${o.nomor}-B01`, o.qty, o.hpp,
          r2(o.hpp * o.qty), userId, o.done]);
    }
  }

  // Saldo inventory: buat/ubah baris lalu tulis pergerakan berurutan waktu (trigger batch FIFO).
  const invId = new Map();
  for (const [key, row] of rows) {
    const wh = W[row.wh];
    const isWip = row.kode.startsWith("WIP-");
    const min = isWip ? M.WIPS.find((w) => w.kode === row.kode).min : M.MATERIALS.find((m) => m[0] === row.kode)[7];
    const unitCost = isWip ? row.wipCost : std.get(row.kode);
    const r = await c.query(
      `INSERT INTO inventory.inventory (raw_material_id, qty_available, qty_on_order, qty_minimum, qty_maximum, unit_cost, lokasi_rak,
         last_movement_at, is_active, branch_id, warehouse_id, created_by)
       VALUES ($1, $2, 0, $3, $4, $5, $6, NULL, true, $7, $8, $9)
       ON CONFLICT (raw_material_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET qty_available = EXCLUDED.qty_available, qty_minimum = EXCLUDED.qty_minimum, qty_maximum = EXCLUDED.qty_maximum,
         unit_cost = EXCLUDED.unit_cost, lokasi_rak = EXCLUDED.lokasi_rak, is_active = true, updated_at = NOW()
       RETURNING id`,
      [ids.get(row.kode), row.final, min, min * 4, unitCost, row.rak, wh.branch, wh.id, S.SEED_ACTOR]);
    invId.set(key, r.rows[0].id);
  }

  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.tipe === "in" ? -1 : 1) - (b.tipe === "in" ? -1 : 1)));
  const balance = new Map();
  const last = new Map();
  let movements = 0;
  for (const e of events) {
    const key = `${e.kode}|${e.wh}`;
    const inv = invId.get(key);
    if (!inv) throw new Error(`Baris inventory ${key} tidak ada`);
    const before = balance.get(key) || 0;
    const after = r3(before + (e.tipe === "in" ? e.qty : -e.qty));
    if (after < -1e-9) throw new Error(`Stok ${key} negatif`);
    balance.set(key, after);
    last.set(key, e.at);
    const wh = W[e.wh];
    const order = typeof e.ref === "object" ? e.ref : null;
    const [refType, refNo, alasan] = !order
      ? ["import", `${M.OPENING_REF}-${e.wh.replace("_", "-")}`, "Saldo awal stok (stock opname awal periode)"]
      : e.output
        ? ["production_wip", order.nomor, `Output WIP dari produksi ${order.nomor}`]
        : ["production", order.nomor, `Pemakaian bahan untuk produksi ${order.nomor}`];
    const mv = await c.query(
      `INSERT INTO inventory.inventory_movements (inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
         reference_type, reference_id, reference_number, alasan, is_active, branch_id, warehouse_id, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $14, $15, $16, $16) RETURNING id`,
      [inv, ids.get(e.kode), e.tipe, e.qty, before, after, r2(e.cost), r2(e.qty * e.cost), refType, order ? order.id : null, refNo,
        alasan, wh.branch, wh.id, S.SEED_ACTOR, e.at]);
    if (e.line) await c.query(`UPDATE manufacturing.production_order_materials SET inventory_movement_id = $1 WHERE id = $2`, [mv.rows[0].id, e.line.id]);
    movements++;
  }
  for (const [key, row] of rows) {
    const bal = balance.get(key) || 0;
    if (Math.abs(bal - row.final) > 0.001) throw new Error(`Saldo ${key} ${bal} ≠ rencana ${row.final}`);
    await c.query(`UPDATE inventory.inventory SET last_movement_at = $2 WHERE id = $1`, [invId.get(key), last.get(key) || null]);
  }

  // Kartu stok produk jadi untuk order produk yang selesai (stok produk sudah termasuk hasil ini).
  let fgMoves = 0;
  for (const o of orders.filter((x) => x.isProduct && x.status === "COMPLETED")) {
    const p = o.product;
    const qtyNow = Number(p.qty_available || 0);
    if (!p.fg_id || qtyNow < o.qty) {
      console.warn(`  ! stok produk ${p.kode} (${qtyNow}) < hasil ${o.nomor} (${o.qty}) — kartu stok produk dilewati`);
      continue;
    }
    await c.query(
      `INSERT INTO inventory.finished_goods_movements (inventory_id, product_id, warehouse_id, branch_id, tipe, jumlah, qty_before, qty_after,
         unit_cost, total_cost, reference_type, reference_id, reference_number, alasan, is_active, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'in', $5, $6, $7, $8, $9, 'production_order', $10, $11, $12, true, $13, $14, $14)`,
      [p.fg_id, p.id, W.MAIN_PVJ.id, scope.pvj.branch_id, o.qty, qtyNow - o.qty, qtyNow, o.hpp, r2(o.hpp * o.qty), o.id, o.nomor,
        `Hasil produksi ${o.nomor}`, S.SEED_ACTOR, at(o.days, "15:31")]);
    fgMoves++;
  }
  return { rows: rows.size, movements, orders, fgMoves };
}

/** harga_modal (+ cost POS & produk jadi) produk ber-BOM = HPP resep (v_products_cogs). */
async function syncHpp(c, products) {
  const ids = products.map((p) => p.id);
  const { rows } = await c.query(`SELECT id, round(estimated_cogs)::numeric AS hpp FROM v_products_cogs WHERE id = ANY($1::uuid[])`, [ids]);
  for (const r of rows) {
    await c.query(`UPDATE item.products SET harga_modal = $2, updated_at = NOW() WHERE id = $1`, [r.id, r.hpp]);
    await c.query(`UPDATE pos.pos_products SET cost_price = $2, updated_at = NOW() WHERE source_product_id = $1`, [r.id, r.hpp]);
    await c.query(`UPDATE inventory.finished_goods_inventory SET unit_cost = $2, updated_at = NOW() WHERE product_id = $1`, [r.id, r.hpp]);
  }
  return rows.length;
}

async function main() {
  S.loadEnv();
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
    await c.query("SET LOCAL TIME ZONE 'Asia/Jakarta'");
    const scope = await loadScope(c);
    const uid = await ensureUnits(c, scope.companyId);
    const std = standardCosts();
    const { ids, prices } = await upsertMaterials(c, scope, uid, std);
    const recipes = await writeRecipes(c, scope, uid, ids);
    const old = await cleanup(c, ids);
    const user = await c.query(`SELECT id FROM auth.users WHERE lower(email) = 'gudang.pvj@paddy.id' LIMIT 1`);
    const stock = await seedStockAndProduction(c, scope, uid, ids, std, user.rows[0]?.id || null);
    const synced = await syncHpp(c, recipes.products);

    const check = await c.query(
      `SELECT material_type, status_stok, count(*)::int AS n FROM v_raw_materials_stock
        WHERE company_id = $1 AND (kode LIKE 'RM-PDY-%' OR kode LIKE 'WIP-PDY-%') GROUP BY 1, 2 ORDER BY 1, 2`, [scope.companyId]);
    const value = await c.query(
      `SELECT COALESCE(sum(total_value), 0)::numeric(15,0) AS v FROM v_raw_materials_stock
        WHERE company_id = $1 AND (kode LIKE 'RM-PDY-%' OR kode LIKE 'WIP-PDY-%')`, [scope.companyId]);
    await c.query("COMMIT");

    const byStatus = (o) => stock.orders.filter((x) => x.status === o).length;
    console.log("bahan baku        :", M.MATERIALS.length, `(${M.CATEGORIES.length - 1} kategori + kategori WIP)`);
    console.log("WIP               :", M.WIPS.length, `(${recipes.wipLines} baris resep WIP)`);
    console.log("daftar harga      :", prices, "bahan × supplier utama");
    console.log("BOM produk        :", recipes.products.length, "produk,", recipes.lines, "baris");
    console.log("stok              :", stock.rows, "baris inventory,", stock.movements, "pergerakan",
      `(lama dihapus: ${old.movements} pergerakan, ${old.orders} order)`);
    console.log("status stok       :", check.rows.map((r) => `${r.material_type}/${r.status_stok} ${r.n}`).join(", "));
    console.log("nilai persediaan  : Rp", Number(value.rows[0].v).toLocaleString("id-ID"));
    console.log("order produksi    :", stock.orders.length, ["COMPLETED", "IN_PROGRESS", "RELEASED", "DRAFT", "CANCELLED"]
      .map((s) => `${s} ${byStatus(s)}`).join(", "), `| kartu stok produk jadi: ${stock.fgMoves}`);
    console.log("HPP disinkron     :", synced, "produk (harga_modal = HPP resep)");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
