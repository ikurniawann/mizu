import type { PublicTreatment, PublicVariant } from "@/features/spa/types";

/** The heading for treatments the catalog left without a category. */
export const OTHER_CATEGORY = "Lainnya";

export interface TreatmentGroup {
  category: string;
  treatments: PublicTreatment[];
}

/** Treatments with at least one bookable variant, variants shortest first. */
export function bookable(treatments: PublicTreatment[]): PublicTreatment[] {
  return treatments
    .filter((t) => t.variants.length > 0)
    .map((t) => ({ ...t, variants: [...t.variants].sort((a, b) => a.duration_min - b.duration_min || a.price_idr - b.price_idr) }));
}

/** Bookable treatments grouped by category, in the order the catalog lists them. */
export function groupByCategory(treatments: PublicTreatment[]): TreatmentGroup[] {
  const groups = new Map<string, PublicTreatment[]>();
  for (const t of bookable(treatments)) {
    const category = t.category?.trim() || OTHER_CATEGORY;
    groups.set(category, [...(groups.get(category) ?? []), t]);
  }
  return [...groups].map(([category, list]) => ({ category, treatments: list }));
}

/** The cheapest variant price, or null when there is none. */
export function startingPrice(variants: PublicVariant[]): number | null {
  return variants.length === 0 ? null : Math.min(...variants.map((v) => v.price_idr));
}

/** "60 / 90 / 120 menit" from the distinct durations. */
export function durationsLabel(variants: PublicVariant[]): string {
  const minutes = [...new Set(variants.map((v) => v.duration_min))].sort((a, b) => a - b);
  return minutes.length === 0 ? "" : `${minutes.join(" / ")} menit`;
}

/** A short pick for the home page: signature treatments first, then the catalog order. */
export function featured(treatments: PublicTreatment[], limit = 6): PublicTreatment[] {
  const list = bookable(treatments);
  const signature = list.filter((t) => /signature/i.test(t.name));
  return [...signature, ...list.filter((t) => !signature.includes(t))].slice(0, limit);
}

/** "10:00 – 22:00" from the outlet's HH:MM opening hours. */
export function openingHours(open: string, close: string): string {
  return open && close ? `${open.slice(0, 5)} – ${close.slice(0, 5)}` : "";
}
