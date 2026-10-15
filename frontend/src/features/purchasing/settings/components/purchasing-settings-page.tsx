"use client";

import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import type { PurchasingSettings } from "@/lib/purchasing/po-rules";
import { useUpdatePurchasingSettings } from "../mutations";
import { usePurchasingSettings } from "../queries";

const PO_RULES: { key: keyof PurchasingSettings; label: string; hint: string }[] = [
  {
    key: "po_requires_pr_raw_material",
    label: "PO Bahan Baku wajib dari PR",
    hint: "Aktif: PO bahan baku hanya bisa dibuat dari purchase request yang disetujui. Nonaktif: PO bisa langsung dibuat.",
  },
  {
    key: "po_requires_pr_product",
    label: "PO Produk wajib dari PR",
    hint: "Aktif: PO produk wajib memilih purchase request yang disetujui. Nonaktif: PR opsional.",
  },
];

/** Pengaturan Pembelian: aturan apakah PO bahan baku / produk harus dibuat dari PR. */
export function PurchasingSettingsPage() {
  const settingsQuery = usePurchasingSettings();
  const updateMutation = useUpdatePurchasingSettings();
  const [draft, setDraft] = useState<PurchasingSettings | null>(null);
  const saved = settingsQuery.data;
  const values = draft ?? saved;
  const dirty = Boolean(draft && saved && PO_RULES.some(({ key }) => draft[key] !== saved[key]));

  const handleSave = async () => {
    if (!draft) return;
    try {
      await updateMutation.mutateAsync(draft);
      setDraft(null);
      toast.success("Aturan purchase order disimpan");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan pengaturan pembelian");
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Pengaturan Pembelian"
        description="Atur alur pembuatan purchase order untuk bahan baku dan produk"
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4" />
            Aturan Purchase Order
          </CardTitle>
          <CardDescription>
            Tentukan apakah purchase order harus dibuat dari purchase request (PR) yang sudah disetujui.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-gray-200/70 pt-2">
          {settingsQuery.isError ? (
            <p className="py-6 text-sm text-red-600">Gagal memuat pengaturan pembelian</p>
          ) : !values ? (
            <p className="py-6 text-sm text-gray-500">Memuat pengaturan...</p>
          ) : (
            PO_RULES.map((rule) => (
              <div key={rule.key} className="flex items-start justify-between gap-4 py-4">
                <div className="min-w-0">
                  <label htmlFor={rule.key} className="text-sm font-medium text-gray-900">
                    {rule.label}
                  </label>
                  <p className="mt-0.5 text-sm text-gray-500">{rule.hint}</p>
                </div>
                <Switch
                  id={rule.key}
                  aria-label={rule.label}
                  checked={values[rule.key]}
                  disabled={updateMutation.isPending}
                  onCheckedChange={(checked) => setDraft({ ...values, [rule.key]: checked })}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="purchasing-secondary-button w-full sm:w-auto"
          disabled={!dirty || updateMutation.isPending}
          onClick={() => setDraft(null)}
        >
          Batal
        </Button>
        <Button
          type="button"
          className="purchasing-main-button w-full sm:w-auto"
          disabled={!dirty || updateMutation.isPending}
          onClick={handleSave}
        >
          {updateMutation.isPending ? "Menyimpan..." : "Simpan"}
        </Button>
      </div>
    </div>
  );
}
