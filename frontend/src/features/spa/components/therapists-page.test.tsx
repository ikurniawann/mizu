import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpaTherapistsPage } from "./therapists-page";

afterEach(() => vi.unstubAllGlobals());

it("shows the employee gender and omits gender from therapist creation", async () => {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/spa/therapists" && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { full_name: "Sari" } }), { status: 201 }));
    }
    const data = url.startsWith("/api/spa/outlets")
      ? [{ branch_id: "b1", branch_name: "Mizu Dago", configured: true, is_active: true }]
      : url.startsWith("/api/spa/employees")
        ? [{ id: "e1", full_name: "Sari", nip: "123", position_title: null, gender: "female", is_therapist: false }]
        : [];
    return Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }));
  }));

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SpaTherapistsPage /></QueryClientProvider>);
  await screen.findByRole("option", { name: "Mizu Dago" });
  fireEvent.click(screen.getByRole("button", { name: "Tambah terapis" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Cari karyawan" }), { target: { value: "Sari" } });
  fireEvent.click(await within(dialog).findByRole("button", { name: /Sari/ }));
  expect(within(dialog).getByText("Wanita")).toBeInTheDocument();
  expect(within(dialog).queryByRole("combobox", { name: /gender/i })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toEqual({ employee_id: "e1", home_branch_id: "b1", is_active: true });
});

it("keeps shift mapping and day-off management in separate tabs", async () => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const data = url.startsWith("/api/spa/outlets")
      ? [
          { branch_id: "b1", branch_name: "Mizu Dago", configured: true, is_active: true },
          { branch_id: "b2", branch_name: "Mizu Buah Batu", configured: true, is_active: true },
        ]
      : url.startsWith("/api/spa/day-offs")
        ? {
            month: "2026-10",
            branch_id: url.includes("branch_id=b2") ? "b2" : "b1",
            quota: { branch_id: "b1", min_female: 1, min_male: 0, max_per_week: 2 },
            days: [],
            requests: [],
          }
        : url === "/api/hris/shifts"
          ? [{ id: "s1", name: "Pagi", start_time: "08:00", end_time: "16:00", is_active: true }]
          : [];
    return Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }));
  }));

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SpaTherapistsPage /></QueryClientProvider>);

  fireEvent.click(screen.getByRole("tab", { name: "Jadwal Shift" }));
  expect(await screen.findByRole("button", { name: "Atur mapping" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Simpan kuota" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Jadwal Libur" }));
  expect(await screen.findByRole("button", { name: "Simpan kuota" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Atur mapping" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Outlet" }), { target: { value: "b2" } });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Outlet" })).toHaveValue("b2"));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) =>
    String(url).startsWith("/api/spa/day-offs") && String(url).includes("branch_id=b2"),
  )).toBe(true));
});
