import { describe, expect, it } from "vitest";
import {
  clampDate,
  dateStrip,
  endClock,
  groupSlots,
  orderedTreatments,
  parsePrefill,
  treatmentCategories,
  whatsappHref,
} from "./public-booking";
import type { PublicTreatment } from "./types";

const slot = (time: string) => ({ time, iso: `2026-10-09T${time}:00.000Z` });

describe("dateStrip", () => {
  it("hari, tanggal, bulan & label", () => {
    const strip = dateStrip("2026-10-09", 3);
    expect(strip.map((d) => [d.date, d.weekday, d.day, d.month, d.label])).toEqual([
      ["2026-10-09", "Jum", 9, "Okt", "Hari ini"],
      ["2026-10-10", "Sab", 10, "Okt", "Besok"],
      ["2026-10-11", "Min", 11, "Okt", null],
    ]);
  });
  it("melewati akhir bulan", () => {
    expect(dateStrip("2026-10-31", 2)[1]).toMatchObject({ date: "2026-11-01", month: "Nov", day: 1 });
  });
  it("tanggal tidak valid → kosong", () => {
    expect(dateStrip("besok")).toEqual([]);
  });
});

describe("groupSlots", () => {
  it("pagi · siang · sore · malam, kelompok kosong dibuang", () => {
    const groups = groupSlots(["10:00", "11:30", "12:00", "18:00", "21:30"].map(slot));
    expect(groups.map((g) => [g.key, g.slots.map((s) => s.time)])).toEqual([
      ["pagi", ["10:00", "11:30"]],
      ["siang", ["12:00"]],
      ["malam", ["18:00", "21:30"]],
    ]);
  });
  it("jam selesai", () => {
    expect(endClock("20:30", 90)).toBe("22:00");
    expect(endClock("23:30", 60)).toBe("00:30");
  });
});

describe("isian awal", () => {
  it("membaca outlet, treatment & tanggal", () => {
    expect(parsePrefill({ outlet: "b-1", treatment: ["t-9", "x"], date: "2026-10-12" })).toEqual({
      outlet: "b-1",
      treatment: "t-9",
      date: "2026-10-12",
    });
  });
  it("mengabaikan nilai aneh", () => {
    expect(parsePrefill({ outlet: "<script>", date: "12/10/2026" })).toEqual({ outlet: null, treatment: null, date: null });
  });
  it("tanggal dibatasi ke rentang booking", () => {
    expect(clampDate(null, "2026-10-09", 30)).toBe("2026-10-09");
    expect(clampDate("2026-10-01", "2026-10-09", 30)).toBe("2026-10-09");
    expect(clampDate("2026-10-20", "2026-10-09", 30)).toBe("2026-10-20");
    expect(clampDate("2027-01-01", "2026-10-09", 30)).toBe("2026-11-08");
  });
});

describe("whatsappHref", () => {
  it("nomor lokal & internasional", () => {
    expect(whatsappHref("0812-7458-7871", "Halo")).toBe("https://wa.me/6281274587871?text=Halo");
    expect(whatsappHref("+62 812 7458 7871", "a b")).toBe("https://wa.me/6281274587871?text=a%20b");
  });
  it("telepon rumah / kosong → null", () => {
    expect(whatsappHref("022-4231234", "x")).toBeNull();
    expect(whatsappHref(null, "x")).toBeNull();
  });
});

describe("treatment", () => {
  const v = (id: string, duration_min: number, price_idr: number) => ({ id, name: `${duration_min} menit`, duration_min, price_idr });
  const list: PublicTreatment[] = [
    { id: "a", name: "Balinese", category: "Massage", description: null, variants: [v("a2", 90, 2), v("a1", 60, 1)] },
    { id: "b", name: "Refleksi", category: " ", description: null, variants: [v("b1", 60, 1)] },
    { id: "c", name: "Kosong", category: "Facial", description: null, variants: [] },
    { id: "d", name: "Shiatsu", category: "Massage", description: null, variants: [v("d1", 60, 1)] },
  ];
  it("kategori sesuai urutan, tanpa treatment kosong", () => {
    expect(treatmentCategories(list)).toEqual(["Massage", "Lainnya"]);
  });
  it("varian terpendek dulu, treatment dari menu di atas", () => {
    const out = orderedTreatments(list, "d");
    expect(out.map((t) => t.id)).toEqual(["d", "a", "b"]);
    expect(out[1].variants.map((x) => x.id)).toEqual(["a1", "a2"]);
    expect(orderedTreatments(list, "zzz").map((t) => t.id)).toEqual(["a", "b", "d"]);
  });
});
