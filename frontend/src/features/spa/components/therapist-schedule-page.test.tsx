import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmployeeShiftScheduleRow } from "@/features/users/api";
import { usersQueryKeys } from "@/features/users/query-keys";
import { TherapistSchedulePage } from "./therapist-schedule-page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/dates", () => ({ todayWib: () => "2026-10-16" }));
afterEach(() => vi.unstubAllGlobals());

const shifts = [
  { id: "s1", name: "Shift Siang", start_time: "09:00", end_time: "17:00", is_active: true },
  { id: "s2", name: "Shift Malam", start_time: "13:00", end_time: "22:00", is_active: true },
  { id: "s3", name: "Shift Pagi", start_time: "06:00", end_time: "14:00", is_active: true },
  { id: "s4", name: "Shift Malam", start_time: "22:00", end_time: "06:00", is_active: true },
];
const therapists = ["Ayu", "Sari", "Budi"].map((name, index) => ({ id: `t${index + 1}`, employee_id: `e${index + 1}`, full_name: name, nip: `00${index + 1}`, home_branch_id: "b1", is_active: true }));
function row(day: number, shiftId: string | null, from = "2026-10-01", to: string | null = null): EmployeeShiftScheduleRow {
  const shift = shifts.find((shift) => shift.id === shiftId);
  return { id: `${day}-${from}`, day_of_week: day, shift_id: shiftId, effective_from: from, effective_to: to, shift_name: shift?.name ?? null, start_time: shift?.start_time ?? null, end_time: shift?.end_time ?? null };
}
type Payload = { effective_from: string; days: { day_of_week: number; shift_id: string | null }[] };

function setup({ failedRead = "", failedWrite = "", cached = false, wireDates = false, shiftOptions = shifts,
  dayOffRequests = [] as { therapist_id: string; date: string; status: string }[] } = {}) {
  const history: Record<string, EmployeeShiftScheduleRow[]> = {
    e1: [row(1, "s1"), row(2, "s1"), row(5, "s1", "2026-10-01", "2026-10-14"), row(5, "s2", "2026-10-15")],
    e2: [],
    e3: Array.from({ length: 7 }, (_, index) => row(index + 1, null)),
  };
  const writes: { employeeId: string; payload: Payload }[] = [];
  if (wireDates) history.e1 = [row(1, "s1", "2026-10-12T00:00:00.000Z"), row(2, "s2", "2026-10-12T17:00:00.000Z")];
  let rejectedEmployee = failedWrite;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const employeeId = url.match(/\/api\/hris\/employees\/(e\d)\/shifts/)?.[1];
    if (employeeId && init?.method === "PUT") {
      const payload = JSON.parse(String(init.body)) as Payload;
      writes.push({ employeeId, payload });
      if (employeeId === rejectedEmployee) return Promise.resolve(new Response(JSON.stringify({ success: false, error: "Gagal menyimpan" }), { status: 500 }));
      history[employeeId] = [
        ...history[employeeId].filter((item) => item.effective_from < payload.effective_from).map((item) => ({ ...item, effective_to: "2026-10-11" })),
        ...payload.days.map((day) => row(day.day_of_week, day.shift_id, payload.effective_from)),
      ];
      return Promise.resolve(new Response(JSON.stringify({ success: true, message: "Disimpan" }), { status: 200 }));
    }
    if (employeeId === failedRead) return Promise.resolve(new Response(JSON.stringify({ success: false, error: "Akses ditolak" }), { status: 403 }));
    const data = employeeId ? history[employeeId].map((item) => ({ ...item,
      shift_name: shiftOptions.find((shift) => shift.id === item.shift_id)?.name ?? null,
    }))
      : url.startsWith("/api/spa/outlets") ? [{ branch_id: "b1", branch_name: "Mizu Dago", configured: true, is_active: true }]
      : url.startsWith("/api/spa/therapists") ? therapists
      : url.startsWith("/api/spa/day-offs") ? { requests: dayOffRequests }
      : url === "/api/hris/shifts" ? shiftOptions : [];
    return Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }));
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (cached) client.setQueryData(usersQueryKeys.shiftSchedule("e1"), history.e1);
  render(<QueryClientProvider client={client}><TherapistSchedulePage /></QueryClientProvider>);
  return { writes, allowWrites: () => { rejectedEmployee = ""; } };
}

async function ready() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Atur mapping" })).toBeEnabled());
}

describe("TherapistSchedulePage", () => {
  it("offers every active HRIS shift with its current hours", async () => {
    setup({ shiftOptions: [
      { id: "s1", name: "Shift Siang", start_time: "10:00", end_time: "16:00", is_active: true },
      { id: "s2", name: "Shift Malam", start_time: "16:00", end_time: "22:00", is_active: true },
      { id: "s3", name: "Shift Pagi", start_time: "06:00", end_time: "14:00", is_active: true },
      { id: "s4", name: "Shift Siang", start_time: "09:00", end_time: "17:00", is_active: false },
    ] });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Atur Ayu, Senin 12 Okt 2026" }));
    const shift = within(screen.getByRole("dialog")).getByRole("combobox", { name: "Shift" });
    expect(within(shift).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Shift Siang · 10:00–16:00", "Shift Malam · 16:00–22:00", "Shift Pagi · 06:00–14:00",
    ]);
  });

  it("marks only approved day-off requests as libur", async () => {
    setup({ dayOffRequests: [
      { therapist_id: "t1", date: "2026-10-16", status: "approved" },
      { therapist_id: "t2", date: "2026-10-16", status: "cancelled" },
    ] });
    await ready();
    expect(await screen.findByRole("button", { name: "Atur Ayu, Jumat 16 Okt 2026" })).toHaveTextContent("Libur disetujui");
    expect(screen.getByRole("button", { name: "Atur Sari, Jumat 16 Okt 2026" })).not.toHaveTextContent("Libur disetujui");
    expect(screen.getByRole("button", { name: "Atur Budi, Jumat 16 Okt 2026" })).toHaveTextContent("Belum diatur");
  });

  it("can replace an inactive legacy shift with an active evening shift", async () => {
    const shiftOptions = shifts.map((shift) => ({ ...shift,
      name: shift.id === "s1" ? "Shift Pagi (lama)" : shift.id === "s2" ? "Shift Siang" : shift.name,
      is_active: shift.id !== "s1" && shift.id !== "s3",
    }));
    const { writes } = setup({ shiftOptions });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Atur Ayu, Senin 12 Okt 2026" }));
    const dialog = within(screen.getByRole("dialog"));
    const shift = dialog.getByRole("combobox", { name: "Shift" });
    expect(shift).toHaveValue("s2");
    expect(within(shift).getByRole("option", { name: /Shift Siang/ })).toBeInTheDocument();
    expect(within(shift).getByRole("option", { name: /Shift Malam/ })).toBeInTheDocument();
    fireEvent.change(shift, { target: { value: "s4" } });
    fireEvent.click(dialog.getByRole("button", { name: "Simpan shift" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].payload.days[0]).toEqual({ day_of_week: 1, shift_id: "s4" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Atur Ayu, Senin 12 Okt 2026" })).toHaveTextContent("Shift Malam"));
  });

  it("does not save an unintended day off when spa shift options are unavailable", async () => {
    const { writes } = setup({ shiftOptions: [] });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Atur Ayu, Senin 12 Okt 2026" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("alert")).toHaveTextContent("Belum ada shift aktif");
    expect(dialog.getByRole("button", { name: "Simpan shift" })).toBeDisabled();
    expect(writes).toHaveLength(0);
  });

  it("shows mapping on its first effective date when the API serializes dates as timestamps", async () => {
    setup({ wireDates: true });
    await ready();
    expect(screen.getByRole("button", { name: "Atur Ayu, Senin 12 Okt 2026" })).toHaveTextContent("Shift Siang");
    expect(screen.getByRole("button", { name: "Atur Ayu, Selasa 13 Okt 2026" })).toHaveTextContent("Shift Malam");
  });

  it("shows dated shifts and treats null patterns as unassigned, including shared employee cache and effective ranges", async () => {
    setup({ cached: true });
    await ready();
    expect(screen.getByRole("button", { name: "Atur Ayu, Senin 12 Okt 2026" })).toHaveTextContent("09:00–17:00");
    expect(screen.getByRole("button", { name: "Atur Ayu, Jumat 16 Okt 2026" })).toHaveTextContent("Shift Malam");
    expect(screen.getByRole("button", { name: "Atur Sari, Senin 12 Okt 2026" })).toHaveTextContent("Belum diatur");
    expect(screen.getByRole("button", { name: "Atur Budi, Senin 12 Okt 2026" })).toHaveTextContent("Belum diatur");
    fireEvent.click(screen.getByRole("button", { name: "Minggu sebelumnya" }));
    expect(screen.getByRole("button", { name: "Atur Ayu, Jumat 9 Okt 2026" })).toHaveTextContent("Shift Siang");
    fireEvent.change(screen.getByRole("textbox", { name: "Cari terapis" }), { target: { value: "002" } });
    expect(screen.queryByRole("rowheader", { name: /Ayu/ })).not.toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /Sari/ })).toBeInTheDocument();
  });

  it("saves only selected therapists and immediately shows the mapping in its effective week", async () => {
    const { writes } = setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Atur mapping" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("combobox", { name: "Shift" })).toHaveTextContent("Shift Siang");
    expect(dialog.getByRole("combobox", { name: "Shift" })).toHaveTextContent("Shift Malam");
    expect(dialog.getByRole("combobox", { name: "Shift" })).toHaveTextContent("Shift Pagi");
    expect(within(dialog.getByRole("combobox", { name: "Shift" })).getAllByRole("option")).toHaveLength(4);
    fireEvent.change(dialog.getByRole("combobox", { name: "Hari" }), { target: { value: "1" } });
    fireEvent.change(dialog.getByLabelText("Berlaku mulai"), { target: { value: "2026-10-19" } });
    fireEvent.click(dialog.getByRole("checkbox", { name: /^Pilih Sari/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Simpan mapping" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes).toHaveLength(1);
    expect(writes[0].employeeId).toBe("e2");
    expect(writes[0].payload.days[0]).toEqual({ day_of_week: 1, shift_id: "s1" });
    expect(screen.getByRole("button", { name: "Atur Sari, Senin 19 Okt 2026" })).toHaveTextContent("Shift Siang09:00–17:00");
  });

  it("changes one cell to another active shift while preserving shifts on other days", async () => {
    const { writes } = setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Atur Ayu, Senin 12 Okt 2026" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("heading", { name: "Atur shift — Ayu" })).toBeInTheDocument();
    expect(dialog.queryByText(/Terapis yang akan diubah/)).not.toBeInTheDocument();
    expect(dialog.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(dialog.getByText(/Saat ini:/)).toHaveTextContent("Shift Siang");
    expect(dialog.getByRole("combobox", { name: "Shift" })).not.toHaveTextContent("Libur pola");
    fireEvent.change(dialog.getByRole("combobox", { name: "Shift" }), { target: { value: "s2" } });
    fireEvent.click(dialog.getByRole("button", { name: "Simpan shift" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes).toHaveLength(1);
    expect(writes[0].payload.days.slice(0, 2)).toEqual([{ day_of_week: 1, shift_id: "s2" }, { day_of_week: 2, shift_id: "s1" }]);
    expect(screen.getByRole("button", { name: "Atur Ayu, Senin 12 Okt 2026" })).toHaveTextContent("Shift Malam");
  });

  it("shows a schedule read error instead of incorrectly claiming it has no mapping", async () => {
    setup({ failedRead: "e2" });
    expect(await screen.findByRole("button", { name: "Muat ulang Sari" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atur mapping" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Atur Sari,/ })).not.toBeInTheDocument();
  });

  it("keeps partial failures visible and retries only changes not yet saved", async () => {
    const { writes, allowWrites } = setup({ failedWrite: "e2" });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Atur mapping" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Pilih semua" }));
    fireEvent.click(dialog.getByRole("button", { name: "Simpan mapping" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("2 dari 3 perubahan tersimpan. Gagal menyimpan: Sari");
    allowWrites();
    fireEvent.click(dialog.getByRole("button", { name: "Simpan mapping" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes.map((write) => write.employeeId)).toEqual(["e1", "e2", "e3", "e2"]);
  });
});
