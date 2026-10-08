import { describe, expect, it } from "vitest";
import {
  addDaysToDate,
  currentMonthWib,
  formatClock,
  generateSlots,
  isoToWibLocalInput,
  monthRange,
  parseClock,
  shortClock,
  wibClockOf,
  wibDateOf,
  wibLocalInputToIso,
  wibToIso,
} from "./time";

describe("parseClock / formatClock", () => {
  it("menerima HH:MM dan HH:MM:SS", () => {
    expect(parseClock("10:00")).toBe(600);
    expect(parseClock("22:30:00")).toBe(1350);
    expect(parseClock("9:05")).toBe(545);
    expect(parseClock("24:00")).toBe(1440);
  });
  it("menolak nilai tidak valid", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock(null)).toBeNull();
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock("10:60")).toBeNull();
    expect(parseClock("abc")).toBeNull();
  });
  it("memformat dan membungkus 24 jam", () => {
    expect(formatClock(600)).toBe("10:00");
    expect(formatClock(1440 + 90)).toBe("01:30");
    expect(shortClock("22:00:00")).toBe("22:00");
    expect(shortClock(undefined)).toBe("");
  });
});

describe("konversi WIB ⇄ ISO", () => {
  it("jam dinding WIB → ISO UTC (melewati batas tanggal)", () => {
    expect(wibToIso("2026-10-08", "10:00")).toBe("2026-10-08T03:00:00.000Z");
    expect(wibToIso("2026-10-08", "06:00")).toBe("2026-10-07T23:00:00.000Z");
    expect(wibToIso("2026-10-08", "00:00")).toBe("2026-10-07T17:00:00.000Z");
  });
  it("menolak input tidak valid", () => {
    expect(() => wibToIso("08-10-2026", "10:00")).toThrow();
    expect(() => wibToIso("2026-10-08", "x")).toThrow();
  });
  it("datetime-local ⇄ ISO pulang-pergi", () => {
    expect(wibLocalInputToIso("2026-10-08T06:30")).toBe("2026-10-07T23:30:00.000Z");
    expect(wibLocalInputToIso("")).toBeNull();
    expect(wibLocalInputToIso("bukan tanggal")).toBeNull();
    expect(isoToWibLocalInput("2026-10-07T23:30:00.000Z")).toBe("2026-10-08T06:30");
    expect(isoToWibLocalInput(null)).toBe("");
    const iso = "2026-12-31T20:15:00.000Z";
    expect(wibLocalInputToIso(isoToWibLocalInput(iso))).toBe(iso);
  });
  it("tanggal & jam WIB dari ISO", () => {
    expect(wibDateOf("2026-10-07T17:00:00.000Z")).toBe("2026-10-08");
    expect(wibDateOf("2026-10-07T16:59:00.000Z")).toBe("2026-10-07");
    expect(wibClockOf("2026-10-07T23:30:00.000Z")).toBe("06:30");
    expect(wibDateOf("invalid")).toBe("");
  });
});

describe("tanggal & bulan", () => {
  it("menambah hari melewati bulan/tahun", () => {
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("bulan WIB berjalan mengikuti WIB, bukan UTC", () => {
    // 31 Okt 2026 18:00 UTC = 1 Nov 01:00 WIB
    expect(currentMonthWib(new Date("2026-10-31T18:00:00Z"))).toBe("2026-11");
  });
  it("rentang bulan", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("generateSlots", () => {
  const base = { date: "2026-10-08", open_time: "10:00", close_time: "12:00", slot_minutes: 30 };

  it("membuat slot dari jam buka sampai sebelum jam tutup", () => {
    const slots = generateSlots(base);
    expect(slots.map((s) => s.time)).toEqual(["10:00", "10:30", "11:00", "11:30"]);
    expect(slots[0].iso).toBe("2026-10-08T03:00:00.000Z");
  });

  it("membuang slot yang selesai melewati jam tutup", () => {
    expect(generateSlots({ ...base, duration_min: 60 }).map((s) => s.time)).toEqual(["10:00", "10:30", "11:00"]);
  });

  it("hanya slot di masa depan (now dalam UTC, dibandingkan dalam WIB)", () => {
    // 03:30Z = 10:30 WIB → slot 10:30 sudah lewat (≤ now)
    const slots = generateSlots({ ...base, now: new Date("2026-10-08T03:30:00Z") });
    expect(slots.map((s) => s.time)).toEqual(["11:00", "11:30"]);
  });

  it("tanggal yang sudah lewat tidak punya slot", () => {
    expect(generateSlots({ ...base, now: new Date("2026-10-09T00:00:00Z") })).toEqual([]);
  });

  it("batas WIB: slot pagi dini hari jatuh di tanggal UTC sebelumnya", () => {
    const slots = generateSlots({ date: "2026-10-08", open_time: "06:00", close_time: "07:00", slot_minutes: 60 });
    expect(slots).toEqual([{ time: "06:00", iso: "2026-10-07T23:00:00.000Z" }]);
    // now = 22:00Z tgl 7 = 05:00 WIB tgl 8 → slot 06:00 masih tersedia
    expect(
      generateSlots({ date: "2026-10-08", open_time: "06:00", close_time: "07:00", slot_minutes: 60, now: new Date("2026-10-07T22:00:00Z") })
    ).toHaveLength(1);
  });

  it("jam tutup lewat tengah malam", () => {
    const slots = generateSlots({ date: "2026-10-08", open_time: "23:00", close_time: "01:00", slot_minutes: 60 });
    expect(slots.map((s) => s.time)).toEqual(["23:00", "00:00"]);
    expect(slots[1].iso).toBe("2026-10-08T17:00:00.000Z");
  });

  it("konfigurasi tidak valid → kosong", () => {
    expect(generateSlots({ ...base, slot_minutes: 0 })).toEqual([]);
    expect(generateSlots({ ...base, open_time: "" })).toEqual([]);
    expect(generateSlots({ ...base, date: "besok" })).toEqual([]);
  });
});
