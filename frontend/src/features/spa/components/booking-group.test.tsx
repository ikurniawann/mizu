import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BookingGroupCreateDialog } from "./booking-group-create-dialog";
import { BookingGroupDialog } from "./booking-group-dialog";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("creates two separate visits with one selected payer", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.includes("/treatments")) return new Response(JSON.stringify({ success: true, data: [{ id: "t1", name: "Massage", code: "MASS", category: null, description: null, is_active: true, sort_order: 0, variants: [{ id: "v1", name: "60 menit", duration_min: 60, price_idr: 200000, is_active: true, sort_order: 0, outlet_prices: [] }] }] }));
    if (url.includes("/therapists")) return new Response(JSON.stringify({ success: true, data: [] }));
    if (url.endsWith("/booking-groups") && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ success: true, data: { id: "group-1", bookings: [{ id: "b1" }, { id: "b2" }] } }));
    }
    return new Response(JSON.stringify({ success: true, data: [] }));
  });
  const onCreated = vi.fn();
  render(<QueryClientProvider client={client}><BookingGroupCreateDialog branchId="branch-1" defaultScheduled="2026-10-12T10:00" onClose={vi.fn()} onCreated={onCreated} /></QueryClientProvider>);
  const names = screen.getAllByLabelText("Nama pelanggan");
  fireEvent.change(names[0], { target: { value: "Ayu" } });
  fireEvent.change(names[1], { target: { value: "Budi" } });
  fireEvent.change(screen.getByLabelText("Nomor HP pembayar"), { target: { value: "081234567890" } });
  for (const select of screen.getAllByLabelText(/Gender pelanggan/)) fireEvent.change(select, { target: { value: "female" } });
  await screen.findAllByRole("option", { name: /Massage/ });
  for (const select of screen.getAllByLabelText(/Treatment orang/)) fireEvent.change(select, { target: { value: "v1" } });
  fireEvent.click(screen.getByRole("button", { name: "Buat 2 booking" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith("group-1"));
  const payload = writes[0] as { payer_name: string; bookings: { customer_name: string; items: { variant_id: string }[] }[] };
  expect(payload.payer_name).toBe("Ayu");
  expect(payload.bookings.map((b) => b.customer_name)).toEqual(["Ayu", "Budi"]);
  expect(payload.bookings.every((b) => b.items[0].variant_id === "v1")).toBe(true);
  client.clear();
});

it("waits for every therapist rating, then sends one group checkout", async () => {
  push.mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const writes: unknown[] = [];
  const bookings = ["Ayu", "Budi"].map((name, index) => ({
    id: `b${index + 1}`, booking_code: `MZ-${index + 1}`, customer_name: name,
    scheduled_at: "2026-10-12T03:00:00Z", therapist_id: `t${index + 1}`, therapist_name: `Terapis ${index + 1}`,
    status: "completed", payment_status: "unpaid", therapist_rating: null, pos_order_id: null,
    items: [{ status: "completed", price_idr: 200000 }],
  }));
  const group = { id: "group-1", payer_name: "Ayu", payer_phone: "081234567890", bookings };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/booking-groups/group-1/checkout") && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ success: true, data: { group, order_id: "order-1", order_number: "POS-001" } }));
    }
    return new Response(JSON.stringify({ success: true, data: group }));
  });
  render(<QueryClientProvider client={client}><BookingGroupDialog id="group-1" onClose={vi.fn()} /></QueryClientProvider>);
  const checkout = await screen.findByRole("button", { name: /Checkout bersama ke POS/ });
  expect(checkout).toBeDisabled();
  const fourStars = screen.getAllByRole("button", { name: "4 bintang" });
  fireEvent.click(fourStars[0]);
  expect(checkout).toBeDisabled();
  const fiveStars = screen.getAllByRole("button", { name: "5 bintang" });
  fireEvent.click(fiveStars[1]);
  expect(checkout).toBeEnabled();
  fireEvent.click(checkout);
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/pos/cashier-new?orderId=order-1&spa=1"));
  expect(writes).toEqual([{ ratings: [{ booking_id: "b1", therapist_rating: 4 }, { booking_id: "b2", therapist_rating: 5 }] }]);
  client.clear();
});

it("keeps the group checkout action visible while another visit is unfinished", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, data: {
    id: "group-1", payer_name: "Ayu", payer_phone: "081234567890", bookings: [
      { id: "b1", booking_code: "SPA-1", customer_name: "Ayu", scheduled_at: "2026-10-12T03:00:00Z", status: "completed", payment_status: "unpaid", therapist_id: "t1", therapist_name: "Sari", therapist_rating: null, pos_order_id: null, items: [{ status: "completed", price_idr: 200000 }] },
      { id: "b2", booking_code: "SPA-2", customer_name: "Budi", scheduled_at: "2026-10-12T03:00:00Z", status: "in_treatment", payment_status: "unpaid", therapist_id: "t2", therapist_name: "Dewi", therapist_rating: null, pos_order_id: null, items: [{ status: "in_treatment", price_idr: 200000 }] },
    ],
  } })));
  render(<QueryClientProvider client={client}><BookingGroupDialog id="group-1" onClose={vi.fn()} /></QueryClientProvider>);
  expect(await screen.findByRole("button", { name: "Checkout bersama ke POS" })).toBeDisabled();
  expect(screen.getByText("Checkout tersedia setelah semua booking aktif selesai dan memiliki terapis.")).toBeInTheDocument();
  client.clear();
});
