import "server-only";
import { getSettings } from "@/lib/settings/app-settings";
import { PO_RULE_KEYS, purchasingSettingsFromStored, type PurchasingSettings } from "@/lib/purchasing/po-rules";

/** Aturan Pengaturan Pembelian dari configuration.app_settings (fallback route TS). */
export async function getPurchasingSettings(): Promise<PurchasingSettings> {
  return purchasingSettingsFromStored(await getSettings([PO_RULE_KEYS.rawMaterial, PO_RULE_KEYS.product]));
}
