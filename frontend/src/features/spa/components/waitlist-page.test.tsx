import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpaWaitlistPage } from "./waitlist-page";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const entry = {
  id: "w1",
  branch_id: "b1",
  branch_name: "Paddy Store Kopo",
  customer_name: "Tamu Dua",
  customer_phone: "081255500202",
  conversation_id: "c1",
  visit_date: "2026-10-09",
  period: "sore",
  people: 2,
  variant_ids: ["v1"],
  variant_labels: ["Reflexology · 45 menit"],
  source: "whatsapp",
  status: "notified",
  note: "",
  notified_at: "2026-10-08T03:00:00.000Z",
  resolved_at: null,
  created_at: "2026-10-08T02:00:00.000Z",
};

describe("SpaWaitlistPage", () => {
  it("lists waiting guests with their wish, source and status", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/spa/outlets")) return new Response(JSON.stringify({ success: true, data: [] }));
      return new Response(JSON.stringify({ success: true, data: [entry] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SpaWaitlistPage />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText("Tamu Dua")).toBeInTheDocument());
    expect(screen.getByText("2 orang")).toBeInTheDocument();
    expect(screen.getByText("Reflexology · 45 menit")).toBeInTheDocument();
    expect(screen.getByText("Bot WhatsApp")).toBeInTheDocument();
    expect(screen.getAllByText("Sudah dikabari").length).toBeGreaterThanOrEqual(2); // filter option + badge
    expect(screen.getByRole("button", { name: "Jadi booking" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Booking History/ })).toHaveAttribute("href", "/dashboard/spa/bookings");
    vi.unstubAllGlobals();
  });
});
