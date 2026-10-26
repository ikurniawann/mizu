import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import AppSidebarNav from "@/components/shared/app-sidebar-nav";
import type { Board, BoardItem, BoardTherapist, Booking, Outlet } from "../types";
import { SpaBookOrderPage } from "./book-order-page";
import { SpaBookingDetailPage } from "./booking-detail-page";
import { SpaBookingsPage } from "./bookings-page";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/dashboard/spa/book-order",
}));

const item: BoardItem = {
  group_id: null,
  id: "item-1", booking_id: "booking-1", booking_code: "SPA-001", customer_name: "Ayu", booking_status: "unassigned", therapist_gender_pref: "any",
  variant_id: "variant-1", treatment_name: "Massage", variant_name: "60 menit", duration_min: 60,
  price_idr: 200000, therapist_id: null, therapist_name: null, starts_at: "2026-10-10T03:00:00Z",
  ends_at: "2026-10-10T04:00:00Z", status: "unassigned", started_at: null, completed_at: null, commission_idr: null,
};
const outlet: Outlet = {
  branch_id: "branch-1", branch_name: "Mizu", company_id: "company-1", configured: true, warehouse_id: null,
  warehouse_name: null, open_time: "09:00", close_time: "22:00", slot_minutes: 30, public_booking: true,
  is_active: true, warehouses: [], last_order_time: null, description: "",
};
const booking: Booking = {
  group_id: null,
  therapist_id: null, therapist_name: null,
  id: "booking-1", booking_code: "SPA-001", branch_id: "branch-1", branch_name: "Mizu", booking_type: "reservation",
  source: "staff", customer_name: "Ayu", customer_phone: "081234567890", scheduled_at: item.starts_at, ends_at: item.ends_at,
  status: "unassigned", payment_status: "unpaid", item_count: 2, total_idr: 300000, therapist_names: [],
  pos_order_id: null, room_id: null, room_name: null, room_price_idr: 0, created_at: "2026-10-09T02:00:00Z", company_id: "company-1", warehouse_id: null, customer_id: null,
  therapist_gender_pref: "any", notes: "Catatan booking", checked_out_at: null, paid_at: null, cancelled_at: null,
  cancel_reason: null, pos_order_number: null, therapist_rating: null,
  items: [item, { ...item, id: "item-2", treatment_name: "Refleksi", price_idr: 100000 }],
  events: [{ id: "event-1", item_id: null, action: "create", from_status: null, to_status: "unassigned",
    actor_name: "Resepsionis", note: null, created_at: "2026-10-09T02:00:00Z" }],
};
let client: QueryClient;
let detail: Booking;
let requested: string[];
let writes: { url: string; method: string | undefined; input: unknown }[];
let board: Board;
let unassignedCount: number;

beforeEach(() => {
  push.mockClear();
  localStorage.setItem(STORAGE_KEYS.spaBookOrderView.key, "calendar");
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  detail = structuredClone(booking);
  requested = [];
  writes = [];
  unassignedCount = 1;
  board = { date: "2026-10-10", branch_id: "branch-1", therapists: [], unassigned: [item] };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requested.push(url);
    if (init?.method && ["PUT", "PATCH", "POST"].includes(init.method)) writes.push({ url, method: init.method, input: JSON.parse(String(init.body)) });
    const path = url.split("?")[0];
    if (path === "/api/spa/bookings/booking-1/status" && init?.method === "POST") {
      const { action } = JSON.parse(String(init.body));
      detail = { ...detail, status: action === "start" ? "in_treatment" : "completed",
        items: detail.items.map((entry) => ({ ...entry, status: action === "start" ? "in_treatment" : "completed" })) };
    }
    const group = { id: "group-1", payer_name: "Ayu", payer_phone: "081234567890",
      bookings: [detail, { ...detail, id: "booking-2", booking_code: "SPA-002", customer_name: "Budi", therapist_id: "therapist-2", therapist_name: "Dewi" }] };
    const data = path === "/api/spa/booking-groups/group-1/checkout" ? { group, order_id: "order-1", order_number: "POS-001" }
      : path === "/api/spa/booking-groups/group-1" ? group
      : path === "/api/spa/bookings/booking-1/checkout" ? { booking: { ...detail, therapist_rating: 4 }, order_id: "order-1", order_number: "POS-001" }
      : path === "/api/spa/outlets" ? [outlet]
      : path === "/api/spa/board" ? board
      : path === "/api/spa/bookings" ? [booking]
      : path === "/api/spa/bookings/booking-1" ? detail
      : path === "/api/spa/bookings/booking-1/status" ? detail
      : path === "/api/spa/customers" ? [{ id: "customer-1", name: "Ayu", phone: "081234567890" }]
      : [];
    return new Response(JSON.stringify({ success: true, data, pagination: { page: 1, limit: 20, total: unassignedCount, totalPages: 1 } }));
  });
});
afterEach(() => { cleanup(); client.clear(); focusManager.setFocused(undefined); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.removeItem(STORAGE_KEYS.spaBookOrderView.key); });

function openPage(page: React.ReactNode) {
  render(<QueryClientProvider client={client}>{page}</QueryClientProvider>);
}

function therapist(name: string, id: string, items: BoardItem[] = []): BoardTherapist {
  return {
    therapist: { id, employee_id: `employee-${id}`, full_name: name, nip: null, phone: null, photo_url: null,
      home_branch_id: "branch-1", home_branch_name: "Mizu", gender: "female", is_active: true, level: 0, employment_cycle: 1, employment_status: "contract" },
    shift: { name: "Pagi", start_time: "09:00", end_time: "17:00" }, on_leave: false, items,
  };
}

it("kartu booking online muncul saat badge berubah meskipun jadwal polling halaman berbeda", async () => {
  vi.useFakeTimers();
  board.unassigned = [];
  unassignedCount = 0;
  const view = (showPage: boolean) => (
    <QueryClientProvider client={client}>
      <AppSidebarNav navItems={[{ href: "/dashboard/spa/book-order", label: "Book Order", icon: "calendar" }]} />
      {showPage && <SpaBookOrderPage />}
    </QueryClientProvider>
  );
  const { rerender } = render(view(false));
  await act(async () => { await vi.advanceTimersByTimeAsync(4_100); });
  rerender(view(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.queryByRole("button", { name: /Ayu/ })).not.toBeInTheDocument();

  board = { ...board, unassigned: [item] };
  unassignedCount = 1;
  await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
  expect(within(screen.getByRole("link", { name: /Book Order/ })).getByText("1")).toBeInTheDocument();
  expect(within(screen.getByRole("complementary", { name: "Belum ditugaskan" })).getByRole("button", { name: /Ayu/ })).toBeInTheDocument();
});

it("kartu diperbarui tiap 10 detik dan saat kembali ke tab meskipun jumlah booking tetap", async () => {
  vi.useFakeTimers();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 120_000, refetchOnWindowFocus: false } });
  openPage(<SpaBookOrderPage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByRole("button", { name: /Ayu/ })).toBeInTheDocument();

  board = { ...board, unassigned: [{ ...item, id: "item-2", booking_id: "booking-2", customer_name: "Budi Online" }] };
  await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
  expect(screen.getByRole("button", { name: /Budi Online/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Ayu/ })).not.toBeInTheDocument();

  focusManager.setFocused(false);
  board = { ...board, unassigned: [{ ...item, id: "item-3", booking_id: "booking-3", customer_name: "Citra Online" }] };
  await act(async () => {
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(screen.getByRole("button", { name: /Citra Online/ })).toBeInTheDocument();
});

it("pilihan Kartu yang tersimpan membuka Sheet tanpa menampilkan toggle Kartu", async () => {
  localStorage.setItem(STORAGE_KEYS.spaBookOrderView.key, "cards");
  openPage(<SpaBookOrderPage />);
  expect(screen.getByRole("tab", { name: "Sheet" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("tab", { name: "Kartu" })).not.toBeInTheDocument();
  expect(await screen.findByRole("region", { name: "Jadwal terapis" })).toBeInTheDocument();
});

it.each(["calendar", "list"])("pencarian terapis dan pelanggan bekerja bersama di %s dan dapat direset", async (view) => {
  localStorage.setItem(STORAGE_KEYS.spaBookOrderView.key, view);
  board.therapists = ["Sari", "Dewi"].map((name, index) => ({
    therapist: { id: `therapist-${index}`, employee_id: `employee-${index}`, full_name: name, nip: null, phone: null, photo_url: null,
      home_branch_id: "branch-1", home_branch_name: "Mizu", gender: "female", is_active: true, level: 0, employment_cycle: 1, employment_status: "contract" },
    shift: null, on_leave: false,
    items: [{ ...item, id: `assigned-${index}`, booking_id: `assigned-booking-${index}`, booking_code: `SPA-${index + 2}`,
      customer_name: index === 0 ? "Budi Pelanggan" : "Citra Pelanggan", therapist_id: `therapist-${index}`, therapist_name: name,
      status: "assigned", booking_status: "assigned" }],
  }));
  openPage(<SpaBookOrderPage />);
  await screen.findByText("Citra Pelanggan");
  fireEvent.change(screen.getByRole("searchbox", { name: "Cari terapis" }), { target: { value: "  sArI  " } });
  expect(screen.queryByText("Citra Pelanggan")).not.toBeInTheDocument();
  expect(screen.getByText("Budi Pelanggan")).toBeInTheDocument();
  expect(screen.getByText("Ayu")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox", { name: "Cari pelanggan Book Order" }), { target: { value: " bUdI " } });
  expect(screen.queryByText("Ayu")).not.toBeInTheDocument();
  expect(screen.getByText("Budi Pelanggan")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox", { name: "Cari pelanggan Book Order" }), { target: { value: "Tidak ditemukan" } });
  expect(screen.getByRole("status")).toHaveTextContent("Tidak ada booking yang cocok");
  fireEvent.click(screen.getByRole("button", { name: "Reset pencarian" }));
  expect(screen.getByText("Citra Pelanggan")).toBeInTheDocument();
  expect(screen.getByText("Ayu")).toBeInTheDocument();
});

it("pencarian pelanggan langsung di form tetap mengizinkan input pelanggan baru", async () => {
  openPage(<SpaBookOrderPage />);
  await screen.findByRole("button", { name: /Ayu.*Massage/ });
  fireEvent.click(screen.getByRole("button", { name: "Booking baru" }));
  const bookingDialog = await screen.findByRole("dialog", { name: "Booking baru" });
  expect(within(bookingDialog).getAllByRole("combobox", { name: "Terapis booking" })).toHaveLength(1);
  fireEvent.click(within(bookingDialog).getByRole("button", { name: "Tambah treatment" }));
  expect(within(bookingDialog).getAllByRole("combobox", { name: "Treatment" })).toHaveLength(2);
  expect(within(bookingDialog).getAllByRole("combobox", { name: "Terapis booking" })).toHaveLength(1);
  expect(within(bookingDialog).queryByRole("combobox", { name: "Terapis" })).not.toBeInTheDocument();
  fireEvent.change(within(bookingDialog).getByRole("textbox", { name: "Cari pelanggan" }), { target: { value: "Ayu" } });
  fireEvent.click(await within(bookingDialog).findByRole("button", { name: /Ayu.*081234567890/ }));
  expect(within(bookingDialog).getByDisplayValue("Ayu")).toBeInTheDocument();
  expect(within(bookingDialog).getByDisplayValue("081234567890")).toBeInTheDocument();
  fireEvent.change(within(bookingDialog).getByRole("textbox", { name: "Nama pelanggan" }), { target: { value: "Pelanggan Baru" } });
  expect(within(bookingDialog).getByDisplayValue("Pelanggan Baru")).toBeInTheDocument();
  expect(within(bookingDialog).getByDisplayValue("081234567890")).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});

it("klik treatment di kalender membuka modal lengkap dan mempertahankan tanggal setelah ditutup", async () => {
  openPage(<SpaBookOrderPage />);
  fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: "2026-10-10" } });
  fireEvent.click(await screen.findByRole("button", { name: /Ayu.*Massage/ }));
  const dialog = await screen.findByRole("dialog", { name: "Detail booking" });
  expect(await within(dialog).findByText("Refleksi")).toBeInTheDocument();
  expect(within(dialog).getByText("Riwayat")).toBeInTheDocument();
  expect(within(dialog).queryByRole("link", { name: "Book Order" })).not.toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Tutup" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByLabelText("Tanggal")).toHaveValue("2026-10-10");
});

it("card grup selesai menampilkan aksi checkout POS dan rating semua terapis", async () => {
  detail = { ...detail, group_id: "group-1", status: "completed", therapist_id: "therapist-1", therapist_name: "Sari",
    items: detail.items.map((entry) => ({ ...entry, status: "completed", therapist_id: "therapist-1", therapist_name: "Sari" })) };
  const groupItem = { ...item, group_id: "group-1", status: "completed" as const, booking_status: "completed" as const,
    therapist_id: "therapist-1", therapist_name: "Sari" };
  board.unassigned = [];
  board.therapists = [therapist("Sari", "therapist-1", [groupItem])];
  openPage(<SpaBookOrderPage />);
  fireEvent.click(await screen.findByRole("button", { name: /Ayu.*Massage/ }));
  const detailDialog = await screen.findByRole("dialog", { name: "Detail booking" });
  fireEvent.click(await within(detailDialog).findByRole("button", { name: "Checkout grup ke POS" }));
  const groupDialog = await screen.findByRole("dialog", { name: "Booking bersama" });
  const pay = await within(groupDialog).findByRole("button", { name: "Checkout bersama ke POS" });
  expect(pay).toBeDisabled();
  const stars = within(groupDialog).getAllByRole("button", { name: "5 bintang" });
  fireEvent.click(stars[0]);
  fireEvent.click(stars[1]);
  expect(pay).toBeEnabled();
  fireEvent.click(pay);
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/pos/cashier-new?orderId=order-1&spa=1"));
  expect(writes.at(-1)?.url).toBe("/api/spa/booking-groups/group-1/checkout");
});

it("klik baris treatment di tampilan daftar membuka detail booking lengkap", async () => {
  localStorage.setItem(STORAGE_KEYS.spaBookOrderView.key, "list");
  openPage(<SpaBookOrderPage />);
  fireEvent.click(await screen.findByText("Massage"));
  expect(await within(await screen.findByRole("dialog")).findByText("Refleksi")).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});

it.each(["list", "history"])("kode booking di %s membuka modal yang sama", async (view) => {
  localStorage.setItem(STORAGE_KEYS.spaBookOrderView.key, view === "history" ? "calendar" : view);
  openPage(view === "history" ? <SpaBookingsPage /> : <SpaBookOrderPage />);
  fireEvent.click(await screen.findByRole("button", { name: "SPA-001" }));
  const dialog = await screen.findByRole("dialog", { name: "Detail booking" });
  expect(await within(dialog).findByText("Refleksi")).toBeInTheDocument();
  expect(within(dialog).getByText("Catatan booking")).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});

it("Booking History membuka detail tanpa aksi membuat booking baru", async () => {
  openPage(<SpaBookingsPage />);
  expect(screen.getByRole("heading", { name: "Booking History" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Booking baru/i })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Status layanan"), { target: { value: "unassigned" } });
  fireEvent.click(await screen.findByRole("button", { name: "SPA-001" }));
  const dialog = await screen.findByRole("dialog", { name: "Detail booking" });
  expect(await within(dialog).findByText("Refleksi")).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Tambah treatment" })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("columnheader", { name: "Aksi" })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Tutup" }));
  expect(screen.getByLabelText("Status layanan")).toHaveValue("unassigned");
});

it("detail Booking History hanya menampilkan data dan tautan kembali", async () => {
  detail.items[0] = { ...detail.items[0], status: "assigned", therapist_id: "therapist-1", therapist_name: "Sari" };
  openPage(<SpaBookingDetailPage id="booking-1" readOnly />);
  expect(await screen.findByRole("heading", { name: "SPA-001" })).toBeInTheDocument();
  expect(screen.getByText("Massage")).toBeInTheDocument();
  expect(screen.getByText("Riwayat")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Booking History" })).toHaveAttribute("href", "/dashboard/spa/bookings");
  expect(screen.queryByRole("link", { name: "Book Order" })).not.toBeInTheDocument();
  for (const action of ["Batalkan booking", "Checkout ke POS", "Tambah treatment", "Ganti terapis", "Mulai", "Selesai", "Ubah", "Jadwal", "Batalkan"]) {
    expect(screen.queryByRole("button", { name: action })).not.toBeInTheDocument();
  }
  expect(screen.queryByRole("columnheader", { name: "Aksi" })).not.toBeInTheDocument();
});

it("detail Book Order menampilkan booking dan hanya kembali ke Book Order", async () => {
  openPage(<SpaBookingDetailPage id="booking-1" />);
  expect(await screen.findByRole("heading", { name: "SPA-001" })).toBeInTheDocument();
  expect(screen.getByText("Massage")).toBeInTheDocument();
  expect(screen.getByText("Refleksi")).toBeInTheDocument();
  expect(screen.getByText("081234567890")).toBeInTheDocument();
  expect(screen.getByText("Catatan booking")).toBeInTheDocument();
  expect(screen.getByText("Riwayat")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Booking History" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Book Order" })).toHaveAttribute("href", "/dashboard/spa/book-order");
});

it("modal booking dari daftar memulai dan menyelesaikan seluruh booking dari tombol di header", async () => {
  localStorage.setItem(STORAGE_KEYS.spaBookOrderView.key, "list");
  detail.therapist_id = "therapist-sari";
  detail.therapist_name = "Sari";
  detail.status = "assigned";
  detail.items = detail.items.map((entry) => ({ ...entry, status: "assigned", therapist_id: "therapist-sari", therapist_name: "Sari" }));
  board.unassigned = [];
  board.therapists = [therapist("Sari", "therapist-sari", [{ ...item, therapist_id: "therapist-sari", status: "assigned", booking_status: "assigned" }])];
  openPage(<SpaBookOrderPage />);
  fireEvent.click(await screen.findByRole("button", { name: "SPA-001" }));
  const dialog = await screen.findByRole("dialog", { name: "Detail booking" });
  await within(dialog).findByText("Refleksi");
  const cancel = within(dialog).getByRole("button", { name: "Batalkan booking" });
  const start = within(dialog).getByRole("button", { name: "Mulai" });
  expect(cancel.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(dialog).getAllByRole("button", { name: "Mulai" })).toHaveLength(1);
  fireEvent.click(start);
  await waitFor(() => expect(writes.at(-1)).toEqual({
    url: "/api/spa/bookings/booking-1/status", method: "POST", input: { action: "start" },
  }));
  expect(within(dialog).queryByRole("button", { name: "Batalkan booking" })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Ubah jadwal" })).not.toBeInTheDocument();
  fireEvent.click(await within(dialog).findByRole("button", { name: "Selesai" }));
  await waitFor(() => expect(writes.at(-1)).toEqual({
    url: "/api/spa/bookings/booking-1/status", method: "POST", input: { action: "complete" },
  }));
  expect(within(dialog).queryByRole("button", { name: "Selesai" })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Checkout ke POS" })).toBeEnabled();
});

it("checkout menunggu booking selesai dan rating terapis sebelum membuka POS", async () => {
  detail.therapist_id = "therapist-1";
  detail.therapist_name = "Sari";
  detail.items = detail.items.map((entry) => ({ ...entry, status: "assigned", therapist_id: "therapist-1", therapist_name: "Sari" }));
  detail.status = "assigned";
  openPage(<SpaBookingDetailPage id="booking-1" />);
  const checkout = await screen.findByRole("button", { name: "Checkout ke POS" });
  expect(checkout).toBeDisabled();
  expect(writes).toEqual([]);

  cleanup();
  client.clear();
  detail.status = "completed";
  detail.items = detail.items.map((entry) => ({ ...entry, status: "completed" }));
  openPage(<SpaBookingDetailPage id="booking-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Checkout ke POS" }));
  const survey = await screen.findByRole("dialog", { name: "Survei kepuasan terapis" });
  expect(within(survey).getByText("Sari")).toBeInTheDocument();
  expect(within(survey).getByRole("button", { name: "Lanjut ke POS" })).toBeDisabled();
  expect(writes).toEqual([]);
  fireEvent.click(within(survey).getByRole("button", { name: "4 bintang" }));
  fireEvent.click(within(survey).getByRole("button", { name: "Lanjut ke POS" }));
  await waitFor(() => expect(writes.at(-1)).toEqual({
    url: "/api/spa/bookings/booking-1/checkout", method: "POST", input: { therapist_rating: 4 },
  }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/pos/cashier-new?orderId=order-1&spa=1"));
});

it("tagihan POS yang sudah dibuat memakai rating tersimpan tanpa survei ulang", async () => {
  detail.status = "completed";
  detail.items = detail.items.map((entry) => ({ ...entry, status: "completed" }));
  detail.therapist_id = "therapist-1";
  detail.therapist_name = "Sari";
  detail.therapist_rating = 4;
  detail.pos_order_id = "order-1";
  openPage(<SpaBookingDetailPage id="booking-1" />);
  expect(await screen.findByText("Rating kepuasan 4/5")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Buka tagihan POS" }));
  await waitFor(() => expect(writes.at(-1)).toEqual({
    url: "/api/spa/bookings/booking-1/checkout", method: "POST", input: {},
  }));
  expect(screen.queryByRole("dialog", { name: "Survei kepuasan terapis" })).not.toBeInTheDocument();
});

it("jadwal diubah pada booking, sementara treatment hanya menampilkan durasi dan bisa dihapus", async () => {
  openPage(<SpaBookingDetailPage id="booking-1" />);
  await screen.findByText("Refleksi");
  expect(screen.getByRole("columnheader", { name: "Durasi" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Jadwal" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Batalkan" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Hapus" })).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: "Ubah jadwal" }));
  const schedule = await screen.findByRole("dialog", { name: "Ubah jadwal booking" });
  fireEvent.change(within(schedule).getByLabelText("Mulai booking (WIB)"), { target: { value: "2026-10-10T11:30" } });
  fireEvent.click(within(schedule).getByRole("button", { name: "Simpan" }));
  await waitFor(() => expect(writes.at(-1)).toEqual({
    url: "/api/spa/bookings/booking-1", method: "PATCH", input: { scheduled_at: "2026-10-10T04:30:00.000Z" },
  }));

  fireEvent.click(screen.getAllByRole("button", { name: "Hapus" })[0]);
  const remove = await screen.findByRole("dialog", { name: "Hapus Massage dari booking?" });
  fireEvent.click(within(remove).getByRole("button", { name: "Hapus treatment" }));
  await waitFor(() => expect(writes.at(-1)).toEqual({
    url: "/api/spa/bookings/booking-1/items/item-1", method: "PATCH", input: { action: "cancel" },
  }));
});

it("aksi ganti terapis dari modal lama tetap tersedia pada halaman detail", async () => {
  detail.therapist_id = "therapist-1";
  detail.therapist_name = "Sari";
  detail.items[0] = { ...detail.items[0], status: "assigned", therapist_id: "therapist-1", therapist_name: "Sari" };
  openPage(<SpaBookingDetailPage id="booking-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Ganti terapis" }));
  expect(within(await screen.findByRole("dialog")).getByText(/Seluruh treatment dalam booking/)).toBeInTheDocument();
  await waitFor(() => expect(requested.some((url) => url.startsWith("/api/spa/availability?") && url.includes("booking_id=booking-1"))).toBe(true));
});

it("penugasan hanya tersedia sekali untuk seluruh booking dan terkunci setelah treatment selesai", async () => {
  detail.therapist_id = "therapist-1";
  detail.therapist_name = "Sari";
  detail.items = detail.items.map((it) => ({ ...it, therapist_id: "therapist-1", therapist_name: "Sari", status: "assigned" }));
  openPage(<SpaBookingDetailPage id="booking-1" />);
  expect(await screen.findAllByRole("button", { name: "Ganti terapis" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Lepas terapis" })).toHaveLength(1);
  expect(screen.queryByRole("columnheader", { name: "Terapis" })).not.toBeInTheDocument();
  cleanup();
  client.clear();
  detail.items[0].status = "completed";
  openPage(<SpaBookingDetailPage id="booking-1" />);
  await screen.findByText("Refleksi");
  expect(screen.queryByRole("button", { name: "Ganti terapis" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Lepas terapis" })).not.toBeInTheDocument();
});


it.each([false, true])("only shows room action with server permission %s", async (allowed) => {
  detail = { ...detail, can_change_room: allowed };
  openPage(<SpaBookingDetailPage id="booking-1" />);
  await screen.findByText("Catatan booking");
  const button = screen.queryByRole("button", { name: "Pilih room" });
  if (allowed) expect(button).toBeInTheDocument();
  else expect(button).not.toBeInTheDocument();
});

it("hides room action when completed even before checkout", async () => {
  detail = { ...detail, can_change_room: true, status: "completed", checked_out_at: null };
  openPage(<SpaBookingDetailPage id="booking-1" />);
  await screen.findByText("Catatan booking");
  expect(screen.queryByRole("button", { name: "Pilih room" })).not.toBeInTheDocument();
});
