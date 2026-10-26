import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ArrivalQueue, BoardItem, BoardTherapist } from "../types";
import { BookOrderCalendar } from "./book-order-calendar";
import { PX_PER_MIN } from "../calendar";

const item: BoardItem = {
  group_id: null,
  id: "item-1", booking_id: "booking-1", booking_code: "SPA-001", customer_name: "Ayu",
  booking_status: "unassigned", therapist_gender_pref: "any", variant_id: "variant-1", treatment_name: "Massage", variant_name: "60 menit",
  duration_min: 60, price_idr: 200000, therapist_id: null, therapist_name: null,
  starts_at: "2026-10-09T03:00:00Z", ends_at: "2026-10-09T04:00:00Z", status: "unassigned",
  started_at: null, completed_at: null, commission_idr: null,
};
const therapist: BoardTherapist = {
  therapist: { id: "therapist-1", employee_id: "employee-1", full_name: "Sari", nip: null, phone: null,
    photo_url: null, home_branch_id: "branch-1", home_branch_name: "Mizu", gender: "female", is_active: true, level: 0, employment_cycle: 1, employment_status: "contract" },
  shift: { name: "Pagi", start_time: "09:00", end_time: "17:00" }, on_leave: false, items: [],
};
let client: QueryClient;
let writes: { url: string; method: string | undefined; input: unknown }[];

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  writes = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    writes.push({ url, method: init?.method, input: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ success: true, data: { booking_id: "booking-1", booking_code: "SPA-001", therapist_id: "therapist-1", therapist_name: "Sari" } }));
  });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

function openCalendar(rows = [therapist], unassigned = [item], arrivalQueue?: ArrivalQueue, onSlot = vi.fn()) {
  const onOpenItem = vi.fn();
  render(<QueryClientProvider client={client}>
    <BookOrderCalendar date="2026-10-09" therapists={rows} unassigned={unassigned} arrivalQueue={arrivalQueue}
      onOpenItem={onOpenItem} onSlot={onSlot} />
  </QueryClientProvider>);
  return onOpenItem;
}

it("area tambahan satu jam berbeda dari tanpa shift dan hanya untuk penyelesaian", () => {
  const noShift = { ...therapist, therapist: { ...therapist.therapist, id: "no-shift", full_name: "Tanpa Jadwal" }, shift: null };
  openCalendar([therapist, noShift]);
  expect(screen.getByText("Perpanjangan shift +1 jam")).toBeInTheDocument();
  expect(screen.getByText("Hanya penyelesaian treatment")).toBeInTheDocument();
  const column = screen.getByText("Sari").closest("[data-therapist-id]")!;
  const extension = column.querySelector('[data-shift-band="extension"]')!;
  expect(extension).toHaveStyle({ top: `${480 * PX_PER_MIN}px`, height: `${60 * PX_PER_MIN}px` });
  expect(extension).toHaveClass("bg-amber-100/70", "pointer-events-none");
  expect(screen.getByText("Tanpa Jadwal").closest("[data-therapist-id]")!.querySelector('[data-shift-band="extension"]')).toBeNull();
});

it.each([{ on_leave: true }, { day_off: true }])("cuti/libur tidak mendapat area tambahan %o", (state) => {
  openCalendar([{ ...therapist, ...state }]);
  expect(screen.getByText("Sari").closest("[data-therapist-id]")!.querySelector('[data-shift-band="extension"]')).toBeNull();
});

it("klik slot sebelum akhir shift membuka booking, tepat akhir atau sesudahnya tidak", () => {
  const onSlot = vi.fn();
  openCalendar([{ ...therapist, shift: { name: "Pagi", start_time: "09:00", end_time: "16:00" } }], [], undefined, onSlot);
  const column = screen.getByText("Sari").closest(".sticky")!.nextElementSibling!;
  fireEvent.click(column, { clientY: (15 * 60 + 30 - 9 * 60) * PX_PER_MIN });
  expect(onSlot).toHaveBeenCalledWith({ therapistId: "therapist-1", time: "15:30" });
  fireEvent.click(column, { clientY: (16 * 60 - 9 * 60) * PX_PER_MIN });
  fireEvent.click(column, { clientY: (16 * 60 + 30 - 9 * 60) * PX_PER_MIN });
  expect(onSlot).toHaveBeenCalledTimes(1);
});

it.each([
  ["08:30", "10:00", true], // 15:30–17:00 WIB
  ["09:00", "09:30", false], // 16:00–16:30 WIB
  ["09:30", "10:00", false], // 16:30–17:00 WIB
  ["08:30", "10:01", false], // 15:30–17:01 WIB
])("pindah terapis %s–%s UTC diterima=%s", async (start, end, accepted) => {
  const assigned: BoardItem = { ...item, status: "assigned", booking_status: "assigned", therapist_id: "source", starts_at: `2026-10-09T${start}:00Z`, ends_at: `2026-10-09T${end}:00Z` };
  const source = { ...therapist, therapist: { ...therapist.therapist, id: "source", full_name: "Dewi" }, items: [assigned] };
  openCalendar([source, { ...therapist, shift: { name: "Pagi", start_time: "09:00", end_time: "16:00" } }], []);
  dragToTherapist(screen.getByRole("button", { name: /Ayu/ }));
  if (accepted) {
    await waitFor(() => expect(writes).toEqual([{ url: "/api/spa/bookings/booking-1/therapist", method: "PUT", input: { therapist_id: "therapist-1" } }]));
  } else {
    await act(async () => {});
    expect(writes).toEqual([]);
  }
});

function dragToTherapist(button: HTMLElement, target?: HTMLElement) {
  const values = new Map<string, string>();
  const dataTransfer = {
    types: ["application/x-mizu-item"], effectAllowed: "", dropEffect: "",
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? "",
  };
  fireEvent.dragStart(button, { dataTransfer });
  const column = target ?? screen.getByText("Sari").closest(".sticky")!.nextElementSibling!;
  fireEvent.dragOver(column, { dataTransfer });
  fireEvent.drop(column, { dataTransfer });
}

it("drop dari Belum ditugaskan mengirim kolom tujuan untuk divalidasi antrian", async () => {
  const onOpenItem = openCalendar();
  const sidebar = screen.getByRole("complementary", { name: "Belum ditugaskan" });
  const schedule = screen.getByRole("region", { name: "Jadwal terapis" });
  expect(schedule).not.toContainElement(sidebar);
  const button = within(sidebar).getByRole("button", { name: /Ayu/ });
  expect(button).toHaveAttribute("draggable", "true");
  fireEvent.click(button);
  expect(onOpenItem).toHaveBeenCalledWith(item);
  dragToTherapist(button);
  await waitFor(() => expect(writes).toEqual([{
    url: "/api/spa/bookings/booking-1/auto-assign", method: "POST",
    input: { therapist_id: "therapist-1" },
  }]));
});

it("target kolom cuti tetap dikirim untuk divalidasi server", async () => {
  openCalendar([{ ...therapist, on_leave: true }]);
  dragToTherapist(within(screen.getByRole("complementary", { name: "Belum ditugaskan" })).getByRole("button", { name: /Ayu/ }));
  await waitFor(() => expect(writes[0]?.input).toEqual({ therapist_id: "therapist-1" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("target kolom di luar shift dikirim untuk divalidasi server", async () => {
  openCalendar([{ ...therapist, shift: { name: "Siang", start_time: "13:00", end_time: "17:00" } }]);
  dragToTherapist(within(screen.getByRole("complementary", { name: "Belum ditugaskan" })).getByRole("button", { name: /Ayu/ }));
  await waitFor(() => expect(writes[0]?.input).toEqual({ therapist_id: "therapist-1" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("target kolom beda gender dikirim untuk divalidasi server", async () => {
  openCalendar([therapist], [{ ...item, therapist_gender_pref: "male" }]);
  dragToTherapist(within(screen.getByRole("complementary", { name: "Belum ditugaskan" })).getByRole("button", { name: /Ayu/ }));
  await waitFor(() => expect(writes[0]?.input).toEqual({ therapist_id: "therapist-1" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("kolom mengikuti posisi prioritas dan ikut berpindah saat antrian berotasi", () => {
  const dewi = { ...therapist, therapist: { ...therapist.therapist, id: "therapist-2", full_name: "Dewi" } };
  const absent = { ...therapist, therapist: { ...therapist.therapist, id: "therapist-3", full_name: "Ani" } };
  const assigned = { ...therapist, items: [{ ...item, status: "assigned" as const, therapist_id: therapist.therapist.id }] };
  const rows = [absent, assigned, dewi];
  const queue: ArrivalQueue = {
    branch_id: "branch-1", date: "2026-10-09",
    queue: [
      { ...therapist.therapist, present: true, clock_in: "2026-10-09T01:30:00Z", last_assigned_at: "2026-10-09T03:00:00Z", assigned_today: 1, position: 2 },
      { ...dewi.therapist, present: true, clock_in: "2026-10-09T01:45:00Z", last_assigned_at: null, assigned_today: 0, position: 1 },
    ],
    absent: [{ ...absent.therapist, present: false, clock_in: null, last_assigned_at: null, assigned_today: 0, position: 0 }],
  };
  const calendar = (arrivalQueue: ArrivalQueue) => <QueryClientProvider client={client}>
    <BookOrderCalendar date="2026-10-09" therapists={rows} unassigned={[]} arrivalQueue={arrivalQueue}
      onOpenItem={() => {}} onSlot={() => {}} />
  </QueryClientProvider>;
  const { rerender } = render(calendar(queue));
  const schedule = screen.getByRole("region", { name: "Jadwal terapis" });
  let columns = Array.from(schedule.querySelectorAll("[data-therapist-id]"));
  expect(columns.map((node) => node.getAttribute("data-therapist-id"))).toEqual(["therapist-2", "therapist-1", "therapist-3"]);
  expect(columns[0]).toHaveTextContent("Prioritas 1");
  expect(columns[1]).toHaveTextContent("Prioritas 2");
  expect(columns[1]).toHaveTextContent("Ayu");
  expect(columns[2]).toHaveTextContent("Belum absen");

  rerender(calendar({ ...queue, queue: [
    { ...queue.queue[0], position: 1 },
    { ...queue.queue[1], position: 2, assigned_today: 1, last_assigned_at: "2026-10-09T04:00:00Z" },
  ] }));
  columns = Array.from(schedule.querySelectorAll("[data-therapist-id]"));
  expect(columns.map((node) => node.getAttribute("data-therapist-id"))).toEqual(["therapist-1", "therapist-2", "therapist-3"]);
  expect(columns[0]).toHaveTextContent("Prioritas 1");
  expect(columns[0]).toHaveTextContent("Ayu");
  expect(columns[1]).toHaveTextContent("Prioritas 2");
  expect(rows.map((row) => row.therapist.id)).toEqual(["therapist-3", "therapist-1", "therapist-2"]);
});

it.each([false, true])("urutan tanpa antrian tersedia tetap deterministik (data tersedia: %s)", (hasQueue) => {
  const dewi = { ...therapist, therapist: { ...therapist.therapist, id: "therapist-2", full_name: "Dewi" } };
  const otherDewi = { ...dewi, therapist: { ...dewi.therapist, id: "therapist-3" } };
  openCalendar([therapist, otherDewi, dewi], [], hasQueue
    ? { branch_id: "branch-1", date: "2026-10-09", queue: [], absent: [] }
    : undefined);
  const columns = screen.getByRole("region", { name: "Jadwal terapis" }).querySelectorAll("[data-therapist-id]");
  expect(Array.from(columns, (node) => node.getAttribute("data-therapist-id"))).toEqual(
    hasQueue ? ["therapist-2", "therapist-3", "therapist-1"] : ["therapist-1", "therapist-3", "therapist-2"],
  );
});

it("tetap dapat memindahkan treatment dari kolom terapis lain", async () => {
  const assigned = { ...item, status: "assigned" as const, therapist_id: "therapist-2" };
  openCalendar([therapist, {
    ...therapist, therapist: { ...therapist.therapist, id: "therapist-2", full_name: "Dewi" }, items: [assigned],
  }], []);
  dragToTherapist(screen.getByRole("button", { name: /Ayu/ }));
  await waitFor(() => expect(writes[0]?.input).toEqual({ therapist_id: "therapist-1" }));
});

it("menggunakan avatar inisial saat foto terapis gagal dimuat", () => {
  openCalendar([{ ...therapist, therapist: { ...therapist.therapist, photo_url: "https://example.com/photos/sari.jpg" } }]);
  const photo = screen.getByRole("img", { name: "Foto Sari" });
  expect(photo).toHaveAttribute("src", "https://example.com/photos/sari.jpg");
  fireEvent.error(photo);
  expect(screen.queryByRole("img", { name: "Foto Sari" })).not.toBeInTheDocument();
  expect(screen.getByText("S")).toBeInTheDocument();
  expect(screen.getByText("Sari")).toBeInTheDocument();
});

it("menampilkan garis dan jam slot 15 menit yang sama dengan hasil klik", () => {
  const onSlot = vi.fn();
  render(<QueryClientProvider client={client}>
    <BookOrderCalendar date="2026-10-09" therapists={[therapist]} unassigned={[]}
      onOpenItem={() => {}} onSlot={onSlot} />
  </QueryClientProvider>);
  const column = screen.getByText("Sari").closest(".sticky")!.nextElementSibling!;
  const clientY = 93 * PX_PER_MIN;
  fireEvent.mouseMove(column, { clientY });
  const label = within(column as HTMLElement).getByText("10:30");
  expect(label.parentElement).toHaveStyle({ top: `${90 * PX_PER_MIN}px` });
  fireEvent.click(column, { clientY });
  expect(onSlot).toHaveBeenCalledWith({ therapistId: "therapist-1", time: "10:30" });
  fireEvent.mouseLeave(column);
  expect(within(column as HTMLElement).queryByText("10:30")).not.toBeInTheDocument();
});

it.each([{ label: "kosong", unassigned: [] }, { label: "berisi", unassigned: [item] }])("melepas terapis saat treatment di-drop kembali ke card kiri ($label)", async ({ unassigned }) => {
  const assigned = { ...item, id: "assigned-1", status: "assigned" as const, therapist_id: "therapist-1", booking_status: "assigned" as const };
  openCalendar([{ ...therapist, items: [assigned] }], unassigned);
  const sidebar = screen.getByRole("complementary", { name: "Belum ditugaskan" });
  const schedule = screen.getByRole("region", { name: "Jadwal terapis" });
  dragToTherapist(within(schedule).getByRole("button", { name: /Ayu/ }), sidebar);
  await waitFor(() => expect(writes).toEqual([{
    url: "/api/spa/bookings/booking-1/therapist", method: "PUT", input: { therapist_id: null },
  }]));
});

it.each([
  { ...item, status: "assigned" as const, therapist_id: "therapist-1", assignment_locked: true },
  { ...item, status: "in_treatment" as const, therapist_id: "therapist-1" },
  { ...item, status: "completed" as const, therapist_id: "therapist-1" },
  { ...item, status: "assigned" as const, therapist_id: "therapist-1", booking_status: "expired" as const },
  item,
])("mengabaikan drop balik untuk treatment yang tidak bisa dilepas (%j)", async (blocked) => {
  openCalendar([{ ...therapist, items: blocked.therapist_id ? [blocked] : [] }], blocked.therapist_id ? [] : [blocked]);
  await act(async () => {
    dragToTherapist(screen.getByRole("button", { name: /Ayu/ }), screen.getByRole("complementary", { name: "Belum ditugaskan" }));
  });
  expect(writes).toEqual([]);
});
