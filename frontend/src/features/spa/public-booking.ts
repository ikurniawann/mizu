/**
 * Logika murni halaman booking publik (/booking/spa): deret tanggal, kelompok
 * jam per waktu hari, isian awal dari URL, dan tautan WhatsApp outlet.
 */
import { addDaysToDate, formatClock, parseClock, type TimeSlot } from "./time";
import type { PublicTreatment } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"] as const;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"] as const;

export interface DateChip {
  date: string;
  weekday: string;
  day: number;
  month: string;
  /** "Hari ini" / "Besok", selain itu null. */
  label: string | null;
}

/** Deret `days` tanggal mulai `today` (WIB "YYYY-MM-DD") untuk pemilih tanggal horizontal. */
export function dateStrip(today: string, days = 14): DateChip[] {
  if (!DATE_RE.test(today)) return [];
  return Array.from({ length: days }, (_, i) => {
    const date = addDaysToDate(today, i);
    const [y, m, d] = date.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
    return {
      date,
      weekday: WEEKDAY[weekday],
      day: d,
      month: MONTH[m - 1],
      label: i === 0 ? "Hari ini" : i === 1 ? "Besok" : null,
    };
  });
}

export interface SlotGroup {
  key: "pagi" | "siang" | "sore" | "malam";
  label: string;
  slots: TimeSlot[];
}

const PERIODS: { key: SlotGroup["key"]; label: string; until: number }[] = [
  { key: "pagi", label: "Pagi", until: 12 * 60 },
  { key: "siang", label: "Siang", until: 15 * 60 },
  { key: "sore", label: "Sore", until: 18 * 60 },
  { key: "malam", label: "Malam", until: 48 * 60 },
];

/** Slot dikelompokkan Pagi (<12) · Siang (<15) · Sore (<18) · Malam; kelompok kosong dibuang. */
export function groupSlots(slots: TimeSlot[]): SlotGroup[] {
  const groups = PERIODS.map((p) => ({ key: p.key, label: p.label, slots: [] as TimeSlot[] }));
  for (const slot of slots) {
    const minute = parseClock(slot.time) ?? 0;
    const index = PERIODS.findIndex((p) => minute < p.until);
    groups[index === -1 ? PERIODS.length - 1 : index].slots.push(slot);
  }
  return groups.filter((g) => g.slots.length > 0);
}

/** Jam selesai "HH:MM" dari jam mulai + durasi total. */
export function endClock(start: string, durationMin: number): string {
  const minute = parseClock(start);
  return minute === null ? "" : formatClock(minute + durationMin);
}

export interface BookingPrefill {
  outlet: string | null;
  treatment: string | null;
  date: string | null;
}

/** Isian awal dari query (?outlet=<branch_id>&treatment=<id>&date=YYYY-MM-DD); nilai aneh diabaikan. */
export function parsePrefill(params: Record<string, string | string[] | undefined>): BookingPrefill {
  const one = (key: string) => {
    const value = params[key];
    const text = (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
    return /^[\w-]{1,64}$/.test(text) ? text : null;
  };
  const date = one("date");
  return { outlet: one("outlet"), treatment: one("treatment"), date: date && DATE_RE.test(date) ? date : null };
}

/** Tanggal isian awal dibatasi ke rentang yang boleh dipesan. */
export function clampDate(date: string | null, today: string, maxDaysAhead: number): string {
  if (!date || date < today) return today;
  const max = addDaysToDate(today, maxDaysAhead);
  return date > max ? max : date;
}

/** Tautan wa.me untuk nomor outlet Indonesia (08… / +62… / 62…); null bila bukan nomor HP. */
export function whatsappHref(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const intl = digits.startsWith("62") ? digits : digits.startsWith("0") ? `62${digits.slice(1)}` : "";
  if (!/^628\d{7,12}$/.test(intl)) return null;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

export const OTHER_CATEGORY = "Lainnya";

/** Kategori treatment sesuai urutan katalog (kosong → "Lainnya"). */
export function treatmentCategories(treatments: PublicTreatment[]): string[] {
  return [...new Set(treatments.filter((t) => t.variants.length > 0).map((t) => t.category?.trim() || OTHER_CATEGORY))];
}

/** Treatment yang bisa dipesan, varian terpendek dulu; treatment `focusId` (dari menu) ditaruh paling atas. */
export function orderedTreatments(treatments: PublicTreatment[], focusId: string | null): PublicTreatment[] {
  const list = treatments
    .filter((t) => t.variants.length > 0)
    .map((t) => ({ ...t, variants: [...t.variants].sort((a, b) => a.duration_min - b.duration_min || a.price_idr - b.price_idr) }));
  const focus = list.find((t) => t.id === focusId);
  return focus ? [focus, ...list.filter((t) => t !== focus)] : list;
}
