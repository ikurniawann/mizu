import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpaRoomsPage } from "./rooms-page";
import { SpaOutletsPage } from "./outlets-page";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("manages rooms on their own page for the selected outlet", async () => {
  const rooms = [{ id: "r1", branch_id: "b1", name: "VIP 1", category: "private", capacity: 2, price_idr: 50000, description: "", is_active: true, sort_order: 0 }];
  const writes: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/spa/outlets") return new Response(JSON.stringify({ success: true, data: [
      { branch_id: "b1", branch_name: "Mizu Dago", configured: true, is_active: true },
      { branch_id: "b2", branch_name: "Mizu Setiabudi", configured: true, is_active: true },
    ] }));
    if (url.startsWith("/api/spa/rooms?")) return new Response(JSON.stringify({ success: true, data: url.includes("b1") ? [...rooms] : [] }));
    writes.push(`${method} ${url}`);
    if (method === "POST") rooms.push({ ...JSON.parse(String(init?.body)), id: "r2", sort_order: 0 });
    if (method === "PUT") Object.assign(rooms[0], JSON.parse(String(init?.body)));
    if (method === "DELETE") rooms.splice(rooms.findIndex((room) => url.endsWith(room.id)), 1);
    return new Response(JSON.stringify({ success: true, data: method === "DELETE" ? {} : rooms.at(-1) }));
  }));

  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><SpaRoomsPage /></QueryClientProvider>);
  expect(await screen.findByRole("heading", { name: "Room Spa" })).toBeInTheDocument();
  expect(await screen.findByRole("row", { name: /Mizu Dago/ })).toBeInTheDocument();
  expect(await screen.findByRole("row", { name: /VIP 1/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tutup room Mizu Dago" }));
  expect(screen.queryByRole("row", { name: /VIP 1/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Buka room Mizu Dago" }));
  expect(screen.getByRole("row", { name: /VIP 1/ })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Filter outlet" }), { target: { value: "b2" } });
  expect(await screen.findByRole("row", { name: /Mizu Setiabudi/ })).toBeInTheDocument();
  expect(await screen.findByText("Belum ada room di outlet ini.")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Filter outlet" }), { target: { value: "b1" } });
  expect(await screen.findByRole("row", { name: /VIP 1/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tambah room" }));
  let dialog = screen.getByRole("dialog", { name: "Tambah room" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Nama room" }), { target: { value: "Reguler 1" } });
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Kategori room" }), { target: { value: "public" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Simpan room" }));
  expect(await screen.findByRole("row", { name: /Reguler 1/ })).toBeInTheDocument();
  expect(rooms[1].category).toBe("public");
  const vip = screen.getByRole("row", { name: /VIP 1/ });
  fireEvent.click(within(vip).getByRole("button", { name: "Ubah room VIP 1" }));
  dialog = screen.getByRole("dialog", { name: "Ubah room VIP 1" });
  expect(within(dialog).getByRole("combobox", { name: "Kategori room" })).toHaveValue("private");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Nama room" }), { target: { value: "VIP Utama" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Simpan room" }));
  const updated = await screen.findByRole("row", { name: /VIP Utama/ });
  fireEvent.click(within(updated).getByRole("button", { name: "Hapus room VIP Utama" }));
  fireEvent.click(screen.getByRole("button", { name: "Hapus room" }));
  await waitFor(() => expect(screen.queryByRole("row", { name: /VIP Utama/ })).not.toBeInTheDocument());
  expect(writes).toEqual(["POST /api/spa/rooms", "PUT /api/spa/rooms/r1", "DELETE /api/spa/rooms/r1"]);
});

it("keeps room management off the outlet page", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({ success: true, data: String(input).includes("/outlets")
    ? [{ branch_id: "b1", branch_name: "Mizu Dago", configured: true, is_active: true, warehouses: [] }]
    : { amount_idr: 0, hold_minutes: 60, enabled: false } }))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SpaOutletsPage /></QueryClientProvider>);
  expect(await screen.findByRole("button", { name: "Atur" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Room" })).not.toBeInTheDocument();
});
