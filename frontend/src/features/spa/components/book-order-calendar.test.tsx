import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BoardItem, BoardTherapist } from "../types";
import { BookOrderCalendar } from "./book-order-calendar";
import { PX_PER_MIN } from "../calendar";

const item: BoardItem = {
  id: "item-1", booking_id: "booking-1", booking_code: "SPA-001", customer_name: "Ayu",
  booking_status: "unassigned", therapist_gender_pref: "any", variant_id: "variant-1", treatment_name: "Massage", variant_name: "60 menit",
  duration_min: 60, price_idr: 200000, therapist_id: null, therapist_name: null,
  starts_at: "2026-10-09T03:00:00Z", ends_at: "2026-10-09T04:00:00Z", status: "unassigned",
  started_at: null, completed_at: null, commission_idr: null,
};
const therapist: BoardTherapist = {
  therapist: { id: "therapist-1", employee_id: "employee-1", full_name: "Sari", nip: null, phone: null,
    photo_url: null, home_branch_id: "branch-1", home_branch_name: "Mizu", gender: "female", is_active: true },
  shift: { name: "Pagi", start_time: "09:00", end_time: "17:00" }, on_leave: false, items: [],
};
let client: QueryClient;
let writes: { url: string; method: string | undefined; input: unknown }[];

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  writes = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    writes.push({ url, method: init?.method, input: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ success: true, data: null }));
  });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

function openCalendar(rows = [therapist], unassigned = [item]) {
  const onOpenItem = vi.fn();
  render(<QueryClientProvider client={client}>
    <BookOrderCalendar date="2026-10-09" therapists={rows} unassigned={unassigned}
      onOpenItem={onOpenItem} onSlot={() => {}} />
  </QueryClientProvider>);
  return onOpenItem;
}

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

it("menugaskan treatment dari card terpisah ke kalender tanpa mengubah jadwal", async () => {
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
    url: "/api/spa/bookings/booking-1/therapist", method: "PUT",
    input: { therapist_id: "therapist-1" },
  }]));
});

it("tetap meminta konfirmasi sebelum drop ke terapis yang cuti", async () => {
  openCalendar([{ ...therapist, on_leave: true }]);
  dragToTherapist(within(screen.getByRole("complementary", { name: "Belum ditugaskan" })).getByRole("button", { name: /Ayu/ }));
  expect(writes).toEqual([]);
  expect(await screen.findByRole("dialog")).toHaveTextContent("Terapis sedang cuti");
  fireEvent.click(screen.getByRole("button", { name: "Tetap tugaskan" }));
  await waitFor(() => expect(writes).toHaveLength(1));
});

it("menolak drop booking yang berada di luar shift terapis", () => {
  openCalendar([{ ...therapist, shift: { name: "Siang", start_time: "13:00", end_time: "17:00" } }]);
  dragToTherapist(within(screen.getByRole("complementary", { name: "Belum ditugaskan" })).getByRole("button", { name: /Ayu/ }));
  expect(writes).toEqual([]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("menolak drop bila gender terapis tidak sesuai preferensi booking", () => {
  openCalendar([therapist], [{ ...item, therapist_gender_pref: "male" }]);
  dragToTherapist(within(screen.getByRole("complementary", { name: "Belum ditugaskan" })).getByRole("button", { name: /Ayu/ }));
  expect(writes).toEqual([]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
