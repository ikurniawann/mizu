#!/usr/bin/env node
/**
 * Seeder QA EPIC-054 — data uji manual Payroll Multi-Entitas, periode Desember 2026.
 *
 * Membuat 3 karyawan uji (NIP QA054-*, nama berawalan "QA"), lengkap dengan akun ESS, penempatan toko,
 * jadwal shift, struktur gaji per entitas, kasbon, dan absensi Desember 2026 per toko, lalu
 * MENG-CLOSING periode absensi Desember 2026 (syarat payroll diproses):
 *
 *   QA054-01  QA Rina Full Paddy   — jaga Paddy Store PVJ saja; gaji full Paddy (1 slip Paddy).
 *   QA054-02  QA Dimas Dua Entitas — jaga PVJ (Paddy) Sen–Rab + Paddy HQ Bandung (Kantor Pusat) Kam–Sab;
 *                                    gaji Paddy Rp1.000.000 + Kantor Pusat Rp1.000.000 (2 slip);
 *                                    kasbon cicilan Rp100.000 + 2 hari telat → hanya di slip Paddy (entitas utama).
 *   QA054-03  QA Sari Multi Toko   — jaga PVJ (Sen/Rab/Jum) + Kopo (Sel/Kam/Sab), keduanya Paddy;
 *                                    1 slip Paddy, biaya dibagi per toko ±50/50.
 *
 * PENTING — closing Desember mengunci SEMUA absensi Desember 2026 (trigger
 * hris.attendance_closed_period_guard). Jalankan --cleanup SEBELUM 1 Desember 2026 supaya absensi
 * karyawan sungguhan tidak tertolak. --cleanup menghapus karyawan & akun uji, menghapus run payroll
 * Desember 2026 yang belum dibayar, dan menghapus periode absensi Desember yang dibuat seeder ini
 * (kembali seperti sebelum seed). Run Desember yang sudah "paid" membuat --cleanup berhenti.
 *
 * Usage:
 *   pnpm db:seed:payroll-qa                      seed + closing absensi Desember 2026
 *   pnpm db:seed:payroll-qa -- --cleanup         bersihkan data uji + buka lagi Desember 2026
 *   tambahkan --allow-remote untuk target non-lokal
 *
 * Target: MIGRATE_DATABASE_URL / DATABASE_URL (shell env, lalu backend/.env.local, backend/.env).
 * Password akun ESS: env QA054_PASSWORD (tanpa env → acak, dicetak sekali).
 */

const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { seedPassword, passwordSource, assertLocalOrAllowed } = require("./lib/seed-password");
const D = require("./lib/paddy-spa-data");

const MARK = "Seeder QA EPIC-054";
const NIP_PREFIX = "QA054-";
const EMAIL_DOMAIN = "paddy.id";
const YEAR = 2026;
const MONTH = 12;
const PERIOD_START = "2026-12-01";
const PERIOD_END = "2026-12-31";
const CLOSING_DATE = "2027-01-03";
const SETUP_FROM = "2026-11-01"; // penempatan, jadwal, dan gaji berlaku sejak sini
const PADDY = "PADDY-RETAIL";
const KANTOR_PUSAT = "MIZU";

// store(dow): toko pada hari ISO dow (1 = Senin … 6 = Sabtu); Minggu libur.
const EMPLOYEES = [
  {
    nip: "QA054-01", name: "QA Rina Full Paddy", slug: "rina", gender: "female", position: "Sales Associate",
    placements: [{ code: "PD-PVJ", primary: true, note: "Toko tugas (QA: gaji full Paddy)" }],
    salaries: [{ company: PADDY, base: 4_500_000, transport: 300_000, meal: 400_000 }],
    store: () => "PD-PVJ",
    late: { "2026-12-03": 15, "2026-12-10": 15 },
    loan: null,
    expect: "1 slip Paddy (gaji pokok 4.500.000); 0 slip Kantor Pusat",
  },
  {
    nip: "QA054-02", name: "QA Dimas Dua Entitas", slug: "dimas", gender: "male", position: "Store Manager",
    placements: [
      { code: "PD-PVJ", primary: true, note: "Toko utama (QA: digaji Paddy)" },
      { code: "MIZU-BANDUNG", primary: false, note: "HQ Bandung Kam–Sab (QA: digaji Kantor Pusat)" },
    ],
    salaries: [{ company: PADDY, base: 1_000_000 }, { company: KANTOR_PUSAT, base: 1_000_000 }],
    store: (dow) => (dow <= 3 ? "PD-PVJ" : "MIZU-BANDUNG"),
    late: { "2026-12-02": 20, "2026-12-09": 20 },
    loan: { principal: 300_000, tenor: 3, installment: 100_000 },
    expect: "2 slip: Paddy 1.000.000 + Kantor Pusat 1.000.000; cicilan 100.000 & potongan telat hanya di slip Paddy",
  },
  {
    nip: "QA054-03", name: "QA Sari Multi Toko", slug: "sari", gender: "female", position: "Front Store",
    placements: [
      { code: "PD-PVJ", primary: true, note: "Toko utama Sen/Rab/Jum (QA: multi toko)" },
      { code: "PD-KOPO", primary: false, note: "Kopo Sel/Kam/Sab (QA: multi toko)" },
    ],
    salaries: [{ company: PADDY, base: 4_000_000, transport: 300_000, meal: 400_000 }],
    store: (dow) => (dow % 2 === 1 ? "PD-PVJ" : "PD-KOPO"),
    late: {},
    loan: null,
    expect: "1 slip Paddy (gaji pokok 4.000.000); biaya dibagi PVJ/Kopo ±50/50 di Biaya Gaji per Toko",
  },
];

const isoDow = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};

function periodDates() {
  const out = [];
  for (let day = 1; day <= 31; day++) out.push(`${YEAR}-${String(MONTH).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  return out;
}

const wib = (date, hh, mm) => `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+07:00`;

async function one(c, sql, params, what) {
  const row = (await c.query(sql, params)).rows[0];
  if (!row) throw new Error(`${what} tidak ditemukan`);
  return row;
}

async function lookups(c) {
  const companies = {};
  for (const code of [PADDY, KANTOR_PUSAT]) {
    companies[code] = await one(c, `SELECT id::text, holding_id::text, name FROM configuration.companies WHERE code = $1`,
      [code], `Perusahaan ${code}`);
  }
  const branches = {};
  for (const code of ["PD-PVJ", "PD-KOPO", "MIZU-BANDUNG"]) {
    branches[code] = await one(c, `SELECT id::text, company_id::text, name FROM configuration.branches WHERE code = $1 AND is_active`,
      [code], `Toko ${code}`);
  }
  const dept = await one(c, `SELECT id::text FROM hris.departments WHERE code = 'RETAIL-STORE'`, [], "Departemen RETAIL-STORE");
  const positions = {};
  for (const e of EMPLOYEES) {
    positions[e.position] = (await one(c, `SELECT id::text FROM hris.positions WHERE title = $1 ORDER BY created_at LIMIT 1`,
      [e.position], `Jabatan ${e.position}`)).id;
  }
  const shift = await one(c, `SELECT id::text FROM hris.shifts WHERE is_active AND name = 'Shift Pagi' AND start_time = '08:00'
     ORDER BY sort_order LIMIT 1`, [], "Shift Pagi 08:00");
  const role = await one(c, `SELECT id::text FROM iam.roles WHERE code = 'employee'`, [], "Role employee");
  const holidays = new Set((await c.query(`SELECT holiday_date::text AS d FROM hris.public_holidays
     WHERE holiday_date BETWEEN $1 AND $2 AND deleted_at IS NULL`, [PERIOD_START, PERIOD_END])).rows.map((r) => r.d));
  return { companies, branches, dept: dept.id, positions, shift: shift.id, role: role.id, holidays };
}

async function upsertAccount(c, e, primary, ref, passwordHash) {
  const email = `qa054.${e.slug}@${EMAIL_DOMAIN}`;
  const userId = (await c.query(
    `INSERT INTO auth.users (email, password_hash, email_verified_at, raw_user_meta_data, raw_app_meta_data)
     VALUES ($1, $2, NOW(), $3::jsonb, '{"role":"employee"}'::jsonb)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, email_verified_at = NOW(),
       raw_user_meta_data = EXCLUDED.raw_user_meta_data, updated_at = NOW()
     RETURNING id::text`, [email, passwordHash, JSON.stringify({ full_name: e.name, role: "employee" })])).rows[0].id;
  const company = ref.companies[PADDY];
  await c.query(
    // configuration.users.role hanya menerima peran aplikasi; akun crew toko memakai 'pos'. Menu ESS
    // datang dari peran IAM 'employee' di bawah.
    `INSERT INTO configuration.users (id, full_name, role, email, status, business_scope, holding_id, company_id, branch_id)
     VALUES ($1, $2, 'pos', $3, 'active', 'branch', $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = 'pos', email = EXCLUDED.email,
       status = 'active', business_scope = 'branch', holding_id = EXCLUDED.holding_id, company_id = EXCLUDED.company_id,
       branch_id = EXCLUDED.branch_id, updated_at = NOW()`,
    [userId, e.name, email, company.holding_id, primary.company_id, primary.id]);
  await c.query(`INSERT INTO iam.user_roles (user_id, role_id, is_primary) VALUES ($1, $2, true)
     ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true`, [userId, ref.role]);
  return { userId, email };
}

async function seedEmployee(c, e, ref, passwordHash) {
  const primary = ref.branches[e.placements[0].code];
  const { userId, email } = await upsertAccount(c, e, primary, ref, passwordHash);
  const n = Number(e.nip.slice(-2));
  const employeeId = (await c.query(
    `INSERT INTO hris.employees (full_name, nip, email, phone, gender, birth_date, marital_status, address, city, province,
       postal_code, join_date, employment_status, is_active, is_access_app, user_id, department_id, job_title_id,
       bank_name, bank_account, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, notes)
     VALUES ($1, $2, $3, $4, $5, $6, 'single', $7, 'Bandung', 'Jawa Barat', '40161', '2025-01-02', 'permanent', true, true,
       $8, $9, $10, 'BCA', $11, 'Kontak Darurat QA', '081200054000', 'Saudara', $12)
     ON CONFLICT (nip) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
       gender = EXCLUDED.gender, is_active = true, is_access_app = true, user_id = EXCLUDED.user_id,
       department_id = EXCLUDED.department_id, job_title_id = EXCLUDED.job_title_id, notes = EXCLUDED.notes, updated_at = NOW()
     RETURNING id::text`,
    [e.name, e.nip, email, `08120005400${n}`, e.gender, `199${n}-0${n}-1${n}`, `Jl. Uji Payroll No. ${n}, Bandung`,
      userId, ref.dept, ref.positions[e.position], `00054000${n}`, `${MARK} — ${e.expect}`])).rows[0].id;

  // Penempatan, jadwal, gaji, dan kasbon ditulis ulang setiap seed (idempoten).
  await c.query(`DELETE FROM hris.employee_placements WHERE employee_id = $1`, [employeeId]);
  for (const p of e.placements) {
    await c.query(`INSERT INTO hris.employee_placements (employee_id, branch_id, is_primary, start_date, notes)
       VALUES ($1, $2, $3, $4, $5)`, [employeeId, ref.branches[p.code].id, p.primary, SETUP_FROM, `${p.note} · ${MARK}`]);
  }
  await c.query(`DELETE FROM hris.employee_shifts WHERE employee_id = $1`, [employeeId]);
  for (let dow = 1; dow <= 7; dow++) {
    await c.query(`INSERT INTO hris.employee_shifts (employee_id, day_of_week, shift_id, effective_from, created_by_name)
       VALUES ($1, $2, $3, $4, $5)`, [employeeId, dow, dow === 7 ? null : ref.shift, SETUP_FROM, MARK]);
  }
  await c.query(`DELETE FROM hris.employee_salary WHERE employee_id = $1`, [employeeId]);
  for (const s of e.salaries) {
    await c.query(`INSERT INTO hris.employee_salary (employee_id, company_id, base_salary, transport_allowance, meal_allowance,
         ptkp_status, is_taxable, bpjs_tk_enrolled, bpjs_kes_enrolled, tapera_enrolled, effective_date, is_active, notes)
       VALUES ($1, $2, $3, $4, $5, 'TK/0', true, true, true, false, $6, true, $7)`,
      [employeeId, ref.companies[s.company].id, s.base, s.transport || 0, s.meal || 0, SETUP_FROM, MARK]);
  }
  await c.query(`DELETE FROM hris.loans WHERE employee_id = $1`, [employeeId]);
  if (e.loan) {
    await c.query(`INSERT INTO hris.loans (employee_id, loan_type, principal_amount, tenor_months, requested_date, approved_at,
         disbursed_at, disbursed_amount, monthly_installment, first_installment_month, first_installment_year,
         remaining_balance, paid_amount, status, is_active, purpose, notes)
       VALUES ($1, 'kasbon', $2, $3, '2026-11-15', NOW(), NOW(), $2, $4, $5, $6, $2, 0, 'approved', true,
         'Kasbon uji payroll multi-entitas', $7)`,
      [employeeId, e.loan.principal, e.loan.tenor, e.loan.installment, MONTH, YEAR, MARK]);
  }

  // Absensi Desember: Senin–Sabtu kecuali libur nasional, Shift Pagi 08:00–16:00 di toko hari itu.
  await c.query(`DELETE FROM hris.attendance WHERE employee_id = $1 AND date BETWEEN $2 AND $3`, [employeeId, PERIOD_START, PERIOD_END]);
  const perStore = {};
  for (const date of periodDates()) {
    const dow = isoDow(date);
    if (dow === 7 || ref.holidays.has(date)) continue;
    const code = e.store(dow);
    const lateMin = e.late[date] || 0;
    await c.query(`INSERT INTO hris.attendance (employee_id, date, clock_in, clock_out, work_hours, break_minutes, status,
         is_late, late_minutes, shift_id, scheduled_start, scheduled_end, branch_id, validated_at, notes)
       VALUES ($1, $2, $3, $4, $5, 60, $6, $7, $8, $9, $10, $11, $12, NOW(), $13)`,
      [employeeId, date, wib(date, 8, lateMin), wib(date, 16, 0), lateMin ? (7 * 60 - lateMin) / 60 : 7,
        lateMin ? "late" : "present", lateMin > 0, lateMin, ref.shift, wib(date, 8, 0), wib(date, 16, 0),
        ref.branches[code].id, MARK]);
    perStore[code] = (perStore[code] || 0) + 1;
  }
  return { employeeId, email, perStore };
}

async function closeDecember(c) {
  const existing = (await c.query(`SELECT id::text, status, closed_by_name FROM hris.attendance_periods
     WHERE period_year = $1 AND period_month = $2`, [YEAR, MONTH])).rows[0];
  if (existing && existing.status === "closed") return existing.closed_by_name === MARK ? "sudah closed (seeder ini)" : `sudah closed oleh ${existing.closed_by_name}`;
  const summary = (await c.query(`SELECT json_build_object(
       'employees', count(DISTINCT a.employee_id), 'rows', count(a.id),
       'without_clock_out', count(a.id) FILTER (WHERE a.clock_in IS NOT NULL AND a.clock_out IS NULL),
       'unvalidated', count(a.id) FILTER (WHERE a.validated_at IS NULL),
       'adjusted', count(a.id) FILTER (WHERE a.is_manual OR a.adjusted_at IS NOT NULL),
       'late', count(a.id) FILTER (WHERE a.is_late)) AS s
     FROM hris.attendance a WHERE a.date BETWEEN $1 AND $2`, [PERIOD_START, PERIOD_END])).rows[0].s;
  const id = (await c.query(`INSERT INTO hris.attendance_periods (period_year, period_month, start_date, end_date, closing_date,
       status, range_frozen, closed_at, closed_by_name, close_mode, close_summary)
     VALUES ($1, $2, $3, $4, $5, 'closed', true, NOW(), $6, 'manual', $7::jsonb)
     ON CONFLICT (period_year, period_month) DO UPDATE SET status = 'closed', range_frozen = true, closed_at = NOW(),
       closed_by = NULL, closed_by_name = EXCLUDED.closed_by_name, close_mode = 'manual', close_summary = EXCLUDED.close_summary
     RETURNING id::text`, [YEAR, MONTH, PERIOD_START, PERIOD_END, CLOSING_DATE, MARK, JSON.stringify(summary)])).rows[0].id;
  await c.query(`INSERT INTO hris.attendance_period_events (period_id, action, actor_name, reason, details)
     VALUES ($1, 'close', $2, $3, $4::jsonb)`,
    [id, MARK, "Data uji QA EPIC-054 — buka lagi dengan --cleanup sebelum 1 Desember 2026", JSON.stringify({ summary })]);
  return existing ? "di-closing (periode sudah ada)" : "dibuat & di-closing";
}

async function seed(c) {
  const password = seedPassword("QA054_PASSWORD");
  const passwordHash = await bcrypt.hash(password, 10);
  await c.query("BEGIN");
  await c.query("SET LOCAL hris.allow_closed_period_write = 'on'");
  const ref = await lookups(c);
  const rows = [];
  for (const e of EMPLOYEES) rows.push({ e, ...(await seedEmployee(c, e, ref, passwordHash)) });
  const period = await closeDecember(c);
  await c.query("COMMIT");

  console.log(`\n${MARK} — data uji payroll multi-entitas siap.`);
  for (const r of rows) {
    const days = Object.entries(r.perStore).map(([code, n]) => `${ref.branches[code].name} ${n} hari`).join(", ");
    console.log(`  ${r.e.nip}  ${r.e.name.padEnd(22)} login ${r.email}`);
    console.log(`           absensi: ${days}`);
    console.log(`           harapan: ${r.e.expect}`);
  }
  console.log(`  Password akun ESS: ${passwordSource("QA054_PASSWORD")}`);
  console.log(`  Absensi Desember 2026: ${period}${ref.holidays.size ? ` (libur dilewati: ${[...ref.holidays].join(", ")})` : ""}`);
  console.log("\n  ⚠ Absensi Desember 2026 kini terkunci untuk SEMUA karyawan. Jalankan --cleanup sebelum 1 Desember 2026.");
}

async function cleanup(c) {
  await c.query("BEGIN");
  await c.query("SET LOCAL hris.allow_closed_period_write = 'on'");
  const paid = (await c.query(`SELECT run_name FROM hris.payroll_runs WHERE period_year = $1 AND period_month = $2 AND status = 'paid'`,
    [YEAR, MONTH])).rows;
  if (paid.length) {
    await c.query("ROLLBACK");
    throw new Error(`Run Desember 2026 sudah dibayar (${paid.map((r) => r.run_name).join(", ")}): cicilan & jurnal sudah terposting. ` +
      "Bersihkan manual (batalkan jurnal, kembalikan saldo pinjaman) sebelum --cleanup.");
  }
  const runs = await c.query(`DELETE FROM hris.payroll_runs WHERE period_year = $1 AND period_month = $2 RETURNING run_name`, [YEAR, MONTH]);
  const emps = (await c.query(`SELECT id::text, user_id::text FROM hris.employees WHERE nip LIKE $1`, [`${NIP_PREFIX}%`])).rows;
  const ids = emps.map((r) => r.id);
  const users = emps.map((r) => r.user_id).filter(Boolean);
  if (ids.length) {
    await c.query(`DELETE FROM hris.attendance WHERE employee_id = ANY($1::uuid[])`, [ids]);
    await c.query(`DELETE FROM hris.loans WHERE employee_id = ANY($1::uuid[])`, [ids]);
    await c.query(`DELETE FROM hris.employees WHERE id = ANY($1::uuid[])`, [ids]);
  }
  if (users.length) {
    await c.query(`DELETE FROM iam.user_roles WHERE user_id = ANY($1::uuid[])`, [users]);
    await c.query(`DELETE FROM configuration.users WHERE id = ANY($1::uuid[])`, [users]);
    await c.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [users]);
  }
  const period = await c.query(`DELETE FROM hris.attendance_periods WHERE period_year = $1 AND period_month = $2
     AND closed_by_name = $3 RETURNING id`, [YEAR, MONTH, MARK]);
  await c.query("COMMIT");
  console.log(`${MARK} — cleanup selesai.`);
  console.log(`  run payroll Desember 2026 dihapus : ${runs.rowCount}${runs.rowCount ? ` (${runs.rows.map((r) => r.run_name).join(", ")})` : ""}`);
  console.log(`  karyawan uji dihapus             : ${ids.length} (beserta akun, absensi, gaji, kasbon, penempatan)`);
  console.log(`  periode absensi Desember 2026    : ${period.rowCount ? "dihapus — terbuka lagi, dibuat ulang otomatis saat dibutuhkan" : "tidak dibuat seeder ini, tidak diubah"}`);
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
    if (process.argv.includes("--cleanup")) await cleanup(c);
    else await seed(c);
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
