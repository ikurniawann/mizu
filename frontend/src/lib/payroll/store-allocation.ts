/**
 * Tampilan alokasi biaya slip per toko (payroll multi-toko): satu slip & satu
 * perhitungan PPh 21/BPJS, biayanya dibagi ke toko sesuai jam/hari hadir.
 */

export type AllocationBasisCode = "hours" | "days" | "primary" | "none";

export const ALLOCATION_BASIS_LABEL: Record<AllocationBasisCode, string> = {
  hours: "Jam kerja per toko",
  days: "Hari hadir per toko",
  primary: "Penempatan utama (tanpa absensi)",
  none: "Tanpa penempatan",
};

export const NO_STORE_LABEL = "Tanpa toko";

/** 0.625 → "62,5%" (satu desimal, koma Indonesia). */
export function formatRatio(ratio: number | string | null | undefined): string {
  if (ratio === null || ratio === undefined || ratio === "") return "—";
  const n = Number(ratio);
  if (!Number.isFinite(n)) return "—";
  return `${(Math.round(n * 1000) / 10).toFixed(1).replace(".", ",")}%`;
}

/** Angka hari/jam ringkas: 16 → "16", 114.53 → "114,5". */
export function formatQty(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1).replace(".", ",");
}

export interface AllocationLike {
  branch_name: string | null;
  ratio: number | string;
}

/** "Paddy Store PVJ 69,6% · Paddy Store Kopo 30,4%" untuk ringkasan satu baris. */
export function allocationSummary(rows: AllocationLike[]): string {
  return rows.map((r) => `${r.branch_name ?? NO_STORE_LABEL} ${formatRatio(r.ratio)}`).join(" · ");
}
