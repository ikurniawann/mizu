import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpaTherapistsPage } from "./therapists-page";

afterEach(() => vi.unstubAllGlobals());

it("shows therapist levels and employment status independently and filters levels", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const data = String(input).startsWith("/api/spa/therapists") ? [
      { id: "t1", full_name: "Sari", home_branch_name: "Dago", gender: "female", is_active: true, level: 0, employment_status: "contract" },
      { id: "t2", full_name: "Dewi", home_branch_name: "Dago", gender: "female", is_active: false, level: 2, employment_status: "resigned" },
    ] : [];
    return new Response(JSON.stringify({ success: true, data }));
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SpaTherapistsPage /></QueryClientProvider>);
  await screen.findByText("Sari");
  expect(within(screen.getByText("Sari").closest("tr")!).getByText("Level 0")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Kepegawaian" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Filter level terapis" }), { target: { value: "2" } });
  expect(screen.queryByText("Sari")).not.toBeInTheDocument();
  expect(screen.getByText("Dewi")).toBeInTheDocument();
  const row = screen.getByText("Dewi").closest("tr")!;
  expect(within(row).getByText("Resign")).toBeInTheDocument();
  expect(within(row).getByText("Nonaktif")).toBeInTheDocument();
});

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

it("previews assistance quota impact before saving an immediate transfer", async () => {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const path = String(url);
    if (init?.method === "POST") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ success: true, data: { impact: [{ branch_id: "b2", date: "2026-10-26", before_female: 1, female: 2, before_male: 0, male: 0, min_female: 1, min_male: 0 }] } }));
    }
    const data = path.startsWith("/api/spa/outlets") ? [
      { branch_id: "b1", branch_name: "Dago", configured: true, is_active: true },
      { branch_id: "b2", branch_name: "Buah Batu", configured: true, is_active: true },
    ] : path.startsWith("/api/spa/therapists") ? [{ id: "t1", full_name: "Sari", home_branch_id: "b1", home_branch_name: "Dago", is_active: true, level: 0, gender: "female" }] : [];
    return new Response(JSON.stringify({ success: true, data }));
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SpaTherapistsPage /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("tab", { name: "Perbantuan" }));
  fireEvent.click(await screen.findByRole("button", { name: "Tambah perbantuan" }));
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByRole("option", { name: "Sari (Dago)" });
  const selects = within(dialog).getAllByRole("combobox");
  fireEvent.change(selects[0], { target: { value: "t1" } });
  fireEvent.change(selects[1], { target: { value: "b2" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Periksa perbantuan" }));
  await within(dialog).findByText(/Syarat terpenuhi/);
  expect(writes.map(w => w.path)).toEqual(["/api/spa/assists/preview"]);
  expect(writes[0].body.starts_at).toBeUndefined();
  expect(writes[0].body.ends_at).toMatch(/\+07:00$/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Simpan perbantuan" }));
  await waitFor(() => expect(writes.map(w => w.path)).toEqual(["/api/spa/assists/preview", "/api/spa/assists"]));
});
