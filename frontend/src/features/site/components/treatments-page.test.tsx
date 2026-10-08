import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicOutlet, PublicTreatment } from "@/features/spa/types";
import { CONTENT_DEFAULTS } from "../content-defaults";
import { pickOutlet, TreatmentsPage } from "./treatments-page";

const outlet = (branch_id: string, name: string): PublicOutlet => ({
  branch_id, slug: branch_id, name, address: "Jl. Westhoff No. 1", city: "Bandung", phone: null, open_time: "10:00", close_time: "22:00", slot_minutes: 30,
});
const OUTLETS = [outlet("b1", "Mizu 1.0"), outlet("b2", "Mizu Signature")];
const MENU: PublicTreatment[] = [
  { id: "t1", name: "Refleksi Kaki", category: "Reflexology", description: "Untuk kaki yang lelah.", variants: [{ id: "v1", name: "60 menit", duration_min: 60, price_idr: 150000 }] },
];
const guide = CONTENT_DEFAULTS.training;

describe("TreatmentsPage", () => {
  it("picks the requested outlet or the first one", () => {
    expect(pickOutlet(OUTLETS, "b2")?.name).toBe("Mizu Signature");
    expect(pickOutlet(OUTLETS, "nope")?.name).toBe("Mizu 1.0");
    expect(pickOutlet([], undefined)).toBeNull();
  });

  it("lists the menu with prices, an outlet switcher and booking links", () => {
    const html = renderToStaticMarkup(<TreatmentsPage guide={guide} outlets={{ ok: true, data: OUTLETS }} selected={OUTLETS[0]} treatments={{ ok: true, data: MENU }} />);
    expect(html).toContain("Reflexology");
    expect(html).toContain("Refleksi Kaki");
    expect(html).toMatch(/Rp150\.000/);
    expect(html).toContain('href="/treatments?outlet=b2"');
    expect(html).toContain('href="/booking/spa?outlet=b1&amp;treatment=t1"');
    expect(html).toContain("10:00 – 22:00");
  });

  it("explains a failed load, an empty menu and no outlets", () => {
    const failed = renderToStaticMarkup(<TreatmentsPage guide={guide} outlets={{ ok: false }} selected={null} treatments={{ ok: true, data: [] }} />);
    expect(failed).toContain("belum bisa dimuat");
    const noOutlets = renderToStaticMarkup(<TreatmentsPage guide={guide} outlets={{ ok: true, data: [] }} selected={null} treatments={{ ok: true, data: [] }} />);
    expect(noOutlets).toContain("Belum ada outlet");
    const empty = renderToStaticMarkup(<TreatmentsPage guide={guide} outlets={{ ok: true, data: OUTLETS }} selected={OUTLETS[1]} treatments={{ ok: true, data: [] }} />);
    expect(empty).toContain("Belum ada treatment yang bisa di-booking online di Mizu Signature");
    const menuFailed = renderToStaticMarkup(<TreatmentsPage guide={guide} outlets={{ ok: true, data: OUTLETS }} selected={OUTLETS[0]} treatments={{ ok: false }} />);
    expect(menuFailed).toContain("Menu treatment Mizu 1.0 belum bisa dimuat");
  });
});
