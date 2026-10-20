import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Product } from "@/lib/pos-api";
import { SpaParkingEditor } from "./spa-parking-editor";

afterEach(cleanup);

it("offers only parking from the Spa outlet and removes only its saved parking line", () => {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  const products = [
    { id: "parking-1", sku: "P1", name: "Parkir Mobil", category: { name: "Parkir" }, warehouse_id: "w1", base_price: 10000, is_active: true, is_available: true },
    { id: "parking-2", sku: "P2", name: "Valet outlet lain", category: { name: "Parkir" }, warehouse_id: "w2", base_price: 25000, is_active: true, is_available: true },
    { id: "treatment", sku: "T1", name: "Pijat", category: { name: "Spa Treatment" }, warehouse_id: "w1", base_price: 100000, is_active: true, is_available: true },
  ] as Product[];
  render(<SpaParkingEditor warehouseId="w1" products={products} items={[
    { id: "line-1", product_id: "parking-1", product_name: "Parkir Mobil", quantity: 1, kitchen_notes: "Parkir booking spa" },
    { id: "line-2", product_id: "treatment", product_name: "Pijat", quantity: 1 },
  ]} busy={false} onAdd={onAdd} onRemove={onRemove} />);

  fireEvent.click(screen.getByRole("button", { name: /Tambah Parkir Mobil/ }));
  expect(onAdd).toHaveBeenCalledWith("parking-1");
  expect(screen.queryByRole("button", { name: /Valet outlet lain/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Hapus Parkir Mobil/ }));
  expect(onRemove).toHaveBeenCalledWith("line-1");
  expect(screen.queryByRole("button", { name: /Hapus Pijat/ })).toBeNull();
});
