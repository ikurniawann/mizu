/**
 * Tata letak kalender Book Order (tampilan per terapis): sumbu jam vertikal
 * per hari WIB, satu kolom per terapis, blok treatment setinggi durasinya
 * ditambah ekor jeda (buffer). Fungsi murni — mudah diuji tanpa DOM.
 */
import type { Shift } from "./types";
import { parseClock, wibClockOf, wibDateOf } from "./time";

/** Piksel per menit: 30 menit = 42 px. */
export const PX_PER_MIN = 1.4;

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
  buffer_min: number;
}

/**
 * Rentang tampilan: jam buka–tutup outlet, diperlebar agar setiap treatment
 * (termasuk jeda) terlihat, dibulatkan ke jam penuh. Bawaan 09:00–22:00.
 */
export function dayRange(open: string | null | undefined, close: string | null | undefined, items: Timed[] = []): DayRange {
  let start = parseClock(open) ?? 9 * 60;
  let end = parseClock(close) ?? 22 * 60;
  if (end <= start) end = start + 12 * 60;
  for (const it of items) {
    start = Math.min(start, minuteOfDay(it.starts_at));
    end = Math.max(end, minuteOfDay(it.starts_at) + durationMin(it) + (it.buffer_min || 0));
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
    const e = s + durationMin(item) + (item.buffer_min || 0);
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
      bufferHeight: (item.buffer_min || 0) * pxPerMin,
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

export interface Band {
  top: number;
  height: number;
}

/** Area di luar shift (diarsir). Tanpa shift/libur/cuti → seluruh kolom. */
export function offShiftBands(shift: Shift | null, unavailable: boolean, range: DayRange, pxPerMin = PX_PER_MIN): Band[] {
  const total = (range.end - range.start) * pxPerMin;
  const s = parseClock(shift?.start_time);
  const e = parseClock(shift?.end_time);
  if (unavailable || s === null || e === null) return [{ top: 0, height: total }];
  const bands: Band[] = [];
  const from = Math.max(s, range.start);
  const to = e > s ? Math.min(e, range.end) : range.end; // shift malam: sampai akhir rentang
  if (from > range.start) bands.push({ top: 0, height: (from - range.start) * pxPerMin });
  if (to < range.end) bands.push({ top: (to - range.start) * pxPerMin, height: (range.end - to) * pxPerMin });
  return bands;
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
export function isDraggable(item: { status: string; booking_status: string }): boolean {
  return (item.status === "unassigned" || item.status === "assigned") && item.booking_status !== "cancelled" && item.booking_status !== "expired";
}

/**
 * Alasan treatment jatuh di luar ketersediaan terapis (cuti, libur, tanpa
 * shift, atau di luar jam shift); null bila aman. Server hanya menolak
 * bentrok jadwal, jadi ini dipakai untuk konfirmasi sebelum menugaskan.
 */
export function availabilityWarning(
  item: Timed,
  row: { shift: Shift | null; on_leave: boolean; day_off?: boolean }
): string | null {
  if (row.on_leave) return "Terapis sedang cuti pada tanggal ini.";
  if (row.day_off) return "Hari ini jadwal libur terapis.";
  const s = parseClock(row.shift?.start_time);
  const e = parseClock(row.shift?.end_time);
  if (s === null || e === null) return "Terapis tidak punya shift pada tanggal ini.";
  const from = minuteOfDay(item.starts_at);
  const to = from + durationMin(item);
  const end = e > s ? e : 24 * 60;
  if (from < s || to > end) return `Treatment ${clockOf(from)}–${clockOf(to)} di luar shift ${clockOf(s)}–${clockOf(e)}.`;
  return null;
}
