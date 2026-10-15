#!/usr/bin/env node
/**
 * Seeder DEMO REKRUTMEN Paddy (schema recruitment) — lowongan, kandidat di semua tahap
 * pipeline, screening, psikotes online, interview AI, offer, serta bank soal psikotes.
 *
 * Yang dibuat (deterministik lewat PADDY_SEED, default 2026; tanggal relatif ke hari ini):
 *   - hris.departments / hris.positions : departemen & posisi Paddy yang belum ada (Sales Associate,
 *       Graphic Designer, Operator Produksi & Cetak, Content Creator, Admin Gudang, CS Online) dan
 *       rentang gaji posisi (hanya bila masih kosong)
 *   - recruitment.job_openings      : 8 lowongan (published / closed / draft), upsert per slug
 *   - recruitment.psikotes_questions: bank soal Aritmatika (33), Matematika (33), PAPI (90 pasangan
 *       ORIGINAL, lihat lib/paddy-psikotes-bank.js), upsert per id deterministik
 *   - recruitment.candidates (47) + candidate_activities, candidate_notes, candidate_screenings,
 *       candidate_ai_analysis, psikotes_sessions + psikotes_session_tests (skor dihitung dengan logika
 *       domain.ScoreMcq / domain.ScorePapi), candidate_psikotes_summary, interview_ai_sessions +
 *       interview_ai_turns (ringkasan AI berbentuk sama dengan files_interview.go summarize),
 *       interviews (scorecard HR/user), candidate_offers
 *   - Gambar tes Baum/DAP/Wartegg (PNG placeholder via sharp) di storage private API:
 *       PADDY_STORAGE_VOLUME=<volume docker> (mis. paddydev-storage, disalin lewat `docker run alpine`),
 *       atau STORAGE_DIR, atau default frontend/storage (sama dengan default API Go lokal).
 *       Tanpa sharp / storage, attachment_path dibiarkan NULL.
 *
 * Idempoten: kandidat seeder dikenali dari email `…+paddyseed@example.com`; setiap jalan menghapus
 * kandidat itu (anak-anaknya ikut terhapus lewat ON DELETE CASCADE) lalu membuat ulang. Kandidat
 * nyata, lowongan lain, dan soal buatan HR tidak disentuh. Trigger notifikasi kandidat/interview
 * dimatikan sementara di dalam transaksi supaya data demo tidak membanjiri notifikasi HR.
 *
 * Usage:
 *   pnpm db:seed:paddy-recruitment
 *   PADDY_STORAGE_VOLUME=paddydev-storage node seeders/paddy-recruitment.js
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { assertLocalOrAllowed } = require("./lib/seed-password");
const S = require("./lib/paddy-spa-data");
const R = require("./lib/paddy-recruitment-data");
const BANK = require("./lib/paddy-psikotes-bank");
const { loadSharp, drawingPng } = require("./lib/paddy-recruitment-drawings");

const SEED = Number(process.env.PADDY_SEED || process.env.MIZU_SEED || 2026);
const NOW = Date.now();
const HOUR = 3600000;
const DAY = 24 * HOUR;
const MIN = 60000;

/* ── helpers ─────────────────────────────────────────────────────────── */

/** UUID stabil dari sebuah kunci (format v4) — URL kandidat & path gambar tetap sama antar-run. */
function uid(key) {
  const h = crypto.createHash("sha1").update(`paddy-recruitment:${SEED}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Token portal seperti newPortalToken() Go: 32 byte acak → 64 hex. */
const portalToken = () => crypto.randomBytes(32).toString("hex");
const iso = (ms) => new Date(ms).toISOString();
const wibDate = (ms) => new Date(ms + 7 * HOUR).toISOString().slice(0, 10);
const rupiah = (n) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const juta = (n) => `Rp${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 2 })} juta`;
const slugName = (name) => name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
const first = (name) => name.split(" ")[0];
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

const STAGES = ["applied", "screening", "psikotes", "interview", "offer", "hired"];
const STATUS_LABEL = { applied: "Applied", screening: "Screening", psikotes: "Psikotes", interview: "Interview", offer: "Offer",
  hired: "Hired", talent_pool: "Talent Pool", rejected: "Tolak", archived: "Diarsipkan" };
const REC_LABEL = { lolos: "Lolos", hold: "Hold", tidak_lolos: "Tidak Lolos" };
const WA_LABEL = { undangan_screening: "Undangan Screening", lolos_psikotes: "Lolos → Lanjut Psikotes",
  undangan_psikotes: "Undangan Psikotes Online", undangan_interview: "Undangan Interview AI",
  lolos_interview: "Lolos → Lanjut Interview", lolos_offer: "Lolos → Lanjut Offer",
  offer_terkirim: "Penawaran Kerja Terkirim", penolakan: "Penolakan Halus" };
const OFFER_ACTION = { accepted: "menerima", negotiating: "mengajukan negosiasi", declined: "menolak" };
const PAPI_LABELS = { N: "Kebutuhan Menyelesaikan Tugas", G: "Peran Pekerja Keras", A: "Dorongan Berprestasi",
  L: "Peran Kepemimpinan", P: "Kebutuhan Mengatur Orang Lain", I: "Peran Membuat Keputusan", T: "Peran Sibuk",
  V: "Peran Penuh Semangat", X: "Kebutuhan Diperhatikan", S: "Peran Hubungan Sosial", B: "Kebutuhan Diterima Kelompok",
  O: "Kedekatan & Kasih Sayang", R: "Peran Teoretis", D: "Peran Bekerja dengan Detail", C: "Peran Keteraturan",
  Z: "Kebutuhan akan Perubahan", E: "Pengendalian Emosi", K: "Kebutuhan Agresi", F: "Dukungan terhadap Atasan",
  W: "Kebutuhan Aturan & Arahan" };

async function insertMany(c, table, columns, rows, chunk = 200) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params = [];
    const values = part.map((row) => `(${row.map((v) => {
      params.push(v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);
      return `$${params.length}`;
    }).join(", ")})`);
    await c.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${values.join(", ")}`, params);
  }
}

/* ── scoring: cermin domain/psikotes.go ──────────────────────────────── */

/** domain.ScoreMcq: skor 0..100 dibulatkan setengah ke atas atas soal yang punya kunci. */
function scoreMcq(questions, answers) {
  const detail = { total: 0, correct: 0, per_question: [] };
  for (const q of questions) {
    const correct = q.answer_key && typeof q.answer_key.correct === "string" ? q.answer_key.correct : "";
    if (!correct) continue;
    const given = Object.prototype.hasOwnProperty.call(answers, q.id) ? answers[q.id] : null;
    const item = { id: q.id, given, correct_key: correct, is_correct: given !== null && given === correct };
    if (item.is_correct) detail.correct++;
    detail.per_question.push(item);
  }
  detail.total = detail.per_question.length;
  const score = detail.total ? Math.floor((detail.correct / detail.total) * 100 + 0.5) : 0;
  return { score, detail };
}

/** domain.ScorePapi: hitung skala pilihan tiap pasangan; dominan = skala dengan hitungan tertinggi. */
function scorePapi(questions, answers) {
  const res = { scales: Object.fromEntries(BANK.PAPI_SCALES.map((s) => [s, 0])), dominant: [], answered: 0, total: 0 };
  for (const q of questions) {
    const a = q.options?.a?.scale;
    const b = q.options?.b?.scale;
    if (typeof a !== "string" || typeof b !== "string" || !a || !b) continue;
    res.total++;
    const pick = answers[q.id];
    const scale = pick === "a" ? a : pick === "b" ? b : null;
    if (!scale || !(scale in PAPI_LABELS)) continue;
    res.scales[scale]++;
    res.answered++;
  }
  const top = Math.max(0, ...Object.values(res.scales));
  if (top > 0) {
    for (const code of BANK.PAPI_SCALES) {
      if (res.scales[code] === top) res.dominant.push({ code, label: PAPI_LABELS[code], count: top });
    }
  }
  return res;
}

/* ── master data ─────────────────────────────────────────────────────── */

async function ensureMaster(c) {
  const brandRows = await c.query(`SELECT id, name FROM item.brands WHERE name = ANY($1)`, [Object.values(R.BRANDS)]);
  const brands = {};
  for (const [key, name] of Object.entries(R.BRANDS)) {
    brands[key] = brandRows.rows.find((b) => b.name === name)?.id || null;
    if (!brands[key]) console.warn(`  ! brand "${name}" belum ada — lowongan/kandidat tanpa brand`);
  }
  const departments = {};
  let newDepartments = 0;
  for (const d of R.DEPARTMENTS) {
    let r = await c.query(`SELECT id, name FROM hris.departments WHERE code = $1`, [d.code]);
    if (!r.rowCount) {
      r = await c.query(
        `INSERT INTO hris.departments (name, code, description, brand_id, is_active) VALUES ($1, $2, $3, $4, true) RETURNING id, name`,
        [d.name, d.code, d.description, d.brand ? brands[d.brand] : null]);
      newDepartments++;
    }
    departments[d.code] = { id: r.rows[0].id, name: r.rows[0].name };
  }
  const positions = {};
  let newPositions = 0;
  for (const p of R.POSITIONS) {
    const dept = departments[p.dept];
    // posisi kembar (salinan lama) → pilih yang paling banyak dipakai karyawan
    let r = await c.query(
      `SELECT p.id, p.title, p.department, p.level FROM hris.positions p
        WHERE p.title = $1 AND p.department = $2
        ORDER BY (SELECT count(*) FROM hris.employees e WHERE e.job_title_id = p.id) DESC, p.created_at LIMIT 1`,
      [p.title, dept.name]);
    if (!r.rowCount) {
      r = await c.query(
        `INSERT INTO hris.positions (title, department, level, is_active, salary_min, salary_max)
         VALUES ($1, $2, $3, true, $4, $5) RETURNING id, title, department, level`, [p.title, dept.name, p.level, p.min, p.max]);
      newPositions++;
    } else {
      await c.query(`UPDATE hris.positions SET salary_min = COALESCE(salary_min, $2), salary_max = COALESCE(salary_max, $3) WHERE id = $1`,
        [r.rows[0].id, p.min, p.max]);
    }
    positions[p.key] = { ...r.rows[0], key: p.key, min: p.min, max: p.max };
  }
  return { brands, departments, positions, newDepartments, newPositions };
}

async function seedJobs(c, m) {
  const jobs = {};
  for (const j of R.JOBS) {
    const publishedAt = j.published == null ? null : NOW - j.published * DAY;
    const createdAt = (publishedAt ?? NOW - 3 * DAY) - 1 * DAY;
    const closing = j.closing == null ? null : wibDate(NOW + j.closing * DAY);
    const dept = m.departments[j.dept];
    const r = await c.query(
      `INSERT INTO recruitment.job_openings (position_id, brand_id, department_id, title, slug, department, location,
         employment_type, work_mode, headcount, description, requirements, benefits, status, published_at, closing_date,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now())
       ON CONFLICT (slug) DO UPDATE SET position_id = EXCLUDED.position_id, brand_id = EXCLUDED.brand_id,
         department_id = EXCLUDED.department_id, title = EXCLUDED.title, department = EXCLUDED.department,
         location = EXCLUDED.location, employment_type = EXCLUDED.employment_type, work_mode = EXCLUDED.work_mode,
         headcount = EXCLUDED.headcount, description = EXCLUDED.description, requirements = EXCLUDED.requirements,
         benefits = EXCLUDED.benefits, status = EXCLUDED.status, published_at = EXCLUDED.published_at,
         closing_date = EXCLUDED.closing_date, created_at = EXCLUDED.created_at
       RETURNING id`,
      [m.positions[j.position].id, m.brands[j.brand], dept.id, j.title, j.slug, dept.name, j.location, j.type, j.mode,
        j.headcount, j.description, j.requirements, j.benefits, j.status, publishedAt ? iso(publishedAt) : null, closing,
        iso(createdAt)]);
    jobs[j.key] = { ...j, id: r.rows[0].id, publishedAt: publishedAt ?? createdAt, deptName: dept.name };
  }
  return jobs;
}

/** Bank soal: upsert per id deterministik (soal tambahan buatan HR tidak disentuh). */
async function seedBank(c, rand) {
  const inst = await c.query(`SELECT id, code, name, kind, config FROM recruitment.psikotes_instruments`);
  const instruments = Object.fromEntries(inst.rows.map((r) => [r.code, r]));
  const sets = { aritmatika: BANK.mcqItems(BANK.ARITMATIKA, rand), matematika: BANK.mcqItems(BANK.MATEMATIKA, rand),
    papi_kostick: BANK.papiItems() };
  const counts = {};
  for (const [code, items] of Object.entries(sets)) {
    const instrument = instruments[code];
    if (!instrument) {
      console.warn(`  ! instrumen ${code} tidak ada — bank soal dilewati`);
      continue;
    }
    for (const q of items) {
      await c.query(
        `INSERT INTO recruitment.psikotes_questions (id, instrument_id, body, options, answer_key, sort_order, is_active)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, true)
         ON CONFLICT (id) DO UPDATE SET instrument_id = EXCLUDED.instrument_id, body = EXCLUDED.body,
           options = EXCLUDED.options, answer_key = EXCLUDED.answer_key, sort_order = EXCLUDED.sort_order, is_active = true`,
        [uid(`question:${code}:${q.sort_order}`), instrument.id, q.body, JSON.stringify(q.options),
          q.answer_key ? JSON.stringify(q.answer_key) : null, q.sort_order]);
    }
    counts[code] = items.length;
  }
  // bank aktif (termasuk soal HR) dalam urutan yang sama dengan DrawQuestionIDs
  const bank = {};
  for (const code of Object.keys(sets)) {
    if (!instruments[code]) continue;
    bank[code] = (await c.query(
      `SELECT id::text, options, answer_key FROM recruitment.psikotes_questions
        WHERE instrument_id = $1 AND is_active ORDER BY sort_order, created_at`, [instruments[code].id])).rows;
  }
  return { instruments, bank, counts };
}

/* ── rencana kandidat ────────────────────────────────────────────────── */

function familyOf(m, spec, job) {
  if (job) return job.family;
  return spec.position === "manager" ? "manager" : "retail";
}

function expectedSalary(rand, posKey, q) {
  const base = { crew: [4.3, 4.9], front: [4.2, 4.7], sales: [4.2, 4.8], cs: [4.3, 5.0], operator: [4.3, 5.2],
    gudang: [4.3, 4.9], designer: [5.0, 7.5], content: [4.8, 6.8], manager: [7.0, 9.5] }[posKey];
  const v = base[0] + (base[1] - base[0]) * (0.3 * rand() + 0.7 * q * rand() + 0.2 * rand());
  const step = posKey === "manager" || posKey === "designer" || posKey === "content" ? 250000 : 100000;
  return Math.round((Math.min(v, base[1]) * 1e6) / step) * step;
}

/**
 * Susun rencana satu kandidat: urutan milestone (jam relatif dari lamaran) yang nanti
 * di-anchor ke waktu nyata. Setiap milestone punya `at` (jam) dan payload aktivitas.
 */
function planCandidate(spec, ctx) {
  const { rand } = ctx;
  const between = (a, b) => a + rand() * (b - a);
  const reach = spec.reach || (STAGES.includes(spec.status) ? spec.status : "applied");
  const reachIdx = STAGES.indexOf(reach);
  const steps = [];
  let t = 0;
  const step = (gap, kind, data = {}) => {
    t += gap;
    steps.push({ at: t, kind, ...data });
    return t;
  };
  steps.push({ at: 0, kind: "applied" });
  let stage = "applied";
  const move = (gap, to) => {
    step(gap, "status", { from: stage, to });
    stage = to;
  };
  if (reachIdx >= 1 || spec.scr) {
    move(between(8, 48), "screening");
    step(0.05, "wa", { template: "undangan_screening" });
    step(between(3, 30), "screening", { rec: spec.scr === "call" ? null : spec.scr });
  }
  if (reachIdx >= 2) {
    move(between(2, 20), "psikotes");
    step(0.03, "psikotes_invited");
    step(0.05, "wa", { template: "undangan_psikotes" });
    if (spec.ps === "in_progress") step(between(4, 30), "psikotes_started");
    if (spec.ps === "completed") {
      step(between(4, 36), "psikotes_started");
      step(1, "psikotes_completed");
      if (spec.psRec) {
        step(between(4, 24), "psikotes_reviewed");
        step(between(0.3, 3), "psikotes_summary", { rec: spec.psRec });
      } else {
        step(between(2, 10), "psikotes_insight");
      }
    }
  }
  if (reachIdx >= 3) {
    step(between(1, 12), "wa", { template: "lolos_interview" });
    move(0.05, "interview");
    step(0.03, "interview_invited");
    step(0.05, "wa", { template: "undangan_interview" });
    if (spec.ai === "in_progress") step(between(4, 30), "interview_started");
    if (spec.ai === "completed") {
      step(between(4, 36), "interview_started");
      step(0.25, "interview_completed");
      if (reachIdx >= 4 || ctx.family === "manager") {
        step(between(18, 60), "hr_interview", { type: "hrd" });
        step(between(18, 60), "hr_interview", { type: "hiring_manager" });
      }
    }
  }
  if (reachIdx >= 4) {
    step(between(1, 10), "wa", { template: "lolos_offer" });
    move(0.05, "offer");
    spec.offers.forEach((status, i) => {
      step(i ? between(6, 30) : between(0.5, 6), "offer_sent", { version: i + 1 });
      step(0.05, "wa", { template: "offer_terkirim" });
      if (status !== "sent") step(between(5, 40), "offer_response", { version: i + 1, status });
    });
  }
  if (spec.status === "hired") move(between(3, 24), "hired");
  if (spec.status === "rejected") {
    step(between(2, 30), "wa", { template: "penolakan" });
    move(0.1, "rejected");
  }
  if (spec.status === "talent_pool") move(between(3, 30), "talent_pool");
  if (spec.status === "archived") {
    move(between(3, 30), "talent_pool");
    move(between(48, 200), "archived");
  }
  return { steps, reach, total: t };
}

/** Waktu akhir rencana (ms) menurut sifat tahap terakhir kandidat. */
function anchorEnd(spec, job, rand) {
  const between = (a, b) => a + rand() * (b - a);
  if (spec.ps === "expired") return NOW - between(9, 12) * DAY;
  if (spec.open) return NOW - between(3, 50) * HOUR;
  if (job && job.status === "closed") return NOW - between(8, 18) * DAY;
  if (["hired", "rejected", "talent_pool", "archived"].includes(spec.status)) return NOW - between(1, 9) * DAY;
  if (spec.status === "applied") return NOW - between(2, 200) * HOUR;
  return NOW - between(10, 120) * HOUR;
}

/* ── storage gambar tes ──────────────────────────────────────────────── */

function storageTarget() {
  if (process.env.PADDY_STORAGE_VOLUME) return { kind: "volume", volume: process.env.PADDY_STORAGE_VOLUME };
  const dir = process.env.STORAGE_DIR || path.join(__dirname, "..", "..", "..", "frontend", "storage");
  return { kind: "dir", dir };
}

/** Salin gambar ke storage private API; mengembalikan true bila berhasil. */
function deliverFiles(files, sessionIds) {
  if (!files.length) return true;
  const target = storageTarget();
  try {
    if (target.kind === "dir") {
      const root = path.join(target.dir, "private", "psikotes");
      for (const id of sessionIds) fs.rmSync(path.join(root, id), { recursive: true, force: true });
      for (const f of files) {
        const abs = path.join(target.dir, "private", f.rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.data);
      }
      console.log(`gambar tes        : ${files.length} file → ${path.join(target.dir, "private", "psikotes")}`);
      return true;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paddy-psikotes-"));
    try {
      for (const f of files) {
        const abs = path.join(tmp, f.rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.data);
      }
      execFileSync("chmod", ["-R", "a+rX", tmp]);
      const ids = sessionIds.join(" ");
      execFileSync("docker", ["run", "--rm", "-v", `${target.volume}:/s`, "-v", `${tmp}:/src:ro`, "-u", "1001:1001",
        "alpine:3.20", "sh", "-c",
        `mkdir -p /s/private/psikotes && cd /s/private/psikotes && for d in ${ids}; do rm -rf "$d"; done && cp -r /src/psikotes/. /s/private/psikotes/`],
      { stdio: ["ignore", "ignore", "inherit"] });
      console.log(`gambar tes        : ${files.length} file → volume ${target.volume}:/private/psikotes`);
      return true;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`  ! gagal menyalin gambar tes (${err.message}) — attachment_path dibiarkan NULL`);
    return false;
  }
}

/* ── pembentukan data per kandidat ───────────────────────────────────── */

function buildAll(m, jobs, bankInfo, rand) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const chance = (p) => rand() < p;
  const between = (a, b) => a + rand() * (b - a);
  const out = { candidates: [], activities: [], notes: [], screenings: [], analyses: [], sessions: [], tests: [],
    summaries: [], aiSessions: [], turns: [], interviews: [], offers: [], drawings: [] };
  const usedDom = new Set();

  R.CANDIDATES.forEach((spec, idx) => {
    const job = spec.job ? jobs[spec.job] : null;
    const posKey = job ? job.position : spec.position;
    const pos = m.positions[posKey];
    const brandKey = job ? job.brand : spec.brand;
    const family = familyOf(m, spec, job);
    const id = uid(`candidate:${idx}`);
    const q = spec.q;
    let dom = pick(R.DOMICILES);
    if (usedDom.has(dom) && chance(0.7)) dom = pick(R.DOMICILES);
    usedDom.add(dom);
    if (brandKey === "KOPO" && chance(0.6)) dom = pick(["Kopo, Bandung", "Margahayu, Kab. Bandung", "Soreang, Kab. Bandung", "Cibaduyut, Bandung", "Dayeuhkolot, Kab. Bandung"]);
    if (brandKey === "PVJ" && chance(0.6)) dom = pick(["Sukajadi, Bandung", "Setiabudi, Bandung", "Sarijadi, Bandung", "Cicendo, Bandung", "Pasteur, Bandung"]);
    const edu = pick(R.EDUCATION[family]);
    const exp = pick(R.EXPERIENCE[posKey] || R.EXPERIENCE.crew);
    const avail = family === "manager" ? pick(["2_weeks", "1_month"]) : pick(["immediate", "immediate", "1_week", "2_weeks", "1_month"]);
    const salary = expectedSalary(rand, posKey, q);
    const email = `${slugName(spec.name)}${R.EMAIL_MARK}`;
    const phone = `0812-9${String(100 + idx * 7).padStart(3, "0")}-${String(1000 + ((idx * 7919) % 9000)).padStart(4, "0")}`;

    const plan = planCandidate(spec, { rand, family });
    let end = anchorEnd(spec, job, rand);
    let created = end - plan.total * HOUR;
    const earliest = Math.max(NOW - 60 * DAY, job ? job.publishedAt + 6 * HOUR : NOW - 60 * DAY);
    let scale = 1;
    if (created < earliest) {
      scale = Math.max(0.1, (end - earliest) / (plan.total * HOUR || 1));
      created = earliest;
      if (end - created < 6 * HOUR) end = created + 6 * HOUR;
    }
    const at = (s) => Math.round(created + s.at * HOUR * scale);
    const lastAt = plan.steps.length ? at(plan.steps[plan.steps.length - 1]) : created;

    const vars = { first: first(spec.name), name: spec.name, dom: dom.split(",")[0], edu, exp: exp.split(" (")[0].replace(" - ", " di "),
      avail: R.AVAILABILITY_TEXT[avail], salary: juta(salary) };
    const cand = { id, full_name: spec.name, email, phone, domicile: dom, source: spec.src, position_id: pos.id,
      brand_id: m.brands[brandKey], job_opening_id: job ? job.id : null, status: spec.status,
      notes: null, created_at: iso(created), updated_at: iso(lastAt), last_experience: exp, last_education: edu,
      availability: avail, expected_salary: salary };
    if (spec.src === "walk_in") cand.notes = `Datang langsung ke ${brandKey === "KOPO" ? "Paddy Store Kopo" : "Paddy Store PVJ"} dan mengisi form lamaran.`;
    else if (spec.src === "referral" || spec.src === "internal_referral") cand.notes = `Direferensikan oleh ${pick(["Nadia Putri (Crew PVJ)", "Shafa Kamila (Crew Kopo)", "Fikri Maulana (Store Manager PVJ)", "Reza Mahendra (Store Manager Kopo)"])}.`;
    else if (family === "creative") cand.notes = `Portofolio: behance.net/${slugName(spec.name).replace(/\./g, "")} (demo)`;
    out.candidates.push(cand);

    const act = (ms, type, description, by = R.HR) => out.activities.push([id, type, description, by, iso(ms)]);
    const positionTitle = pos.title;
    const ctxState = { psikotes: null, ai: null, offers: [] };
    const tests = job ? job.tests : ["papi_kostick", "aritmatika", "baum"];
    const manager = R.MANAGERS[brandKey === "HQ" ? "HQ" : brandKey];

    for (const s of plan.steps) {
      const when = at(s);
      switch (s.kind) {
        case "status":
          act(when, "status_change", `Tahap diubah: ${STATUS_LABEL[s.from]} → ${STATUS_LABEL[s.to]}`);
          break;
        case "wa":
          act(when, "wa_template_sent", `Template WA "${WA_LABEL[s.template]}" dibuka`);
          break;
        case "screening": {
          const rec = s.rec;
          const rejected = rec === "tidak_lolos";
          const unreachable = rejected && spec.src === "other";
          out.screenings.push({
            candidate_id: id, contacted: true, interested: unreachable ? null : !rejected || chance(0.5),
            availability_note: unreachable ? "Tidak bisa dihubungi setelah 3x telepon" : `Bisa mulai ${R.AVAILABILITY_TEXT[avail]}`,
            confirmed_salary: unreachable ? null : Math.round((salary * (rejected ? between(1.0, 1.25) : between(0.97, 1.05))) / 50000) * 50000,
            willing_shift: unreachable ? null : rejected ? false : family === "creative" ? null : true,
            willing_placement: unreachable ? null : rejected ? chance(0.5) : true,
            notes: unreachable ? "WA tidak dibalas dan telepon tidak diangkat."
              : rejected ? `Kandidat keberatan dengan shift malam sampai pukul 22.00 dan lokasi ${job ? job.location.split("— ")[1] || job.location : "toko"}.`
                : rec === "hold" ? "Komunikasi baik, tetapi pengalaman masih minim. Tunggu kandidat lain sebelum lanjut."
                  : rec === "lolos" ? `Komunikatif dan antusias. ${family === "creative" ? "Portofolio sesuai gaya visual Paddy." : "Siap shift dan akhir pekan."}`
                    : "Sudah ditelepon, menunggu kandidat mengirim dokumen pendukung.",
            recommendation: rec, updated_by_name: R.HR, created_at: iso(when), updated_at: iso(when),
          });
          act(when, "screening_updated", `Hasil screening disimpan${rec ? ` (rekomendasi: ${REC_LABEL[rec]})` : ""}`);
          break;
        }
        case "psikotes_invited": {
          const sessionId = uid(`psikotes:${idx}`);
          const expires = when + 7 * DAY;
          const status = spec.ps;
          ctxState.psikotes = { id: sessionId, invited: when, status, tests: [] };
          out.sessions.push({ id: sessionId, candidate_id: id, token: portalToken(), status: status === "completed" ? "completed" : status,
            webcam_consent: status === "completed" || status === "in_progress" ? true : null, invited_at: iso(when), expires_at: iso(expires),
            started_at: null, completed_at: null, created_by_name: R.HR, created_at: iso(when), updated_at: iso(when) });
          tests.forEach((code, i) => {
            const t = { id: uid(`psikotes:${idx}:${code}`), session_id: sessionId, code, instrument_id: bankInfo.instruments[code].id,
              kind: bankInfo.instruments[code].kind, status: "pending", answers: null, score: null, score_detail: null,
              attachment_path: null, review_notes: null, reviewed_by_name: null, sort_order: i, started_at: null,
              completed_at: null, ai_insight: null, created_at: iso(when), updated_at: iso(when) };
            ctxState.psikotes.tests.push(t);
            out.tests.push(t);
          });
          const names = tests.map((code) => bankInfo.instruments[code].name).join(", ");
          act(when, "psikotes_invited", `Undangan psikotes online dibuat (${names}; berlaku 7 hari)`);
          break;
        }
        case "psikotes_started": {
          const sess = out.sessions.find((x) => x.id === ctxState.psikotes.id);
          sess.started_at = iso(when);
          sess.updated_at = iso(when);
          let cursor = when + between(1, 3) * MIN;
          for (const t of ctxState.psikotes.tests) {
            const running = spec.ps === "in_progress";
            if (running && t.sort_order > 1) break; // tes ketiga dst. belum dimulai
            const duration = t.kind === "forced_choice" ? between(14, 26) : t.kind === "mcq" ? between(5, 9.5) : between(9, 16);
            t.started_at = iso(cursor);
            const inProgressNow = running && t.sort_order === 1;
            fillTest(t, { q, family, inProgress: inProgressNow, rand, bank: bankInfo.bank });
            if (!inProgressNow) t.completed_at = iso(cursor + duration * MIN);
            t.updated_at = t.completed_at || t.started_at;
            if (t.kind === "drawing" && !inProgressNow) {
              t.status = "perlu_review";
              const variant = q >= 0.6 ? 0 : 1;
              t.variant = variant;
              const sessId = ctxState.psikotes.id;
              const done = cursor + duration * MIN;
              const hex = crypto.createHash("sha1").update(t.id).digest("hex").slice(0, 16);
              t.attachment_rel = `psikotes/${sessId}/${t.id}/${Math.round(done)}-${hex}.png`;
              out.drawings.push({ test: t, code: t.code, variant });
            }
            cursor += (duration + between(0.5, 2)) * MIN;
          }
          ctxState.psikotes.cursor = cursor;
          break;
        }
        case "psikotes_completed": {
          const sess = out.sessions.find((x) => x.id === ctxState.psikotes.id);
          const done = Math.max(when, ctxState.psikotes.cursor || when);
          sess.completed_at = iso(done);
          sess.updated_at = iso(done);
          act(done, "psikotes_completed", "Kandidat menyelesaikan seluruh rangkaian psikotes online", "Sistem");
          break;
        }
        case "psikotes_insight":
        case "psikotes_reviewed": {
          for (const t of ctxState.psikotes.tests.filter((x) => x.kind === "drawing")) {
            const note = R.DRAWING_NOTES[t.code][t.variant ?? 0];
            const viaAi = chance(0.5);
            t.ai_insight = {
              observation: note.observation, observation_source: viaAi ? "ai" : "manual", vision_model: viaAi ? "gpt-4o-mini" : null,
              insight: { ringkasan: note.ringkasan, indikasi: note.indikasi.map(([aspek, insight]) => ({ aspek, insight })),
                perhatikan_saat_interview: note.perhatikan, keterbatasan: R.DRAWING_LIMIT },
              model: "deepseek-chat", created_at: iso(when - 20 * MIN), created_by_name: R.HR,
            };
            t.updated_at = iso(when);
            if (s.kind === "psikotes_reviewed") {
              t.status = "reviewed";
              t.review_notes = note.review;
              t.reviewed_by_name = R.HR;
              act(when, "psikotes_reviewed", `Hasil tes ${bankInfo.instruments[t.code].name} direview manual`);
            }
          }
          break;
        }
        case "psikotes_summary": {
          const rec = s.rec;
          const papi = ctxState.psikotes.tests.find((x) => x.kind === "forced_choice")?.score_detail;
          const dom = papi?.dominant?.map((d) => `${d.code} (${d.label})`).join(", ") || "-";
          const mcq = ctxState.psikotes.tests.filter((x) => x.kind === "mcq").map((x) => `${bankInfo.instruments[x.code].name} ${x.score}`).join(", ");
          out.summaries.push({ candidate_id: id, recommendation: rec,
            notes: `${mcq ? `Skor ${mcq}. ` : ""}PAPI dominan: ${dom}. ${rec === "lolos" ? `Profil sesuai kebutuhan ${positionTitle}; lanjut interview.`
              : rec === "hold" ? "Beberapa indikasi perlu divalidasi saat interview; tahan sambil menunggu kandidat lain."
                : "Skor tes di bawah standar minimal dan profil kurang sesuai untuk peran ini."}`,
            updated_by_name: R.HR, created_at: iso(when), updated_at: iso(when) });
          act(when, "psikotes_summary_updated", `Rekomendasi psikotes disimpan (rekomendasi: ${REC_LABEL[rec]})`);
          break;
        }
        case "interview_invited": {
          const sessionId = uid(`interview:${idx}`);
          const maxQ = family === "manager" ? 8 : pick([6, 6, 8]);
          ctxState.ai = { id: sessionId, maxQ };
          out.aiSessions.push({ id: sessionId, candidate_id: id, token: portalToken(), status: spec.ai, webcam_consent: spec.ai === "sent" ? null : true,
            config: { max_questions: maxQ }, ai_summary: null, summary_model: null, summarized_at: null, invited_at: iso(when),
            expires_at: iso(when + 7 * DAY), started_at: null, completed_at: null, created_by_name: R.HR, created_at: iso(when), updated_at: iso(when) });
          act(when, "interview_ai_invited", `Undangan interview AI dibuat (maks ${maxQ} pertanyaan; berlaku 7 hari)`);
          break;
        }
        case "interview_started": {
          const sess = out.aiSessions.find((x) => x.id === ctxState.ai.id);
          sess.started_at = iso(when);
          sess.updated_at = iso(when);
          const turns = interviewTurns(spec, { family, posKey, vars, positionTitle, rand, maxQ: ctxState.ai.maxQ });
          const limit = spec.ai === "in_progress" ? 4 : turns.length;
          const voice = chance(0.6);
          let cursor = when + 0.5 * MIN;
          turns.slice(0, limit).forEach((turn, i) => {
            const answered = !(spec.ai === "in_progress" && i === limit - 1);
            const asked = cursor;
            const mode = voice ? (chance(0.85) ? "voice" : "text") : (chance(0.85) ? "text" : "voice");
            const answeredAt = asked + between(0.8, 2.6) * MIN;
            out.turns.push({ session_id: sess.id, turn_no: i + 1, topic: turn.topic, question: turn.question,
              answer_transcript: answered ? turn.answer : null, answer_mode: answered ? mode : null,
              transcribe_model: answered && mode === "voice" ? "whisper-1" : null, asked_at: iso(asked),
              answered_at: answered ? iso(answeredAt) : null, created_at: iso(asked) });
            cursor = answeredAt + between(0.1, 0.4) * MIN;
          });
          ctxState.ai.cursor = cursor;
          ctxState.ai.turns = Math.min(limit, turns.length);
          ctxState.ai.skills = turns.skills;
          break;
        }
        case "interview_completed": {
          const sess = out.aiSessions.find((x) => x.id === ctxState.ai.id);
          const done = Math.max(when, ctxState.ai.cursor);
          sess.completed_at = iso(done);
          sess.summarized_at = iso(done + 8000);
          sess.updated_at = iso(done + 8000);
          sess.summary_model = "deepseek-chat";
          sess.ai_summary = interviewSummary(spec, { family, positionTitle, salary, pos, skills: ctxState.ai.skills, rand, vars });
          act(done + 8000, "interview_ai_completed", `Interview AI selesai (${ctxState.ai.turns} pertanyaan) — kesimpulan AI tersedia`, null);
          break;
        }
        case "hr_interview": {
          const online = chance(0.35);
          const proceed = STAGES.indexOf(plan.reach) >= 4;
          const score = (base) => Math.max(1, Math.min(5, Math.round(base + (q - 0.6) * 4 + (rand() - 0.5))));
          const sc = family === "retail"
            ? { kemampuan_komunikasi: score(3.6), penampilan_grooming: score(3.8), pengetahuan_produk: score(3.2),
              kecepatan_pelayanan: score(3.5), attitude_customer_service: score(3.8) }
            : family === "manager"
              ? { pengalaman_managerial: score(3.6), problem_solving: score(3.4), leadership_komunikasi: score(3.6),
                pemahaman_operasional: score(3.4), target_performance: score(3.3) }
              : { technical_skills: score(3.6), communication: score(3.4), attitude: score(3.8), experience: score(3.2), culture_fit: score(3.6) };
          const vals = Object.values(sc);
          sc.overall_score = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
          sc.notes = proceed ? "Sikap baik dan jawaban konsisten dengan hasil interview AI." : "Pengalaman belum sesuai kebutuhan; jawaban studi kasus kurang konkret.";
          out.interviews.push({ candidate_id: id, interview_date: iso(when), type: s.type, scorecard: sc,
            recommendation: proceed ? "proceed" : spec.status === "talent_pool" ? "pool" : "reject",
            notes: s.type === "hrd" ? `Interview HR oleh ${R.HR}.` : `Interview user dengan ${manager}.`,
            created_at: iso(when - 2 * DAY), mode: online ? "online" : "offline",
            meeting_link: online ? `https://meet.google.com/pdy-${String(1000 + idx).slice(-4)}-dmo` : null });
          break;
        }
        case "offer_sent": {
          const v = s.version;
          const statusFinal = spec.offers[v - 1];
          const last = v === spec.offers.length;
          const posMid = (pos.min + pos.max) / 2;
          const base = Math.round(Math.min(Math.max(salary * (statusFinal === "negotiating" ? 0.93 : 0.98), pos.min), pos.max * 1.02) / 50000) * 50000;
          const offerBase = v === 1 ? base : Math.round(Math.min(salary, posMid * 1.15) / 50000) * 50000;
          const benefits = R.OFFER_BENEFITS[family].slice(0, family === "retail" ? 5 : 4 + (v - 1));
          const offer = { id: uid(`offer:${idx}:${v}`), candidate_id: id, version: v, token: portalToken(),
            status: !last && (statusFinal === "sent" || statusFinal === "negotiating") ? "expired" : statusFinal,
            position_title: positionTitle, base_salary: offerBase, benefits,
            start_date: wibDate(when + between(10, 20) * DAY), notes: v === 1 ? `Disetujui ${manager}; budget posisi ${rupiah(pos.min)}–${rupiah(pos.max)}.`
              : `Revisi setelah negosiasi v${v - 1}.`, response_note: null, responded_at: null, response_ip: null,
            response_source: null, sent_at: iso(when), expires_at: iso(when + 7 * DAY), created_by_name: R.HR,
            created_at: iso(when), updated_at: iso(when) };
          ctxState.offers[v - 1] = offer;
          out.offers.push(offer);
          act(when, "offer_sent", `Offer v${v} dibuat (berlaku 7 hari)`);
          break;
        }
        case "offer_response": {
          const offer = ctxState.offers[s.version - 1];
          const viaPortal = chance(0.7);
          const note = s.status === "negotiating" ? `Terima kasih atas penawarannya. Apakah gaji pokok bisa ${rupiah(Math.round((offer.base_salary * 1.06) / 50000) * 50000)}? Jarak dari rumah ke lokasi cukup jauh.`
            : s.status === "declined" ? pick(["Mohon maaf, saya sudah menerima tawaran lain dengan gaji yang lebih sesuai.", "Terima kasih, saya memutuskan melanjutkan studi terlebih dahulu."])
              : chance(0.5) ? "Terima kasih, saya siap bergabung!" : null;
          offer.response_note = note;
          offer.responded_at = iso(when);
          offer.response_source = viaPortal ? "portal" : "manual";
          offer.response_ip = viaPortal ? `203.0.113.${10 + idx}` : null;
          offer.updated_at = iso(when);
          const desc = viaPortal
            ? `Kandidat ${OFFER_ACTION[s.status]} offer v${s.version} via portal${note ? ` — "${note.slice(0, 300)}"` : ""}`
            : `Kandidat ${OFFER_ACTION[s.status]} offer v${s.version} (dicatat manual)${note ? ` — "${note.slice(0, 300)}"` : ""}`;
          act(when, "offer_response", desc, viaPortal ? null : R.HR);
          break;
        }
        default:
          break;
      }
    }

    // catatan internal (note_added tidak tampil di timeline, tapi tercatat seperti AddNote)
    const noteTexts = noteFor(spec, { family, positionTitle, manager, vars, rand });
    noteTexts.forEach((text, i) => {
      const when = Math.min(lastAt, created + (lastAt - created) * (0.4 + 0.25 * i) + 30 * MIN);
      const by = i === 1 ? manager : R.HR;
      out.notes.push([id, text, by, iso(when)]);
      act(when, "note_added", "Catatan internal ditambahkan", by);
    });

    // analisis CV AI (sebagian besar kandidat selain yang baru melamar)
    if (spec.status !== "applied" || chance(0.5)) out.analyses.push(cvAnalysis(spec, cand, { job, pos, family, rand, created }));
  });
  return out;
}

/** Isi jawaban & skor satu tes psikotes (persis bentuk BeginTest / ScoreTest di Go). */
function fillTest(t, { q, family, inProgress, rand, bank }) {
  if (t.kind === "drawing") {
    t.answers = { question_ids: [], answers: {} };
    t.status = inProgress ? "in_progress" : "perlu_review";
    return;
  }
  const questions = bank[t.code] || [];
  let drawn;
  if (t.kind === "mcq") {
    const seeded = questions.slice();
    for (let i = seeded.length - 1; i > 0; i--) {
      const k = Math.floor(rand() * (i + 1));
      [seeded[i], seeded[k]] = [seeded[k], seeded[i]];
    }
    drawn = seeded.slice(0, 10);
  } else {
    drawn = questions; // PAPI: seluruh bank aktif dalam urutan bank
  }
  const answers = {};
  const limit = inProgress ? 4 : drawn.length;
  drawn.slice(0, limit).forEach((qq) => {
    if (t.kind === "mcq") {
      if (rand() < 0.04) return; // tidak dijawab
      const correct = qq.answer_key?.correct;
      if (rand() < 0.3 + 0.65 * q) answers[qq.id] = correct;
      else answers[qq.id] = pickWrong(qq.options, correct, rand);
    } else {
      if (rand() < 0.01) return;
      const w = R.PAPI_PROFILE[family] || {};
      const wa = (w[qq.options.a.scale] || 1) * (0.7 + rand() * 0.6);
      const wb = (w[qq.options.b.scale] || 1) * (0.7 + rand() * 0.6);
      answers[qq.id] = rand() < wa / (wa + wb) ? "a" : "b";
    }
  });
  t.answers = { question_ids: drawn.map((x) => x.id), answers };
  if (inProgress) {
    t.status = "in_progress";
    return;
  }
  t.status = "selesai";
  if (t.kind === "mcq") {
    const { score, detail } = scoreMcq(drawn, answers);
    t.score = score;
    t.score_detail = detail;
  } else {
    t.score = null;
    t.score_detail = scorePapi(drawn, answers);
  }
}

function pickWrong(options, correct, rand) {
  const wrong = (options || []).map((o) => o.key).filter((k) => k !== correct);
  return wrong[Math.floor(rand() * wrong.length)] || correct;
}

/** 5–6 giliran interview AI mengikuti urutan topik generateNextInterviewQuestion. */
function interviewTurns(spec, { family, posKey, vars, positionTitle, rand, maxQ }) {
  const A = R.ANSWERS[family];
  const creative = family === "creative";
  const roleIdx = posKey === "content" ? 1 : 0;
  const pick = (arr) => (creative ? arr[roleIdx] : arr[Math.floor(rand() * arr.length)]);
  const followup = creative && posKey === "content" ? A.followupContent : A.followup;
  const weak = spec.q < 0.45;
  const turns = [];
  turns.push({ topic: "pembuka", question: `Halo ${spec.name}! Terima kasih sudah meluangkan waktu untuk interview posisi ${positionTitle}. `
    + "Perkenalkan diri Anda secara singkat, lalu ceritakan pengalaman kerja atau kegiatan yang paling relevan dengan posisi ini.",
  answer: fill(pick(A.pembuka), vars) });
  turns.push({ topic: "keahlian", question: `Terima kasih, ${vars.first}. Keahlian apa yang paling Anda kuasai untuk posisi ${positionTitle}, dan bisa beri contoh penggunaannya?`,
    answer: weak ? "Saya bisa belajar cepat, Kak. Untuk keahlian khusus mungkin belum banyak, tapi saya mau diajari." : fill(pick(A.keahlian), vars) });
  if (maxQ >= 6 && !weak) turns.push({ topic: "keahlian", question: followup[0], answer: fill(followup[1], vars) });
  turns.push({ topic: "motivasi", question: "Apa yang membuat Anda tertarik melamar ke Paddy, dan apa yang Anda pahami tentang pekerjaan di posisi ini?",
    answer: weak ? "Karena dekat dari rumah dan saya sedang butuh pekerjaan." : fill(pick(A.motivasi), vars) });
  turns.push({ topic: "ketersediaan", question: "Kapan Anda bisa mulai bekerja, dan apakah ada kendala lokasi atau jam kerja yang perlu kami ketahui?",
    answer: fill(pick(A.ketersediaan), vars) + (weak ? " Tapi kalau shift malam sepertinya agak susah." : "") });
  turns.push({ topic: "gaji", question: "Berapa ekspektasi gaji Anda untuk posisi ini?", answer: fill(pick(A.gaji), vars) });
  const skills = (R.SKILLS[posKey] || R.SKILLS[family]).slice().sort(() => rand() - 0.5).slice(0, weak ? 2 : 4);
  const out = turns.slice(0, maxQ);
  out.skills = skills;
  return out;
}

/** ai_summary persis bentuk summarize() di files_interview.go. */
function interviewSummary(spec, { family, positionTitle, salary, pos, skills, rand, vars }) {
  const skor = Math.max(0, Math.min(100, Math.round(35 + spec.q * 60 + (rand() - 0.5) * 8)));
  const kesimpulan = skor >= 75 ? "relevan" : skor >= 55 ? "cukup_relevan" : "kurang_relevan";
  const over = salary > pos.max;
  const redFlags = [];
  if (spec.q < 0.45) redFlags.push("Jawaban tentang keahlian cenderung umum dan tanpa contoh konkret", "Ada keberatan terhadap shift malam");
  if (over) redFlags.push(`Ekspektasi gaji di atas rentang budget posisi (${juta(pos.max)})`);
  return {
    ringkasan: `${spec.name} melamar sebagai ${positionTitle} dengan pengalaman ${vars.exp}. `
      + (kesimpulan === "relevan" ? "Jawaban runtut, disertai contoh nyata, dan mengindikasikan pemahaman yang baik tentang pekerjaan."
        : kesimpulan === "cukup_relevan" ? "Jawaban cukup jelas, meskipun beberapa bagian masih umum dan perlu digali lebih lanjut."
          : "Jawaban cenderung singkat dan kurang menunjukkan pengalaman yang relevan dengan posisi."),
    relevansi: { skor, kesimpulan,
      alasan: kesimpulan === "kurang_relevan"
        ? "Jawaban mengindikasikan pengalaman yang belum sesuai dan motivasi yang cenderung pragmatis."
        : `Pengalaman dan keahlian yang disebutkan cenderung sesuai dengan kebutuhan ${positionTitle}${family === "retail" ? ", terutama pelayanan pelanggan" : family === "creative" ? ", terutama eksekusi visual" : ""}.` },
    keahlian: skills,
    ekspektasi_gaji: { disebutkan: true, nilai: juta(salary),
      catatan: over ? `Di atas rentang budget posisi (${rupiah(pos.min)}–${rupiah(pos.max)}); perlu negosiasi.` : "Masih dalam rentang budget posisi." },
    red_flags: redFlags,
    perhatikan_saat_interview_lanjutan: family === "retail"
      ? ["Simulasi melayani pelanggan yang ragu memilih desain", "Konfirmasi kesediaan shift sampai pukul 22.00 dan akhir pekan", "Cek ketelitian menghitung uang kembalian"]
      : family === "creative" ? ["Minta walkthrough satu proyek portofolio dari brief sampai final", "Tes desain singkat sesuai gaya visual Paddy", "Diskusikan ritme revisi dan tenggat rilis koleksi"]
        : family === "production" ? ["Tes praktik cetak di mesin UV workshop", "Tanyakan prosedur K3 dan perawatan mesin", "Konfirmasi kesediaan lembur saat musim ramai"]
          : ["Studi kasus penurunan omzet toko", "Gali gaya kepemimpinan saat ada konflik antar-crew", "Konfirmasi target penjualan yang realistis untuk 3 bulan pertama"],
    keterbatasan: R.INTERVIEW_LIMIT,
  };
}

function noteFor(spec, { family, positionTitle, manager, vars, rand }) {
  const notes = [];
  if (["hired", "offer"].includes(spec.status)) {
    notes.push(`${vars.first} kuat di ${family === "creative" ? "eksekusi visual dan ide konten" : family === "production" ? "ketelitian cetak dan perawatan mesin" : "komunikasi dengan pelanggan"}; rekomendasi lanjut.`);
    notes.push(`Sudah ngobrol langsung dengan ${vars.first}, cocok dengan tim. Siapkan onboarding ${positionTitle}.`);
  } else if (spec.status === "talent_pool") {
    notes.push(`Kandidat bagus untuk ${positionTitle}, simpan di talent pool untuk pembukaan berikutnya${spec.offers ? " (menolak offer karena gaji)" : ""}.`);
  } else if (spec.status === "rejected") {
    notes.push("Tidak dilanjutkan; kirim pesan penolakan halus dan simpan data untuk referensi.");
  } else if (spec.status === "interview" && rand() < 0.6) {
    notes.push(`Prioritaskan jadwal interview user dengan ${manager} minggu ini.`);
  } else if (spec.status === "screening" && rand() < 0.5) {
    notes.push("Kandidat minta dihubungi setelah jam 5 sore.");
  }
  return notes;
}

/** Baris candidate_ai_analysis dengan bentuk extracted/job_context sama seperti analyzeCV (files_cv.go). */
function cvAnalysis(spec, cand, { job, pos, family, rand, created }) {
  const score = Math.max(15, Math.min(97, Math.round(30 + spec.q * 65 + (rand() - 0.5) * 10)));
  const sumber = { jobstreet: "JobStreet", instagram: "Instagram @paddy.id", referral: "Referral", internal_referral: "Referral karyawan",
    jobfair: "Job fair kampus", headhunter: "Headhunter" }[spec.src] || null;
  const jobContext = job
    ? [`Posisi: ${job.title}`, job.description ? `Deskripsi: ${job.description}` : null, job.requirements ? `Persyaratan: ${job.requirements}` : null].filter(Boolean).join("\n")
    : `Posisi: ${pos.title}${pos.department ? ` — Departemen ${pos.department}` : ""}${pos.level ? ` (level ${pos.level})` : ""}`;
  const strong = score >= 75;
  const mid = score >= 50;
  const when = created + (1 + rand() * 20) * HOUR;
  return {
    candidate_id: cand.id,
    cv_text: `${cand.full_name}\n${cand.email} | ${cand.phone} | ${cand.domicile}\n\nPENDIDIKAN\n${cand.last_education}\n\nPENGALAMAN\n${cand.last_experience}\n\nKEAHLIAN\n${(R.SKILLS[pos.key] || R.SKILLS[family]).slice(0, 4).join(", ")}`,
    extracted: { nama: cand.full_name, email: cand.email, no_hp: cand.phone, sumber, pendidikan: cand.last_education,
      pengalaman: cand.last_experience, metode_ekstraksi: "pdf" },
    summary: `${cand.full_name} berdomisili di ${cand.domicile} dengan pendidikan terakhir ${cand.last_education}. Pengalaman terakhir sebagai ${cand.last_experience}. `
      + (strong ? "Profil menunjukkan pengalaman yang relevan dan keahlian yang dibutuhkan posisi." : mid ? "Pengalaman cukup relevan meski belum lama." : "Pengalaman belum banyak berkaitan dengan posisi yang dilamar."),
    match_score: score,
    match_reason: strong ? `Pengalaman dan keahlian di CV sesuai dengan persyaratan ${job ? job.title : pos.title}.`
      : mid ? "Sebagian persyaratan terpenuhi; pengalaman spesifik masih terbatas."
        : "CV kurang menunjukkan pengalaman atau keahlian yang diminta lowongan.",
    job_context: jobContext, model: "deepseek-chat", created_at: iso(when), updated_at: iso(when),
  };
}

/* ── tulis ke database ───────────────────────────────────────────────── */

async function writeAll(c, data, interviewerId) {
  await insertMany(c, "recruitment.candidates",
    ["id", "full_name", "email", "phone", "domicile", "source", "position_id", "brand_id", "job_opening_id", "status", "notes",
      "created_at", "updated_at", "last_experience", "last_education", "availability", "expected_salary"],
    data.candidates.map((x) => [x.id, x.full_name, x.email, x.phone, x.domicile, x.source, x.position_id, x.brand_id,
      x.job_opening_id, x.status, x.notes, x.created_at, x.updated_at, x.last_experience, x.last_education, x.availability, x.expected_salary]));
  await insertMany(c, "recruitment.candidate_activities", ["candidate_id", "activity_type", "description", "created_by_name", "created_at"],
    data.activities);
  await insertMany(c, "recruitment.candidate_notes", ["candidate_id", "content", "created_by_name", "created_at"], data.notes);
  await insertMany(c, "recruitment.candidate_screenings",
    ["candidate_id", "contacted", "interested", "availability_note", "confirmed_salary", "willing_shift", "willing_placement",
      "notes", "recommendation", "updated_by_name", "created_at", "updated_at"],
    data.screenings.map((x) => [x.candidate_id, x.contacted, x.interested, x.availability_note, x.confirmed_salary, x.willing_shift,
      x.willing_placement, x.notes, x.recommendation, x.updated_by_name, x.created_at, x.updated_at]));
  await insertMany(c, "recruitment.candidate_ai_analysis",
    ["candidate_id", "cv_text", "extracted", "summary", "match_score", "match_reason", "job_context", "model", "created_at", "updated_at"],
    data.analyses.map((x) => [x.candidate_id, x.cv_text, x.extracted, x.summary, x.match_score, x.match_reason, x.job_context,
      x.model, x.created_at, x.updated_at]));
  await insertMany(c, "recruitment.psikotes_sessions",
    ["id", "candidate_id", "token", "status", "webcam_consent", "invited_at", "expires_at", "started_at", "completed_at",
      "created_by_name", "created_at", "updated_at"],
    data.sessions.map((x) => [x.id, x.candidate_id, x.token, x.status, x.webcam_consent, x.invited_at, x.expires_at, x.started_at,
      x.completed_at, x.created_by_name, x.created_at, x.updated_at]));
  await insertMany(c, "recruitment.psikotes_session_tests",
    ["id", "session_id", "instrument_id", "status", "answers", "score", "score_detail", "attachment_path", "review_notes",
      "reviewed_by_name", "sort_order", "started_at", "completed_at", "created_at", "updated_at", "ai_insight"],
    data.tests.map((x) => [x.id, x.session_id, x.instrument_id, x.status, x.answers, x.score, x.score_detail, x.attachment_path,
      x.review_notes, x.reviewed_by_name, x.sort_order, x.started_at, x.completed_at, x.created_at, x.updated_at, x.ai_insight]));
  await insertMany(c, "recruitment.candidate_psikotes_summary",
    ["candidate_id", "recommendation", "notes", "updated_by_name", "created_at", "updated_at"],
    data.summaries.map((x) => [x.candidate_id, x.recommendation, x.notes, x.updated_by_name, x.created_at, x.updated_at]));
  await insertMany(c, "recruitment.interview_ai_sessions",
    ["id", "candidate_id", "token", "status", "webcam_consent", "config", "ai_summary", "summary_model", "summarized_at",
      "invited_at", "expires_at", "started_at", "completed_at", "created_by_name", "created_at", "updated_at"],
    data.aiSessions.map((x) => [x.id, x.candidate_id, x.token, x.status, x.webcam_consent, x.config, x.ai_summary, x.summary_model,
      x.summarized_at, x.invited_at, x.expires_at, x.started_at, x.completed_at, x.created_by_name, x.created_at, x.updated_at]));
  await insertMany(c, "recruitment.interview_ai_turns",
    ["session_id", "turn_no", "topic", "question", "answer_transcript", "answer_mode", "transcribe_model", "asked_at", "answered_at", "created_at"],
    data.turns.map((x) => [x.session_id, x.turn_no, x.topic, x.question, x.answer_transcript, x.answer_mode, x.transcribe_model,
      x.asked_at, x.answered_at, x.created_at]));
  if (interviewerId) {
    await insertMany(c, "recruitment.interviews",
      ["candidate_id", "interviewer_id", "interview_date", "type", "scorecard", "recommendation", "notes", "created_at", "mode", "meeting_link"],
      data.interviews.map((x) => [x.candidate_id, interviewerId, x.interview_date, x.type, x.scorecard, x.recommendation, x.notes,
        x.created_at, x.mode, x.meeting_link]));
  }
  await insertMany(c, "recruitment.candidate_offers",
    ["id", "candidate_id", "version", "token", "status", "position_title", "base_salary", "benefits", "start_date", "notes",
      "response_note", "responded_at", "response_ip", "response_source", "sent_at", "expires_at", "created_by_name", "created_at", "updated_at"],
    data.offers.map((x) => [x.id, x.candidate_id, x.version, x.token, x.status, x.position_title, x.base_salary, x.benefits, x.start_date,
      x.notes, x.response_note, x.responded_at, x.response_ip, x.response_source, x.sent_at, x.expires_at, x.created_by_name,
      x.created_at, x.updated_at]));
}

/** Matikan trigger notifikasi selama transaksi; false bila tidak diizinkan (bukan owner). */
async function muteTriggers(c, on) {
  const verb = on ? "DISABLE" : "ENABLE";
  try {
    await c.query("SAVEPOINT mute");
    await c.query(`ALTER TABLE recruitment.candidates ${verb} TRIGGER trg_notify_candidate_changes`);
    await c.query(`ALTER TABLE recruitment.interviews ${verb} TRIGGER trg_notify_interview_changes`);
    await c.query("RELEASE SAVEPOINT mute");
    return true;
  } catch (err) {
    await c.query("ROLLBACK TO SAVEPOINT mute");
    if (on) console.warn(`  ! trigger notifikasi tidak bisa dimatikan (${err.message}); notifikasi demo dibersihkan setelahnya`);
    return false;
  }
}

async function main() {
  S.loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL");
    process.exit(1);
  }
  assertLocalOrAllowed(url);
  const rand = S.rng(SEED);
  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL TIME ZONE 'Asia/Jakarta'");
    const startedAt = (await c.query("SELECT now() AS t")).rows[0].t;
    const muted = await muteTriggers(c, true);

    const m = await ensureMaster(c);
    console.log("departemen/posisi :", `${Object.keys(m.departments).length} / ${Object.keys(m.positions).length}`,
      `(${m.newDepartments} departemen & ${m.newPositions} posisi baru)`);
    const jobs = await seedJobs(c, m);
    console.log("lowongan          :", R.JOBS.map((j) => `${j.slug} [${j.status}]`).join(", "));
    const bankInfo = await seedBank(c, S.rng(SEED + 1));
    console.log("bank soal         :", Object.entries(bankInfo.counts).map(([k, n]) => `${k} ${n}`).join(", "));

    const old = await c.query(`SELECT id::text FROM recruitment.candidates WHERE email LIKE $1`, [`%${R.EMAIL_MARK}`]);
    const oldSessions = old.rowCount ? (await c.query(`SELECT id::text FROM recruitment.psikotes_sessions WHERE candidate_id = ANY($1::uuid[])`,
      [old.rows.map((r) => r.id)])).rows.map((r) => r.id) : [];
    if (old.rowCount) {
      const ids = old.rows.map((r) => r.id);
      // tabel live/proktor tanpa FK ke sesi: bersihkan baris milik sesi kandidat seeder
      for (const [type, table] of [["psikotes", "recruitment.psikotes_sessions"], ["interview", "recruitment.interview_ai_sessions"]]) {
        const sids = `(SELECT id FROM ${table} WHERE candidate_id = ANY($1::uuid[]))`;
        for (const live of ["recruitment.live_monitor_frames", "recruitment.live_chat_messages", "recruitment.live_signals"]) {
          await c.query(`DELETE FROM ${live} WHERE session_type = '${type}' AND session_id IN ${sids}`, [ids]).catch(() => {});
        }
      }
      await c.query(`DELETE FROM recruitment.candidates WHERE id = ANY($1::uuid[])`, [ids]);
    }
    console.log("kandidat lama     :", old.rowCount, "dihapus");

    const data = buildAll(m, jobs, bankInfo, rand);

    // gambar tes: render lalu kirim ke storage sebelum COMMIT
    const sharp = loadSharp();
    const drawRand = S.rng(SEED + 7);
    const files = [];
    if (sharp) {
      for (const d of data.drawings) {
        const png = await drawingPng(sharp, d.code, drawRand, d.variant);
        if (png) files.push({ rel: d.test.attachment_rel, data: png, test: d.test });
      }
    } else {
      console.warn("  ! sharp tidak ditemukan — gambar tes tidak dibuat");
    }
    const sessionIds = [...new Set([...oldSessions, ...data.sessions.map((x) => x.id)])];
    if (files.length && deliverFiles(files, sessionIds)) for (const f of files) f.test.attachment_path = f.rel;

    const interviewer = (await c.query(
      `SELECT u.id FROM auth.users u WHERE u.email = ANY($1) ORDER BY array_position($1, u.email::text) LIMIT 1`,
      [[process.env.SUPER_USER_EMAIL, "super@paddy.id", "admin@paddy.id"].filter(Boolean)])).rows[0]?.id;
    if (!interviewer) console.warn("  ! user interviewer tidak ditemukan — tabel interviews dilewati");
    await writeAll(c, data, interviewer);

    if (muted) await muteTriggers(c, false);
    else {
      await c.query(`DELETE FROM public.notifications WHERE created_at >= $1 AND link = ANY($2)`,
        [startedAt, ["/dashboard/hris/candidates", ...data.candidates.map((x) => `/dashboard/hris/candidates/${x.id}`)]]);
    }
    await c.query("COMMIT");

    const byStatus = {};
    for (const x of data.candidates) byStatus[x.status] = (byStatus[x.status] || 0) + 1;
    console.log("kandidat          :", data.candidates.length, JSON.stringify(byStatus));
    console.log("aktivitas/catatan :", data.activities.length, "/", data.notes.length);
    console.log("screening / AI CV :", data.screenings.length, "/", data.analyses.length);
    console.log("psikotes          :", data.sessions.length, "sesi,", data.tests.length, "tes,", data.summaries.length, "ringkasan");
    console.log("interview AI      :", data.aiSessions.length, "sesi,", data.turns.length, "giliran; interview HR:", interviewer ? data.interviews.length : 0);
    console.log("offer             :", data.offers.length);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
