import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpaTrendPage } from "./trend-page";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Line: () => null,
}));
let urls: string[];
let failReport: boolean;
let failOutlets: boolean;
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SpaTrendPage /></QueryClientProvider>);
}
beforeEach(() => {
  urls = []; failReport = false; failOutlets = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    const outlet = url.endsWith("/outlets");
    const failed = outlet ? failOutlets : failReport;
    const query = new URL(url, "http://localhost").searchParams;
    const data = outlet ? [{ branch_id: "outlet-a", branch_name: "Dago", configured: true, is_active: true }] :
      { from: query.get("from"), to: query.get("to"), interval: query.get("interval"), total_bookings: 4,
        periods: [{ period: "2026-10-01", bookings: 3 }, { period: "2026-10-02", bookings: 0 }, { period: "2026-10-03", bookings: 1 }] };
    return { ok: !failed, status: failed ? 500 : 200, json: async () => failed ? { success: false, error: "Server gagal" } : { success: true, data } };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Spa Trend", () => {
  it("resets ranges in WIB on mode changes while keeping the outlet", async () => {
    mount();
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Outlet"), { target: { value: "outlet-a" } });
    fireEvent.change(screen.getByLabelText("Kelompok periode"), { target: { value: "yearly" } });
    const year = new Date(Date.now() + 7 * 3600000).getUTCFullYear();
    expect(screen.getByLabelText("Tanggal awal")).toHaveValue(`${year - 4}-01-01`);
    expect(screen.getByLabelText("Tanggal akhir")).toHaveValue(`${year}-12-31`);
    await waitFor(() => expect(urls.some((u) => u.includes("interval=yearly") && u.includes("branch_id=outlet-a"))).toBe(true));
    fireEvent.change(screen.getByLabelText("Kelompok periode"), { target: { value: "monthly" } });
    expect(screen.getByLabelText("Tanggal awal")).toHaveValue(`${year}-01-01`);
  });
  it("includes zero periods in the average and percentages", async () => {
    mount();
    const table = await screen.findByRole("table");
    expect(screen.getByText("1,3")).toBeInTheDocument();
    expect(within(table).getByText("0%")).toBeInTheDocument();
    expect(within(table).getByText("75%")).toBeInTheDocument();
  });
  it.each(["", "9999-12-31"])("hides old results and stops report requests for invalid from=%s", async (from) => {
    mount();
    await screen.findByRole("table");
    const before = urls.filter((u) => u.includes("reports")).length;
    fireEvent.change(screen.getByLabelText("Tanggal awal"), { target: { value: from } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Tanggal/);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await waitFor(() => expect(urls.filter((u) => u.includes("reports"))).toHaveLength(before));
  });
  it.each(["report", "outlets"])("shows %s failures and can retry without inventing zero totals", async (source) => {
    failReport = source === "report"; failOutlets = source === "outlets";
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Server gagal");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    failReport = false; failOutlets = false;
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByRole("table");
  });
});
