import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicOutlet, PublicTreatment } from "@/features/spa/types";
import { CONTENT_DEFAULTS } from "../content-defaults";
import { pickOutlet, TreatmentsPage } from "./treatments-page";

const outlet = (branch_id: string, name: string): PublicOutlet => ({
  branch_id, slug: branch_id, name, address: "Jl. Westhoff No. 1", city: "Bandung", phone: null, open_time: "10:00", close_time: "22:00", slot_minutes: 30,
});
const OUTLETS = [outlet("b1", "Paddy Store PVJ"), outlet("b2", "Paddy Store Kopo")];
const MENU: PublicTreatment[] = [
  { id: "t1", name: "Refleksi Kaki", category: "Reflexology", description: "Untuk kaki yang lelah.", variants: [{ id: "v1", name: "60 menit", duration_min: 60, price_idr: 150000 }] },
];
const guide = CONTENT_DEFAULTS.training;

describe("TreatmentsPage", () => {
  it("picks the requested outlet or the first one", () => {
    expect(pickOutlet(OUTLETS, "b2")?.name).toBe("Paddy Store Kopo");
    expect(pickOutlet(OUTLETS, "nope")?.name).toBe("Paddy Store PVJ");
    expect(pickOutlet([], undefined)).toBeNull();
  });

  it("lists the menu with prices, an outlet switcher and booking links", () => {
    const html = renderToStaticMarkup(<TreatmentsPage guide={guide} outlets={{ ok: true, data: OUTLETS }} selected={OUTLETS[0]} treatments={{ ok: true, data: MENU }} />);
    expect(html).toContain("Reflexology");
    expect(html).toContain("Refleksi Kaki");
    expect(html).toMatch(/Rp 150\.000/);
    expect(html).toContain('href="/treatments?outlet=b2"');
    expect(html).toContain('href="/booking/spa?outlet=b1&amp;treatment=t1"');
    expect(html).toContain("10:00 – 22:00");
  });

  it("shows Custom Case with the background gallery and sticker themes", () => {
    const sticker = (code: string) => ({ code, name: code, image: `/experience/stickers/${code}.webp` });
    const experience = {
      price: 119000,
      layouts: [{ code: "2", name: "Layout 2 gambar", slots: 2 }, { code: "3", name: "Layout 3 gambar", slots: 3 }],
      brands: [{ code: "apple", name: "Apple", models: ["Iphone 15"] }],
      backgrounds: [
        { code: "black-sky", name: "Black Sky", image: "/experience/backgrounds/black-sky.webp" },
        { code: "star-dots", name: "Star Dots", image: "/experience/backgrounds/star-dots.webp" },
      ],
      themes: [
        { code: "baking-pals", name: "Baking Pals", cover: "/c.webp", stickers: ["a", "b", "c", "d"].map((x) => sticker(`baking-pals-${x}`)) },
        { code: "picnic-day", name: "Picnic Day", cover: "/c.webp", stickers: ["a", "b", "c", "d"].map((x) => sticker(`picnic-day-${x}`)) },
      ],
      fonts: [{ code: "daydream", name: "Daydream", sample: "/f.webp" }],
      name_max_length: 12,
    };
    const menu: PublicTreatment[] = [{ id: "cc", name: "Custom Case", category: "Custom Case", description: null, customizable: true,
      variants: [{ id: "v9", name: "Sesi desain", duration_min: 30, price_idr: 119000 }] }];
    const html = renderToStaticMarkup(<TreatmentsPage guide={guide} outlets={{ ok: true, data: OUTLETS }} selected={OUTLETS[0]} treatments={{ ok: true, data: menu }} experience={experience} />);
    expect(html).toContain("Pilih dari 2 background &amp; 2 tema stiker");
    expect(html).toContain("/experience/backgrounds/star-dots.webp");
    expect(html).toContain("Picnic Day");
    expect(html).toMatch(/Rp 119\.000/);
    expect(html).toContain('href="/booking/spa?outlet=b1&amp;treatment=cc"');
  });

  it("explains a failed load, an empty menu and no outlets", () => {
    const failed = renderToStaticMarkup(<TreatmentsPage guide={guide} outlets={{ ok: false }} selected={null} treatments={{ ok: true, data: [] }} />);
    expect(failed).toContain("belum bisa dimuat");
    const noOutlets = renderToStaticMarkup(<TreatmentsPage guide={guide} outlets={{ ok: true, data: [] }} selected={null} treatments={{ ok: true, data: [] }} />);
    expect(noOutlets).toContain("Belum ada toko");
    const empty = renderToStaticMarkup(<TreatmentsPage guide={guide} outlets={{ ok: true, data: OUTLETS }} selected={OUTLETS[1]} treatments={{ ok: true, data: [] }} />);
    expect(empty).toContain("Belum ada layanan experience yang bisa di-booking online di Paddy Store Kopo");
    const menuFailed = renderToStaticMarkup(<TreatmentsPage guide={guide} outlets={{ ok: true, data: OUTLETS }} selected={OUTLETS[0]} treatments={{ ok: false }} />);
    expect(menuFailed).toContain("Menu layanan experience Paddy Store PVJ belum bisa dimuat");
  });
});
