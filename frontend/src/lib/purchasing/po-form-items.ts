/** Logika murni form PO bahan baku: baris item, satuan, total, validasi, dan payload API. */
import {
  basePack,
  defaultPurchasePackFor,
  packLabel,
  resolvePacks,
  wholePacksFor,
  type ItemPack,
} from "@/lib/purchasing/packs";
import { computePoTotals, type PoTotals } from "@/lib/purchasing/po-totals";
import type {
  PurchaseOrderFormData,
  PurchaseOrderItem,
  PurchaseOrderWithStats,
  RawMaterialWithStock,
  Unit,
} from "@/types/purchasing";

export interface POItemForm {
  id: string;
  raw_material_id: string;
  pr_item_id?: string;
  satuan_id?: string;
  qty_ordered: number;
  harga_satuan: number;
  notes: string;
  subtotal: number;
  raw_material_name?: string;
  raw_material_unit?: string;
  requested_qty?: number;
  requested_satuan_id?: string;
}

/** Baris item PR yang dibutuhkan form PO (bentuk dari GET /api/purchasing/pr/[id]). */
export interface POFormPRItem {
  id: string;
  raw_material_id?: string | null;
  satuan_id?: string | null;
  satuan?: { id?: string; nama?: string } | null;
  unit?: string | null;
  qty?: number | null;
  estimated_price?: number | null;
  description?: string | null;
  raw_material?: { nama?: string } | null;
}

type POItemRow = PurchaseOrderItem & {
  pr_item_id?: string | null;
  satuan_id?: string | null;
  catatan?: string | null;
};

export function mapPOItemToForm(item: PurchaseOrderItem): POItemForm {
  const row = item as POItemRow;
  const qty = Number(item.qty_ordered || 0);
  const price = Number(item.harga_satuan || 0);
  const note = row.catatan ?? item.notes ?? "";
  return {
    id: item.id,
    pr_item_id: row.pr_item_id || undefined,
    raw_material_id: item.raw_material_id || "",
    satuan_id: row.satuan_id || undefined,
    qty_ordered: qty,
    harga_satuan: price,
    notes: note,
    subtotal: qty * price,
    raw_material_name: item.raw_material?.nama || note,
    raw_material_unit: item.satuan?.nama || item.raw_material?.satuan || "",
    requested_qty: qty,
    requested_satuan_id: row.satuan_id || undefined,
  };
}

/** Satuan item PR: id eksplisit, lalu cocokkan nama/kode satuan, lalu satuan besar bahan baku. */
export function resolveSatuanIdFromPrItem(
  item: Pick<POFormPRItem, "satuan_id" | "satuan" | "unit" | "raw_material_id">,
  materials: RawMaterialWithStock[],
  units: Unit[]
): string | undefined {
  if (item.satuan_id) return item.satuan_id;
  if (item.satuan?.id) return item.satuan.id;

  const label = (item.satuan?.nama || item.unit || "").trim().toLowerCase();
  if (label) {
    const match = units.find((unit) => unit.nama.toLowerCase() === label || unit.kode?.toLowerCase() === label);
    if (match) return match.id;
  }

  if (item.raw_material_id) {
    return materials.find((entry) => entry.id === item.raw_material_id)?.satuan_besar_id || undefined;
  }
  return undefined;
}

export function mapPRItemToForm(item: POFormPRItem, materials: RawMaterialWithStock[], units: Unit[]): POItemForm {
  const qty = Number(item.qty || 0);
  const price = Number(item.estimated_price || 0);
  const satuanId = resolveSatuanIdFromPrItem(item, materials, units);
  const unitName = item.satuan?.nama || item.unit || units.find((unit) => unit.id === satuanId)?.nama || "";
  return {
    id: item.id,
    pr_item_id: item.id,
    raw_material_id: item.raw_material_id || "",
    satuan_id: satuanId,
    qty_ordered: qty,
    harga_satuan: price,
    notes: item.description || "",
    subtotal: qty * price,
    raw_material_name: item.raw_material?.nama || item.description || "",
    raw_material_unit: unitName,
    requested_qty: qty,
    requested_satuan_id: satuanId,
  };
}

/* ── PO langsung (tanpa PR): baris yang bisa ditambah, dipilih, dan dihapus ── */

export interface POUnitOption {
  value: string;
  label: string;
  /** Isi satuan ini dalam satuan dasar bahan baku. */
  factor: number;
}

let draftRowSeq = 0;

/** API mengirim kolom numeric sebagai string ("50"); konversi pack butuh angka. */
function withNumericPacks(material: RawMaterialWithStock): RawMaterialWithStock {
  return {
    ...material,
    konversi_factor: material.konversi_factor == null ? undefined : Number(material.konversi_factor),
    unit_conversions: material.unit_conversions?.map((conversion) => ({
      ...conversion,
      qty_in_base_unit: Number(conversion.qty_in_base_unit),
    })),
  };
}

/** Baris kosong form PO langsung (qty 1, harga menunggu saran). */
export function emptyPOItem(id = `new-${++draftRowSeq}`): POItemForm {
  return { id, raw_material_id: "", qty_ordered: 1, harga_satuan: 0, notes: "", subtotal: 0 };
}

/**
 * Satuan beli sebuah bahan baku: pack aktif (atau satuan besar/kecil lama) dengan
 * label "KARTON (24 PCS)"; urutan mengikuti data pack (pack dasar dulu).
 */
export function purchaseUnitOptions(raw: RawMaterialWithStock | undefined, units: Unit[]): POUnitOption[] {
  if (!raw) return [];
  const material = withNumericPacks(raw);
  const conversions: ItemPack[] = (material.unit_conversions ?? []).map((conversion) => ({
    ...conversion,
    unit_name: conversion.satuan?.nama,
  }));
  const unitName = (pack: ItemPack) =>
    pack.unit_name || units.find((unit) => unit.id === pack.satuan_id)?.nama || "";
  const packs = resolvePacks(material, conversions).map((pack) => ({ ...pack, unit_name: unitName(pack) }));
  const base = basePack(packs);
  const baseName = (base && unitName(base)) || material.satuan_kecil_nama || material.satuan_besar_nama || "";
  const seen = new Set<string>();
  return packs.flatMap((pack) => {
    if (!pack.unit_name || seen.has(pack.satuan_id)) return [];
    seen.add(pack.satuan_id);
    return [{ value: pack.satuan_id, label: packLabel(pack, baseName), factor: pack.qty_in_base_unit }];
  });
}

/** Pilih bahan baku: satuan = pack beli bawaan, harga direset sampai saran harga masuk. */
export function withMaterial(item: POItemForm, material: RawMaterialWithStock, units: Unit[]): POItemForm {
  const unitId = defaultPurchasePackFor(withNumericPacks(material))?.satuan_id ?? material.satuan_besar_id ?? undefined;
  const option = purchaseUnitOptions(material, units).find((entry) => entry.value === unitId);
  return {
    ...item,
    raw_material_id: material.id,
    raw_material_name: material.nama,
    pr_item_id: undefined,
    satuan_id: unitId,
    requested_satuan_id: unitId,
    raw_material_unit: option?.label || units.find((unit) => unit.id === unitId)?.nama || "",
    harga_satuan: 0,
    subtotal: 0,
  };
}

/** Ganti satuan baris; harga direset karena harga per satuan ikut berubah. */
export function withUnit(item: POItemForm, unitId: string, label: string): POItemForm {
  return { ...item, satuan_id: unitId, requested_satuan_id: unitId, raw_material_unit: label, harga_satuan: 0, subtotal: 0 };
}

/**
 * Baris dari laporan stok rendah (?material_id=&qty=, qty dalam satuan dasar):
 * pack beli bawaan, qty dibulatkan ke pack utuh (minimal 1).
 */
export function lowStockPOItem(material: RawMaterialWithStock, baseQty: number, units: Unit[]): POItemForm {
  const row = withMaterial(emptyPOItem(`low-stock-${material.id}`), material, units);
  const factor = defaultPurchasePackFor(withNumericPacks(material))?.qty_in_base_unit ?? 1;
  return withQtyOrPrice(row, "qty_ordered", Math.max(1, wholePacksFor(baseQty, factor)));
}

/** Item PR disetujui untuk PO langsung ("Ambil dari PR"): nama dari master bahan baku bila ada. */
export function prItemsToPOItems(items: POFormPRItem[], materials: RawMaterialWithStock[], units: Unit[]): POItemForm[] {
  return items.map((item) => {
    const row = mapPRItemToForm(item, materials, units);
    const material = materials.find((entry) => entry.id === row.raw_material_id);
    return material ? { ...row, raw_material_name: material.nama } : row;
  });
}

/** Ubah qty atau harga satu baris dan hitung ulang subtotalnya. */
export function withQtyOrPrice(item: POItemForm, field: "qty_ordered" | "harga_satuan", value: number): POItemForm {
  const next = { ...item, [field]: value };
  next.subtotal = next.qty_ordered * next.harga_satuan;
  if (field === "qty_ordered") next.requested_qty = value;
  return next;
}

/** Isi harga beli saran (dibulatkan) dan satuannya; qty minimal 1. */
export function withPurchasePrice(item: POItemForm, unitPrice: number, unitId: string, unitLabel: string): POItemForm {
  const price = Math.round(unitPrice);
  const qty = Math.max(1, Number(item.qty_ordered || item.requested_qty || 1));
  return {
    ...item,
    satuan_id: unitId,
    raw_material_unit: unitLabel || item.raw_material_unit,
    qty_ordered: qty,
    harga_satuan: price,
    subtotal: qty * price,
  };
}

/** Satuan untuk mencari harga beli: satuan baris, satuan PR, lalu satuan besar bahan baku. */
export function priceLookupUnitId(item: POItemForm, materials: RawMaterialWithStock[]): string | undefined {
  const material = materials.find((entry) => entry.id === item.raw_material_id);
  return item.satuan_id || item.requested_satuan_id || material?.satuan_besar_id || undefined;
}

export function emptyPOForm(prId: string | undefined, today: string): PurchaseOrderFormData {
  return {
    supplier_id: "",
    pr_id: prId,
    tanggal_po: today,
    tanggal_kirim_estimasi: "",
    catatan: "",
    alamat_pengiriman: "",
    diskon_persen: 0,
    diskon_nominal: 0,
    ppn_persen: 11,
    source_type: "manual",
    production_order_id: null,
    source_reference: null,
    items: [],
  };
}

export function poFormFromExisting(po: PurchaseOrderWithStats, today: string): PurchaseOrderFormData {
  return {
    supplier_id: po.supplier_id || "",
    pr_id: po.pr_id || undefined,
    tanggal_po: po.tanggal_po?.split("T")[0] || today,
    tanggal_kirim_estimasi: po.tanggal_kirim_estimasi?.split("T")[0] || "",
    catatan: po.catatan || "",
    alamat_pengiriman: po.alamat_pengiriman || "",
    diskon_persen: Number(po.diskon_persen || 0),
    diskon_nominal: Number(po.diskon_nominal || 0),
    ppn_persen: Number(po.ppn_persen ?? 11),
    source_type: po.source_type || "manual",
    production_order_id: po.production_order_id || null,
    source_reference: po.source_reference || null,
    items: [],
  };
}

/** Total form memakai rumus server (computePoTotals) supaya angka di layar sama dengan yang tersimpan. */
export function poFormTotals(items: POItemForm[], form: Pick<PurchaseOrderFormData, "diskon_persen" | "diskon_nominal" | "ppn_persen">): PoTotals {
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  return computePoTotals(subtotal, form);
}

/**
 * Pesan galat validasi sebelum simpan, atau null bila valid. `requirePr` = aturan
 * "PO Bahan Baku wajib dari PR" (bawaan aktif); baris baru (bukan dari PR) wajib bersatuan.
 */
export function validatePOForm(
  form: PurchaseOrderFormData,
  items: POItemForm[],
  isEditMode: boolean,
  { requirePr = true }: { requirePr?: boolean } = {}
): string | null {
  if (!isEditMode && requirePr && !form.pr_id) return "Purchase order harus dibuat dari purchase request yang disetujui";
  if (!form.supplier_id) return "Pilih supplier terlebih dahulu";
  if (items.length === 0) return "Tambahkan minimal 1 item";
  if (items.some((item) => !item.raw_material_id)) return "Pilih bahan baku untuk semua item";
  if (!isEditMode && items.some((item) => !item.pr_item_id && !item.satuan_id)) {
    return "Pilih satuan untuk semua item";
  }
  if (items.some((item) => item.qty_ordered <= 0 || item.harga_satuan < 0)) {
    return "Lengkapi jumlah dan harga untuk semua item";
  }
  return null;
}

export function buildCreatePOPayload(form: PurchaseOrderFormData, items: POItemForm[]): PurchaseOrderFormData {
  return {
    ...form,
    pr_id: form.pr_id || undefined,
    tanggal_kirim_estimasi: form.tanggal_kirim_estimasi || "",
    items: items.map((item) => ({
      raw_material_id: item.raw_material_id,
      pr_item_id: item.pr_item_id,
      satuan_id: item.satuan_id,
      qty_ordered: Number(item.qty_ordered || 0),
      harga_satuan: Number(item.harga_satuan || 0),
      notes: item.notes || "",
    })),
  };
}

/** Ubah PO draf hanya mengirim header; item terkunci di mode ubah. */
export function buildUpdatePOPayload(form: PurchaseOrderFormData): Partial<PurchaseOrderFormData> {
  return {
    supplier_id: form.supplier_id,
    tanggal_po: form.tanggal_po,
    tanggal_kirim_estimasi: form.tanggal_kirim_estimasi || undefined,
    catatan: form.catatan || undefined,
    alamat_pengiriman: form.alamat_pengiriman || undefined,
    diskon_persen: form.diskon_persen,
    diskon_nominal: form.diskon_nominal,
    ppn_persen: form.ppn_persen,
  };
}
