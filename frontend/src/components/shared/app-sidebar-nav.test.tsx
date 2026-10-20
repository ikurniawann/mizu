import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAssignBooking } from "@/features/spa/mutations";
import type { NavItem } from "@/lib/iam/types";
import AppSidebarNav from "./app-sidebar-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/spa/book-order",
  useRouter: () => ({ push: vi.fn() }),
}));

const navItems: NavItem[] = [{
  href: "/dashboard/spa", label: "Spa", icon: "calendar",
  children: [{ href: "/dashboard/spa/book-order", label: "Book Order", icon: "calendar" }],
}];
let client: QueryClient;
let total: number;
let requests: string[];

beforeEach(() => {
  total = 17;
  requests = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    requests.push(input);
    if (url.pathname === "/api/hris/nav-badges") return Response.json({ badges: {} });
    if (url.pathname === "/api/spa/bookings/booking-1/therapist" && init?.method === "PUT") {
      total = 0;
      return Response.json({ success: true, data: { id: "booking-1" } });
    }
    if (url.pathname === "/api/spa/bookings" && url.searchParams.get("status") === "unassigned") {
      // Total includes all matching bookings, not just the one returned on this page.
      return Response.json({
        success: true, data: [{ id: "booking-1", item_count: 3 }],
        pagination: { page: 1, limit: 1, total, totalPages: total },
      });
    }
    return Response.json({ success: false, error: "Unexpected request" }, { status: 400 });
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function AssignButton() {
  const assign = useAssignBooking();
  return <button onClick={() => assign.mutate({ bookingId: "booking-1", therapistId: "therapist-1" })}>Tugaskan</button>;
}

function openNav(items = navItems, extra?: React.ReactNode) {
  render(<QueryClientProvider client={client}><AppSidebarNav navItems={items} />{extra}</QueryClientProvider>);
}

it("menampilkan total booking belum ditugaskan pada Book Order dan grup Spa yang tertutup", async () => {
  openNav();
  const link = screen.getByRole("link", { name: /Book Order/ });
  expect(await within(link).findByText("17")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Spa" }));
  expect(within(screen.getByRole("button", { name: /Spa/ })).getByText("17")).toBeInTheDocument();
  const request = requests.find((url) => url.startsWith("/api/spa/bookings?"));
  expect(request).toBeDefined();
  expect(new URL(request!, "http://localhost").searchParams.get("limit")).toBe("1");
});

it("badge mengikuti booking online baru lewat polling dan hilang saat tidak ada antrean", async () => {
  vi.useFakeTimers();
  total = 0;
  openNav();
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  const link = screen.getByRole("link", { name: "Book Order" });
  total = 4;
  await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
  expect(within(link).getByText("4")).toBeInTheDocument();
  total = 0;
  await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
  expect(link).toHaveTextContent(/^Book Order$/);
});

it("badge langsung diperbarui setelah penugasan tanpa menunggu polling", async () => {
  total = 1;
  openNav(navItems, <AssignButton />);
  const link = screen.getByRole("link", { name: /Book Order/ });
  expect(await within(link).findByText("1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tugaskan" }));
  await waitFor(() => expect(link).toHaveTextContent(/^Book Order$/));
});

it("tidak meminta jumlah booking bila pengguna tidak memiliki menu Book Order", async () => {
  openNav([{ href: "/dashboard", label: "Beranda", icon: "home" }]);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(requests.some((url) => url.startsWith("/api/spa/"))).toBe(false);
});
