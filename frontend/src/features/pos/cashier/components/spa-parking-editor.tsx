"use client";

import { Button } from "@/components/ui/button";
import type { Product } from "@/lib/pos-api";
import type { CashierOrderItem } from "../api";

export function SpaParkingEditor(props: {
  warehouseId: string;
  products: Product[];
  items: CashierOrderItem[];
  busy: boolean;
  onAdd: (productId: string) => void;
  onRemove: (itemId: string) => void;
}) {
  const available = props.products.filter((p) => p.category?.name.toLowerCase() === "parkir" &&
    (p.warehouse_id ?? p.stall_warehouse_id) === props.warehouseId && p.is_active !== false && p.is_available !== false);
  const added = props.items.filter((item) => item.kitchen_notes === "Parkir booking spa");
  return (
    <section aria-label="Parkir pada tagihan Spa" className="rounded-xl border border-border bg-card p-3 text-sm">
      <p className="font-semibold">Tambah parkir ke tagihan treatment</p>
      <p className="mt-1 text-xs text-muted-foreground">Pilih produk parkir untuk satu pembayaran. Untuk transaksi terpisah, bayar treatment lalu buat transaksi POS baru.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {available.map((product) => (
          <Button key={product.id} type="button" size="sm" variant="outline" disabled={props.busy} onClick={() => props.onAdd(product.id)}>
            Tambah {product.name}
          </Button>
        ))}
        {available.length === 0 && <p className="text-xs text-warning">Produk parkir belum tersedia di outlet ini.</p>}
      </div>
      {added.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border pt-2">
          {added.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
              <span>{item.product_name}</span>
              <button type="button" disabled={props.busy || !item.id} className="text-danger underline disabled:opacity-50" onClick={() => item.id && props.onRemove(item.id)}>
                Hapus {item.product_name}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
