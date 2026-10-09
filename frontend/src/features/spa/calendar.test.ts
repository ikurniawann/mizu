import { describe, expect, it } from "vitest";
import {
  availabilityWarning,
  clockOf,
  dayRange,
  hourMarks,
  isDraggable,
  layoutColumn,
  minuteAtOffset,
  minuteOfDay,
  nowOffset,
  offShiftBands,
  PX_PER_MIN,
} from "./calendar";

// 2026-10-09 10:00 WIB = 03:00Z
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 9, h - 7, m)).toISOString();
};
const item = (id: string, start: string, end: string, buffer = 15) => ({ id, starts_at: at(start), ends_at: at(end), buffer_min: buffer });

describe("rentang & jam", () => {
  it("minuteOfDay dalam WIB", () => {
    expect(minuteOfDay(at("10:30"))).toBe(630);
  });
  it("jam buka–tutup, dibulatkan ke jam penuh", () => {
    expect(dayRange("10:00", "22:00")).toEqual({ start: 600, end: 1320 });
    expect(dayRange("09:30", "21:15")).toEqual({ start: 540, end: 1320 });
  });
  it("diperlebar oleh treatment di luar jam (termasuk jeda)", () => {
    expect(dayRange("10:00", "22:00", [item("a", "09:15", "10:15"), item("b", "21:30", "22:30", 20)])).toEqual({ start: 540, end: 1380 });
  });
  it("bawaan bila jam outlet kosong", () => {
    expect(dayRange(null, null)).toEqual({ start: 540, end: 1320 });
  });
  it("garis jam", () => {
    expect(hourMarks({ start: 600, end: 780 })).toEqual([600, 660, 720, 780]);
  });
});

describe("layoutColumn", () => {
  const range = { start: 600, end: 1320 };
  it("posisi & tinggi blok + jeda", () => {
    const [p] = layoutColumn([item("a", "11:00", "12:30")], range);
    expect(p.top).toBe(60 * PX_PER_MIN);
    expect(p.height).toBe(90 * PX_PER_MIN);
    expect(p.bufferHeight).toBe(15 * PX_PER_MIN);
    expect([p.lane, p.lanes]).toEqual([0, 1]);
  });
  it("tumpang-tindih dibagi lajur, yang berurutan tetap satu lajur", () => {
    const placed = layoutColumn(
      [item("a", "10:00", "11:00"), item("b", "10:30", "11:30"), item("c", "13:00", "14:00"), item("d", "11:15", "12:00", 0)],
      range
    );
    const by = Object.fromEntries(placed.map((p) => [p.item.id, [p.lane, p.lanes]]));
    expect(by.a).toEqual([0, 2]);
    expect(by.b).toEqual([1, 2]);
    expect(by.d).toEqual([0, 2]); // lajur a kosong lagi setelah 11:15 (a + jeda selesai 11:15)
    expect(by.c).toEqual([0, 1]);
  });
});

describe("interaksi", () => {
  const range = { start: 600, end: 1320 };
  it("klik → menit dibulatkan 15", () => {
    expect(minuteAtOffset(0, range)).toBe(600);
    expect(minuteAtOffset(40 * PX_PER_MIN, range)).toBe(630);
    expect(minuteAtOffset(99999, range)).toBe(1305);
    expect(clockOf(630)).toBe("10:30");
  });
  it("area di luar shift", () => {
    const shift = { name: "Spa Pagi", start_time: "09:00", end_time: "17:00" };
    expect(offShiftBands(shift, false, range)).toEqual([{ top: 420 * PX_PER_MIN, height: 300 * PX_PER_MIN }]);
    expect(offShiftBands(null, false, range)).toEqual([{ top: 0, height: 720 * PX_PER_MIN }]);
    expect(offShiftBands(shift, true, range)).toHaveLength(1);
  });
  it("garis sekarang hanya untuk hari ini", () => {
    const now = new Date(at("12:00"));
    expect(nowOffset("2026-10-09", now, range)).toBe(120 * PX_PER_MIN);
    expect(nowOffset("2026-10-10", now, range)).toBeNull();
  });
  it("hanya treatment belum dimulai yang bisa diseret", () => {
    expect(isDraggable({ status: "assigned", booking_status: "assigned" })).toBe(true);
    expect(isDraggable({ status: "in_treatment", booking_status: "in_treatment" })).toBe(false);
    expect(isDraggable({ status: "unassigned", booking_status: "expired" })).toBe(false);
  });
  it("peringatan di luar shift / cuti / libur", () => {
    const shift = { name: "Spa Siang", start_time: "13:00:00", end_time: "22:00:00" };
    expect(availabilityWarning(item("a", "14:00", "15:00"), { shift, on_leave: false })).toBeNull();
    expect(availabilityWarning(item("a", "10:00", "11:00"), { shift, on_leave: false })).toMatch("di luar shift 13:00–22:00");
    expect(availabilityWarning(item("a", "21:30", "22:30"), { shift, on_leave: false })).toMatch("di luar shift");
    expect(availabilityWarning(item("a", "14:00", "15:00"), { shift, on_leave: true })).toMatch("cuti");
    expect(availabilityWarning(item("a", "14:00", "15:00"), { shift, on_leave: false, day_off: true })).toMatch("libur");
    expect(availabilityWarning(item("a", "14:00", "15:00"), { shift: null, on_leave: false })).toMatch("tidak punya shift");
  });
});
