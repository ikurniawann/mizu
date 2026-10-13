import { describe, expect, it } from "vitest";
import { countdownLabel, countdownTone, remainingSeconds } from "./rooms";

describe("timer room (R9)", () => {
  it("menghitung sisa waktu dari started_at + durasi", () => {
    const now = new Date("2026-10-13T03:30:00Z");
    expect(remainingSeconds("2026-10-13T03:00:00Z", 60, now)).toBe(30 * 60);
    expect(remainingSeconds("2026-10-13T03:00:00Z", 20, now)).toBe(-10 * 60);
    expect(remainingSeconds("bukan tanggal", 60, now)).toBe(0);
  });
  it("memformat hitung mundur dan lewat waktu", () => {
    expect(countdownLabel(725)).toBe("12:05");
    expect(countdownLabel(3661)).toBe("1:01:01");
    expect(countdownLabel(-190)).toBe("+03:10");
  });
  it("menandai hampir habis dan lewat waktu", () => {
    expect(countdownTone(600)).toBe("normal");
    expect(countdownTone(300)).toBe("ending");
    expect(countdownTone(-1)).toBe("over");
  });
});
