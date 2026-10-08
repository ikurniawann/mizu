import { describe, expect, it } from "vitest";
import type { PublicTreatment } from "@/features/spa/types";
import { bookable, durationsLabel, featured, groupByCategory, openingHours, OTHER_CATEGORY, startingPrice } from "./treatments";

const t = (name: string, category: string | null, variants: [number, number][]): PublicTreatment => ({
  id: name,
  name,
  category,
  description: null,
  variants: variants.map(([duration_min, price_idr], i) => ({ id: `${name}-${i}`, name: `${duration_min} menit`, duration_min, price_idr })),
});

const MENU = [
  t("Balinese Massage", "Massage", [[90, 255000], [60, 185000], [120, 325000]]),
  t("Refleksi Kaki", "Reflexology", [[45, 120000], [60, 150000]]),
  t("Totok Wajah", null, [[45, 130000]]),
  t("Thai Massage", "Massage", [[60, 195000]]),
  t("Draft", "Massage", []),
  t("Mizu Signature Ritual", "Signature", [[150, 595000]]),
];

describe("treatment menu helpers", () => {
  it("drops treatments without variants and sorts variants by duration", () => {
    const list = bookable(MENU);
    expect(list.map((x) => x.name)).not.toContain("Draft");
    expect(list[0].variants.map((v) => v.duration_min)).toEqual([60, 90, 120]);
    expect(MENU[0].variants[0].duration_min).toBe(90); // input untouched
  });

  it("groups by category in catalog order with a fallback heading", () => {
    const groups = groupByCategory(MENU);
    expect(groups.map((g) => g.category)).toEqual(["Massage", "Reflexology", OTHER_CATEGORY, "Signature"]);
    expect(groups[0].treatments.map((x) => x.name)).toEqual(["Balinese Massage", "Thai Massage"]);
    expect(groupByCategory([])).toEqual([]);
  });

  it("reads the starting price and the durations", () => {
    expect(startingPrice(MENU[0].variants)).toBe(185000);
    expect(startingPrice([])).toBeNull();
    expect(durationsLabel(MENU[0].variants)).toBe("60 / 90 / 120 menit");
    expect(durationsLabel([])).toBe("");
  });

  it("puts signature treatments first and caps the pick", () => {
    const pick = featured(MENU, 3);
    expect(pick.map((x) => x.name)).toEqual(["Mizu Signature Ritual", "Balinese Massage", "Refleksi Kaki"]);
  });

  it("formats opening hours", () => {
    expect(openingHours("10:00", "22:00")).toBe("10:00 – 22:00");
    expect(openingHours("", "22:00")).toBe("");
  });
});
