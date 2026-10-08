#!/usr/bin/env node
/**
 * Seeder TRANSAKSI Mizu Spa (EPIC-052): riwayat booking 45 hari terakhir,
 * hari ini, dan 7 hari ke depan untuk 3 outlet Mizu — butuh seeder master
 * (seeders/mizu-spa.js) lebih dulu.
 *
 * Yang dibuat (deterministik lewat MIZU_SEED, default 2026):
 *   - spa.bookings + booking_items + booking_events
 *       walk-in / reservasi / booking online; single, couple (2 terapis bersamaan),
 *       dan kombinasi berurutan; preferensi gender terapis
 *       Status mengikuti waktu: lampau → selesai & lunas (sebagian batal / kedaluwarsa),
 *       sedang berjalan → in_treatment, mendatang → ditugaskan / belum ditugaskan.
 *   - Penugasan terapis TIDAK PERNAH bentrok (durasi + jeda), hanya terapis yang
 *     sedang shift (pola mingguan hris.employee_shifts) di outlet asal atau perbantuan.
 *   - Komisi dibekukan per treatment selesai dengan aturan spa.commission_rules
 *     (resolusi sama dengan modul Go).
 *   - pos.pos_orders + items + status history untuk booking lunas (cash / QRIS / kartu kredit),
 *     pos.pos_shifts per outlet per hari (shift_number MZS-…), statistik pos_customers.
 *
 * Idempoten: setiap jalan menghapus transaksi seeder sebelumnya (penanda created_by
 * SEED_ACTOR dan shift MZS-…) lalu membuat ulang. Data yang dibuat staf tidak disentuh.
 *
 * Usage:
 *   pnpm db:seed:mizu-spa-transactions
 *   MIZU_SEED_DAYS_BACK=60 MIZU_SEED_DAYS_AHEAD=14 node seeders/mizu-spa-transactions.js
 */

const crypto = require("crypto");
const { Client } = require("pg");
const { sslForUrl } = require("../scripts/pg-utils");
const { assertLocalOrAllowed } = require("./lib/seed-password");
const D = require("./lib/mizu-spa-data");

const DAYS_BACK = Number(process.env.MIZU_SEED_DAYS_BACK || 45);
const DAYS_AHEAD = Number(process.env.MIZU_SEED_DAYS_AHEAD || 7);
const rand = D.rng(Number(process.env.MIZU_SEED || 2026));
const MIN = 60000;

/* ── helpers ─────────────────────────────────────────────────────────── */

const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
function weighted(items, weightOf) {
  const total = items.reduce((s, x) => s + weightOf(x), 0);
  let r = rand() * total;
  for (const x of items) {
    r -= weightOf(x);
    if (r <= 0) return x;
  }
  return items[items.length - 1];
}
const uuid = () => crypto.randomUUID();
const wibDate = (d) => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const at = (date, minutes) => new Date(Date.parse(`${date}T00:00:00+07:00`) + minutes * MIN);
const addDays = (date, n) => wibDate(new Date(Date.parse(`${date}T12:00:00+07:00`) + n * 86400000));
const isoWeekday = (date) => ((new Date(`${date}T12:00:00+07:00`).getUTCDay() + 6) % 7) + 1;
const clock = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const ymd = (date) => date.replace(/-/g, "");
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function insertMany(c, table, columns, rows, chunk = 300) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params = [];
    const values = part.map((row) => `(${row.map((v) => { params.push(v); return `$${params.length}`; }).join(", ")})`);
    await c.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${values.join(", ")}`, params);
  }
}

/* ── load ────────────────────────────────────────────────────────────── */

async function load(c) {
  const codes = D.OUTLETS.map((o) => o.code);
  const outletRows = await c.query(
    `SELECT b.id, b.code, b.name, b.company_id, so.warehouse_id, to_char(so.open_time, 'HH24:MI') AS open,
            to_char(so.close_time, 'HH24:MI') AS close
       FROM configuration.branches b JOIN spa.outlets so ON so.branch_id = b.id
       JOIN configuration.companies co ON co.id = b.company_id
      WHERE co.code = $1 AND b.code = ANY($2)`, [D.COMPANY.code, codes]);
  if (outletRows.rowCount !== codes.length) throw new Error("Outlet Mizu belum lengkap — jalankan seeders/mizu-spa.js dulu");
  const outlets = outletRows.rows.map((r) => ({ ...r, load: D.OUTLETS.find((o) => o.code === r.code).load }));
  const byBranch = new Map(outlets.map((o) => [o.id, o]));

  const variantRows = await c.query(
    `SELECT v.id, v.name, v.duration_min, v.buffer_min, v.price_idr::float8 AS price, t.id AS treatment_id, t.code, t.name AS treatment
       FROM spa.treatment_variants v JOIN spa.treatments t ON t.id = v.treatment_id
      WHERE v.is_active AND t.is_active AND t.code = ANY($1)`, [D.TREATMENTS.map((t) => t.code)]);
  const treatments = D.TREATMENTS.map((t) => ({ ...t, variants: variantRows.rows.filter((v) => v.code === t.code) }))
    .filter((t) => t.variants.length);
  const priceRows = await c.query(`SELECT variant_id, branch_id, price_idr::float8 AS price FROM spa.variant_outlet_prices`);
  const prices = new Map(priceRows.rows.map((r) => [`${r.variant_id}|${r.branch_id}`, r.price]));
  const productRows = await c.query(
    `SELECT m.variant_id, m.branch_id, p.id, p.sku FROM spa.variant_pos_products m JOIN pos.pos_products p ON p.id = m.pos_product_id`);
  const products = new Map(productRows.rows.map((r) => [`${r.variant_id}|${r.branch_id}`, { id: r.id, sku: r.sku }]));

  const staffRows = await c.query(
    `SELECT e.id AS employee_id, e.nip, e.full_name, t.id AS therapist_id, t.gender, t.home_branch_id
       FROM hris.employees e LEFT JOIN spa.therapists t ON t.employee_id = e.id
      WHERE e.nip = ANY($1)`, [D.STAFF.map((s) => `MZ-${s[0]}`)]);
  const staffByNip = new Map(staffRows.rows.map((r) => [r.nip.slice(3), r]));
  const therapists = [];
  const cashier = {};
  for (const [nip, , , outletCode, kind, shift, dayOff] of D.STAFF) {
    const row = staffByNip.get(nip);
    if (!row) throw new Error(`Staf MZ-${nip} belum ada — jalankan seeders/mizu-spa.js dulu`);
    const outlet = outlets.find((o) => o.code === outletCode);
    if (kind === "therapist") {
      const s = D.SHIFTS.find((x) => x.key === shift);
      therapists.push({ id: row.therapist_id, employeeId: row.employee_id, name: row.full_name, gender: row.gender,
        home: outlet.id, dayOff, shiftStart: clock(s.start), shiftEnd: clock(s.end) });
    }
    if (kind === "frontdesk") cashier[outlet.id] = row.employee_id;
  }
  const assistRows = await c.query(
    `SELECT therapist_id, branch_id, start_date::text AS start, end_date::text AS end FROM spa.therapist_assists
      WHERE therapist_id = ANY($1)`, [therapists.map((t) => t.id)]);

  const ruleRows = await c.query(
    `SELECT id, treatment_id, variant_id, branch_id, commission_type AS type, value::float8 AS value
       FROM spa.commission_rules WHERE is_active`);

  const custRows = await c.query(`SELECT id, name, phone, gender FROM pos.pos_customers WHERE phone = ANY($1)`,
    [D.customers().map((x) => x.phone)]);
  return { outlets, byBranch, treatments, prices, products, therapists, cashier, assists: assistRows.rows,
    rules: ruleRows.rows, customers: custRows.rows };
}

/* ── rules mirrored from the Go domain ───────────────────────────────── */

function resolveCommission(rules, treatmentId, variantId, branchId, price) {
  let best = null;
  let bestRank = Infinity;
  for (const r of rules) {
    if (r.branch_id && r.branch_id !== branchId) continue;
    const branchRank = r.branch_id ? 0 : 1;
    let rank;
    if (r.variant_id) {
      if (r.variant_id !== variantId) continue;
      rank = branchRank;
    } else if (r.treatment_id) {
      if (r.treatment_id !== treatmentId) continue;
      rank = 2 + branchRank;
    } else rank = 4 + branchRank;
    if (rank < bestRank) { best = r; bestRank = rank; }
  }
  if (!best) return null;
  const amount = best.type === "percent" ? Math.round((price * best.value) / 100) : Math.round(best.value);
  return { type: best.type, value: best.value, amount };
}

function deriveStatus(items) {
  const active = items.filter((s) => s !== "cancelled");
  if (!active.length) return "cancelled";
  if (active.includes("in_treatment")) return "in_treatment";
  if (active.every((s) => s === "completed")) return "completed";
  if (active.includes("unassigned")) return "unassigned";
  return "assigned";
}

/* ── reset ───────────────────────────────────────────────────────────── */

async function reset(c) {
  const orders = await c.query(
    `SELECT pos_order_id FROM spa.bookings WHERE created_by = $1 AND pos_order_id IS NOT NULL`, [D.SEED_ACTOR]);
  const ids = orders.rows.map((r) => r.pos_order_id);
  if (ids.length) {
    await c.query(`DELETE FROM pos.pos_order_status_history WHERE order_id = ANY($1)`, [ids]);
    await c.query(`DELETE FROM pos.pos_order_items WHERE order_id = ANY($1)`, [ids]);
    await c.query(`DELETE FROM pos.pos_orders WHERE id = ANY($1)`, [ids]);
  }
  const b = await c.query(`DELETE FROM spa.bookings WHERE created_by = $1`, [D.SEED_ACTOR]);
  await c.query(`DELETE FROM pos.pos_shifts WHERE shift_number LIKE 'MZS-%'`);
  return { bookings: b.rowCount, orders: ids.length };
}

/* ── generation ──────────────────────────────────────────────────────── */

function generate(ctx, existingCodes, orderSeq) {
  const now = new Date();
  const today = wibDate(now);
  const bookings = [];
  const busy = new Map(); // therapistId|date -> [[start,end)]
  const codes = new Set(existingCodes);

  const fits = (tid, date, s, e) => (busy.get(`${tid}|${date}`) || []).every(([bs, be]) => e <= bs || s >= be);
  const occupy = (tid, date, s, e) => {
    const k = `${tid}|${date}`;
    if (!busy.has(k)) busy.set(k, []);
    busy.get(k).push([s, e]);
  };
  const lent = (t, date) => ctx.assists.find((a) => a.therapist_id === t.id && a.start <= date && date <= a.end);
  const working = (outlet, date) => ctx.therapists.filter((t) => {
    if (isoWeekday(date) === t.dayOff) return false;
    const loan = lent(t, date);
    return loan ? loan.branch_id === outlet.id : t.home === outlet.id;
  });

  // [startMin, endMin) is the treatment, busyEnd adds the clean-up buffer: the
  // shift must cover the treatment, the calendar must be free through the buffer.
  function findTherapist(outlet, date, startMin, endMin, busyEnd, gender, exclude) {
    const pool = working(outlet, date).filter((t) => !exclude.includes(t.id) && (gender === "any" || t.gender === gender)
      && t.shiftStart <= startMin && endMin <= t.shiftEnd && fits(t.id, date, startMin, busyEnd));
    return pool.length ? pick(pool) : null;
  }

  function code(created) {
    for (;;) {
      let s = "";
      for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
      const c = `MZ-${ymd(wibDate(created)).slice(2)}-${s}`;
      if (!codes.has(c)) { codes.add(c); return c; }
    }
  }

  const variantPick = (t) => weighted(t.variants, (v) => (v.duration_min === 60 ? 5 : v.duration_min === 90 ? 3 : 1.5));
  const treatmentPick = () => weighted(ctx.treatments, (t) => t.weight);
  const priceOf = (v, outlet) => ctx.prices.get(`${v.id}|${outlet.id}`) ?? v.price;

  for (let offset = -DAYS_BACK; offset <= DAYS_AHEAD; offset++) {
    const date = addDays(today, offset);
    const weekend = [6, 7].includes(isoWeekday(date));
    for (const outlet of ctx.outlets) {
      const open = clock(outlet.open);
      const close = clock(outlet.close);
      const future = offset > 0 ? Math.max(0.12, 0.7 - offset * 0.09) : 1;
      const target = Math.round(((weekend ? 16 : 10) * outlet.load * future) + (rand() * 4 - 2));
      for (let n = 0; n < target; n++) {
        const kind = weighted([["single", 75], ["couple", 13], ["combo", 12]], (x) => x[1])[0];
        const source = offset > 0
          ? weighted([["reservation", 70], ["public", 30]], (x) => x[1])[0]
          : weighted([["walk_in", 40], ["reservation", 45], ["public", 15]], (x) => x[1])[0];
        const pref = weighted([["any", 70], ["female", 25], ["male", 5]], (x) => x[1])[0];
        // Lines: [variant, guestIndex]; couple = 2 guests at once, combo = consecutive.
        const first = treatmentPick();
        const lines = [{ v: variantPick(first), t: first, offset: 0 }];
        if (kind === "couple") lines.push({ v: lines[0].v, t: first, offset: 0, partner: true });
        if (kind === "combo") {
          const extra = pick(ctx.treatments.filter((t) => ["REFLEX", "TOTOK", "HEAD", "LULUR"].includes(t.code)));
          // Lanjut setelah jeda treatment pertama (persiapan ruang/terapis).
          lines.push({ v: variantPick(extra), t: extra, offset: lines[0].v.duration_min + lines[0].v.buffer_min });
        }
        const span = Math.max(...lines.map((l) => l.offset + l.v.duration_min));
        let placed = null;
        for (let attempt = 0; attempt < 6 && !placed; attempt++) {
          // Ramai sore-malam: jam mulai condong ke 15:00–20:00.
          const clamp = (m) => Math.min(Math.max(m, open), close - 60);
          const hourPeak = weighted([[open, 2], [open + 120, 3], [open + 240, 4], [clamp(15 * 60), 6], [clamp(17 * 60), 7], [clamp(19 * 60), 5]], (x) => x[1])[0];
          const start = Math.min(Math.max(open, hourPeak + 30 * between(-2, 3)), close - span);
          if (start < open) continue;
          const startAt = at(date, start);
          const assigned = [];
          let ok = true;
          for (const l of lines) {
            const s = start + l.offset;
            const e = s + l.v.duration_min + l.v.buffer_min;
            const same = l.offset > 0 ? assigned[0] : null; // combo: same therapist if free
            let t = same && fits(same.id, date, s, e) && same.shiftEnd >= e - l.v.buffer_min ? same : null;
            if (!t) t = findTherapist(outlet, date, s, s + l.v.duration_min, e, l.partner ? "any" : pref, assigned.filter((x) => x && l.partner).map((x) => x.id));
            if (!t) { ok = false; break; }
            assigned.push(t);
          }
          if (!ok && offset < 0) continue; // lampau: semua treatment yang terjadi pasti punya terapis
          placed = { start, startAt, therapists: ok ? assigned : lines.map(() => null) };
        }
        if (!placed) continue;

        // Timeline relative to now.
        const items = lines.map((l, i) => {
          const s = at(date, placed.start + l.offset);
          const e = new Date(s.getTime() + l.v.duration_min * MIN);
          return { line: l, startsAt: s, endsAt: e, therapist: placed.therapists[i] };
        });
        const lastEnd = items.reduce((m, it) => Math.max(m, it.endsAt.getTime()), 0);
        const created = source === "walk_in"
          ? new Date(placed.startAt.getTime() - between(5, 30) * MIN)
          : new Date(placed.startAt.getTime() - between(1, 6) * 86400000 - between(0, 600) * MIN);
        if (created > now) continue;

        let fate = "normal";
        if (lastEnd < now.getTime()) fate = weighted([["done", 91], ["cancel", 6], ["noshow", 3]], (x) => x[1])[0];
        if (fate === "normal" && placed.therapists.some((t) => !t)) fate = "open"; // tidak ada terapis kosong
        const unassignFuture = items[0].startsAt > now && (source === "public" ? chance(0.7) : chance(0.3));

        for (const it of items) {
          const isPast = it.endsAt <= now;
          const running = it.startsAt <= now && now < it.endsAt;
          if (fate === "cancel") it.status = "cancelled";
          else if (fate === "noshow") it.status = "unassigned";
          else if (fate === "done" || isPast) it.status = it.therapist ? "completed" : "unassigned";
          else if (running && it.therapist) it.status = "in_treatment";
          else it.status = it.therapist && !unassignFuture ? "assigned" : "unassigned";
          if (it.status === "unassigned" || (it.status === "cancelled" && chance(0.5))) it.therapist = null;
          if (it.therapist && it.status !== "cancelled") {
            const s = Math.round((it.startsAt - at(date, 0)) / MIN);
            occupy(it.therapist.id, date, s, s + it.line.v.duration_min + it.line.v.buffer_min);
          }
          it.price = priceOf(it.line.v, outlet);
          if (it.status === "in_treatment" || it.status === "completed") it.startedAt = new Date(it.startsAt.getTime() + between(0, 6) * MIN);
          if (it.status === "completed") it.completedAt = new Date(it.endsAt.getTime() + between(-3, 6) * MIN);
          if (it.status === "completed") {
            it.commission = resolveCommission(ctx.rules, it.line.v.treatment_id, it.line.v.id, outlet.id, it.price);
          }
        }
        let status = deriveStatus(items.map((i) => i.status));
        if (fate === "noshow") status = "expired";
        const paid = status === "completed";
        const customer = source === "walk_in" && chance(0.4) ? null : pick(ctx.customers);
        const name = customer ? customer.name : pick(["Tamu walk-in", "Bapak Rudi", "Ibu Sari", "Mas Dimas", "Teh Rani", "Kang Ujang"]);
        const booking = {
          id: uuid(), code: code(created), outlet, source: source === "public" ? "public" : "front_office",
          type: source === "walk_in" ? "walk_in" : "reservation", customer, name,
          phone: customer ? customer.phone : "", pref, notes: chance(0.15) ? pick(["Fokus punggung dan bahu", "Tekanan lembut",
            "Alergi minyak kacang", "Minta terapis yang sama seperti kunjungan lalu", "Ulang tahun, siapkan teh hangat"]) : "",
          scheduledAt: items[0].startsAt, status, items, created, paid,
        };
        if (fate === "cancel") {
          booking.cancelledAt = new Date(Math.min(items[0].startsAt.getTime() - between(30, 1440) * MIN, now.getTime()));
          if (booking.cancelledAt < created) booking.cancelledAt = new Date(created.getTime() + 10 * MIN);
          booking.cancelReason = pick(["Tamu berhalangan", "Jadwal bentrok dengan acara keluarga", "Sakit", "Ganti hari"]);
        }
        if (paid) {
          const lastDone = Math.max(...items.filter((i) => i.completedAt).map((i) => i.completedAt.getTime()));
          booking.checkoutAt = new Date(lastDone + between(2, 10) * MIN);
          booking.paidAt = new Date(booking.checkoutAt.getTime() + between(1, 4) * MIN);
          const payDate = wibDate(booking.paidAt);
          orderSeq[payDate] = (orderSeq[payDate] || 0) + 1;
          booking.orderNumber = `POS-${ymd(payDate)}-${String(orderSeq[payDate]).padStart(4, "0")}`;
          booking.method = weighted([["cash", 30], ["qris", 50], ["credit_card", 20]], (x) => x[1])[0];
        }
        bookings.push(booking);
      }
    }
  }
  return bookings;
}

/* ── persistence ─────────────────────────────────────────────────────── */

const METHOD_NAME = { cash: "Cash", qris: "QRIS", credit_card: "Credit Card" };

async function persist(c, ctx, bookings) {
  const bookingRows = [];
  const itemRows = [];
  const eventRows = [];
  const orderRows = [];
  const orderItemRows = [];
  const historyRows = [];
  const shifts = new Map(); // branch|date -> shift
  const ev = (b, itemId, action, from, to, when, note = "") =>
    eventRows.push([uuid(), b.id, itemId, action, from, to, D.SEED_ACTOR, note, when]);

  for (const b of bookings) {
    const total = b.items.filter((i) => i.status !== "cancelled").reduce((s, i) => s + i.price, 0);
    let orderId = null;
    if (b.paid) {
      orderId = uuid();
      const date = wibDate(b.paidAt);
      const key = `${b.outlet.id}|${date}`;
      if (!shifts.has(key)) {
        shifts.set(key, { id: uuid(), branch: b.outlet, date, orders: 0, total: 0, cash: 0, qris: 0, credit: 0 });
      }
      const sh = shifts.get(key);
      sh.orders++;
      sh.total += total;
      if (b.method === "cash") sh.cash += total;
      else if (b.method === "qris") sh.qris += total;
      else sh.credit += total;
      const paidAmount = b.method === "cash" ? Math.ceil(total / 50000) * 50000 : total;
      orderRows.push([orderId, b.orderNumber, "dine_in", "completed", "paid", b.method, b.method, METHOD_NAME[b.method],
        b.customer ? b.customer.id : null, ctx.cashier[b.outlet.id], 1, total, 0, 0, 0, 0, "[]", total, paidAmount,
        paidAmount - total, 0, `Booking spa ${b.code}`, b.name, b.phone || null, b.outlet.company_id, b.outlet.id,
        b.outlet.warehouse_id, "stall", sh.id, b.checkoutAt, b.checkoutAt, b.paidAt, b.checkoutAt, b.paidAt]);
      historyRows.push([uuid(), orderId, null, "pending", ctx.cashier[b.outlet.id], `Booking spa ${b.code}`, b.checkoutAt]);
      historyRows.push([uuid(), orderId, "pending", "completed", ctx.cashier[b.outlet.id], `Dibayar ${METHOD_NAME[b.method]}`, b.paidAt]);
    }
    bookingRows.push([b.id, b.code, b.outlet.company_id, b.outlet.id, b.outlet.warehouse_id, b.type, b.source,
      b.customer ? b.customer.id : null, b.name, b.phone, b.pref, b.notes, b.scheduledAt, b.status,
      b.paid ? "paid" : "unpaid", orderId, b.checkoutAt || null, b.paidAt || null, b.cancelledAt || null,
      b.cancelReason || null, D.SEED_ACTOR, b.created, b.paidAt || b.cancelledAt || b.created]);
    ev(b, null, "create", null, "unassigned", b.created, b.source === "public" ? "Booking online" : "");
    let derived = "unassigned";
    const statuses = b.items.map(() => "unassigned");
    for (const [i, it] of b.items.entries()) {
      const id = uuid();
      it.id = id;
      const v = it.line.v;
      itemRows.push([id, b.id, v.id, v.treatment, v.name, v.duration_min, v.buffer_min, it.price,
        it.therapist ? it.therapist.id : null, it.startsAt, it.endsAt, it.status, it.startedAt || null, it.completedAt || null,
        it.commission ? it.commission.type : null, it.commission ? it.commission.value : null,
        it.status === "completed" ? (it.commission ? it.commission.amount : 0) : null, i, b.created, it.completedAt || b.created]);
      const assignAt = new Date(Math.min(b.type === "walk_in" ? b.created.getTime() + 2 * MIN
        : it.startsAt.getTime() - between(30, 600) * MIN, Date.now()));
      const assignWhen = assignAt < b.created ? new Date(b.created.getTime() + MIN) : assignAt;
      if (it.therapist) {
        ev(b, id, "assign", "unassigned", "assigned", assignWhen, it.therapist.name);
        statuses[i] = "assigned";
      }
      if (it.startedAt) { ev(b, id, "start", "assigned", "in_treatment", it.startedAt); statuses[i] = "in_treatment"; }
      if (it.completedAt) { ev(b, id, "complete", "in_treatment", "completed", it.completedAt); statuses[i] = "completed"; }
      const next = deriveStatus(statuses);
      if (next !== derived && it.therapist) {
        ev(b, null, "status", derived, next, it.completedAt || it.startedAt || assignWhen);
        derived = next;
      }
      if (b.paid) {
        const p = ctx.products.get(`${v.id}|${b.outlet.id}`);
        if (!p) throw new Error(`Produk POS untuk ${v.treatment} (${v.name}) di ${b.outlet.name} belum ada — jalankan seeders/mizu-spa.js`);
        orderItemRows.push([uuid(), orderId, p.id, `${v.treatment} (${v.name})`.slice(0, 200), p.sku, "[]", "[]", 1, it.price,
          it.price, it.price, it.therapist ? `Terapis: ${it.therapist.name}` : null, "spa", "served", 0, false, b.checkoutAt]);
      }
    }
    if (b.status === "cancelled") ev(b, null, "cancel", derived, "cancelled", b.cancelledAt, b.cancelReason);
    if (b.status === "expired") {
      const lastEnd = new Date(Math.max(...b.items.map((i) => i.endsAt.getTime())));
      ev(b, null, "expire", "unassigned", "expired", new Date(lastEnd.getTime() + 125 * MIN), "Lewat jadwal tanpa dimulai");
    }
    if (b.paid) {
      ev(b, null, "checkout", null, null, b.checkoutAt, `Tagihan POS ${b.orderNumber}`);
      ev(b, null, "paid", "unpaid", "paid", b.paidAt, "Dibayar di kasir POS");
    }
  }

  const today = wibDate(new Date());
  const shiftRows = [...shifts.values()].map((s) => {
    const open = at(s.date, clock(s.branch.open) - 30);
    const closed = s.date === today ? null : at(s.date, clock(s.branch.close) + 15);
    return [s.id, `MZS-${s.branch.code.replace("MZ-", "").slice(0, 4)}-${ymd(s.date)}`, ctx.cashier[s.branch.id], s.branch.id, open, closed,
      "Seeder Mizu Spa", closed ? "Seeder Mizu Spa" : null, 500000, closed ? 500000 + s.cash : 0, 500000 + s.cash, s.orders,
      s.total, 0, s.cash, s.qris, 0, s.credit, 0, closed ? "closed" : "active"];
  });

  await insertMany(c, "pos.pos_shifts", ["id", "shift_number", "cashier_id", "branch_id", "opened_at", "closed_at", "opened_by",
    "closed_by", "opening_cash", "closing_cash", "expected_cash", "total_orders", "total_sales", "total_refunds", "total_cash_sales",
    "total_qris_sales", "total_debit_sales", "total_credit_sales", "total_ark_coin_sales", "status"], shiftRows);
  await insertMany(c, "pos.pos_orders", ["id", "order_number", "order_type", "status", "payment_status", "payment_method",
    "payment_method_code", "payment_method_name", "customer_id", "cashier_id", "guest_count", "subtotal", "discount_amount",
    "tax_amount", "service_charge_amount", "other_charges_amount", "charges_breakdown", "total_amount", "amount_paid",
    "change_amount", "ark_coins_used", "notes", "contact_name", "contact_phone", "company_id", "branch_id", "warehouse_id",
    "sold_from", "shift_id", "ordered_at", "confirmed_at", "completed_at", "created_at", "updated_at"], orderRows);
  await insertMany(c, "pos.pos_order_items", ["id", "order_id", "product_id", "product_name", "product_sku", "variants", "modifiers",
    "quantity", "unit_price", "subtotal", "total_amount", "kitchen_notes", "station", "kitchen_status", "xp_earned",
    "inventory_deducted", "created_at"], orderItemRows);
  await insertMany(c, "pos.pos_order_status_history", ["id", "order_id", "from_status", "to_status", "changed_by", "notes",
    "changed_at"], historyRows);
  await insertMany(c, "spa.bookings", ["id", "booking_code", "company_id", "branch_id", "warehouse_id", "booking_type", "source",
    "customer_id", "customer_name", "customer_phone", "therapist_gender_pref", "notes", "scheduled_at", "status", "payment_status",
    "pos_order_id", "checked_out_at", "paid_at", "cancelled_at", "cancel_reason", "created_by", "created_at", "updated_at"], bookingRows);
  await insertMany(c, "spa.booking_items", ["id", "booking_id", "variant_id", "treatment_name", "variant_name", "duration_min",
    "buffer_min", "price_idr", "therapist_id", "starts_at", "ends_at", "status", "started_at", "completed_at", "commission_type",
    "commission_value", "commission_idr", "sort_order", "created_at", "updated_at"], itemRows);
  await insertMany(c, "spa.booking_events", ["id", "booking_id", "item_id", "action", "from_status", "to_status", "actor_user_id",
    "note", "created_at"], eventRows.map((r) => { r[6] = null; return r; }));

  // Statistik pelanggan demo dari transaksi spa lunas.
  await c.query(
    `UPDATE pos.pos_customers c SET visit_count = s.visits, total_spent = s.spent, last_visit = s.last
       FROM (SELECT customer_id, count(*) AS visits, sum(total_amount) AS spent, max(completed_at) AS last
               FROM pos.pos_orders WHERE id = ANY($1) AND customer_id IS NOT NULL GROUP BY customer_id) s
      WHERE c.id = s.customer_id`, [orderRows.map((r) => r[0])]);
  return { bookings: bookingRows.length, items: itemRows.length, events: eventRows.length, orders: orderRows.length, shifts: shiftRows.length };
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
    const removed = await reset(c);
    console.log(`reset             : ${removed.bookings} booking, ${removed.orders} order POS seeder lama dihapus`);
    const ctx = await load(c);
    const existing = await c.query(`SELECT booking_code FROM spa.bookings`);
    const seq = {};
    const seqRows = await c.query(
      `SELECT substr(order_number, 5, 8) AS d, max(substr(order_number, 14)::int) AS n FROM pos.pos_orders
        WHERE order_number ~ '^POS-[0-9]{8}-[0-9]{4}$' GROUP BY 1`);
    for (const r of seqRows.rows) seq[`${r.d.slice(0, 4)}-${r.d.slice(4, 6)}-${r.d.slice(6, 8)}`] = Number(r.n);
    const bookings = generate(ctx, existing.rows.map((r) => r.booking_code), seq);
    const res = await persist(c, ctx, bookings);
    await c.query("COMMIT");
    const by = (k) => bookings.reduce((m, b) => ((m[b[k]] = (m[b[k]] || 0) + 1), m), {});
    console.log("booking           :", res.bookings, JSON.stringify(by("status")));
    console.log("treatment         :", res.items, "| events:", res.events);
    console.log("order POS lunas   :", res.orders, "| shift kasir:", res.shifts);
    const revenue = bookings.filter((b) => b.paid).reduce((s, b) => s + b.items.reduce((x, i) => x + (i.status === "completed" ? i.price : 0), 0), 0);
    const commission = bookings.reduce((s, b) => s + b.items.reduce((x, i) => x + (i.commission ? i.commission.amount : 0), 0), 0);
    console.log("omzet / komisi    :", revenue.toLocaleString("id-ID"), "/", commission.toLocaleString("id-ID"));
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
