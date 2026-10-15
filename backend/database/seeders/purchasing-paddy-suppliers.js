#!/usr/bin/env node
/**
 * Seeder: master supplier purchasing Paddy (scope PADDY / PADDY-RETAIL / toko utama).
 *
 * Padanan purchasing-mizu-suppliers.js untuk tenant Paddy. Versi Mizu membaca
 * vendor F&B dari sheet Market List; Paddy adalah brand retail (case HP &
 * adorable goods), jadi daftar supplier ditulis di sini: blank case, tinta UV,
 * smartwatch, tas, knitwear, kemasan, parfum, beads & charm untuk workshop.
 * Nama, PIC, dan nomor telepon FIKTIF (data demo).
 *
 * Idempoten: upsert per (company, branch, kode). Supplier lain di scope yang
 * sama tidak dihapus (berbeda dengan versi Mizu yang me-reset scope).
 *
 * Usage:
 *   pnpm db:seed:purchasing-paddy-suppliers
 *   pnpm db:seed:purchasing-paddy-suppliers -- --dry-run
 *   node seeders/purchasing-paddy-suppliers.js --allow-remote
 */
"use strict";

const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { assertLocalOrAllowed } = require("./lib/seed-password");
const D = require("./lib/paddy-spa-data");

const BRANCH_CODE = process.env.PADDY_SUPPLIER_BRANCH_CODE || D.OUTLETS[0].code;

/** [kode, nama, pic, telepon, kota, kategori, catatan, termin] */
const SUPPLIERS = [
  ["SUP-PDY-001", "PT Sinar Aksesoris Gadget", "Hendra Wijaya", "081122334455", "Jakarta Utara", "BARANG_DAGANG", "Importir case HP polos & blank case untuk UV print", "TOP30"],
  ["SUP-PDY-002", "CV Tekno Wearable Indonesia", "Andi Prakoso", "081233445566", "Jakarta Barat", "BARANG_DAGANG", "Distributor smartwatch & strap OEM untuk Paddy Watch", "TOP30"],
  ["SUP-PDY-003", "CV Kulit Garut Mandiri", "Dewi Puspita", "081344556677", "Garut", "BARANG_DAGANG", "Produsen tas kulit & backpack, maklon merek Paddy", "TOP14"],
  ["SUP-PDY-004", "Rajut Craft Bandung", "Siti Aminah", "081455667788", "Bandung", "BARANG_DAGANG", "Knitwear & knitted bag handmade", "TOP14"],
  ["SUP-PDY-005", "PT Warna Digital UV", "Rahmat Iskandar", "081566778899", "Tangerang", "BAHAN_BAKU", "Tinta UV LED, varnish, primer, sparepart printer UV untuk custom case", "TOP30"],
  ["SUP-PDY-006", "CV Kemasan Prima", "Lina Mardiana", "081677889900", "Bandung", "KEMASAN", "Box bermerek, poly mailer, paper bag, gift box & pita", "TOP30"],
  ["SUP-PDY-007", "PT Aroma Nusantara Lab", "Yuliani Sari", "081788990011", "Bogor", "BARANG_DAGANG", "Maklon body mist Paddy Parfume", "TOP30"],
  ["SUP-PDY-008", "Toko Manik Pasar Baru", "Ratna Sari", "081899001122", "Bandung", "BAHAN_BAKU", "Beads, charm, mutiara, tali strap untuk Charm & Beads Strap Workshop", "COD"],
  ["SUP-PDY-009", "CV Kanvas Tekstil Cigondewah", "Ujang Sopandi", "081900112233", "Bandung", "BAHAN_BAKU", "Tote bag kanvas polos, cat tekstil, patch & benang bordir", "TOP14"],
];

async function main() {
  D.loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL");
    process.exit(1);
  }
  assertLocalOrAllowed(url);
  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    const { rows } = await c.query(
      `SELECT c.id AS company_id, b.id AS branch_id, c.name AS company_name, b.name AS branch_name
         FROM configuration.companies c
         JOIN configuration.branches b ON b.company_id = c.id AND b.code = $2
        WHERE c.code = $1`, [D.COMPANY.code, BRANCH_CODE]);
    if (!rows[0]) throw new Error(`Scope ${D.COMPANY.code}/${BRANCH_CODE} tidak ditemukan — jalankan pnpm db:seed:paddy-spa dulu`);
    const scope = rows[0];
    console.log(`Scope: ${scope.company_name} → ${scope.branch_name}`);
    if (dryRun) {
      for (const s of SUPPLIERS) console.log(`  ${s[0]} ${s[1]} [${s[5]}]`);
      console.log("\nDry-run selesai (tidak ada write).");
      return;
    }
    await c.query("BEGIN");
    for (const [kode, nama, pic, phone, kota, kategori, catatan, terms] of SUPPLIERS) {
      await c.query(
        `INSERT INTO purchasing.suppliers (kode, nama_supplier, pic_name, pic_phone, telepon, kota, kategori, catatan,
           payment_terms, currency, status, is_active, company_id, branch_id)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, 'IDR', 'active', true, $9, $10)
         ON CONFLICT (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
                      COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), kode) WHERE deleted_at IS NULL
         DO UPDATE SET nama_supplier = EXCLUDED.nama_supplier, pic_name = EXCLUDED.pic_name, pic_phone = EXCLUDED.pic_phone,
           telepon = EXCLUDED.telepon, kota = EXCLUDED.kota, kategori = EXCLUDED.kategori, catatan = EXCLUDED.catatan,
           payment_terms = EXCLUDED.payment_terms, is_active = true, updated_at = NOW()`,
        [kode, nama, pic, phone, kota, kategori, catatan, terms, scope.company_id, scope.branch_id]);
      console.log(`  ✓ ${kode} ${nama}`);
    }
    await c.query("COMMIT");
    console.log(`\nSelesai. Supplier Paddy: ${SUPPLIERS.length}`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
