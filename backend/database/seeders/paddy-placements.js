#!/usr/bin/env node
/**
 * Seeder demo Payroll multi-toko Paddy — Penempatan Karyawan + absensi per toko + run payroll.
 *
 * Paddy = satu perusahaan; karyawan bisa bekerja di lebih dari satu toko (configuration.branches).
 * Seeder ini (idempoten) mengisi:
 *   1. hris.employee_placements  — penempatan untuk SEMUA karyawan aktif:
 *        - crew experience: toko asal spa.therapists.home_branch_id (utama) + toko perbantuan
 *          dari spa.therapist_assists (crew yang membantu toko lain mendapat 2 penempatan)
 *        - front store / store manager: toko di data demo (lib/paddy-spa-data STAFF);
 *          store manager PD-201 & PD-202 memegang PVJ dan Kopo sekaligus
 *        - purchasing toko/gudang: toko di namanya; staf kantor & akun admin: HQ (MIZU-BANDUNG)
 *      Baris seeder ditandai notes berakhiran " · data demo"; karyawan yang sudah punya
 *      penempatan buatan staf tidak disentuh.
 *   2. hris.attendance — (a) backfill branch_id absensi lama ke penempatan utama; (b) absensi demo
 *      2 bulan terakhir (mis. Agustus & September bila sekarang Oktober) sesuai pola shift tiap
 *      karyawan, hanya pada tanggal yang belum ada absensinya. Karyawan multi-toko bekerja di toko
 *      kedua pada hari tertentu (crew perbantuan: Sabtu & Minggu; store manager: 2 hari/minggu).
 *      Tanggal di periode absensi yang sudah di-closing (hris.attendance_periods status closed)
 *      tidak disentuh sama sekali.
 *   3. hris.employee_salary — struktur gaji demo untuk karyawan toko yang BELUM punya baris gaji
 *      sama sekali (gaji yang sudah ada tidak diubah).
 *   4. Run payroll bulan lalu lewat API Go (kalkulasi asli aplikasi: PPh 21/BPJS + alokasi per toko),
 *      status draft. Dengan --paid-run, bulan sebelumnya juga dihitung, periode absensinya di-closing
 *      (wajib sebelum payroll diproses), lalu diproses → disetujui → dibayar (memicu jurnal payroll per toko). Bila tahun berjalan belum punya tahun buku Paddy,
 *      dibuat "Tahun Buku <tahun>" dengan 12 periode OPEN supaya jurnal bisa terposting.
 *      API: PADDY_API_URL (default http://127.0.0.1:8080), login SUPER_USER_EMAIL / SUPER_USER_PASSWORD.
 *      API tidak terjangkau → langkah ini dilewati dengan pesan (data lain tetap tersimpan).
 *
 * Usage:
 *   pnpm db:seed:paddy-placements
 *   node seeders/paddy-placements.js --paid-run         (+ run bulan sebelumnya sampai dibayar)
 *   node seeders/paddy-placements.js --skip-payroll     (tanpa langkah API)
 *   node seeders/paddy-placements.js --allow-remote     untuk target non-lokal
 */

const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { assertLocalOrAllowed } = require("./lib/seed-password");
const D = require("./lib/paddy-spa-data");

const MARK = "[seed:paddy-placements]";
// Catatan penempatan hasil seeder berakhiran PLACEMENT_TAG (tampil rapi di UI, tetap bisa dikenali).
const PLACEMENT_TAG = " · data demo";
const PLACEMENT_START = "2026-07-01";
const HQ_CODE = "MIZU-BANDUNG";
// Store manager yang memegang dua toko: nip suffix → [utama, kedua], hari di toko kedua (ISO 1=Senin).
const MANAGER_STORES = {
  "201": { stores: ["PD-PVJ", "PD-KOPO"], secondDays: [2, 4] },
  "202": { stores: ["PD-KOPO", "PD-PVJ"], secondDays: [3, 5] },
};
// Crew perbantuan bekerja di toko kedua pada akhir pekan.
const ASSIST_DAYS = [6, 7];
// Akun sistem/demo: tetap dapat penempatan HQ, tetapi tanpa absensi & gaji demo.
const SYSTEM_NIPS = new Set(["SUPERADMIN", "ADMINPADDY", "DEMOPADDY"]);

// Gaji demo per peran (Rupiah/bulan). Tapera tidak diikutkan (belum ada akun utang Tapera di COA Paddy).
const SALARY = {
  therapist: { base: 4_600_000, fixed: 0, transport: 300_000, meal: 400_000, ptkp: "TK/0" },
  frontdesk: { base: 4_600_000, fixed: 0, transport: 300_000, meal: 400_000, ptkp: "TK/0" },
  manager: { base: 6_500_000, fixed: 1_000_000, transport: 400_000, meal: 500_000, ptkp: "K/1" },
  purchasing: { base: 5_000_000, fixed: 250_000, transport: 300_000, meal: 400_000, ptkp: "TK/0" },
  office: { base: 5_500_000, fixed: 500_000, transport: 300_000, meal: 400_000, ptkp: "TK/0" },
};

function wibToday() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** [{year, month}] bulan ke-n sebelum bulan berjalan (WIB). */
function monthsBack(n) {
  const [y, m] = wibToday().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function monthDays({ year, month }) {
  const out = [];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= last; day++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay() || 7; // ISO 1..7
    out.push({ date, dow });
  }
  return out;
}

/** "HH:MM[:SS]" WIB pada tanggal → Date UTC, plus menit. */
function wibAt(date, time, plusMinutes = 0) {
  const [h, m] = time.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) + ((h - 7) * 60 + m + plusMinutes) * 60 * 1000);
}

async function branchesByCode(c) {
  const r = await c.query(`SELECT id, code, name, company_id::text AS company_id FROM configuration.branches
     WHERE code = ANY($1) AND is_active`,
    [["PD-PVJ", "PD-KOPO", HQ_CODE]]);
  const out = {};
  for (const row of r.rows) out[row.code] = row;
  for (const code of ["PD-PVJ", "PD-KOPO"]) {
    if (!out[code]) throw new Error(`Toko ${code} belum ada — jalankan db:seed:paddy-spa dulu`);
  }
  if (!out[HQ_CODE]) console.warn(`  ! Cabang HQ ${HQ_CODE} tidak ditemukan; staf kantor ditempatkan di PD-PVJ`);
  return out;
}

/** Rencana penempatan per karyawan: [{code, primary, note}] + peran untuk gaji. */
function planFor(e, stores, staffByNip) {
  const suffix = e.nip.startsWith(D.NIP_PREFIX) ? e.nip.slice(D.NIP_PREFIX.length) : null;
  const staff = suffix ? staffByNip[suffix] : null;
  const hq = stores[HQ_CODE] ? HQ_CODE : "PD-PVJ";
  if (MANAGER_STORES[suffix]) {
    const [first, second] = MANAGER_STORES[suffix].stores;
    return { role: "manager", secondDays: MANAGER_STORES[suffix].secondDays, items: [
      { code: first, primary: true, note: "Store manager" },
      { code: second, primary: false, note: "Store manager — memegang dua toko" },
    ] };
  }
  if (e.home_code) {
    const items = [{ code: e.home_code, primary: true, note: "Toko asal crew experience" }];
    for (const code of e.assist_codes || []) {
      if (code !== e.home_code) items.push({ code, primary: false, note: "Perbantuan di toko lain" });
    }
    return { role: "therapist", secondDays: ASSIST_DAYS, items };
  }
  if (staff) {
    return { role: staff[4] === "manager" ? "manager" : staff[4] === "frontdesk" ? "frontdesk" : "therapist",
      items: [{ code: staff[3], primary: true, note: "Toko tugas" }] };
  }
  if (/purchasing/i.test(e.full_name)) {
    const code = /kopo/i.test(e.full_name) ? "PD-KOPO" : "PD-PVJ";
    return { role: "purchasing", items: [{ code, primary: true, note: "Purchasing toko/gudang" }] };
  }
  return { role: "office", items: [{ code: hq, primary: true, note: "Kantor pusat (HQ)" }] };
}

async function seedPlacements(c, stores) {
  const staffByNip = {};
  for (const s of D.STAFF) staffByNip[s[0]] = s;
  const employees = (await c.query(`
    SELECT e.id, e.nip, e.full_name, e.join_date::text AS join_date, hb.code AS home_code,
           (SELECT array_agg(DISTINCT ab.code) FROM spa.therapist_assists a
              JOIN configuration.branches ab ON ab.id = a.branch_id WHERE a.therapist_id = t.id) AS assist_codes,
           EXISTS (SELECT 1 FROM hris.employee_placements p
                    WHERE p.employee_id = e.id AND (p.notes IS NULL OR (p.notes NOT LIKE $1 AND p.notes NOT LIKE $2))) AS has_manual
      FROM hris.employees e
      LEFT JOIN spa.therapists t ON t.employee_id = e.id
      LEFT JOIN configuration.branches hb ON hb.id = t.home_branch_id
     WHERE e.is_active
     ORDER BY e.nip`, [MARK + "%", "%" + PLACEMENT_TAG])).rows;

  // Baris seeder lama (penanda MARK di depan) maupun baru (PLACEMENT_TAG di belakang) ditulis ulang.
  await c.query(`DELETE FROM hris.employee_placements WHERE notes LIKE $1 OR notes LIKE $2`, [MARK + "%", "%" + PLACEMENT_TAG]);
  const plans = [];
  let rows = 0, skipped = 0;
  for (const e of employees) {
    const plan = planFor(e, stores, staffByNip);
    plans.push({ ...e, ...plan });
    if (e.has_manual) { skipped++; continue; }
    const start = e.join_date > PLACEMENT_START && plan.role === "office" ? e.join_date : PLACEMENT_START;
    for (const it of plan.items) {
      const branch = stores[it.code];
      if (!branch) continue;
      await c.query(`INSERT INTO hris.employee_placements (employee_id, branch_id, is_primary, start_date, notes)
                     VALUES ($1, $2, $3, $4, $5)`, [e.id, branch.id, it.primary, start, `${it.note}${PLACEMENT_TAG}`]);
      rows++;
    }
  }
  const multi = plans.filter((p) => p.items.length > 1);
  console.log(`penempatan        : ${rows} baris untuk ${employees.length - skipped} karyawan` +
    (skipped ? ` (${skipped} karyawan punya penempatan buatan staf, dilewati)` : ""));
  console.log(`multi-toko        : ${multi.map((p) => `${p.full_name} (${p.items.map((i) => i.code).join(" + ")})`).join(", ")}`);
  return plans;
}

/** Pola shift karyawan: dow → {start, end} (null = libur). Tanpa pola: Senin–Sabtu 09:00–17:00. */
async function shiftPatterns(c) {
  const r = await c.query(`
    SELECT DISTINCT ON (es.employee_id, es.day_of_week) es.employee_id, es.day_of_week, s.id AS shift_id,
           s.start_time::text AS start_time, s.end_time::text AS end_time, s.is_overnight
      FROM hris.employee_shifts es LEFT JOIN hris.shifts s ON s.id = es.shift_id
     ORDER BY es.employee_id, es.day_of_week, es.effective_from DESC`);
  const out = {};
  for (const row of r.rows) {
    out[row.employee_id] ??= {};
    out[row.employee_id][row.day_of_week] = row.start_time && !row.is_overnight
      ? { id: row.shift_id, start: row.start_time, end: row.end_time } : null;
  }
  return out;
}

/** Rentang periode absensi yang sudah di-closing (absensinya terkunci); [] bila tabel belum ada. */
async function closedPeriods(c) {
  const exists = (await c.query(`SELECT to_regclass('hris.attendance_periods') AS t`)).rows[0].t;
  if (!exists) return [];
  const r = await c.query(`SELECT start_date::text AS start, end_date::text AS end FROM hris.attendance_periods
    WHERE status = 'closed'`);
  return r.rows;
}

const CLOSED_FILTER = `NOT EXISTS (SELECT 1 FROM hris.attendance_periods ap
  WHERE ap.status = 'closed' AND a.date BETWEEN ap.start_date AND ap.end_date)`;

async function seedAttendance(c, plans, stores, months) {
  const closed = await closedPeriods(c);
  const isClosed = (date) => closed.some((p) => date >= p.start && date <= p.end);
  const guard = closed.length ? `AND ${CLOSED_FILTER}` : "";
  // (a) Backfill absensi lama tanpa toko → penempatan utama yang berlaku pada tanggalnya.
  const backfill = await c.query(`
    UPDATE hris.attendance a SET branch_id = p.branch_id
      FROM hris.employee_placements p
     WHERE a.branch_id IS NULL AND p.employee_id = a.employee_id AND p.is_primary
       AND p.start_date <= a.date AND (p.end_date IS NULL OR p.end_date >= a.date) ${guard}`);

  // (b) Absensi demo: hapus hasil seeder sebelumnya pada bulan-bulan ini, isi ulang tanggal kosong.
  const first = monthDays(months[0])[0].date;
  const lastMonth = monthDays(months[months.length - 1]);
  const last = lastMonth[lastMonth.length - 1].date;
  await c.query(`DELETE FROM hris.attendance a WHERE notes = $1 AND date BETWEEN $2 AND $3 ${guard}`, [MARK, first, last]);
  const patterns = await shiftPatterns(c);
  const rand = D.rng(20261015);
  let inserted = 0, secondStore = 0;
  for (const p of plans) {
    if (SYSTEM_NIPS.has(p.nip)) continue;
    const primary = stores[p.items[0].code];
    const second = p.items[1] ? stores[p.items[1].code] : null;
    const pattern = patterns[p.id];
    for (const m of months) {
      for (const { date, dow } of monthDays(m)) {
        if (date < p.join_date || date < PLACEMENT_START || isClosed(date)) continue;
        const shift = pattern ? pattern[dow] : (dow === 7 ? null : { id: null, start: "09:00", end: "17:00" });
        if (!shift) continue;
        if (rand() < 0.03) continue; // tidak masuk (alpa/izin) — tidak ada baris
        const atSecond = second && (p.secondDays || []).includes(dow);
        const branch = atSecond ? second : primary;
        const lateMinutes = rand() < 0.12 ? 5 + Math.floor(rand() * 25) : 0;
        const clockIn = wibAt(date, shift.start, lateMinutes ? lateMinutes : -Math.floor(rand() * 10));
        const clockOut = rand() < 0.02 ? null : wibAt(date, shift.end, Math.floor(rand() * 20));
        const res = await c.query(`
          INSERT INTO hris.attendance (employee_id, date, clock_in, clock_out, status, is_late, late_minutes,
                                      branch_id, notes, shift_id, scheduled_start, scheduled_end)
          VALUES ($1, $2, $3, $4, 'present', $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (employee_id, date) DO NOTHING`,
          [p.id, date, clockIn, clockOut, lateMinutes > 0, lateMinutes, branch.id, MARK,
            shift.id, shift.id ? wibAt(date, shift.start) : null, shift.id ? wibAt(date, shift.end) : null]);
        inserted += res.rowCount;
        if (res.rowCount && atSecond) secondStore++;
      }
    }
  }
  console.log(`absensi           : ${backfill.rowCount} baris lama diberi toko; ${inserted} baris demo ` +
    `${first}..${last} (${secondStore} di toko kedua)`);
}

async function seedSalaries(c, plans, stores, periodStart) {
  let created = 0;
  for (const p of plans) {
    if (SYSTEM_NIPS.has(p.nip) || p.join_date > periodStart) continue;
    const s = SALARY[p.role] || SALARY.office;
    // Gaji dibayar entitas (perusahaan) toko utama karyawan — payroll dihitung per entitas (EPIC-054).
    const company = (stores[p.items[0].code] || stores["PD-PVJ"]).company_id;
    const res = await c.query(`
      INSERT INTO hris.employee_salary (employee_id, company_id, base_salary, fixed_allowance, transport_allowance,
                                        meal_allowance, ptkp_status, tapera_enrolled, effective_date, is_active, notes)
      SELECT $1, $2::uuid, $3, $4, $5, $6, $7, false, $8, true, $9
       WHERE NOT EXISTS (SELECT 1 FROM hris.employee_salary WHERE employee_id = $1)`,
      [p.id, company, s.base, s.fixed, s.transport, s.meal, s.ptkp, PLACEMENT_START, `${MARK} gaji demo (${p.role})`]);
    created += res.rowCount;
  }
  console.log(`struktur gaji     : ${created} karyawan diberi gaji demo (yang sudah punya gaji tidak diubah)`);
}

/* ── Payroll lewat API Go ─────────────────────────────────────────────── */

async function api(base, cookie, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error || json.message || ""}`.trim());
  return json;
}

async function login(base) {
  const email = process.env.SUPER_USER_EMAIL;
  const password = process.env.SUPER_USER_PASSWORD;
  if (!email || !password) throw new Error("SUPER_USER_EMAIL / SUPER_USER_PASSWORD belum diset");
  const res = await api(base, null, "POST", "/api/auth/login", { email, password });
  const token = res?.data?.session?.access_token;
  if (!token) throw new Error("login tidak mengembalikan sesi");
  return `nuhabit_session=${token}`;
}

/**
 * Buat (bila belum ada) lalu hitung run periode m untuk satu entitas; kembalikan run. Run non-draft
 * tidak disentuh. Run lama tanpa entitas pada periode itu membuat API menolak — pesannya diteruskan.
 */
async function calculateRun(base, cookie, m, entity) {
  const list = await api(base, cookie, "GET", `/api/hris/payroll?year=${m.year}`);
  let run = (list.data || []).find((r) => r.period_month === m.month && r.period_year === m.year && r.company_id === entity.id);
  if (!run) {
    run = (await api(base, cookie, "POST", "/api/hris/payroll",
      { period_month: m.month, period_year: m.year, company_id: entity.id })).data;
  }
  const label = `payroll ${m.month}/${m.year} ${entity.name}`;
  if (run.status !== "draft") {
    console.log(`${label}: run "${run.run_name}" berstatus ${run.status} — tidak dihitung ulang`);
    return run;
  }
  const calc = await api(base, cookie, "POST", `/api/hris/payroll/${run.id}/calculate`, { include_thr: false });
  const warn = calc.summary?.allocation_warnings?.length || 0;
  console.log(`${label}: ${calc.message}${warn ? ` — ${warn} karyawan tanpa toko` : ""}`);
  return { ...run, status: "draft" };
}

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober",
  "November", "Desember"];

/**
 * Jurnal payroll diposting pada tanggal dibayar; tanpa periode fiskal terbuka tidak ada jurnal.
 * Bila tahun berjalan belum punya tahun buku untuk perusahaan Paddy, buat "Tahun Buku <tahun>"
 * dengan 12 periode bulanan OPEN (pola bcdcoffee-demo-accounting). Tahun buku yang ada tidak diubah.
 */
async function ensureFiscalYear(c) {
  const today = wibToday();
  const year = Number(today.slice(0, 4));
  const company = (await c.query(`SELECT id FROM configuration.companies WHERE code = $1`, [D.COMPANY.code])).rows[0];
  if (!company) return;
  const covered = await c.query(`SELECT 1 FROM accounting.fiscal_periods p JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
     WHERE y.company_id = $1 AND y.deleted_at IS NULL AND p.start_date <= $2::date AND p.end_date >= $2::date`, [company.id, today]);
  if (covered.rowCount) return;
  await c.query("BEGIN");
  try {
    const fy = (await c.query(`INSERT INTO accounting.fiscal_years (company_id, code, name, start_date, end_date, is_active)
      VALUES ($1, $2, $3, $4::date, $5::date, true) RETURNING id`,
      [company.id, `FY${year}`, `Tahun Buku ${year}`, `${year}-01-01`, `${year}-12-31`])).rows[0];
    for (let m = 1; m <= 12; m++) {
      const start = `${year}-${String(m).padStart(2, "0")}-01`;
      const end = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
      await c.query(`INSERT INTO accounting.fiscal_periods (fiscal_year_id, period_no, name, start_date, end_date, status)
        VALUES ($1, $2, $3, $4::date, $5::date, 'OPEN')`, [fy.id, m, `${BULAN[m - 1]} ${year}`, start, end]);
    }
    await c.query("COMMIT");
    console.log(`tahun buku        : FY${year} ${D.COMPANY.code} dibuat (12 periode OPEN) agar jurnal payroll bisa terposting`);
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  }
}

async function seedPayroll(c, args) {
  if (args.includes("--skip-payroll")) {
    console.log("payroll           : dilewati (--skip-payroll)");
    return;
  }
  const base = (process.env.PADDY_API_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  let cookie;
  try {
    cookie = await login(base);
  } catch (err) {
    console.log(`payroll           : dilewati — API ${base} tidak dapat dipakai (${err.message}).`);
    console.log("                    Jalankan API Go lalu ulangi, atau buat & hitung run dari menu HRIS → Penggajian.");
    return;
  }
  // Payroll dihitung per entitas (EPIC-054): satu run per perusahaan yang punya gaji aktif.
  const entities = (await api(base, cookie, "GET", "/api/hris/payroll/entities")).data || [];
  const paying = new Set((await c.query(`SELECT DISTINCT company_id::text AS id FROM hris.employee_salary
     WHERE is_active AND company_id IS NOT NULL`)).rows.map((r) => r.id));
  const targets = entities.filter((e) => paying.has(e.id));
  const tryRun = async (m, e) => {
    try {
      return await calculateRun(base, cookie, m, e);
    } catch (err) {
      console.log(`payroll ${m.month}/${m.year} ${e.name}: dilewati — ${err.message}`);
      return null;
    }
  };
  for (const e of targets) await tryRun(monthsBack(1), e);
  if (!args.includes("--paid-run")) return;
  const earlier = monthsBack(2);
  for (const e of targets) {
    const run = await tryRun(earlier, e);
    if (!run || run.status === "paid") continue;
    await ensureFiscalYear(c);
    // Payroll hanya bisa diproses setelah periode absensinya di-closing.
    const period = (await api(base, cookie, "GET", `/api/hris/payroll/${run.id}`)).data.attendance_period;
    if (period?.id && period.status === "open") {
      await api(base, cookie, "POST", `/api/hris/attendance-periods/${period.id}/close`);
      console.log(`absensi ${earlier.month}/${earlier.year}    : periode ${period.label} di-closing (syarat proses payroll)`);
    }
    for (const status of ["processing", "completed", "paid"]) {
      const cur = (await api(base, cookie, "GET", `/api/hris/payroll/${run.id}`)).data.status;
      if (cur === status || cur === "paid") continue;
      await api(base, cookie, "PUT", `/api/hris/payroll/${run.id}`, { status });
    }
    console.log(`payroll ${earlier.month}/${earlier.year} ${e.name}: diproses → disetujui → dibayar (jurnal per toko lewat outbox)`);
  }
}

async function main() {
  D.loadEnv();
  const args = process.argv.slice(2);
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL");
    process.exit(1);
  }
  assertLocalOrAllowed(url);
  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    const months = [monthsBack(2), monthsBack(1)];
    await c.query("BEGIN");
    const stores = await branchesByCode(c);
    const plans = await seedPlacements(c, stores);
    await seedAttendance(c, plans, stores, months);
    await seedSalaries(c, plans, stores, monthDays(months[0])[0].date);
    await c.query("COMMIT");
    await seedPayroll(c, args);
    console.log("Selesai. Lihat HRIS → Master Data → Penempatan Karyawan dan HRIS → Penggajian → Biaya Gaji per Toko.");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
