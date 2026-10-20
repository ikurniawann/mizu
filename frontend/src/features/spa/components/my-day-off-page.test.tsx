import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MyDayOffPage } from "./my-day-off-page";

afterEach(() => vi.unstubAllGlobals());

it("submits a therapist day-off request from the employee area", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/spa/me/day-offs" && init?.method === "POST") {
      requests.push(String(init.body));
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "r1" } }), { status: 201 }));
    }
    const data = url === "/api/spa/me"
      ? { therapist: { id: "t1", full_name: "Ayu", is_active: true } }
      : { month: "2026-10", branch_id: "b1", quota: { branch_id: "b1", min_female: 1, min_male: 0, max_per_week: 2 }, requests: [], days: [{ date: "2026-10-22", weekday: 4, working_female: 2, working_male: 1, off_count: 0, can_book: true }] };
    return Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }));
  }));

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MyDayOffPage /></QueryClientProvider>);

  expect(await screen.findByRole("heading", { name: "Jadwal Libur" })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: /22 Oktober 2026, bisa diajukan/ }));
  fireEvent.click(screen.getByRole("button", { name: "Ajukan libur" }));
  await waitFor(() => expect(requests).toEqual(['{"date":"2026-10-22"}']));
});

it("does not offer day-off requests to employees who are not active therapists", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: { therapist: null } }), { status: 200 })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MyDayOffPage /></QueryClientProvider>);

  expect(await screen.findByText("Akun Anda belum terdaftar sebagai terapis aktif.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Ajukan libur" })).not.toBeInTheDocument();
});
