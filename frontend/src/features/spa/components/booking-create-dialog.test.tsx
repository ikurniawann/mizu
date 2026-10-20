import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Outlet } from "../types";
import { BookingCreateDialog, CustomerSearch } from "./booking-create-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows customer ban status and prevents selecting a banned customer", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, data: [
    { id: "active-1", name: "Ayu", phone: "081234567890", banned: false },
    { id: "banned-1", name: "Ayu Lama", phone: "081298765432", banned: true },
  ] })));
  const onPick = vi.fn();
  render(<QueryClientProvider client={client}><CustomerSearch onPick={onPick} /></QueryClientProvider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Cari pelanggan" }), { target: { value: "Ayu" } });
  const banned = await screen.findByRole("button", { name: /Ayu Lama.*Diblokir/ });
  expect(banned).toBeDisabled();
  expect(screen.getByRole("button", { name: /Ayu.*Aktif/ })).toBeEnabled();
  fireEvent.click(banned);
  expect(onPick).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Ayu.*Aktif/ }));
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "active-1" }));
  client.clear();
});

it("requires a room before creating a booking and sends the selected room", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0];
    if (path === "/api/spa/bookings" && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ success: true, data: { id: "booking-1", booking_code: "SPA-1", customer_name: "Ayu" } }));
    }
    const data = path === "/api/spa/treatments" ? [{ id: "t1", name: "Massage", code: "MASS", category: null, description: null, is_active: true, sort_order: 0, variants: [{ id: "v1", name: "60 menit", duration_min: 60, price_idr: 200000, is_active: true, sort_order: 0, outlet_prices: [] }] }]
      : path === "/api/spa/rooms" ? [{ id: "room-1", name: "VIP", capacity: 2, price_idr: 100000, is_active: true }]
      : [];
    return new Response(JSON.stringify({ success: true, data }));
  });
  const outlet = { branch_id: "branch-1", branch_name: "Mizu", configured: true, is_active: true } as Outlet;
  render(<QueryClientProvider client={client}><BookingCreateDialog outlets={[outlet]} defaultScheduled="2026-10-17T10:00" onClose={vi.fn()} onCreated={vi.fn()} /></QueryClientProvider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Nama pelanggan" }), { target: { value: "Ayu" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Nomor HP" }), { target: { value: "081234567890" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Gender pelanggan" }), { target: { value: "female" } });
  await screen.findByRole("option", { name: /Massage/ });
  fireEvent.change(screen.getByRole("combobox", { name: "Treatment" }), { target: { value: "v1" } });
  expect(await screen.findByRole("option", { name: /VIP/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Tanpa room" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Buat booking" }));
  expect(writes).toHaveLength(0);
  expect(screen.getByRole("combobox", { name: "Room" })).toBeInvalid();
  fireEvent.change(screen.getByRole("combobox", { name: "Room" }), { target: { value: "room-1" } });
  expect(screen.getByRole("dialog", { name: "Booking baru" }).querySelector("form")!.checkValidity()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Buat booking" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].room_id).toBe("room-1");
  client.clear();
});
