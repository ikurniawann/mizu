/** State & validasi form treatment + varian (murni, diuji di treatment-form.test.ts). */
import type { Outlet, PriceInput, Treatment, TreatmentInput } from "./types";

export interface VariantRow {
  /** Kunci lokal untuk React; bukan id server. */
  key: string;
  id?: string;
  name: string;
  duration_min: string;
  buffer_min: string;
  price_idr: string;
  is_active: boolean;
}

export interface TreatmentForm {
  code: string;
  name: string;
  category: string;
  description: string;
  is_active: boolean;
  sort_order: string;
  variants: VariantRow[];
}

let seq = 0;
const nextKey = () => `v${++seq}`;

export function emptyVariantRow(): VariantRow {
  return { key: nextKey(), name: "", duration_min: "60", buffer_min: "15", price_idr: "", is_active: true };
}

export function initialTreatmentForm(treatment: Treatment | null): TreatmentForm {
  if (!treatment) {
    return { code: "", name: "", category: "", description: "", is_active: true, sort_order: "0", variants: [emptyVariantRow()] };
  }
  return {
    code: treatment.code,
    name: treatment.name,
    category: treatment.category ?? "",
    description: treatment.description ?? "",
    is_active: treatment.is_active,
    sort_order: String(treatment.sort_order ?? 0),
    variants: [...treatment.variants]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({
        key: nextKey(),
        id: v.id,
        name: v.name,
        duration_min: String(v.duration_min),
        buffer_min: String(v.buffer_min),
        price_idr: String(v.price_idr),
        is_active: v.is_active,
      })),
  };
}

const isInt = (value: string, min: number) => /^\d+$/.test(value.trim()) && Number(value) >= min;

/** Daftar pesan galat; kosong = valid. */
export function validateTreatmentForm(form: TreatmentForm): string[] {
  const errors: string[] = [];
  if (!form.code.trim()) errors.push("Kode treatment wajib diisi.");
  if (!form.name.trim()) errors.push("Nama treatment wajib diisi.");
  if (form.sort_order.trim() && !/^-?\d+$/.test(form.sort_order.trim())) errors.push("Urutan harus bilangan bulat.");
  if (form.variants.length === 0) errors.push("Minimal satu varian.");
  form.variants.forEach((v, i) => {
    const n = i + 1;
    if (!v.name.trim()) errors.push(`Varian ${n}: nama wajib diisi.`);
    if (!isInt(v.duration_min, 1)) errors.push(`Varian ${n}: durasi minimal 1 menit.`);
    if (!isInt(v.buffer_min || "0", 0)) errors.push(`Varian ${n}: jeda harus ≥ 0 menit.`);
    if (!isInt(v.price_idr, 0)) errors.push(`Varian ${n}: harga harus angka ≥ 0.`);
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
    sort_order: Number(form.sort_order.trim() || 0),
    variants: form.variants.map((v, index) => ({
      ...(v.id ? { id: v.id } : {}),
      name: v.name.trim(),
      duration_min: Number(v.duration_min),
      buffer_min: Number(v.buffer_min || 0),
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
      if (!/^\d+$/.test(text)) throw new Error(`Harga "${raw}" untuk ${v.name} tidak valid.`);
      const price = Number(text);
      if (!existing || Number(existing.price_idr) !== price) {
        out.push({ variant_id: v.id, branch_id: branchId, price_idr: price });
      }
    }
  }
  return out;
}
