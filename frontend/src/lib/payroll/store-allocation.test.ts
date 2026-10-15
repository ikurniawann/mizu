import { describe, expect, it } from "vitest";
import { allocationSummary, formatQty, formatRatio } from "./store-allocation";

describe("store allocation formatting", () => {
  it("formats ratios and quantities the Indonesian way", () => {
    expect(formatRatio(0.625)).toBe("62,5%");
    expect(formatRatio("0.696316")).toBe("69,6%");
    expect(formatRatio(1)).toBe("100,0%");
    expect(formatRatio(null)).toBe("—");
    expect(formatQty(16)).toBe("16");
    expect(formatQty("114.53")).toBe("114,5");
  });

  it("summarizes the split in one line, null store as Tanpa toko", () => {
    expect(
      allocationSummary([
        { branch_name: "Paddy Store PVJ", ratio: 0.6 },
        { branch_name: null, ratio: 0.4 },
      ])
    ).toBe("Paddy Store PVJ 60,0% · Tanpa toko 40,0%");
  });
});
