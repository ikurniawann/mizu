/**
 * Waktu modul Spa. Semua outlet berada di WIB (Asia/Jakarta, UTC+7, tanpa
 * DST), jadi konversi cukup dengan offset tetap — tidak bergantung zona waktu
 * browser. API menerima/mengirim ISO UTC; input form memakai jam dinding WIB.
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "10:00" / "10:00:00" / "9:5" → menit sejak 00:00; null bila tidak valid. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

/** Menit sejak 00:00 → "HH:MM" (dibungkus 24 jam). */
export function formatClock(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "HH:MM:SS" → "HH:MM" untuk tampilan/isi input time; kosong tetap kosong. */
export function shortClock(value: string | null | undefined): string {
  const minutes = parseClock(value);
  return minutes === null ? "" : formatClock(minutes);
}

/** Tanggal WIB + jam WIB → ISO UTC. `("2026-10-08","06:00")` → `"2026-10-07T23:00:00.000Z"`. */
export function wibToIso(date: string, time: string): string {
  const minutes = parseClock(time);
  if (!DATE_RE.test(date) || minutes === null) throw new Error("Tanggal/jam tidak valid");
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 0, minutes) - WIB_OFFSET_MS).toISOString();
}

/** Nilai `<input type="datetime-local">` (dibaca sebagai WIB) → ISO UTC; null bila kosong/tidak valid. */
export function wibLocalInputToIso(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value ?? "");
  if (!match) return null;
  try {
    return wibToIso(match[1], match[2]);
  } catch {
    return null;
  }
}

function wibShifted(iso: string | Date): string | null {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString();
}

/** ISO UTC → nilai `<input type="datetime-local">` dalam WIB ("YYYY-MM-DDTHH:MM"). */
export function isoToWibLocalInput(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  return wibShifted(iso)?.slice(0, 16) ?? "";
}

/** ISO UTC → tanggal kalender WIB "YYYY-MM-DD". */
export function wibDateOf(iso: string | Date): string {
  return wibShifted(iso)?.slice(0, 10) ?? "";
}

/** ISO UTC → jam WIB "HH:MM". */
export function wibClockOf(iso: string | Date): string {
  return wibShifted(iso)?.slice(11, 16) ?? "";
}

/** Tambah n hari ke tanggal kalender "YYYY-MM-DD". */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Bulan WIB berjalan "YYYY-MM". */
export function currentMonthWib(now: Date = new Date()): string {
  return wibDateOf(now).slice(0, 7);
}

/** Rentang tanggal satu bulan "YYYY-MM" → {from: tgl 1, to: tgl terakhir}. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Selisih menit antara dua ISO (dibulatkan). */
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / MINUTE_MS);
}

/** Tambah menit ke ISO UTC. */
export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * MINUTE_MS).toISOString();
}

export interface TimeSlot {
  /** Jam dinding WIB "HH:MM". */
  time: string;
  /** Awal slot, ISO UTC. */
  iso: string;
}

export interface SlotOptions {
  /** Tanggal kunjungan WIB "YYYY-MM-DD". */
  date: string;
  open_time: string;
  close_time: string;
  slot_minutes: number;
  /** Total durasi treatment terpilih; slot yang selesai melewati jam tutup dibuang. */
  duration_min?: number;
  /** Slot yang mulai ≤ now dibuang (hanya slot di masa depan). */
  now?: Date;
}

/**
 * Slot mulai dari jam buka sampai sebelum jam tutup, setiap `slot_minutes`.
 * Jam tutup ≤ jam buka berarti outlet tutup lewat tengah malam (mis. 10:00–02:00).
 */
export function generateSlots(options: SlotOptions): TimeSlot[] {
  const open = parseClock(options.open_time);
  let close = parseClock(options.close_time);
  const step = Math.floor(options.slot_minutes);
  if (open === null || close === null || !(step > 0) || !DATE_RE.test(options.date)) return [];
  if (close <= open) close += 1440;
  const duration = Math.max(0, options.duration_min ?? 0);
  const dayStartMs = new Date(wibToIso(options.date, "00:00")).getTime();
  const nowMs = options.now ? options.now.getTime() : null;
  const slots: TimeSlot[] = [];
  for (let start = open; start < close; start += step) {
    if (duration > 0 && start + duration > close) break;
    const startMs = dayStartMs + start * MINUTE_MS;
    if (nowMs !== null && startMs <= nowMs) continue;
    slots.push({ time: formatClock(start), iso: new Date(startMs).toISOString() });
  }
  return slots;
}
