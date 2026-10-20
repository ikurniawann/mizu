import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavLeaf } from "@/lib/iam/nav-leaves";
import { PhoneNav } from "./phone-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

const spaLeaves: NavLeaf[] = [
  { href: "/dashboard/spa", label: "Overview", section: "Spa", icon: "home" },
  { href: "/dashboard/spa/book-order", label: "Book Order", section: "Spa", icon: "home" },
];

const otherLeaves: NavLeaf[] = ["Sales", "Stock", "Reports"].map((section) => ({
  href: `/dashboard/${section.toLowerCase()}`,
  label: section,
  section,
  icon: "home",
}));

function renderNav(leaves: NavLeaf[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (items: NavLeaf[]) => (
    <QueryClientProvider client={client}>
      <PhoneNav leaves={items} userName="Admin" userRole="admin" onAccount={vi.fn()} />
    </QueryClientProvider>
  );
  const result = render(view(leaves));
  return { ...result, client, setLeaves: (items: NavLeaf[]) => result.rerender(view(items)) };
}

describe("PhoneNav booking counts", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname !== "/api/spa/bookings") throw new Error(`Unexpected request: ${input}`);
      return new Response(JSON.stringify({
        success: true,
        data: [],
        pagination: { page: 1, limit: 1, total: 7, totalPages: 7 },
      }), { status: 200 });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the count on the Spa shortcut, collapsed section, and exact Book Order link", async () => {
    const { client } = renderNav(spaLeaves);
    const shortcut = screen.getByRole("link", { name: "Spa" });
    await waitFor(() => expect(within(shortcut).getByText("7")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Lainnya/ }));
    const section = await screen.findByRole("button", { name: /Spa/ });
    expect(section).toHaveAttribute("aria-expanded", "false");
    expect(within(section).getByText("7")).toBeInTheDocument();
    fireEvent.click(section);
    expect(within(screen.getByRole("link", { name: /Book Order/ })).getByText("7")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: "Overview" })).queryByText("7")).not.toBeInTheDocument();
    client.clear();
  });

  it("keeps the count visible in Lainnya when Spa is outside the three shortcuts", async () => {
    const { client } = renderNav([...otherLeaves, ...spaLeaves]);
    expect(screen.queryByRole("link", { name: /Spa/ })).not.toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("button", { name: /Lainnya/ })).getByText("7")).toBeInTheDocument());
    client.clear();
  });

  it("hides cached counts when Book Order access is removed", async () => {
    const { client, setLeaves } = renderNav(spaLeaves);
    await waitFor(() => expect(within(screen.getByRole("button", { name: /Lainnya/ })).getByText("7")).toBeInTheDocument());
    setLeaves([spaLeaves[0]]);
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    client.clear();
  });

  it("does not fetch bookings when Book Order is absent from the allowed menu", () => {
    const { client } = renderNav([spaLeaves[0]]);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Lainnya" })).toBeInTheDocument();
    client.clear();
  });
});
