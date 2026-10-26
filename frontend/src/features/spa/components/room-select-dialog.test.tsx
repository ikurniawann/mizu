import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RoomSelectDialog } from "./room-select-dialog";
import type { Booking } from "../types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const booking = {
  id: "b1", branch_id: "branch", room_id: "old", room_name: "Public asal",
  room_price_idr: 25000, total_idr: 225000, status: "in_treatment",
} satisfies Pick<Booking, "id" | "branch_id" | "room_id" | "room_name" | "room_price_idr" | "total_idr" | "status">;

function setup(current = booking) {
  const writes: unknown[] = [];
  const close = vi.fn();
  const rooms = [
    { id: "old", name: "Public asal", category: "public", capacity: 2, price_idr: 25000 },
    { id: "vip", name: "VIP tujuan", category: "private", capacity: 1, price_idr: 100000 },
    { id: "free", name: "Public gratis", category: "public", capacity: 2, price_idr: 0 },
  ];
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      writes.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ success: true, data: { ...current, room_id: "vip", room_name: "VIP tujuan" } }));
    }
    return new Response(JSON.stringify({ success: true, data: rooms }));
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><RoomSelectDialog booking={current} onClose={close} /></QueryClientProvider>);
  return { writes, close };
}

it("previews the full destination rate and submits only room_id", async () => {
  const { writes, close } = setup();
  await screen.findByRole("option", { name: /VIP tujuan.*Private/ });
  expect(screen.getByRole("button", { name: "Simpan" })).toBeDisabled();
  expect(screen.queryByRole("option", { name: "Tanpa room" })).not.toBeInTheDocument();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Room tujuan" }), { target: { value: "vip" } });
  expect(within(screen.getByTestId("room-transfer-price")).getByText(/100[.]000/)).toBeInTheDocument();
  expect(within(screen.getByTestId("room-transfer-total")).getByText(/300[.]000/)).toBeInTheDocument();
  expect(screen.getByText(/tarif penuh room tujuan/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(writes).toEqual([{ room_id: "vip" }]);
});

it("uses zero for a free destination without a waiver option", async () => {
  setup();
  await screen.findByRole("option", { name: /Public gratis/ });
  fireEvent.change(screen.getByRole("combobox", { name: "Room tujuan" }), { target: { value: "free" } });
  expect(screen.getByTestId("room-transfer-price")).toHaveTextContent(/Rp\s*0/);
  expect(screen.getByTestId("room-transfer-total")).toHaveTextContent(/200[.]000/);
});
