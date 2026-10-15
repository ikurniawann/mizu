/**
 * Pengaturan Pembelian — aturan "PO wajib dari PR" (configuration.app_settings).
 * Dipakai server (validasi pembuatan PO) dan klien (form PO), jadi tanpa akses DB.
 * Key yang belum tersimpan = perilaku lama: bahan baku wajib PR, produk opsional.
 */
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";

export const PO_RULE_KEYS = {
  rawMaterial: "po_requires_pr_raw_material",
  product: "po_requires_pr_product",
} as const;

export interface PurchasingSettings {
  po_requires_pr_raw_material: boolean;
  po_requires_pr_product: boolean;
}

export const DEFAULT_PURCHASING_SETTINGS: PurchasingSettings = {
  po_requires_pr_raw_material: true,
  po_requires_pr_product: false,
};

/** Nilai tersimpan → boolean; kosong/tidak terbaca memakai `fallback`. */
export function parseSettingBool(value: string | null | undefined, fallback: boolean): boolean {
  switch ((value ?? "").trim().toLowerCase()) {
    case "true":
    case "1":
    case "yes":
    case "on":
      return true;
    case "false":
    case "0":
    case "no":
    case "off":
      return false;
    default:
      return fallback;
  }
}

export function purchasingSettingsFromStored(stored: Record<string, string | null | undefined>): PurchasingSettings {
  return {
    po_requires_pr_raw_material: parseSettingBool(
      stored[PO_RULE_KEYS.rawMaterial],
      DEFAULT_PURCHASING_SETTINGS.po_requires_pr_raw_material
    ),
    po_requires_pr_product: parseSettingBool(
      stored[PO_RULE_KEYS.product],
      DEFAULT_PURCHASING_SETTINGS.po_requires_pr_product
    ),
  };
}

/** PO modul ini wajib menyebut PR disetujui? PO barang operasional (general) tidak diatur. */
export function poRequiresPr(moduleType: PurchasingModuleType | string, settings: PurchasingSettings): boolean {
  if (moduleType === "raw_material") return settings.po_requires_pr_raw_material;
  if (moduleType === "product") return settings.po_requires_pr_product;
  return false;
}

export function poRequiresPrMessage(moduleType: PurchasingModuleType | string): string {
  return moduleType === "product"
    ? "PO produk harus dibuat dari purchase request yang disetujui (aturan di Pengaturan Pembelian)"
    : "PO bahan baku harus dibuat dari purchase request yang disetujui (aturan di Pengaturan Pembelian)";
}
