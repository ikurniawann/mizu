import { describe, expect, it } from "vitest";
import { MANUAL_INPUT_CODES, manualInputKind, manualInputLabel } from "./manual-inputs";

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
