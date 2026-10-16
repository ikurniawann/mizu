import { describe, expect, it } from "vitest";
import { MANUAL_INPUT_CODES, manualInputKind, manualInputLabel, parseAmountID } from "./manual-inputs";

describe("manual inputs (EPIC-055)", () => {
  it("matches the backend payroll_inputs codes", () => {
    expect(MANUAL_INPUT_CODES.map((c) => c.code)).toEqual([
      "BONUS", "INCENTIVE", "NATURA", "TRANSPORT_LOCATION", "OTHER_EARNING",
      "OTHER_EARNING_NONTAX",
      "PENALTY", "ABSENCE", "UNION", "OTHER_DEDUCTION",
      "LATE_OVERRIDE",
    ]);
  });

  it("labels and classifies codes", () => {
    expect(manualInputLabel("PENALTY")).toBe("Denda");
    expect(manualInputKind("OTHER_EARNING_NONTAX")).toBe("earning_nontax");
    expect(manualInputLabel("UNKNOWN")).toBe("UNKNOWN");
    expect(manualInputKind("UNKNOWN")).toBeUndefined();
  });
});

describe("parseAmountID", () => {
  it("reads Indonesian and plain amounts", () => {
    expect(parseAmountID("25.000")).toBe(25000);
    expect(parseAmountID("1.500.000,50")).toBe(1500000.5);
    expect(parseAmountID("250000.50")).toBe(250000.5);
    expect(parseAmountID("Rp 75.000")).toBe(75000);
    expect(parseAmountID("0")).toBe(0);
    expect(parseAmountID("")).toBeNull();
    expect(parseAmountID("abc")).toBeNull();
    expect(parseAmountID("-5")).toBeNull();
  });
});
