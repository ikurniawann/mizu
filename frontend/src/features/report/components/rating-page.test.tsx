import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpaRatingPage } from "./rating-page";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows rated bookings and therapist averages without a trend", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true, status: 200, json: async () => ({ success: true, data: url.endsWith("/outlets")
      ? [{ branch_id: "a", branch_name: "Dago" }]
      : { from: "2031-01-15", to: "2031-01-16", total_ratings: 2, average_rating: 4,
          bookings: [{ id: "b", booking_code: "SPA-101", customer_name: "Ani", branch_name: "Dago", therapist_id: "t", therapist_name: "Tini", scheduled_at: "2031-01-15T02:00:00Z", rating: 5 }],
          therapists: [{ therapist_id: "t", therapist_name: "Tini", total_ratings: 2, average_rating: 4 }] } }),
  })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SpaRatingPage /></QueryClientProvider>);
  expect(await screen.findByText("SPA-101")).toBeInTheDocument();
  expect(screen.getByText("Ani")).toBeInTheDocument();
  expect(screen.getAllByText("Tini").length).toBeGreaterThan(0);
  expect(screen.queryByText("Tren rating harian")).not.toBeInTheDocument();
  expect(screen.getByText("Rata-rata per terapis")).toBeInTheDocument();
});
