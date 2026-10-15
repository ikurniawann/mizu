/**
 * Periode absensi (closing absensi) di sisi klien — cermin
 * backend/internal/modules/hris/domain/attendance_period.go, dipakai untuk
 * pratinjau pengaturan cut-off sebelum disimpan dan label tanggal.
 *
 * Periode bulan M (bulan payroll):
 *  - cut-off 0 / akhir bulan  → 1 s.d. akhir bulan M
 *  - cut-off N (1–28)          → tgl N+1 bulan M-1 s.d. tgl N bulan M
 * Tanggal closing = akhir periode + N hari; lewat tanggal itu periode terkunci.
 */

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const MONTH_LONG_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return utc(y, m, d);
};

/** 0 dan 29–31 = akhir bulan (0); 1–28 tetap; selain itu null. */
export function normalizeCutoff(day: number): number | null {
  if (!Number.isInteger(day)) return null;
  if (day === 0 || (day > 28 && day <= 31)) return 0;
  if (day >= 1 && day <= 28) return day;
  return null;
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

export interface PeriodRange {
  year: number;
  month: number;
  start: string;
  end: string;
  closing: string;
}

/** Periode bulan payroll year/month menurut pengaturan saja. */
export function computePeriod(cutoffDay: number, offsetDays: number, year: number, month: number): PeriodRange {
  const cut = normalizeCutoff(cutoffDay) ?? 0;
  const end = cut === 0 ? utc(year, month + 1, 0) : utc(year, month, cut);
  const start = cut === 0 ? utc(year, month, 1) : utc(year, month - 1, cut + 1);
  const endIso = iso(end);
  return { year, month, start: iso(start), end: endIso, closing: addDays(endIso, Math.max(0, offsetDays)) };
}

/** Bulan payroll yang periodenya memuat tanggal (YYYY-MM-DD). */
export function periodKeyFor(cutoffDay: number, date: string): { year: number; month: number } {
  const d = parse(date);
  const cut = normalizeCutoff(cutoffDay) ?? 0;
  if (cut !== 0 && d.getUTCDate() > cut) {
    const next = utc(d.getUTCFullYear(), d.getUTCMonth() + 2, 1);
    return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
  }
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** "21 Okt 2026" */
export function shortDateId(date: string): string {
  const d = parse(date);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "1–31 Okt 2026", "21 Sep – 20 Okt 2026", "21 Des 2026 – 20 Jan 2027". */
export function periodRangeLabel(start: string, end: string): string {
  const s = parse(start);
  const e = parse(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${start} – ${end}`;
  if (s.getUTCFullYear() !== e.getUTCFullYear()) return `${shortDateId(start)} – ${shortDateId(end)}`;
  if (s.getUTCMonth() !== e.getUTCMonth()) {
    return `${s.getUTCDate()} ${MONTH_SHORT[s.getUTCMonth()]} – ${shortDateId(end)}`;
  }
  if (s.getUTCDate() === e.getUTCDate()) return shortDateId(end);
  return `${s.getUTCDate()}–${shortDateId(end)}`;
}

/** Selisih hari kalender today → date (negatif bila sudah lewat). */
export function daysUntil(today: string, date: string): number {
  return Math.round((parse(date).getTime() - parse(today).getTime()) / 86_400_000);
}

/** Hari ini (WIB) sebagai YYYY-MM-DD. */
export function todayWib(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** "08.30" WIB dari ISO timestamp → "08:30" untuk input jam; "" bila kosong. */
export function wibClockInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(11, 16);
}

/** Deskripsi aturan cut-off untuk UI. */
export function cutoffDescription(cutoffDay: number): string {
  const cut = normalizeCutoff(cutoffDay) ?? 0;
  if (cut === 0) return "Bulan kalender (tgl 1 s.d. akhir bulan)";
  return `Tgl ${cut + 1} bulan lalu s.d. tgl ${cut} bulan berjalan`;
}
