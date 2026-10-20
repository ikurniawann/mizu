import { afterEach, expect, it, vi } from "vitest";
import { addSpaParkingItem, removeSpaParkingItem } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("saves a parking product on the existing Spa order", async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, data: { id: "line-1" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  await addSpaParkingItem("order-1", "product-1");
  expect(fetchMock).toHaveBeenCalledWith("/api/pos/orders/order-1/parking-items", expect.objectContaining({
    method: "POST", body: JSON.stringify({ product_id: "product-1" }),
  }));
});

it("removes only the selected parking line", async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, data: { id: "line-1" } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await removeSpaParkingItem("order-1", "line-1");
  expect(fetchMock).toHaveBeenCalledWith("/api/pos/orders/order-1/parking-items/line-1", expect.objectContaining({ method: "DELETE" }));
});
