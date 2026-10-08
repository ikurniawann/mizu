import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { getPool } from "@/lib/db";
import { safeEqual } from "@/lib/security/compare";
import { sendWhatsAppOtp } from "@/lib/whatsapp";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUTOFF_MS = 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type ChangeResult = { ok: true; grant?: string; phoneHint?: string } | { ok: false; status: number; error: string };
type BookingForChange = { id: string; customer_phone: string; status: string; payment_status: string; pos_order_id: string | null; scheduled_at: Date };

export function canChangePublicBooking(booking: { status: string; payment_status: string; pos_order_id: string | null; scheduled_at: Date | string }, now = Date.now()) {
  return ["unassigned", "assigned"].includes(booking.status)
    && booking.payment_status === "unpaid"
    && !booking.pos_order_id
    && new Date(booking.scheduled_at).getTime() - now >= CUTOFF_MS;
}

export async function issueBookingChangeCode(token: string): Promise<ChangeResult> {
  if (!UUID.test(token)) return { ok: false, status: 404, error: "Booking tidak ditemukan" };
  const db = await getPool().connect();
  let booking: BookingForChange | undefined;
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const salt = randomBytes(16).toString("hex");
  let challengeId = "";
  try {
    await db.query("BEGIN");
    const found = await db.query<BookingForChange>(
      `SELECT id::text, customer_phone, status, payment_status, pos_order_id::text, scheduled_at
         FROM spa.bookings WHERE public_token = $1::uuid AND source = 'public' FOR UPDATE`, [token]);
    booking = found.rows[0];
    if (!booking) { await db.query("ROLLBACK"); return { ok: false, status: 404, error: "Booking tidak ditemukan" }; }
    if (!canChangePublicBooking(booking)) { await db.query("ROLLBACK"); return { ok: false, status: 409, error: "Perubahan mandiri hanya tersedia sampai 24 jam sebelum kunjungan untuk booking yang belum dibayar." }; }
    const recent = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM spa.public_booking_challenges
        WHERE booking_id = $1 AND created_at > now() - interval '10 minutes'`, [booking.id]);
    if (recent.rows[0].n >= 3) { await db.query("ROLLBACK"); return { ok: false, status: 429, error: "Terlalu banyak kode diminta. Coba lagi dalam 10 menit." }; }
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO spa.public_booking_challenges (booking_id, code_hash, expires_at)
       VALUES ($1, $2, now() + interval '5 minutes') RETURNING id::text`, [booking.id, `${salt}:${hash(`${salt}:${code}`)}`]);
    challengeId = inserted.rows[0].id;
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { db.release(); }
  const sent = await sendWhatsAppOtp({ target: booking!.customer_phone, code, fallbackText: `Kode perubahan booking Mizu Anda: ${code}. Berlaku 5 menit. Jangan bagikan kode ini.` });
  if (!sent.success) {
    await getPool().query("DELETE FROM spa.public_booking_challenges WHERE id = $1", [challengeId]);
    return { ok: false, status: 503, error: "Kode belum bisa dikirim ke WhatsApp. Coba lagi nanti atau hubungi outlet." };
  }
  return { ok: true, phoneHint: `••••${booking!.customer_phone.slice(-4)}` };
}

export async function verifyBookingChangeCode(token: string, code: string): Promise<ChangeResult> {
  if (!UUID.test(token)) return { ok: false, status: 404, error: "Booking tidak ditemukan" };
  if (!/^\d{6}$/.test(code)) return { ok: false, status: 400, error: "Masukkan kode 6 digit." };
  const db = getPool();
  const found = await db.query<{ id: string; booking_id: string; code_hash: string; expires_at: Date; consumed_at: Date | null; status: string; payment_status: string; pos_order_id: string | null; scheduled_at: Date }>(
    `SELECT c.id::text, c.booking_id::text, c.code_hash, c.expires_at, c.consumed_at,
            b.status, b.payment_status, b.pos_order_id::text, b.scheduled_at
       FROM spa.public_booking_challenges c JOIN spa.bookings b ON b.id = c.booking_id
      WHERE b.public_token = $1::uuid AND b.source = 'public'
      ORDER BY c.created_at DESC LIMIT 1`, [token]);
  const row = found.rows[0];
  if (!row) return { ok: false, status: 400, error: "Minta kode baru terlebih dahulu." };
  if (!canChangePublicBooking(row)) return { ok: false, status: 409, error: "Booking ini tidak bisa diubah mandiri." };
  if (row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) return { ok: false, status: 400, error: "Kode kedaluwarsa. Minta kode baru." };
  const claimed = await db.query(
    `UPDATE spa.public_booking_challenges SET attempts = attempts + 1
      WHERE id = $1 AND attempts < 5 AND consumed_at IS NULL AND expires_at > now() RETURNING id`, [row.id]);
  if (!claimed.rowCount) return { ok: false, status: 429, error: "Terlalu banyak percobaan. Minta kode baru." };
  const [salt, expected] = row.code_hash.split(":");
  if (!salt || !expected || !safeEqual(expected, hash(`${salt}:${code}`))) return { ok: false, status: 400, error: "Kode salah." };
  const grant = randomUUID();
  const consumed = await db.query(
    `UPDATE spa.public_booking_challenges
        SET consumed_at = now(), grant_hash = $2, grant_expires_at = now() + interval '15 minutes'
      WHERE id = $1 AND consumed_at IS NULL RETURNING id`, [row.id, hash(grant)]);
  return consumed.rowCount ? { ok: true, grant } : { ok: false, status: 400, error: "Kode sudah dipakai. Minta kode baru." };
}
