"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { formatRupiah } from "@/lib/format";
import { purchaseUnitOptions, type POItemForm } from "@/lib/purchasing/po-form-items";
import type { RawMaterialWithStock, Unit } from "@/types/purchasing";

interface POItemsEditorProps {
  items: POItemForm[];
  materials: RawMaterialWithStock[];
  units: Unit[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMaterialChange: (id: string, materialId: string) => void;
  onUnitChange: (id: string, unitId: string, label: string) => void;
  onQtyOrPriceChange: (id: string, field: "qty_ordered" | "harga_satuan", value: number) => void;
  onNotesChange: (id: string, notes: string) => void;
}

/**
 * Item PO langsung (aturan "PO Bahan Baku wajib dari PR" nonaktif): tambah/hapus baris,
 * pilih bahan baku & satuan beli, qty, harga satuan (saran dari daftar harga supplier), catatan.
 */
export function POItemsEditor({
  items,
  materials,
  units,
  onAdd,
  onRemove,
  onMaterialChange,
  onUnitChange,
  onQtyOrPriceChange,
  onNotesChange,
}: POItemsEditorProps) {
  const materialOptions = materials
    .filter((material) => material.is_active !== false)
    .map((material) => ({ value: material.id, label: material.nama, description: material.kode }));

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Item Purchase Order</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="mr-1.5 h-4 w-4" />
          Tambah Item
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item, index) => {
          const material = materials.find((entry) => entry.id === item.raw_material_id);
          const unitOptions = purchaseUnitOptions(material, units);
          return (
            <div key={item.id} className="rounded-xl border border-gray-200/70 bg-white/70 p-4">
              <div className="mb-4 flex items-center justify-between border-b border-gray-200/70 pb-3">
                <p className="text-sm font-medium text-gray-900">Item #{index + 1}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                  aria-label={`Hapus item ${index + 1}`}
                  onClick={() => onRemove(item.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="min-w-0 space-y-1.5 lg:col-span-4">
                  <Label className="text-xs">
                    Bahan Baku <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={materialOptions}
                    value={item.raw_material_id}
                    onChange={(value) => value && onMaterialChange(item.id, value)}
                    placeholder="Pilih bahan baku..."
                    searchPlaceholder="Cari bahan baku..."
                    emptyMessage="Bahan baku tidak ditemukan"
                    className="w-full! h-9 text-sm"
                  />
                </div>
                <div className="min-w-0 space-y-1.5 lg:col-span-2">
                  <Label className="text-xs">
                    Satuan <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={unitOptions.map(({ value, label }) => ({ value, label }))}
                    value={item.satuan_id || ""}
                    onChange={(value) => {
                      const option = unitOptions.find((entry) => entry.value === value);
                      if (option) onUnitChange(item.id, option.value, option.label);
                    }}
                    placeholder={material ? "Pilih satuan..." : "Pilih bahan dulu"}
                    searchPlaceholder="Cari satuan..."
                    emptyMessage="Satuan tidak tersedia"
                    disabled={!material}
                    className="w-full! h-9 text-sm"
                  />
                </div>
                <div className="min-w-0 space-y-1.5 lg:col-span-2">
                  <Label className="text-xs">
                    Qty <span className="text-red-500">*</span>
                  </Label>
                  <NumericInput
                    min="0"
                    value={item.qty_ordered > 0 ? item.qty_ordered : null}
                    decimalScale={4}
                    placeholder="0"
                    onFocus={(event) => event.currentTarget.select()}
                    onValueChange={(value) => onQtyOrPriceChange(item.id, "qty_ordered", value || 0)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="min-w-0 space-y-1.5 lg:col-span-2">
                  <Label className="text-xs">Harga Satuan</Label>
                  <NumericInput
                    min="0"
                    value={item.harga_satuan}
                    decimalScale={0}
                    onValueChange={(value) => onQtyOrPriceChange(item.id, "harga_satuan", value || 0)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="min-w-0 rounded-lg bg-gray-50/80 p-3 lg:col-span-2">
                  <p className="text-xs text-gray-500">Subtotal</p>
                  <p className="text-sm font-semibold text-gray-900">{formatRupiah(item.subtotal)}</p>
                </div>
                <div className="min-w-0 space-y-1.5 lg:col-span-12">
                  <Label className="text-xs">Catatan</Label>
                  <Input
                    value={item.notes}
                    onChange={(event) => onNotesChange(item.id, event.target.value)}
                    placeholder="Catatan item (opsional)..."
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 py-10 text-center text-sm text-gray-500">
            Belum ada item. Klik &quot;Tambah Item&quot; atau ambil dari purchase request.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
