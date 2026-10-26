/**
 * Jadwal terapis (Area Karyawan → Tugas Terapis): treatment dikelompokkan per
 * hari lalu per booking, plus penanda booking yang baru ditugaskan. Fungsi
 * murni, diuji tanpa DOM.
 */
import { addDaysToDate, wibDateOf } from "./time";
import type { BookingStatus, MyScheduleItem, PaymentStatus } from "./types";

const WEEKDAY = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"] as const;

/** Booking baru = ditugaskan ke terapis dalam 24 jam terakhir. */
export const NEW_ASSIGNMENT_HOURS = 24;

export interface MyBooking {
  booking_id: string;
  booking_code: string;
  customer_name: string;
  branch_id: string;
  branch_name: string;
  starts_at: string;
  ends_at: string;
  notes: string;
  booking_status: BookingStatus;
  payment_status: PaymentStatus;
  assigned_at: string | null;
  items: MyScheduleItem[];
  /** Total komisi treatment di booking ini (perkiraan bila ada yang belum selesai). */
  commission_idr: number;
  estimated: boolean;
  commission_missing?: boolean;
}

export interface MyScheduleDay {
  date: string;
  label: string;
  bookings: MyBooking[];
}

/** "Hari ini", "Besok", atau "Rabu, 14 Okt" untuk tanggal WIB "YYYY-MM-DD". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Hari ini";
  if (date === addDaysToDate(today, 1)) return "Besok";
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${WEEKDAY[weekday]}, ${d} ${MONTH[m - 1]}`;
}

/** Treatment → booking → hari, urut jam mulai; booking batal/item batal dibuang. */
export function groupMySchedule(items: MyScheduleItem[], today: string): MyScheduleDay[] {
  const bookings = new Map<string, MyBooking>();
  for (const it of items) {
    if (it.status === "cancelled" || it.booking_status === "cancelled") continue;
    let b = bookings.get(it.booking_id);
    if (!b) {
      b = {
        booking_id: it.booking_id,
        booking_code: it.booking_code,
        customer_name: it.customer_name,
        branch_id: it.branch_id,
        branch_name: it.branch_name,
        starts_at: it.starts_at,
        ends_at: it.ends_at,
        notes: it.notes,
        booking_status: it.booking_status,
        payment_status: it.payment_status,
        assigned_at: it.assigned_at,
        items: [],
        commission_idr: 0,
        estimated: false,
      };
      bookings.set(it.booking_id, b);
    }
    b.items.push(it);
    b.commission_idr += Number(it.commission_idr ?? 0);
    b.estimated ||= it.commission_estimated;
    b.commission_missing ||= it.commission_idr == null;
  }
  const days = new Map<string, MyScheduleDay>();
  const sorted = [...bookings.values()].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  for (const b of sorted) {
    const date = wibDateOf(b.starts_at);
    let day = days.get(date);
    if (!day) {
      day = { date, label: dayLabel(date, today), bookings: [] };
      days.set(date, day);
    }
    day.bookings.push(b);
  }
  return [...days.values()];
}

/** Booking yang baru ditugaskan (belum selesai) — ditandai "Baru". */
export function isNewAssignment(b: Pick<MyBooking, "assigned_at" | "booking_status">, now: Date): boolean {
  if (!b.assigned_at || b.booking_status === "completed") return false;
  const age = now.getTime() - new Date(b.assigned_at).getTime();
  return age >= 0 && age < NEW_ASSIGNMENT_HOURS * 3_600_000;
}

/** "Balinese Massage — 60 menit" tanpa mengulang durasi bila nama varian sudah durasi. */
export function treatmentLabel(it: Pick<MyScheduleItem, "treatment_name" | "variant_name" | "duration_min">): string {
  const variant = it.variant_name.trim();
  const duration = `${it.duration_min} menit`;
  if (!variant || variant === duration || variant === String(it.duration_min)) return `${it.treatment_name} — ${duration}`;
  return `${it.treatment_name} — ${variant} · ${duration}`;
}
