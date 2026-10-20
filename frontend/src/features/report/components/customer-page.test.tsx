import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpaCustomerReportPage } from "./customer-page";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows POS customer KPIs, three top tens and customer trend", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true, status: 200, json: async () => ({ success: true, data: url.endsWith("/outlets")
      ? [{ branch_id: "a", branch_name: "Dago" }]
      : { from: "2031-01-15", to: "2031-01-16", interval: "daily", total_customers: 2, total_transactions: 3, total_sales: 600,
          top_treatments: [{ treatment_id: "t", treatment_name: "Pijat", quantity: 3 }],
          top_customers: [{ customer_id: "c", customer_name: "Ani", transactions: 2, sales: 300 }],
          top_sales_customers: [{ customer_id: "d", customer_name: "Budi", transactions: 1, sales: 300 }],
          periods: [{ period: "2031-01-15", customers: 1 }, { period: "2031-01-16", customers: 2 }] } }),
  })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SpaCustomerReportPage /></QueryClientProvider>);
  expect(await screen.findByText("Pijat")).toBeInTheDocument();
  expect(screen.getByText("Top 10 Customer")).toBeInTheDocument();
  expect(screen.getByText("Top 10 Sales Customer")).toBeInTheDocument();
  expect(screen.getByText("Ani")).toBeInTheDocument();
  expect(screen.getByText("Budi")).toBeInTheDocument();
  expect(screen.getByText("Trend jumlah customer")).toBeInTheDocument();
});
