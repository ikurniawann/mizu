import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SalesVsTargetPage } from "./sales-vs-target-page";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Bar: () => null, Legend: () => null,
}));
type Target = { id: string; branch_id: string; branch_name: string; month: string; amount: number };
let targets: Target[];
let failSave: boolean;
let failLoad: boolean;
const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Jakarta", year: "numeric" }).format(new Date()));
const outlets = [{ id: "outlet-a", name: "Dago" }, { id: "outlet-b", name: "Setiabudi" }];

beforeEach(() => {
  targets = [
    { id: "a-jan", branch_id: "outlet-a", branch_name: "Dago", month: `${year}-01`, amount: 100 },
    { id: "b-jan", branch_id: "outlet-b", branch_name: "Setiabudi", month: `${year}-01`, amount: 200 },
    { id: "b-dec", branch_id: "outlet-b", branch_name: "Setiabudi", month: `${year}-12`, amount: 50 },
  ];
  failSave = false; failLoad = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if ((method !== "GET" && failSave) || (method === "GET" && failLoad)) {
      return { ok: false, status: 500, json: async () => ({ success: false, error: "Server gagal" }) };
    }
    const parsed = new URL(url, "http://localhost");
    const selectedYear = Number(parsed.searchParams.get("year") ?? year);
    let data: unknown;
    if (method === "PUT") {
      const savedYear = Number(parsed.pathname.split("/").pop());
      for (const cell of JSON.parse(String(init?.body)).changes) {
        const month = `${savedYear}-${String(cell.month).padStart(2, "0")}`;
        targets = targets.filter((row) => row.branch_id !== cell.branch_id || row.month !== month);
        if (cell.amount !== null) targets.push({ id: `${cell.branch_id}-${month}`, branch_id: cell.branch_id, branch_name: outlets.find((o) => o.id === cell.branch_id)!.name, month, amount: cell.amount });
      }
      data = { year: savedYear };
    } else if (method === "DELETE") {
      const removedYear = parsed.pathname.split("/").pop();
      targets = targets.filter((row) => !row.month.startsWith(`${removedYear}-`)); data = {};
    } else if (parsed.pathname.endsWith("sales-target-years")) {
      data = { outlets, years: [...new Set(targets.map((row) => Number(row.month.slice(0, 4))))].sort((a, b) => b - a).map((y) => {
        const months = Array.from({ length: 12 }, (_, i) => targets.filter((t) => t.month === `${y}-${String(i + 1).padStart(2, "0")}`).reduce((sum, t) => sum + t.amount, 0));
        return { year: y, months, total: months.reduce((sum, amount) => sum + amount, 0) };
      }) };
    } else if (parsed.pathname.endsWith("sales-vs-target")) {
      data = { year: selectedYear, outlets, outlet_count: 2, months: Array.from({ length: 12 }, (_, i) => {
        const month = `${selectedYear}-${String(i + 1).padStart(2, "0")}`;
        const rows = targets.filter((row) => row.month === month);
        return { month, sales: i === 0 ? 150 : 0, target: rows.length ? rows.reduce((sum, row) => sum + row.amount, 0) : null, target_count: rows.length };
      }) };
    } else data = targets.filter((row) => row.month.startsWith(`${selectedYear}-`));
    return { ok: true, status: 200, json: async () => ({ success: true, data }) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(editable = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SalesVsTargetPage permissions={{ create: editable, update: editable, delete: editable }} /></QueryClientProvider>);
}
async function settings() {
  await screen.findByRole("table", { name: "Sales vs Target bulanan" });
  fireEvent.click(screen.getByRole("tab", { name: "Setting Target" }));
  return screen.findByRole("table", { name: "Target sales per tahun" });
}
async function openYear() {
  fireEvent.click(screen.getByRole("button", { name: `Lihat target tahun ${year}` }));
  return screen.findByRole("table", { name: `Target outlet tahun ${year}` });
}

describe("Sales vs Target", () => {
  it("shows twelve report months with achievements and unset targets", async () => {
    mount();
    const table = await screen.findByRole("table", { name: "Sales vs Target bulanan" });
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    expect(within(table).getByText("50%")).toBeInTheDocument();
    expect(within(table).getAllByText("Belum diatur")).toHaveLength(10);
  });
  it("pivots annual totals across January to December and opens outlet inputs", async () => {
    mount(); const table = await settings();
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("300");
    expect(cells[12]).toHaveTextContent("50");
    expect(cells[13]).toHaveTextContent("350");
    expect(within(table).getByRole("columnheader", { name: "Januari" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Desember" })).toBeInTheDocument();
    const grid = await openYear();
    expect(within(grid).getByLabelText("Dago Januari")).toHaveValue(100);
    expect(within(grid).getByLabelText("Setiabudi Januari")).toHaveValue(200);
    expect(within(grid).getAllByRole("spinbutton")).toHaveLength(24);
  });
  it("saves multiple outlet cells together and refreshes annual and sales totals", async () => {
    mount(); await settings(); await openYear();
    fireEvent.change(screen.getByLabelText("Dago Januari"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Setiabudi Februari"), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText("Dago Desember"), { target: { value: "100" } });
    const grid = screen.getByRole("table", { name: `Target outlet tahun ${year}` });
    expect(within(grid).getAllByRole("row").at(-1)).toHaveTextContent("1.050");
    fireEvent.click(screen.getByRole("button", { name: "Simpan target tahun" }));
    const table = await screen.findByRole("table", { name: "Target sales per tahun" });
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("500");
    expect(cells[2]).toHaveTextContent("400");
    expect(cells[12]).toHaveTextContent("150");
    expect(cells[13]).toHaveTextContent("1.050");
    fireEvent.click(screen.getByRole("tab", { name: "Sales vs Target" }));
    expect(await within(await screen.findByRole("table", { name: "Sales vs Target bulanan" })).findByText("30%")).toBeInTheDocument();
  });
  it("creates a selected year's outlet grid without replacing other years", async () => {
    mount(); await settings();
    fireEvent.click(screen.getByRole("button", { name: "Tambah target tahun" }));
    fireEvent.change(screen.getByLabelText("Tahun target"), { target: { value: String(year + 1) } });
    await screen.findByRole("table", { name: `Target outlet tahun ${year + 1}` });
    fireEvent.change(screen.getByLabelText("Dago Januari"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Setiabudi Januari"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan target tahun" }));
    const table = await screen.findByRole("table", { name: "Target sales per tahun" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("3.000");
    expect(within(table).getAllByRole("row")[2]).toHaveTextContent("350");
  });
  it("clears a cell and deletes the year's targets after confirmation", async () => {
    mount(); await settings(); await openYear();
    fireEvent.change(screen.getByLabelText("Setiabudi Desember"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan target tahun" }));
    const table = await screen.findByRole("table", { name: "Target sales per tahun" });
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[12]).toHaveTextContent("—");
    expect(cells[13]).toHaveTextContent("300");
    fireEvent.click(screen.getByRole("button", { name: `Hapus target tahun ${year}` }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(String(year));
    fireEvent.click(within(dialog).getByRole("button", { name: "Hapus target tahun" }));
    expect(await screen.findByText("Belum ada target tahunan.")).toBeInTheDocument();
  });
  it("preserves the entire draft after a failed save", async () => {
    mount(); await settings(); await openYear();
    fireEvent.change(screen.getByLabelText("Dago Januari"), { target: { value: "500" } });
    failSave = true;
    fireEvent.click(screen.getByRole("button", { name: "Simpan target tahun" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server gagal");
    expect(screen.getByLabelText("Dago Januari")).toHaveValue(500);
    expect(screen.getByLabelText("Setiabudi Januari")).toHaveValue(200);
  });
  it("preserves an unsaved grid when checking sales in the other tab", async () => {
    mount(); await settings(); await openYear();
    fireEvent.change(screen.getByLabelText("Dago Januari"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Setiabudi Februari"), { target: { value: "750" } });
    fireEvent.click(screen.getByRole("tab", { name: "Sales vs Target" }));
    await screen.findByRole("table", { name: "Sales vs Target bulanan" });
    fireEvent.click(screen.getByRole("tab", { name: "Setting Target" }));
    await screen.findByRole("table", { name: `Target outlet tahun ${year}` });
    expect(screen.getByLabelText("Dago Januari")).toHaveValue(500);
    expect(screen.getByLabelText("Setiabudi Februari")).toHaveValue(750);
  });
  it("allows readers to inspect the pivot but not edit inputs or delete years", async () => {
    mount(false); const table = await settings();
    expect(screen.queryByRole("button", { name: "Tambah target tahun" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: /Hapus/ })).not.toBeInTheDocument();
    const grid = await openYear();
    expect(within(grid).getByLabelText("Dago Januari")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Simpan target tahun" })).not.toBeInTheDocument();
  });
  it("shows load errors and supports retry", async () => {
    failLoad = true; mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Server gagal");
    failLoad = false;
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByRole("table", { name: "Sales vs Target bulanan" });
  });
});
