/**
 * Tata letak kalender Book Order (tampilan per terapis): sumbu jam vertikal
 * per hari WIB, satu kolom per terapis, blok booking setinggi total durasinya.
 */
import type { Shift } from "./types";
import { parseClock, wibClockOf, wibDateOf, wibToIso } from "./time";

/** Piksel per menit: 30 menit = 42 px. */
export const PX_PER_MIN = 1.4;
export const SHIFT_EXTENSION_MINUTES = 60;

export interface DayRange {
  /** Menit sejak 00:00 WIB. */
  start: number;
  end: number;
}

/** Menit sejak 00:00 WIB dari timestamp ISO. */
export function minuteOfDay(iso: string): number {
  return parseClock(wibClockOf(iso)) ?? 0;
}

interface Timed {
  starts_at: string;
  ends_at: string;
}

/**
 * Rentang tampilan: jam buka–tutup outlet, diperlebar agar setiap treatment
 * terlihat, dibulatkan ke jam penuh. Bawaan 09:00–22:00.
 */
export function dayRange(open: string | null | undefined, close: string | null | undefined, items: Timed[] = []): DayRange {
  let start = parseClock(open) ?? 9 * 60;
  let end = parseClock(close) ?? 22 * 60;
  if (end <= start) end = start + 12 * 60;
  for (const it of items) {
    start = Math.min(start, minuteOfDay(it.starts_at));
    end = Math.max(end, minuteOfDay(it.starts_at) + durationMin(it));
  }
  return { start: Math.floor(start / 60) * 60, end: Math.min(24 * 60, Math.ceil(end / 60) * 60) };
}

/** Garis jam penuh di dalam rentang. */
export function hourMarks(range: DayRange): number[] {
  const out: number[] = [];
  for (let m = range.start; m <= range.end; m += 60) out.push(m);
  return out;
}

export function durationMin(it: Pick<Timed, "starts_at" | "ends_at">): number {
  return Math.max(1, Math.round((new Date(it.ends_at).getTime() - new Date(it.starts_at).getTime()) / 60000));
}

export interface Placed<T> {
  item: T;
  top: number;
  height: number;
  bufferHeight: number;
  /** Lajur di dalam kelompok tumpang-tindih (0-based) dan jumlah lajurnya. */
  lane: number;
  lanes: number;
}

/**
 * Posisi blok dalam satu kolom. Treatment yang waktunya saling tumpang-tindih
 * (biasanya hanya di kolom "Belum ditugaskan") dibagi ke lajur berdampingan.
 */
export function layoutColumn<T extends Timed>(items: T[], range: DayRange, pxPerMin = PX_PER_MIN): Placed<T>[] {
  const sorted = [...items].sort((a, b) => minuteOfDay(a.starts_at) - minuteOfDay(b.starts_at) || durationMin(b) - durationMin(a));
  const placed: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    const s = minuteOfDay(item.starts_at);
    const e = s + durationMin(item);
    if (cluster.length && s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else {
      laneEnds[lane] = e;
    }
    clusterEnd = Math.max(clusterEnd, e);
    const p: Placed<T> = {
      item,
      top: (s - range.start) * pxPerMin,
      height: durationMin(item) * pxPerMin,
      bufferHeight: 0,
      lane,
      lanes: 1,
    };
    cluster.push(p);
    placed.push(p);
  }
  flush();
  return placed;
}

/** Menit (dibulatkan ke bawah per `step`) dari posisi klik di kolom. */
export function minuteAtOffset(y: number, range: DayRange, pxPerMin = PX_PER_MIN, step = 15): number {
  const raw = range.start + y / pxPerMin;
  const snapped = Math.floor(raw / step) * step;
  return Math.min(Math.max(snapped, range.start), range.end - step);
}

/**
 * Jam mulai baru saat blok diseret naik/turun: `top` = posisi atas blok di
 * kolom (px), dibulatkan ke `step` menit terdekat dan tetap di dalam rentang.
 */
export function snapStartMinute(top: number, range: DayRange, pxPerMin = PX_PER_MIN, step = 15): number {
  const raw = range.start + Math.max(0, top) / pxPerMin;
  const snapped = Math.round(raw / step) * step;
  return Math.min(Math.max(snapped, range.start), range.end - step);
}

export interface Band {
  top: number;
  height: number;
}

function shiftWindow(shift: Shift | null): { start: number; end: number; treatmentEnd: number } | null {
  const start = parseClock(shift?.start_time);
  const endClock = parseClock(shift?.end_time);
  if (start === null || endClock === null) return null;
  const end = endClock > start ? endClock : 24 * 60;
  return { start, end, treatmentEnd: Math.min(24 * 60, end + SHIFT_EXTENSION_MINUTES) };
}

function clippedBand(start: number, end: number, range: DayRange, pxPerMin: number): Band | null {
  const from = Math.max(start, range.start);
  const to = Math.min(end, range.end);
  return to > from ? { top: (from - range.start) * pxPerMin, height: (to - from) * pxPerMin } : null;
}

/** Tambahan waktu khusus penyelesaian treatment, bukan waktu mulai baru. */
export function shiftExtensionBand(shift: Shift | null, unavailable: boolean, range: DayRange, pxPerMin = PX_PER_MIN): Band | null {
  const window = shiftWindow(shift);
  return unavailable || !window ? null : clippedBand(window.end, window.treatmentEnd, range, pxPerMin);
}

/** Pesan penolakan waktu mulai: akhir shift asli bersifat eksklusif. */
export function shiftStartMismatch(minute: number, shift: Shift | null): string | null {
  const window = shiftWindow(shift);
  if (!window) return null;
  if (minute < window.start) return `Booking di luar shift ${clockOf(window.start)}–${clockOf(window.end)}.`;
  if (minute >= window.end) return `Booking harus dimulai sebelum ${clockOf(window.end)} WIB (akhir shift).`;
  return null;
}

/** Area di luar shift dan tambahan treatment. Tanpa shift/libur/cuti → seluruh kolom. */
export function offShiftBands(shift: Shift | null, unavailable: boolean, range: DayRange, pxPerMin = PX_PER_MIN): Band[] {
  const total = (range.end - range.start) * pxPerMin;
  const window = shiftWindow(shift);
  if (unavailable || !window) return [{ top: 0, height: total }];
  return [
    clippedBand(range.start, window.start, range, pxPerMin),
    clippedBand(window.treatmentEnd, range.end, range, pxPerMin),
  ].filter((band): band is Band => band !== null);
}

/** Posisi garis "sekarang" bila tanggal tampilan = hari ini (WIB), selain itu null. */
export function nowOffset(date: string, now: Date, range: DayRange, pxPerMin = PX_PER_MIN): number | null {
  if (wibDateOf(now) !== date) return null;
  const m = minuteOfDay(now.toISOString());
  if (m < range.start || m > range.end) return null;
  return (m - range.start) * pxPerMin;
}

/** "HH:MM" dari menit. */
export function clockOf(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Item yang boleh dipindah ke terapis lain lewat seret (belum dimulai, booking masih terbuka). */
export function isDraggable(item: { status: string; booking_status: string; assignment_locked?: boolean }): boolean {
  return !item.assignment_locked && (item.status === "unassigned" || item.status === "assigned") && item.booking_status !== "cancelled" && item.booking_status !== "expired";
}

/** Booking di luar rentang shift yang memang terjadwal tidak boleh ditugaskan. */
export function shiftMismatch(item: Timed, shift: Shift | null): string | null {
  const window = shiftWindow(shift);
  if (!window) return null;
  const startMismatch = shiftStartMismatch(minuteOfDay(item.starts_at), shift);
  if (startMismatch) return startMismatch;
  const midnight = new Date(wibToIso(wibDateOf(item.starts_at), "00:00")).getTime();
  if (new Date(item.ends_at).getTime() > midnight + window.treatmentEnd * 60000) {
    return `Booking harus selesai paling lambat ${clockOf(window.treatmentEnd)} WIB (akhir shift +1 jam).`;
  }
  return null;
}

/** Alasan ketersediaan yang masih perlu dikonfirmasi sebelum penugasan. */
export function availabilityWarning(
  item: Timed,
  row: { shift: Shift | null; on_leave: boolean; day_off?: boolean }
): string | null {
  if (row.on_leave) return "Terapis sedang cuti pada tanggal ini.";
  if (row.day_off) return "Hari ini jadwal libur terapis.";
  if (!row.shift) return "Terapis tidak punya shift pada tanggal ini.";
  return shiftMismatch(item, row.shift);
}
