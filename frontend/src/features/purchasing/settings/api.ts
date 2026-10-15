import { BASE, fetchApi } from "@/lib/purchasing/api-client/http";
import type { PurchasingSettings } from "@/lib/purchasing/po-rules";

export type { PurchasingSettings } from "@/lib/purchasing/po-rules";

/** GET /api/purchasing/settings — aturan Pengaturan Pembelian (dibaca semua pengguna purchasing). */
export async function getPurchasingSettings(): Promise<PurchasingSettings> {
  const res = await fetchApi<{ data: PurchasingSettings }>(`${BASE}/settings`);
  return res.data;
}

/** PUT /api/purchasing/settings — butuh aksi update pada menu Pengaturan Pembelian. */
export async function updatePurchasingSettings(patch: Partial<PurchasingSettings>): Promise<PurchasingSettings> {
  const res = await fetchApi<{ data: PurchasingSettings }>(`${BASE}/settings`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  return res.data;
}
