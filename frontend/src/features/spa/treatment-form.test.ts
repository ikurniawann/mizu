import { describe, expect, it } from "vitest";
import {
  emptyVariantRow,
  buildPriceBatches,
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
    { id: "v2", name: "90 menit", duration_min: 90, price_idr: 300000, is_active: true, sort_order: 1, outlet_prices: [] },
    {
      id: "v1",
      name: "60 menit",
      duration_min: 60,
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
      { name: "45 menit", duration_min: 45, price_idr: 150000, is_active: true, sort_order: 0 },
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
    expect(errors.some((error) => error.includes("durasi"))).toBe(true);
    expect(errors.some((error) => error.includes("harga"))).toBe(true);
    expect(errors).toContain("Nama varian tidak boleh sama.");
  });

  it.each([
    ["code", "-BAL"], ["code", "A".repeat(21)], ["name", "A".repeat(121)],
    ["category", "A".repeat(61)], ["description", "A".repeat(2001)],
    ["sort_order", "-1"], ["sort_order", "10000"], ["sort_order", "1.5"],
  ] as const)("menolak master di luar batas: %s", (field, value) => {
    const form = initialTreatmentForm(treatment);
    form[field] = value;
    expect(validateTreatmentForm(form).length).toBeGreaterThan(0);
  });

  it.each([
    ["name", "A".repeat(61)], ["duration_min", "4"], ["duration_min", "601"],
    ["price_idr", "1000000000000"],
  ] as const)("menolak varian di luar batas: %s", (field, value) => {
    const form = initialTreatmentForm(treatment);
    form.variants[0][field] = value;
    expect(validateTreatmentForm(form).length).toBeGreaterThan(0);
  });

  it("menerima batas varian dan menolak lebih dari 20 varian", () => {
    const form = initialTreatmentForm(treatment);
    Object.assign(form.variants[0], { duration_min: "5", price_idr: "999999999999" });
    Object.assign(form.variants[1], { duration_min: "600", price_idr: "0" });
    expect(validateTreatmentForm(form)).toEqual([]);
    form.variants = Array.from({ length: 21 }, (_, i) => ({ ...emptyVariantRow(), name: `Varian ${i}`, price_idr: "0" }));
    expect(validateTreatmentForm(form).length).toBeGreaterThan(0);
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

  it.each(["-1", "1.5", "teks", "1000000000000", "999999999999999999999"])("menolak harga outlet %s", (raw) => {
    expect(() => toPriceInputs(treatment, { v1: { b1: raw } })).toThrow(/tidak valid/);
  });

  it("membandingkan angka dan mempertahankan harga khusus nol atau sama dengan dasar", () => {
    expect(toPriceInputs(treatment, { v1: { b1: "0220000" } })).toEqual([]);
    expect(toPriceInputs(treatment, { v1: { b2: "200000" }, v2: { b1: "0", b2: "999999999999" } })).toEqual([
      { variant_id: "v2", branch_id: "b1", price_idr: 0 },
      { variant_id: "v2", branch_id: "b2", price_idr: 999999999999 },
      { variant_id: "v1", branch_id: "b2", price_idr: 200000 },
    ]);
  });

  it("memisahkan request per treatment maksimal 500 sel dan memvalidasi semua draft", () => {
    const grid = { v1: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`outlet-${i}`, "1"])) };
    const batches = buildPriceBatches([treatment], grid);
    expect(batches.map((batch) => [batch.id, batch.prices.length])).toEqual([["t1", 500], ["t1", 1]]);
    expect(batches[1].prices).toEqual([{ variant_id: "v1", branch_id: "outlet-500", price_idr: 1 }]);
    grid.v1["outlet-500"] = "-1";
    expect(() => buildPriceBatches([treatment], grid)).toThrow(/tidak valid/);
  });
});
