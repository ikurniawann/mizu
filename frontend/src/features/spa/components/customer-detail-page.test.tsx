import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpaCustomerDetailPage } from "./customer-detail-page";

function showDetail(history: unknown[], customer: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    success: true,
    data: {
      customer: { id: "c1", name: "Ayu", phone: "08123456789", gender: "female", ...customer },
      history,
      pagination: { page: 1, limit: 20, total: history.length, totalPages: history.length ? 1 : 0 },
    },
  }))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SpaCustomerDetailPage id="c1" /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("menampilkan profil dan treatment selesai dari riwayat customer", async () => {
  showDetail([{ id: "i1", booking_id: "b1", booking_code: "SPA-001", branch_name: "Dago", treatment_name: "Balinese Massage", variant_name: "60 menit", therapist_name: "Sari", completed_at: "2026-10-11T03:00:00Z" }]);
  expect(await screen.findByText("Perempuan")).toBeInTheDocument();
  expect(screen.getByText("08123456789")).toBeInTheDocument();
  expect(screen.getByText("Balinese Massage")).toBeInTheDocument();
  expect(screen.getByText("SPA-001")).toBeInTheDocument();
  expect(screen.queryByText("Tanggal lahir")).not.toBeInTheDocument();
  expect(screen.queryByText("Kota")).not.toBeInTheDocument();
  expect(screen.queryByText("Email")).not.toBeInTheDocument();
});

it("menjelaskan saat customer belum punya treatment selesai", async () => {
  showDetail([]);
  expect(await screen.findByText("Belum ada treatment spa yang selesai.")).toBeInTheDocument();
});

it("menandai member yang diblokir beserta alasannya dan menawarkan buka blokir", async () => {
  showDetail([], { banned_at: "2026-10-13T03:00:00Z", banned_reason: "Sering tidak datang" });
  expect(await screen.findByText("Diblokir")).toBeInTheDocument();
  expect(screen.getByText(/Alasan: Sering tidak datang/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Buka blokir" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Blokir member" })).not.toBeInTheDocument();
});

it("member aktif punya tombol blokir yang meminta alasan", async () => {
  showDetail([]);
  expect(await screen.findByText("Aktif")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Blokir member" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Buka blokir" })).not.toBeInTheDocument();
});
