import { describe, expect, it } from "vitest";
import {
  computePeriod,
  cutoffDescription,
  daysUntil,
  normalizeCutoff,
  periodKeyFor,
  periodRangeLabel,
  wibClockInput,
} from "./attendance-period";

describe("attendance period math", () => {
  it("uses the calendar month by default", () => {
    expect(computePeriod(0, 3, 2026, 10)).toEqual({
      year: 2026, month: 10, start: "2026-10-01", end: "2026-10-31", closing: "2026-11-03",
    });
    expect(computePeriod(0, 3, 2028, 2).end).toBe("2028-02-29");
  });

  it("applies a cut-off across months and years", () => {
    expect(computePeriod(20, 3, 2026, 10)).toMatchObject({ start: "2026-09-21", end: "2026-10-20", closing: "2026-10-23" });
    expect(computePeriod(20, 3, 2027, 1)).toMatchObject({ start: "2026-12-21", end: "2027-01-20" });
    expect(computePeriod(20, 0, 2026, 3)).toMatchObject({ start: "2026-02-21", end: "2026-03-20", closing: "2026-03-20" });
  });

  it("treats 29–31 as end of month", () => {
    expect(normalizeCutoff(31)).toBe(0);
    expect(normalizeCutoff(28)).toBe(28);
    expect(normalizeCutoff(32)).toBeNull();
    expect(computePeriod(31, 3, 2026, 2)).toMatchObject({ start: "2026-02-01", end: "2026-02-28" });
    expect(cutoffDescription(20)).toBe("Tgl 21 bulan lalu s.d. tgl 20 bulan berjalan");
  });

  it("finds the payroll month of a date", () => {
    expect(periodKeyFor(20, "2026-10-21")).toEqual({ year: 2026, month: 11 });
    expect(periodKeyFor(20, "2026-12-25")).toEqual({ year: 2027, month: 1 });
    expect(periodKeyFor(0, "2026-12-25")).toEqual({ year: 2026, month: 12 });
  });

  it("labels ranges like the backend", () => {
    expect(periodRangeLabel("2026-09-21", "2026-10-20")).toBe("21 Sep – 20 Okt 2026");
    expect(periodRangeLabel("2026-10-01", "2026-10-31")).toBe("1–31 Okt 2026");
    expect(periodRangeLabel("2026-12-21", "2027-01-20")).toBe("21 Des 2026 – 20 Jan 2027");
    expect(daysUntil("2026-10-15", "2026-10-23")).toBe(8);
  });

  it("reads the WIB wall clock of a timestamp", () => {
    expect(wibClockInput("2026-10-02T01:30:00.000Z")).toBe("08:30");
    expect(wibClockInput(null)).toBe("");
  });
});
