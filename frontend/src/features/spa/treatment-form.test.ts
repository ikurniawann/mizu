import { describe, expect, it } from "vitest";
import {
  emptyVariantRow,
  initialPriceGrid,
  initialTreatmentForm,
  toPriceInputs,
  toTreatmentInput,
  validateTreatmentForm,
} from "./treatment-form";
import type { Treatment } from "./types";

const treatment: Treatment = {
  id: "t1",
  code: "BAL",
  name: "Balinese Massage",
  category: "Massage",
  description: null,
  is_active: true,
  sort_order: 1,
  variants: [
    { id: "v2", name: "90 menit", duration_min: 90, buffer_min: 15, price_idr: 300000, is_active: true, sort_order: 1, outlet_prices: [] },
    {
      id: "v1",
      name: "60 menit",
      duration_min: 60,
      buffer_min: 15,
      price_idr: 200000,
      is_active: true,
      sort_order: 0,
      outlet_prices: [{ branch_id: "b1", price_idr: 220000 }],
    },
  ],
};

describe("form treatment", () => {
  it("form baru valid setelah diisi", () => {
    const form = initialTreatmentForm(null);
    expect(validateTreatmentForm(form)).toContain("Kode treatment wajib diisi.");
    form.code = "ref";
    form.name = "Refleksi";
    form.variants[0] = { ...form.variants[0], name: "45 menit", duration_min: "45", price_idr: "150000" };
    expect(validateTreatmentForm(form)).toEqual([]);
    const input = toTreatmentInput(form);
    expect(input.code).toBe("REF");
    expect(input.variants).toEqual([
      { name: "45 menit", duration_min: 45, buffer_min: 15, price_idr: 150000, is_active: true, sort_order: 0 },
    ]);
  });

  it("menjaga id varian lama dan urutan sort_order", () => {
    const form = initialTreatmentForm(treatment);
    expect(form.variants.map((v) => v.id)).toEqual(["v1", "v2"]);
    form.variants.push({ ...emptyVariantRow(), name: "120 menit", duration_min: "120", price_idr: "400000" });
    const input = toTreatmentInput(form);
    expect(input.variants.map((v) => [v.id, v.sort_order])).toEqual([
      ["v1", 0],
      ["v2", 1],
      [undefined, 2],
    ]);
  });

  it("menolak angka tidak valid dan nama varian ganda", () => {
    const form = initialTreatmentForm(treatment);
    form.variants[0].duration_min = "0";
    form.variants[1].price_idr = "abc";
    form.variants[1].name = "60 MENIT";
    const errors = validateTreatmentForm(form);
    expect(errors).toContain("Varian 1: durasi minimal 1 menit.");
    expect(errors).toContain("Varian 2: harga harus angka ≥ 0.");
    expect(errors).toContain("Nama varian tidak boleh sama.");
  });
});

describe("harga per outlet", () => {
  const outlets = [{ branch_id: "b1" }, { branch_id: "b2" }];

  it("grid awal dari override yang ada", () => {
    expect(initialPriceGrid(treatment, outlets)).toEqual({ v2: { b1: "", b2: "" }, v1: { b1: "220000", b2: "" } });
  });

  it("hanya mengirim perubahan; kosong = hapus override", () => {
    const grid = initialPriceGrid(treatment, outlets);
    grid.v1.b1 = "";
    grid.v2.b2 = "320000";
    expect(toPriceInputs(treatment, grid)).toEqual([
      { variant_id: "v2", branch_id: "b2", price_idr: 320000 },
      { variant_id: "v1", branch_id: "b1", price_idr: null },
    ]);
    expect(toPriceInputs(treatment, initialPriceGrid(treatment, outlets))).toEqual([]);
  });

  it("melempar galat untuk harga bukan angka", () => {
    const grid = initialPriceGrid(treatment, outlets);
    grid.v2.b1 = "12a";
    expect(() => toPriceInputs(treatment, grid)).toThrow(/tidak valid/);
  });
});
