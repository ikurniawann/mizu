import { describe, it, expect } from "vitest";
import { entitySlug, withEntitySlug } from "./entity-slug";

describe("entitySlug", () => {
  it("mengubah nama entitas menjadi potongan nama file", () => {
    expect(entitySlug("Paddy Kantor Pusat")).toBe("paddy-kantor-pusat");
    expect(entitySlug("  PT. Nü Habit & Co ")).toBe("pt-n-habit-co");
  });

  it("kosong bila tidak ada nama atau tak ada huruf/angka", () => {
    expect(entitySlug(null)).toBe("");
    expect(entitySlug(undefined)).toBe("");
    expect(entitySlug("---")).toBe("");
  });
});

describe("withEntitySlug", () => {
  it("menambahkan slug entitas di belakang nama dasar bila ada", () => {
    expect(withEntitySlug("payroll-6-2026", "Paddy")).toBe("payroll-6-2026-paddy");
    expect(withEntitySlug("payroll-6-2026", null)).toBe("payroll-6-2026");
  });
});
