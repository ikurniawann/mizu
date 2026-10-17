#!/usr/bin/env node
/**
 * Seeder akun login karyawan hasil import HRIS Odoo — role Karyawan (Area Karyawan / ESS saja).
 *
 * Untuk setiap karyawan AKTIF hasil import (notes "Import Odoo…") yang belum punya akun dan punya email asli:
 *   1. auth.users: email = email karyawan, password acak unik (bcrypt cost 10, sama seperti Manajemen User);
 *   2. configuration.users: peran aplikasi `employee`, cakupan cabang penempatan utama (entitas & holding ikut);
 *   3. iam.user_roles: hanya role IAM `employee` (Karyawan);
 *   4. hris.employees: user_id + is_access_app = true.
 * Karyawan dengan email placeholder (@tanpa-email.invalid) atau email yang sudah dipakai akun lain dilewati
 * dan dilaporkan. Semua dalam satu transaksi; aman dijalankan ulang (yang sudah punya akun dilewati).
 *
 * Usage:
 *   pnpm db:seed:paddy-employee-accounts                    # dry run: hanya menghitung, tidak menulis
 *   pnpm db:seed:paddy-employee-accounts -- --apply --out <file.csv>   # buat akun, tulis kredensial ke CSV
 *   tambahkan --allow-remote untuk target non-lokal
 *
 * File CSV berisi password awal — simpan terbatas (chmod 600) dan hapus setelah dibagikan ke karyawan.
 */

const crypto = require("crypto");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { assertLocalOrAllowed } = require("./lib/seed-password");
const D = require("./lib/paddy-spa-data");

const IMPORT_MARK = "Import Odoo%";
const PLACEHOLDER = "%@tanpa-email.invalid";
// Tanpa karakter yang mirip (0/O, 1/l/I) agar mudah diketik dari kertas/WA.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function randomPassword(length = 10) {
  for (;;) {
    const bytes = crypto.randomBytes(length);
    const pw = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)) return pw;
  }
}

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  D.loadEnv();
  const apply = process.argv.includes("--apply");
  const out = arg("--out");
  if (apply && !out) {
    console.error("ERROR: --apply butuh --out <file.csv> untuk menyimpan kredensial");
    process.exit(1);
  }
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL");
    process.exit(1);
  }
  assertLocalOrAllowed(url);
  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    const role = (await c.query(`SELECT id::text FROM iam.roles WHERE code = 'employee' AND deleted_at IS NULL`)).rows[0];
    if (!role) throw new Error("Role IAM 'employee' (Karyawan) tidak ditemukan — jalankan db:seed:iam dulu");

    const rows = (await c.query(`
      SELECT e.id::text, e.nip, e.full_name, lower(trim(e.email)) AS email,
             pb.branch_id, pb.branch_name, pb.company_id, pb.company_name, pb.holding_id,
             (e.email ILIKE $2) AS placeholder,
             EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(trim(e.email))) AS email_taken
        FROM hris.employees e
        LEFT JOIN LATERAL (
          SELECT b.id::text AS branch_id, b.name AS branch_name, co.id::text AS company_id, co.name AS company_name,
                 co.holding_id::text AS holding_id
            FROM hris.employee_placements p
            JOIN configuration.branches b ON b.id = p.branch_id
            JOIN configuration.companies co ON co.id = b.company_id
           WHERE p.employee_id = e.id AND p.is_primary AND (p.end_date IS NULL OR p.end_date >= CURRENT_DATE)
           ORDER BY p.start_date DESC LIMIT 1) pb ON true
       WHERE e.is_active AND e.user_id IS NULL AND e.notes LIKE $1
       ORDER BY pb.company_name, e.full_name`, [IMPORT_MARK, PLACEHOLDER])).rows;

    const todo = rows.filter((r) => !r.placeholder && !r.email_taken && r.branch_id);
    const skipped = rows.filter((r) => !todo.includes(r)).map((r) => ({
      ...r,
      reason: r.placeholder ? "email placeholder (belum ada email)" : r.email_taken ? "email sudah dipakai akun lain" : "tanpa penempatan aktif",
    }));
    console.log(`Karyawan aktif hasil import tanpa akun: ${rows.length} · dibuatkan akun: ${todo.length} · dilewati: ${skipped.length}`);
    for (const s of skipped.slice(0, 50)) console.log(`  lewati ${s.nip.padEnd(12)} ${s.full_name.padEnd(34)} ${s.reason}`);
    if (!apply) {
      console.log("Dry run — tidak ada yang ditulis. Tambahkan --apply --out <file.csv> untuk membuat akun.");
      return;
    }

    await c.query("BEGIN");
    const created = [];
    for (const r of todo) {
      const password = randomPassword();
      const hash = await bcrypt.hash(password, 10);
      const userId = (await c.query(
        `INSERT INTO auth.users (email, password_hash, email_verified_at, raw_user_meta_data, raw_app_meta_data)
         VALUES ($1, $2, NOW(), $3::jsonb, '{"role":"employee"}'::jsonb) RETURNING id::text`,
        [r.email, hash, JSON.stringify({ full_name: r.full_name })])).rows[0].id;
      await c.query(
        `INSERT INTO configuration.users (id, full_name, email, role, status, can_switch_stall, can_central_checkout,
           business_scope, holding_id, company_id, branch_id)
         VALUES ($1, $2, $3, 'employee', 'active', false, false, 'branch', $4, $5, $6)`,
        [userId, r.full_name, r.email, r.holding_id, r.company_id, r.branch_id]);
      await c.query(`INSERT INTO iam.user_roles (user_id, role_id, is_primary) VALUES ($1, $2, true)`, [userId, role.id]);
      const linked = await c.query(
        `UPDATE hris.employees SET user_id = $2, is_access_app = true, updated_at = NOW() WHERE id = $1 AND user_id IS NULL`,
        [r.id, userId]);
      if (linked.rowCount !== 1) throw new Error(`Karyawan ${r.nip} berubah saat proses — dibatalkan`);
      created.push({ ...r, password });
    }
    await c.query("COMMIT");

    const header = "nip,nama,email (username),password_awal,entitas,cabang";
    const lines = created.map((r) => [r.nip, r.full_name, r.email, r.password, r.company_name, r.branch_name].map(csvCell).join(","));
    const skipLines = skipped.map((r) => [r.nip, r.full_name, r.email, "", r.company_name, `DILEWATI: ${r.reason}`].map(csvCell).join(","));
    fs.writeFileSync(out, [header, ...lines, ...skipLines].join("\n") + "\n", { mode: 0o600 });
    console.log(`Selesai: ${created.length} akun dibuat (role Karyawan). Kredensial: ${out} (chmod 600) — password tidak dicetak.`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
