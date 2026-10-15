/** State & validasi form treatment + varian (murni, diuji di treatment-form.test.ts). */
import type { Outlet, PriceInput, Treatment, TreatmentInput } from "./types";

export interface VariantRow {
  /** Kunci lokal untuk React; bukan id server. */
  key: string;
  id?: string;
  name: string;
  duration_min: string;
  price_idr: string;
  is_active: boolean;
}

export interface TreatmentForm {
  code: string;
  name: string;
  category: string;
  description: string;
  is_active: boolean;
  /** Layanan custom case: booking-nya membawa desain case (wajib di booking online). */
  customizable: boolean;
  sort_order: string;
  variants: VariantRow[];
}

let seq = 0;
const nextKey = () => `v${++seq}`;

export function emptyVariantRow(): VariantRow {
  return { key: nextKey(), name: "", duration_min: "60", price_idr: "", is_active: true };
}

export function initialTreatmentForm(treatment: Treatment | null): TreatmentForm {
  if (!treatment) {
    return { code: "", name: "", category: "", description: "", is_active: true, customizable: false, sort_order: "0", variants: [emptyVariantRow()] };
  }
  return {
    code: treatment.code,
    name: treatment.name,
    category: treatment.category ?? "",
    description: treatment.description ?? "",
    is_active: treatment.is_active,
    customizable: !!treatment.customizable,
    sort_order: String(treatment.sort_order ?? 0),
    variants: [...treatment.variants]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({
        key: nextKey(),
        id: v.id,
        name: v.name,
        duration_min: String(v.duration_min),
        price_idr: String(v.price_idr),
        is_active: v.is_active,
      })),
  };
}

export const MAX_PRICE_IDR = 999_999_999_999;
const isInt = (value: string, min: number, max: number) =>
  /^\d+$/.test(value.trim()) && Number(value) >= min && Number(value) <= max;

/** Kosong berarti harga dasar; nol tetap harga khusus. */
export function parseOutletPrice(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (!isInt(value, 0, MAX_PRICE_IDR)) throw new Error("Harga tidak valid. Isi bilangan bulat 0–999.999.999.999 atau kosongkan untuk harga dasar.");
  return Number(value);
}

/** Daftar pesan galat; kosong = valid. */
export function validateTreatmentForm(form: TreatmentForm): string[] {
  const errors: string[] = [];
  if (!form.code.trim()) errors.push("Kode layanan wajib diisi.");
  else if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(form.code.trim().toUpperCase())) errors.push("Kode harus 1–20 karakter huruf, angka, atau tanda hubung; diawali huruf atau angka.");
  if (!form.name.trim()) errors.push("Nama layanan wajib diisi.");
  if (form.name.trim().length > 120) errors.push("Nama layanan maksimal 120 karakter.");
  if (form.category.trim().length > 60) errors.push("Kategori maksimal 60 karakter.");
  if (form.description.trim().length > 2000) errors.push("Deskripsi maksimal 2.000 karakter.");
  if (!isInt(form.sort_order.trim() || "0", 0, 9999)) errors.push("Urutan harus bilangan bulat 0–9.999.");
  if (form.variants.length < 1 || form.variants.length > 20) errors.push("Daftar harus berisi 1–20 varian.");
  form.variants.forEach((v, i) => {
    const n = i + 1;
    if (!v.name.trim()) errors.push(`Varian ${n}: nama wajib diisi.`);
    if (v.name.trim().length > 60) errors.push(`Varian ${n}: nama maksimal 60 karakter.`);
    if (!isInt(v.duration_min, 5, 600)) errors.push(`Varian ${n}: durasi harus bilangan bulat 5–600 menit.`);
    if (!isInt(v.price_idr, 0, MAX_PRICE_IDR)) errors.push(`Varian ${n}: harga harus bilangan bulat 0–999.999.999.999.`);
  });
  const names = form.variants.map((v) => v.name.trim().toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) errors.push("Nama varian tidak boleh sama.");
  return errors;
}

/** Form → body POST/PATCH; urutan varian mengikuti urutan baris. */
export function toTreatmentInput(form: TreatmentForm): TreatmentInput {
  return {
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    category: form.category.trim(),
    description: form.description.trim(),
    is_active: form.is_active,
    customizable: form.customizable,
    sort_order: Number(form.sort_order.trim() || 0),
    variants: form.variants.map((v, index) => ({
      ...(v.id ? { id: v.id } : {}),
      name: v.name.trim(),
      duration_min: Number(v.duration_min),
      price_idr: Number(v.price_idr),
      is_active: v.is_active,
      sort_order: index,
    })),
  };
}

/** Grid harga per outlet: `prices[variantId][branchId]` = teks input ("" = harga dasar). */
export type PriceGrid = Record<string, Record<string, string>>;

export function initialPriceGrid(treatment: Treatment, outlets: Pick<Outlet, "branch_id">[]): PriceGrid {
  const grid: PriceGrid = {};
  for (const v of treatment.variants) {
    grid[v.id] = {};
    for (const o of outlets) {
      const override = v.outlet_prices.find((p) => p.branch_id === o.branch_id);
      grid[v.id][o.branch_id] = override ? String(override.price_idr) : "";
    }
  }
  return grid;
}

/**
 * Grid → body PUT /prices. Hanya sel yang berubah dikirim; sel dikosongkan
 * yang sebelumnya punya override dikirim `null` (hapus override).
 * Melempar Error bila ada nilai bukan angka.
 */
export function toPriceInputs(treatment: Treatment, grid: PriceGrid): PriceInput[] {
  const out: PriceInput[] = [];
  for (const v of treatment.variants) {
    for (const [branchId, raw] of Object.entries(grid[v.id] ?? {})) {
      const text = raw.trim();
      const existing = v.outlet_prices.find((p) => p.branch_id === branchId);
      if (text === "") {
        if (existing) out.push({ variant_id: v.id, branch_id: branchId, price_idr: null });
        continue;
      }
      const price = parseOutletPrice(raw);
      if (!existing || Number(existing.price_idr) !== price) {
        out.push({ variant_id: v.id, branch_id: branchId, price_idr: price });
      }
    }
  }
  return out;
}

/** Validasi seluruh draft terlebih dulu, lalu bagi per treatment sesuai batas API. */
export function buildPriceBatches(treatments: Treatment[], grid: PriceGrid): { id: string; prices: PriceInput[] }[] {
  const variants = new Set(treatments.flatMap((t) => t.variants.map((v) => v.id)));
  if (Object.keys(grid).some((id) => !variants.has(id))) {
    throw new Error("Varian pada draft tidak ditemukan. Muat ulang daftar sebelum menyimpan.");
  }
  return treatments.flatMap((treatment) => {
    const prices = toPriceInputs(treatment, grid);
    const batches = [];
    for (let i = 0; i < prices.length; i += 500) batches.push({ id: treatment.id, prices: prices.slice(i, i + 500) });
    return batches;
  });
}
