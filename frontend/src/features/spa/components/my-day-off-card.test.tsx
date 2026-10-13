import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MyDayOffCard } from "./my-day-off-card";

const month = {
  month: "2026-10",
  branch_id: "b1",
  quota: { branch_id: "b1", min_female: 1, min_male: 1, max_per_week: 2 },
  requests: [],
  days: Array.from({ length: 31 }, (_, i) => {
    const date = `2026-10-${String(i + 1).padStart(2, "0")}`;
    const base = { date, weekday: ((i + 3) % 7) + 1, working_female: 2, working_male: 1, off_count: 0, can_book: false };
    if (date === "2026-10-12") return { ...base, mine: "requested", request_id: "r1" };
    if (date === "2026-10-13") return { ...base, reason: "Kuota terapis wanita yang masuk sudah minimum (1 orang)" };
    if (date === "2026-10-22") return { ...base, can_book: true };
    return base;
  }),
};

function show() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: month }))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MyDayOffCard /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("menampilkan libur sendiri, alasan penolakan, dan tombol ajukan", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: /12 Oktober 2026, libur/ }));
  expect(screen.getByRole("button", { name: "Batalkan libur ini" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /13 Oktober 2026$/ }));
  expect(screen.getByText(/Belum bisa libur: Kuota terapis wanita/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /22 Oktober 2026, bisa diajukan/ }));
  expect(screen.getByRole("button", { name: "Ajukan libur" })).toBeInTheDocument();
});
