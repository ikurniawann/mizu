"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import { getRawMaterialPurchasePrice } from "@/lib/purchasing/api-client/raw-materials";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import {
  buildCreatePOPayload,
  buildUpdatePOPayload,
  emptyPOItem,
  poFormTotals,
  prItemsToPOItems,
  priceLookupUnitId,
  validatePOForm,
  withMaterial,
  withPurchasePrice,
  withQtyOrPrice,
  withUnit,
  type POItemForm,
} from "@/lib/purchasing/po-form-items";
import type { PurchaseOrderFormData, RawMaterialWithStock, Unit } from "@/types/purchasing";
import type { POFormData } from "../../api";
import { useCreatePurchaseOrder, useUpdatePurchaseOrder } from "../../mutations";
import { useApprovedPRsForPO } from "../../queries";
import { POItemsSection, POSummaryCard, PRSourceCard, type PRSource } from "./po-form-sections";
import { POItemsEditor } from "./po-items-editor";

/** Harga beli saran (biaya GRN terakhir) untuk satuan baris; baris tetap apa adanya bila tidak ada saran. */
async function priceItem(
  item: POItemForm,
  supplierId: string,
  materials: RawMaterialWithStock[],
  units: Unit[]
): Promise<POItemForm> {
  const unitId = priceLookupUnitId(item, materials);
  if (!item.raw_material_id || !unitId) return item;
  try {
    const suggestion = await getRawMaterialPurchasePrice(item.raw_material_id, { supplierId, satuanId: unitId });
    if (!suggestion || suggestion.unit_price <= 0) return item;
    return withPurchasePrice(item, suggestion.unit_price, unitId, units.find((u) => u.id === unitId)?.nama || "");
  } catch {
    return item;
  }
}

interface POFormProps {
  /** Ada = ubah PO draf (hanya header); kosong = buat PO dari purchase request. */
  poId?: string;
  /**
   * PO langsung (aturan "PO Bahan Baku wajib dari PR" nonaktif): item bisa ditambah,
   * dipilih, dan dihapus; PR disetujui opsional lewat "Ambil dari PR".
   */
  direct?: boolean;
  title: string;
  description: string;
  initialForm: PurchaseOrderFormData;
  initialItems: POItemForm[];
  prSource: PRSource | null;
  lookups: POFormData;
}

export function POForm({ poId, direct = false, title, description, initialForm, initialItems, prSource, lookups }: POFormProps) {
  const router = useRouter();
  const isEditMode = Boolean(poId);
  const [form, setForm] = useState(initialForm);
  const [items, setItems] = useState(initialItems);
  const createMutation = useCreatePurchaseOrder();
  const updateMutation = useUpdatePurchaseOrder();
  const approvedPRsQuery = useApprovedPRsForPO(direct);
  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const totals = poFormTotals(items, form);
  const backHref = poId ? RM_ROUTES.purchasingPoDetail(poId) : RM_ROUTES.purchasingPo;
  const patch = (values: Partial<PurchaseOrderFormData>) => setForm((prev) => ({ ...prev, ...values }));

  /**
   * PO langsung: saran harga satu baris (daftar harga supplier / GRN terakhir) hanya mengisi
   * harga, dan diabaikan bila bahan/satuan baris sudah berganti selama menunggu.
   */
  const suggestRowPrice = async (row: POItemForm, supplierId: string) => {
    if (!row.raw_material_id) return;
    const priced = await priceItem(row, supplierId, lookups.materials, lookups.units);
    if (priced === row) return;
    setItems((prev) =>
      prev.map((item) =>
        item.id === row.id && item.raw_material_id === row.raw_material_id && item.satuan_id === row.satuan_id
          ? withQtyOrPrice(item, "harga_satuan", priced.harga_satuan)
          : item
      )
    );
  };

  const handleSupplierChange = async (supplierId: string) => {
    patch({ supplier_id: supplierId });
    // Item PO draf terkunci, jadi harga hanya disarankan saat membuat PO baru.
    if (!supplierId || isEditMode || items.length === 0) return;
    if (direct) {
      items.forEach((item) => void suggestRowPrice(item, supplierId));
      return;
    }
    setItems(await Promise.all(items.map((item) => priceItem(item, supplierId, lookups.materials, lookups.units))));
  };

  const handleItemChange = (index: number, field: "qty_ordered" | "harga_satuan", value: number) =>
    setItems((prev) => prev.map((item, i) => (i === index ? withQtyOrPrice(item, field, value) : item)));

  const updateRow = (id: string, update: (item: POItemForm) => POItemForm) =>
    setItems((prev) => prev.map((item) => (item.id === id ? update(item) : item)));

  const handleMaterialChange = (id: string, materialId: string) => {
    const material = lookups.materials.find((entry) => entry.id === materialId);
    const current = items.find((item) => item.id === id);
    if (!material || !current) return;
    const next = withMaterial(current, material, lookups.units);
    updateRow(id, () => next);
    void suggestRowPrice(next, form.supplier_id);
  };

  const handleUnitChange = (id: string, unitId: string, label: string) => {
    const current = items.find((item) => item.id === id);
    if (!current || current.satuan_id === unitId) return;
    const next = withUnit(current, unitId, label);
    updateRow(id, () => next);
    void suggestRowPrice(next, form.supplier_id);
  };

  /** "Ambil dari PR": isi item dari PR disetujui; mengosongkan PR melepas tautan item ke PR. */
  const handlePickPR = (prId: string) => {
    const pr = approvedPRsQuery.data?.find((entry) => entry.id === prId);
    patch({ pr_id: pr?.id });
    if (!pr) {
      setItems((prev) => prev.map((item) => ({ ...item, pr_item_id: undefined })));
      return;
    }
    const rows = prItemsToPOItems(pr.items ?? [], lookups.materials, lookups.units);
    if (rows.length === 0) return;
    setItems(rows);
    if (form.supplier_id) rows.forEach((row) => void suggestRowPrice(row, form.supplier_id));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = validatePOForm(form, items, isEditMode, { requirePr: !direct });
    if (invalid) {
      toast.error(invalid);
      return;
    }
    try {
      if (poId) {
        await updateMutation.mutateAsync({ id: poId, payload: buildUpdatePOPayload(form) });
        toast.success("PO berhasil disubmit");
        router.push(`/dashboard/purchasing/po/${poId}?updated=1`);
        return;
      }
      const po = await createMutation.mutateAsync(buildCreatePOPayload(form, items));
      toast.success("PO berhasil dibuat");
      router.push(`/dashboard/purchasing/po/${po.id}`);
    } catch (error) {
      const fallback = isEditMode ? "Gagal memperbarui purchase order" : "Gagal membuat purchase order";
      toast.error(error instanceof Error ? error.message : fallback);
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader backHref={backHref} title={title} description={description} />

      {prSource && (
        <PRSourceCard pr={prSource} onOpen={() => router.push(RM_ROUTES.purchasingPrDetail(prSource.id))} />
      )}

      <form id="purchase-order-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <Card className="border-gray-200/70 shadow-xs xl:col-span-8">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                Informasi Purchase Order
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {direct && (
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">Ambil dari PR</Label>
                  <Combobox
                    options={(approvedPRsQuery.data ?? []).map((pr) => ({
                      value: pr.id,
                      label: pr.pr_number,
                      description: [pr.department_name, `${pr.items?.length ?? 0} item`].filter(Boolean).join(" · "),
                    }))}
                    value={form.pr_id || ""}
                    onChange={handlePickPR}
                    placeholder="Opsional, pilih PR disetujui untuk mengisi item..."
                    searchPlaceholder="Cari PR..."
                    emptyMessage={approvedPRsQuery.isLoading ? "Memuat PR..." : "Tidak ada PR disetujui"}
                    allowClear
                    className="w-full! h-9 text-sm"
                  />
                </div>
              )}

              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs">
                  Supplier <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={lookups.suppliers.map((supplier) => ({
                    value: supplier.id,
                    label: supplier.nama_supplier,
                    description: supplier.kode_supplier,
                  }))}
                  value={form.supplier_id}
                  onChange={handleSupplierChange}
                  placeholder="Pilih supplier..."
                  searchPlaceholder="Cari supplier..."
                  emptyMessage="Supplier tidak ditemukan"
                  allowClear
                  className="w-full! h-9 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <DsDateTimePicker
                  label="Tanggal PO"
                  value={form.tanggal_po}
                  onChange={(value) => patch({ tanggal_po: value })}
                  placeholder="Pilih tanggal PO..."
                  dateOnly
                />
                <DsDateTimePicker
                  label="Estimasi Tanggal Pengiriman"
                  value={form.tanggal_kirim_estimasi}
                  onChange={(value) => patch({ tanggal_kirim_estimasi: value })}
                  placeholder="Pilih estimasi tanggal pengiriman..."
                  dateOnly
                />
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs">Catatan</Label>
                <Textarea
                  value={form.catatan}
                  onChange={(e) => patch({ catatan: e.target.value })}
                  placeholder="Catatan untuk supplier..."
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs">Alamat Pengiriman</Label>
                <Textarea
                  value={form.alamat_pengiriman}
                  onChange={(e) => patch({ alamat_pengiriman: e.target.value })}
                  placeholder="Alamat pengiriman..."
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>
            </CardContent>
          </Card>

          <POSummaryCard
            totals={totals}
            diskonPersen={form.diskon_persen}
            ppnPersen={form.ppn_persen}
            onDiskonChange={(value) => patch({ diskon_persen: value, diskon_nominal: 0 })}
            onPpnChange={(value) => patch({ ppn_persen: value })}
          />
        </div>

        {direct ? (
          <POItemsEditor
            items={items}
            materials={lookups.materials}
            units={lookups.units}
            onAdd={() => setItems((prev) => [...prev, emptyPOItem()])}
            onRemove={(id) => setItems((prev) => prev.filter((item) => item.id !== id))}
            onMaterialChange={handleMaterialChange}
            onUnitChange={handleUnitChange}
            onQtyOrPriceChange={(id, field, value) => updateRow(id, (item) => withQtyOrPrice(item, field, value))}
            onNotesChange={(id, notes) => updateRow(id, (item) => ({ ...item, notes }))}
          />
        ) : (
          <POItemsSection items={items} locked={isEditMode} onChange={handleItemChange} />
        )}

        <PurchasingFormFooter
          onCancel={() => router.push(backHref)}
          submitLabel="Simpan"
          loading={isSubmitting}
          disabled={isSubmitting || (!isEditMode && !prSource && !direct)}
          formId="purchase-order-form"
        />
      </form>
    </div>
  );
}
