import { describe, expect, it } from "vitest";
import {
  designSummary,
  draftFromDesign,
  draftToDesign,
  emptyDraft,
  filterModels,
  isDraftComplete,
  missingSections,
  resolveDraft,
  stickerSpots,
  withLayout,
  type ExperienceCatalog,
} from "./experience";

const catalog: ExperienceCatalog = {
  price: 119000,
  layouts: [
    { code: "2", name: "Layout 2 gambar", slots: 2 },
    { code: "3", name: "Layout 3 gambar", slots: 3 },
  ],
  brands: [
    { code: "apple", name: "Apple", models: ["Iphone 15 Pro", "Iphone 15", "Iphone 13 Mini"] },
    { code: "samsung", name: "Samsung", models: ["Samsung S23"] },
  ],
  backgrounds: [{ code: "black-sky", name: "Black Sky", image: "/experience/backgrounds/black-sky.webp" }],
  themes: [
    {
      code: "baking-pals",
      name: "Baking Pals",
      cover: "/c.webp",
      stickers: ["a", "b", "c", "d"].map((x) => ({ code: `baking-pals-${x}`, name: `Baking Pals ${x.toUpperCase()}`, image: `/s/${x}.webp` })),
    },
    {
      code: "picnic-day",
      name: "Picnic Day",
      cover: "/p.webp",
      stickers: ["a", "b", "c", "d"].map((x) => ({ code: `picnic-day-${x}`, name: `Picnic Day ${x.toUpperCase()}`, image: `/p/${x}.webp` })),
    },
  ],
  fonts: [{ code: "daydream", name: "Daydream", sample: "/f.webp" }],
  name_max_length: 12,
};

function filled() {
  const d = emptyDraft(catalog);
  d.brand = "apple";
  d.model = "Iphone 15 Pro";
  d.stickers = [
    { theme: "baking-pals", code: "baking-pals-a" },
    { theme: "picnic-day", code: "picnic-day-b" },
    { theme: "baking-pals", code: "baking-pals-c" },
  ];
  d.withName = true;
  d.name = "  Kai  ";
  d.font = "daydream";
  d.background = "black-sky";
  return d;
}

describe("desain custom case", () => {
  it("draft kosong memakai layout 3 gambar dan menandai semua bagian", () => {
    const d = emptyDraft(catalog);
    expect(d.layout).toBe("3");
    expect(d.stickers).toEqual([null, null, null]);
    expect(missingSections(d, catalog)).toEqual(["hp", "stiker", "nama", "background"]);
    expect(isDraftComplete(d, catalog)).toBe(false);
  });

  it("draft lengkap → body API hanya berisi kode, nama dirapikan", () => {
    const d = filled();
    expect(isDraftComplete(d, catalog)).toBe(true);
    expect(draftToDesign(d)).toEqual({
      brand: "apple",
      model: "Iphone 15 Pro",
      layout: "3",
      stickers: [
        { theme: "baking-pals", code: "baking-pals-a" },
        { theme: "picnic-day", code: "picnic-day-b" },
        { theme: "baking-pals", code: "baking-pals-c" },
      ],
      background: "black-sky",
      name: "Kai",
      font: "daydream",
    });
  });

  it("tanpa nama: font tidak dikirim; nama wajib font bila dipakai", () => {
    const d = filled();
    d.withName = false;
    expect(draftToDesign(d)).toMatchObject({ name: "", font: "" });
    d.withName = true;
    d.font = "";
    expect(missingSections(d, catalog)).toEqual(["nama"]);
    d.font = "daydream";
    d.name = "   ";
    expect(missingSections(d, catalog)).toEqual(["nama"]);
  });

  it("model harus milik merk terpilih", () => {
    const d = filled();
    d.brand = "samsung";
    expect(missingSections(d, catalog)).toEqual(["hp"]);
  });

  it("ganti layout mempertahankan stiker yang muat", () => {
    const d = withLayout(filled(), catalog.layouts[0], catalog);
    expect(d.stickers).toHaveLength(2);
    expect(isDraftComplete(d, catalog)).toBe(true);
    const back = withLayout(d, catalog.layouts[1], catalog);
    expect(back.stickers[2]).toBeNull();
    expect(missingSections(back, catalog)).toEqual(["stiker"]);
  });

  it("resolve + ringkasan sama dengan spa.DesignSummary", () => {
    const design = resolveDraft(filled(), catalog);
    expect(design.background_image).toBe("/experience/backgrounds/black-sky.webp");
    expect(design.stickers[1].image).toBe("/p/b.webp");
    expect(designSummary(design)).toBe("Iphone 15 Pro · Black Sky · 3 stiker: Baking Pals A, Picnic Day B, Baking Pals C · Nama: Kai (Daydream)");
    expect(designSummary({ ...design, name: "", font: "" })).toMatch(/Tanpa nama$/);
  });

  it("desain tersimpan bisa diedit lagi", () => {
    const saved = { ...resolveDraft(filled(), catalog), brand_name: "Apple" };
    const d = draftFromDesign(saved, catalog);
    expect(d.withName).toBe(true);
    expect(d.slotThemes).toEqual(["baking-pals", "picnic-day", "baking-pals"]);
    expect(isDraftComplete(d, catalog)).toBe(true);
    expect(draftFromDesign(null, catalog).stickers).toEqual([null, null, null]);
  });

  it("pencarian tipe mengabaikan huruf besar dan spasi", () => {
    expect(filterModels(catalog.brands[0].models, "iphone15")).toEqual(["Iphone 15 Pro", "Iphone 15"]);
    expect(filterModels(catalog.brands[0].models, "MINI")).toEqual(["Iphone 13 Mini"]);
    expect(filterModels(catalog.brands[0].models, "")).toHaveLength(3);
  });

  it("posisi stiker tersedia untuk tiap jumlah slot", () => {
    expect(stickerSpots(2)).toHaveLength(2);
    expect(stickerSpots(3)).toHaveLength(3);
    expect(stickerSpots(5)).toHaveLength(5);
  });
});
