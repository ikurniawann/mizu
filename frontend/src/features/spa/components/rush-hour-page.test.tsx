import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpaRushHourPage } from "./rush-hour-page";

const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, bookings: hour === 9 || hour === 10 ? 2 : 0 }));
let urls: string[];
let failReport: boolean;
let failOutlets: boolean;
let emptyReport: boolean;
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SpaRushHourPage /></QueryClientProvider>);
}
beforeEach(() => {
  urls = []; failReport = false; failOutlets = false; emptyReport = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    const outlet = url.endsWith("/outlets");
    const failed = outlet ? failOutlets : failReport;
    const query = new URL(url, "http://localhost").searchParams;
    const data = outlet ? [{ branch_id: "outlet-a", branch_name: "Dago", configured: true, is_active: true }] :
      { from: query.get("from"), to: query.get("to"), total_bookings: emptyReport ? 0 : 4, peak_bookings: emptyReport ? 0 : 2, peak_hours: emptyReport ? [] : [9, 10], hourly: emptyReport ? hourly.map((row) => ({ ...row, bookings: 0 })) : hourly };
    return { ok: !failed, status: failed ? 500 : 200, json: async () => failed ? { success: false, error: "Server gagal" } : { success: true, data } };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Spa Rush Hour", () => {
  it("shows all 24 hours and every tied peak from the same response", async () => {
    mount();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(25);
    expect(within(table).getByText("00:00–00:59")).toBeInTheDocument();
    expect(within(table).getByText("23:00–23:59")).toBeInTheDocument();
    expect(screen.getByText(/Jam lain: 10:00/)).toBeInTheDocument();
    expect(within(table).getAllByText("50%")).toHaveLength(2);
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
  it("keeps all zero buckets without inventing a peak when no bookings exist", async () => {
    emptyReport = true;
    mount();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(25);
    expect(within(table).getAllByText("0%")).toHaveLength(24);
    expect(screen.getByRole("status")).toHaveTextContent("Belum ada booking");
    expect(screen.getByText("Belum ada jam tersibuk")).toBeInTheDocument();
    expect(screen.queryByText("Tersibuk")).not.toBeInTheDocument();
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
