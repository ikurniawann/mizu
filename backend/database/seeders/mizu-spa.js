#!/usr/bin/env node
/**
 * Seeder MASTER Mizu Spa (EPIC-052) — data demo outlet milik sendiri.
 *
 * Mengisi (idempoten, satu transaksi):
 *   - configuration.holdings/companies/branches : Mizu Group → Mizu Spa → 2 outlet asli (Mizu 1.0 Westhoff,
 *     Mizu Signature Riau) + profil publik; outlet demo lama dinonaktifkan; venue default CRM
 *   - spa.outlets                               : stall POS default, jam buka, booking online
 *   - spa.treatments + treatment_variants       : 12 treatment, varian durasi & harga
 *   - spa.variant_outlet_prices                 : harga premium Setiabudi
 *   - spa.commission_rules                      : default 10%, refleksi 12%, signature nominal, dll
 *   - hris.departments/positions/shifts         : Spa Operations, Terapis, shift Spa Pagi/Siang
 *   - hris.employees + employee_shifts          : 17 terapis, 3 resepsionis, 3 manajer (pola libur mingguan)
 *   - login demo: fo.westhoff@ / fo.signature@ (Resepsionis Spa), ayu@ / euis@ / wulan@ (Terapis Spa);
 *     login demo lama fo.dago@ / fo.riau@ / fo.setiabudi@ dinonaktifkan
 *   - spa.therapists, therapist_assists, outlet_pics
 *   - auth.users + configuration.users + iam.user_roles : login resepsionis (Resepsionis Spa) dan
 *     3 terapis (Terapis Spa), scope cabang + stall
 *   - pos.pos_customers                         : 80 pelanggan demo
 *   - item.products + pos.pos_products + spa.variant_pos_products : produk POS per varian × outlet
 *
 * Password login demo: env MIZU_DEMO_PASSWORD, tanpa itu acak dan dicetak sekali.
 *
 * Usage:
 *   pnpm db:seed:mizu-spa                 (lalu db:seed:mizu-spa-transactions)
 *   node seeders/mizu-spa.js --allow-remote   untuk target non-lokal (mis. container docker lain)
 */

const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { seedPassword, passwordSource, assertLocalOrAllowed } = require("./lib/seed-password");
const D = require("./lib/mizu-spa-data");

const EFFECTIVE_FROM = "2026-08-01";

async function ensureScope(c) {
  const h = await c.query(
    `INSERT INTO configuration.holdings (name, code) VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW() RETURNING id`,
    [D.HOLDING.name, D.HOLDING.code]);
  const co = await c.query(
    `INSERT INTO configuration.companies (holding_id, name, code, is_active) VALUES ($1, $2, $3, true)
     ON CONFLICT (holding_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = true, updated_at = NOW() RETURNING id`,
    [h.rows[0].id, D.COMPANY.name, D.COMPANY.code]);
  const companyId = co.rows[0].id;
  const outlets = {};
  for (const o of D.OUTLETS) {
    // Profil publik cabang (halaman Lokasi website): slug + tampil publik + Instagram.
    const b = await c.query(
      `INSERT INTO configuration.branches (company_id, name, code, address, city, phone, slug, is_public, instagram, is_active)
       VALUES ($1, $2, $3, $4, 'Bandung', $5, $6, true, 'mizufamily.id', true)
       ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address,
         city = EXCLUDED.city, phone = EXCLUDED.phone, slug = EXCLUDED.slug, is_public = true,
         instagram = EXCLUDED.instagram, is_active = true, updated_at = NOW()
       RETURNING id`, [companyId, o.name, o.code, o.address, o.phone || null, o.slug]);
    const branchId = b.rows[0].id;
    // Stall spa: default warehouse cabang (dibuat trigger), dinamai ulang supaya jelas di POS.
    let wh = await c.query(
      `SELECT id FROM configuration.warehouses WHERE branch_id = $1 AND is_active ORDER BY is_default DESC, created_at LIMIT 1`, [branchId]);
    if (!wh.rowCount) {
      wh = await c.query(
        `INSERT INTO configuration.warehouses (branch_id, code, name, is_default, is_active) VALUES ($1, 'SPA', $2, true, true) RETURNING id`,
        [branchId, `Spa ${o.name}`]);
    } else {
      await c.query(`UPDATE configuration.warehouses SET name = $2, updated_at = NOW() WHERE id = $1`, [wh.rows[0].id, `Spa ${o.name}`]);
    }
    const warehouseId = wh.rows[0].id;
    await c.query(
      `INSERT INTO spa.outlets (branch_id, warehouse_id, open_time, close_time, slot_minutes, public_booking, is_active)
       VALUES ($1, $2, $3::time, $4::time, 30, true, true)
       ON CONFLICT (branch_id) DO UPDATE SET warehouse_id = EXCLUDED.warehouse_id, open_time = EXCLUDED.open_time,
         close_time = EXCLUDED.close_time, public_booking = true, is_active = true, updated_at = NOW()`,
      [branchId, warehouseId, o.open, o.close]);
    outlets[o.code] = { ...o, branchId, warehouseId, companyId };
  }
  // Outlet demo lama: nonaktif (cabang, outlet spa, booking online, produk POS-nya).
  const retired = await c.query(
    `UPDATE configuration.branches SET is_active = false, is_public = false, updated_at = NOW()
      WHERE company_id = $1 AND code = ANY($2) RETURNING id`, [companyId, D.RETIRED_OUTLETS]);
  const retiredIds = retired.rows.map((r) => r.id);
  if (retiredIds.length) {
    await c.query(`UPDATE spa.outlets SET is_active = false, public_booking = false, updated_at = NOW() WHERE branch_id = ANY($1)`, [retiredIds]);
    await c.query(`UPDATE pos.pos_products p SET is_active = false, updated_at = NOW() FROM spa.variant_pos_products m
      WHERE m.pos_product_id = p.id AND m.branch_id = ANY($1)`, [retiredIds]);
    await c.query(`DELETE FROM spa.outlet_pics WHERE branch_id = ANY($1)`, [retiredIds]);
  }
  // Venue default (POS & dokumen untuk user tanpa scope cabang) = outlet Mizu pertama.
  for (const [key, value] of [["default_company_id", companyId], ["default_branch_id", outlets[D.OUTLETS[0].code].branchId]]) {
    await c.query(
      `INSERT INTO crm.crm_settings (key, value) VALUES ($1, to_jsonb($2::text))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value]);
  }
  return { companyId, outlets, retired: retiredIds.length };
}

async function seedTreatments(c) {
  const variants = {}; // "BALI|60 menit" -> { id, treatmentId }
  const treatments = {};
  for (const [i, t] of D.TREATMENTS.entries()) {
    const r = await c.query(
      `INSERT INTO spa.treatments (code, name, category, description, is_active, sort_order)
       VALUES ($1, $2, $3, $4, true, $5)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
         description = EXCLUDED.description, is_active = true, sort_order = EXCLUDED.sort_order, updated_at = NOW()
       RETURNING id`, [t.code, t.name, t.category, t.description, (i + 1) * 10]);
    const treatmentId = r.rows[0].id;
    treatments[t.code] = treatmentId;
    for (const [j, [name, duration, buffer, price]] of t.variants.entries()) {
      const existing = await c.query(
        `SELECT id FROM spa.treatment_variants WHERE treatment_id = $1 AND lower(name) = lower($2) ORDER BY created_at LIMIT 1`,
        [treatmentId, name]);
      let id;
      if (existing.rowCount) {
        id = existing.rows[0].id;
        await c.query(
          `UPDATE spa.treatment_variants SET duration_min = $2, buffer_min = $3, price_idr = $4, is_active = true,
             sort_order = $5, updated_at = NOW() WHERE id = $1`, [id, duration, buffer, price, j]);
      } else {
        id = (await c.query(
          `INSERT INTO spa.treatment_variants (treatment_id, name, duration_min, buffer_min, price_idr, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [treatmentId, name, duration, buffer, price, j])).rows[0].id;
      }
      variants[`${t.code}|${name}`] = { id, treatmentId, treatment: t, name, duration, buffer, price };
    }
  }
  return { treatments, variants };
}

async function seedPrices(c, outlets, variants) {
  for (const [outlet, code, variant, price] of D.OUTLET_PRICES) {
    await c.query(
      `INSERT INTO spa.variant_outlet_prices (variant_id, branch_id, price_idr) VALUES ($1, $2, $3)
       ON CONFLICT (variant_id, branch_id) DO UPDATE SET price_idr = EXCLUDED.price_idr, updated_at = NOW()`,
      [variants[`${code}|${variant}`].id, outlets[outlet].branchId, price]);
  }
}

async function seedRules(c, outlets, treatments, variants) {
  for (const r of D.COMMISSION_RULES) {
    const variantId = r.variant ? variants[`${r.treatment}|${r.variant}`].id : null;
    const treatmentId = !r.variant && r.treatment ? treatments[r.treatment] : null;
    const branchId = r.outlet ? outlets[r.outlet].branchId : null;
    await c.query(
      `INSERT INTO spa.commission_rules (treatment_id, variant_id, branch_id, commission_type, value, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (COALESCE(treatment_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET commission_type = EXCLUDED.commission_type, value = EXCLUDED.value, is_active = true, updated_at = NOW()`,
      [treatmentId, variantId, branchId, r.type, r.value]);
  }
}

async function seedHr(c) {
  let dep = await c.query(`SELECT id FROM hris.departments WHERE code = 'SPA-OPS'`);
  if (!dep.rowCount) {
    dep = await c.query(
      `INSERT INTO hris.departments (name, code, description, is_active) VALUES ('Spa Operations', 'SPA-OPS',
         'Terapis, front office, dan manajemen outlet Mizu Spa', true) RETURNING id`);
  }
  const positions = {};
  for (const [key, title, level] of [["therapist", "Terapis Spa", "staff"], ["frontdesk", "Resepsionis Spa", "staff"],
    ["manager", "Outlet Manager Spa", "manager"]]) {
    let p = await c.query(`SELECT id FROM hris.positions WHERE title = $1 AND department = 'Spa Operations' LIMIT 1`, [title]);
    if (!p.rowCount) {
      p = await c.query(`INSERT INTO hris.positions (title, department, level, is_active) VALUES ($1, 'Spa Operations', $2, true) RETURNING id`,
        [title, level]);
    }
    positions[key] = p.rows[0].id;
  }
  const shifts = {};
  for (const [i, s] of D.SHIFTS.entries()) {
    let r = await c.query(`SELECT id FROM hris.shifts WHERE name = $1 LIMIT 1`, [s.name]);
    if (!r.rowCount) {
      r = await c.query(
        `INSERT INTO hris.shifts (name, start_time, end_time, break_minutes, late_tolerance_minutes, is_overnight, is_active, sort_order)
         VALUES ($1, $2::time, $3::time, 60, 10, false, true, $4) RETURNING id`, [s.name, s.start, s.end, 50 + i]);
    }
    shifts[s.key] = r.rows[0].id;
  }
  return { departmentId: dep.rows[0].id, positions, shifts };
}

async function seedStaff(c, outlets, hr, passwordHash) {
  const roles = {};
  for (const code of ["spa_therapist", "spa_frontdesk"]) {
    roles[code] = (await c.query(`SELECT id FROM iam.roles WHERE code = $1`, [code])).rows[0]?.id;
    if (!roles[code]) throw new Error(`Role ${code} belum ada — jalankan migrasi 20261008100000_spa_booking.sql dulu`);
  }
  const staff = {};
  const logins = [];
  for (const [nip, name, gender, outletCode, kind, shift, dayOff, email] of D.STAFF) {
    const o = outlets[outletCode];
    const slug = name.toLowerCase().replace(/[^a-z]+/g, ".");
    let userId = null;
    if (email) {
      const u = await c.query(
        `INSERT INTO auth.users (email, password_hash, email_verified_at, raw_user_meta_data, raw_app_meta_data)
         VALUES ($1, $2, NOW(), $3::jsonb, '{"role":"pos"}'::jsonb)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, email_verified_at = NOW(),
           raw_user_meta_data = EXCLUDED.raw_user_meta_data, updated_at = NOW()
         RETURNING id`, [email, passwordHash, JSON.stringify({ full_name: name, role: "pos" })]);
      userId = u.rows[0].id;
      await c.query(
        `INSERT INTO configuration.users (id, full_name, role, email, status, business_scope, holding_id, company_id, branch_id,
           default_warehouse_id, can_switch_stall)
         VALUES ($1, $2, 'pos', $3, 'active', 'branch',
           (SELECT holding_id FROM configuration.companies WHERE id = $4), $4, $5, $6, false)
         ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = 'pos', email = EXCLUDED.email, status = 'active',
           business_scope = 'branch', holding_id = EXCLUDED.holding_id, company_id = EXCLUDED.company_id,
           branch_id = EXCLUDED.branch_id, default_warehouse_id = EXCLUDED.default_warehouse_id, updated_at = NOW()`,
        [userId, name, email, o.companyId, o.branchId, o.warehouseId]);
      await c.query(
        `INSERT INTO configuration.user_warehouses (user_id, warehouse_id, is_active) VALUES ($1, $2, true)
         ON CONFLICT (user_id, warehouse_id) DO UPDATE SET is_active = true`, [userId, o.warehouseId]);
      const role = kind === "frontdesk" ? "spa_frontdesk" : "spa_therapist";
      await c.query(
        `INSERT INTO iam.user_roles (user_id, role_id, is_primary) VALUES ($1, $2, true)
         ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true`, [userId, roles[role]]);
      logins.push([email, name, role]);
    }
    const fullNip = `MZ-${nip}`;
    const emp = await c.query(
      `INSERT INTO hris.employees (full_name, nip, email, phone, join_date, employment_status, is_active, is_access_app,
         user_id, department_id, job_title_id)
       VALUES ($1, $2, $3, $4, '2026-07-01', 'permanent', true, $5, $6, $7, $8)
       ON CONFLICT (nip) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, is_active = true,
         is_access_app = EXCLUDED.is_access_app, user_id = COALESCE(EXCLUDED.user_id, hris.employees.user_id),
         department_id = EXCLUDED.department_id, job_title_id = EXCLUDED.job_title_id, updated_at = NOW()
       RETURNING id`,
      [name, fullNip, email || `${slug}@staff.mizu.id`, `0813${String(20000000 + Number(nip) * 7919).slice(0, 8)}`,
        userId !== null, userId, hr.departmentId, hr.positions[kind]]);
    const employeeId = emp.rows[0].id;
    // Pola shift mingguan: satu hari libur, sisanya shift tetap.
    await c.query(`DELETE FROM hris.employee_shifts WHERE employee_id = $1 AND effective_from = $2::date`, [employeeId, EFFECTIVE_FROM]);
    for (let day = 1; day <= 7; day++) {
      await c.query(
        `INSERT INTO hris.employee_shifts (employee_id, day_of_week, shift_id, effective_from, created_by_name)
         VALUES ($1, $2, $3, $4::date, 'Seeder Mizu Spa')`, [employeeId, day, day === dayOff ? null : hr.shifts[shift], EFFECTIVE_FROM]);
    }
    staff[nip] = { employeeId, userId, name, gender, outlet: outletCode, kind, shift, dayOff };
    if (kind === "therapist") {
      const t = await c.query(
        `INSERT INTO spa.therapists (employee_id, home_branch_id, gender, is_active) VALUES ($1, $2, $3, true)
         ON CONFLICT (employee_id) DO UPDATE SET home_branch_id = EXCLUDED.home_branch_id, gender = EXCLUDED.gender,
           is_active = true, updated_at = NOW()
         RETURNING id`, [employeeId, o.branchId, gender]);
      staff[nip].therapistId = t.rows[0].id;
    }
    if (kind === "manager") {
      await c.query(`DELETE FROM spa.outlet_pics WHERE employee_id = $1 AND branch_id <> $2`, [employeeId, o.branchId]);
      await c.query(`INSERT INTO spa.outlet_pics (branch_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [o.branchId, employeeId]);
    }
  }
  // Login demo lama: nonaktif (tidak bisa masuk), datanya tetap untuk jejak audit.
  await c.query(
    `UPDATE configuration.users u SET status = 'inactive', updated_at = NOW() FROM auth.users a
      WHERE a.id = u.id AND a.email = ANY($1)`, [D.RETIRED_LOGINS]);
  await c.query(`UPDATE auth.users SET banned_until = 'infinity', updated_at = NOW() WHERE email = ANY($1)`, [D.RETIRED_LOGINS]);
  return { staff, logins };
}

async function seedAssists(c, outlets, staff) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  for (const a of D.ASSISTS) {
    const t = staff[a.nip];
    await c.query(`DELETE FROM spa.therapist_assists WHERE therapist_id = $1 AND note = $2`, [t.therapistId, a.note]);
    // Setiap Sabtu–Minggu bulan berjalan.
    for (let d = new Date(monthStart); d <= monthEnd; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() !== 6) continue;
      const sat = d.toISOString().slice(0, 10);
      const sun = new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
      await c.query(
        `INSERT INTO spa.therapist_assists (therapist_id, branch_id, start_date, end_date, note) VALUES ($1, $2, $3::date, $4::date, $5)`,
        [t.therapistId, outlets[a.outlet].branchId, sat, sun, a.note]);
    }
  }
}

async function seedCustomers(c) {
  let n = 0;
  for (const cu of D.customers()) {
    await c.query(
      `INSERT INTO pos.pos_customers (phone, name, member_type, gender, city, wa_consent)
       VALUES ($1, $2, 'registered', $3, 'Bandung', true)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, gender = EXCLUDED.gender`, [cu.phone, cu.name, cu.gender]);
    n++;
  }
  return n;
}

/** Produk POS per varian × outlet, format kode sama dengan modul Go (ensureProduct). */
async function seedPosProducts(c, outlets, variants) {
  const cat = await c.query(`SELECT id FROM pos.pos_categories WHERE lower(name) = 'spa treatment' ORDER BY display_order LIMIT 1`);
  const categoryId = cat.rows[0]?.id || null;
  let n = 0;
  for (const o of Object.values(outlets)) {
    const priceRows = await c.query(`SELECT variant_id, price_idr FROM spa.variant_outlet_prices WHERE branch_id = $1`, [o.branchId]);
    const prices = new Map(priceRows.rows.map((r) => [r.variant_id, Number(r.price_idr)]));
    for (const v of Object.values(variants)) {
      const { kode, sku } = D.posCodes(v.treatment.code, v.id, o.branchId);
      const name = `${v.treatment.name} (${v.name})`.slice(0, 100);
      const price = prices.get(v.id) ?? v.price;
      let master = await c.query(`SELECT id FROM item.products WHERE warehouse_id = $1 AND kode = $2 AND deleted_at IS NULL LIMIT 1`,
        [o.warehouseId, kode]);
      if (master.rowCount) {
        await c.query(`UPDATE item.products SET nama = $2, kategori = 'Spa Treatment', harga_jual = $3, station = 'spa', is_active = true,
          updated_at = NOW() WHERE id = $1`, [master.rows[0].id, name, price]);
      } else {
        master = await c.query(
          `INSERT INTO item.products (kode, nama, kategori, harga_jual, harga_modal, markup_persen, company_id, branch_id, warehouse_id,
             station, production_output_type, is_active)
           VALUES ($1, $2, 'Spa Treatment', $3, 0, 0, $4, $5, $6, 'spa', 'FINISHED_GOOD', true) RETURNING id`,
          [kode, name, price, o.companyId, o.branchId, o.warehouseId]);
      }
      const masterId = master.rows[0].id;
      let pos = await c.query(`SELECT id FROM pos.pos_products WHERE source_product_id = $1 OR sku = $2
        ORDER BY (source_product_id = $1) DESC NULLS LAST LIMIT 1`, [masterId, sku]);
      if (pos.rowCount) {
        await c.query(`UPDATE pos.pos_products SET name = $2, category_id = $3, base_price = $4, is_active = true, station = 'spa',
          source_product_id = $5, updated_at = NOW() WHERE id = $1`, [pos.rows[0].id, name, categoryId, price, masterId]);
      } else {
        pos = await c.query(
          `INSERT INTO pos.pos_products (sku, name, description, category_id, base_price, cost_price, is_active, is_available,
             inventory_tracking, station, source_product_id, sales_channels)
           VALUES ($1, $2, 'Treatment spa', $3, $4, 0, true, true, false, 'spa', $5, ARRAY['pos']) RETURNING id`,
          [sku, name, categoryId, price, masterId]);
      }
      await c.query(
        `INSERT INTO spa.variant_pos_products (variant_id, branch_id, pos_product_id) VALUES ($1, $2, $3)
         ON CONFLICT (variant_id, branch_id) DO UPDATE SET pos_product_id = EXCLUDED.pos_product_id, synced_at = NOW()`,
        [v.id, o.branchId, pos.rows[0].id]);
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
  const password = seedPassword("MIZU_DEMO_PASSWORD");
  const passwordHash = await bcrypt.hash(password, 10);
  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const { outlets, retired } = await ensureScope(c);
    console.log("outlet            :", Object.values(outlets).map((o) => o.name).join(", "), retired ? `(${retired} outlet lama dinonaktifkan)` : "");
    const { treatments, variants } = await seedTreatments(c);
    console.log("treatment/varian  :", Object.keys(treatments).length, "/", Object.keys(variants).length);
    await seedPrices(c, outlets, variants);
    await seedRules(c, outlets, treatments, variants);
    console.log("aturan komisi     :", D.COMMISSION_RULES.length);
    const hr = await seedHr(c);
    const { staff, logins } = await seedStaff(c, outlets, hr, passwordHash);
    console.log("staf              :", Object.keys(staff).length, `(${Object.values(staff).filter((s) => s.therapistId).length} terapis)`);
    await seedAssists(c, outlets, staff);
    console.log("pelanggan         :", await seedCustomers(c));
    console.log("produk POS        :", await seedPosProducts(c, outlets, variants));
    await c.query("COMMIT");
    console.log("\nLogin demo (password:", passwordSource("MIZU_DEMO_PASSWORD") + "):");
    for (const [email, name, role] of logins) console.log(`  ${email.padEnd(24)} ${name.padEnd(18)} ${role}`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
