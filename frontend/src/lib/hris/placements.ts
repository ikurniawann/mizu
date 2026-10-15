/**
 * Logika murni Penempatan Karyawan (karyawan multi-toko): status penempatan,
 * label rentang tanggal, dan pilihan toko saat clock-in (toko terdekat dari
 * GPS bila koordinat toko tersedia, selain itu penempatan utama).
 */

export interface PlacementDates {
  start_date: string; // YYYY-MM-DD
  end_date: string | null;
}

export type PlacementStatus = "aktif" | "akan_datang" | "berakhir";

/** Status penempatan pada tanggal `today` (YYYY-MM-DD, WIB). */
export function placementStatus(p: PlacementDates, today: string): PlacementStatus {
  if (p.end_date && p.end_date < today) return "berakhir";
  if (p.start_date > today) return "akan_datang";
  return "aktif";
}

export const PLACEMENT_STATUS_LABEL: Record<PlacementStatus, string> = {
  aktif: "Aktif",
  akan_datang: "Akan datang",
  berakhir: "Berakhir",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "1 Jul 2026" dari "2026-07-01". */
export function shortDateId(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Sejak 1 Jul 2026" atau "1 Jul 2026 – 30 Sep 2026". */
export function placementRangeLabel(p: PlacementDates): string {
  return p.end_date
    ? `${shortDateId(p.start_date)} – ${shortDateId(p.end_date)}`
    : `Sejak ${shortDateId(p.start_date)}`;
}

export interface ClockStoreOption {
  branch_id: string;
  is_primary: boolean;
  lat: string | number | null;
  lng: string | number | null;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Jarak dua titik GPS dalam meter (haversine). */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function coord(v: string | number | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Toko yang dipilih lebih dulu saat clock-in: toko terdekat dari lokasi GPS
 * bila lokasi dan koordinat toko ada, selain itu `defaultBranchId` (penempatan
 * utama), lalu toko pertama. null bila tidak ada pilihan.
 */
export function preferredClockStore(
  options: ClockStoreOption[],
  defaultBranchId: string | null,
  location: GeoPoint | null
): string | null {
  if (options.length === 0) return null;
  if (location) {
    let best: { id: string; d: number } | null = null;
    for (const o of options) {
      const lat = coord(o.lat);
      const lng = coord(o.lng);
      if (lat === null || lng === null) continue;
      const d = distanceMeters(location, { latitude: lat, longitude: lng });
      if (!best || d < best.d) best = { id: o.branch_id, d };
    }
    if (best) return best.id;
  }
  if (defaultBranchId && options.some((o) => o.branch_id === defaultBranchId)) return defaultBranchId;
  return (options.find((o) => o.is_primary) ?? options[0]).branch_id;
}
