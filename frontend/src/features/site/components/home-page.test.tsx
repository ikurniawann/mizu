import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicOutlet, PublicTreatment } from "@/features/spa/types";
import { CONTENT_DEFAULTS } from "../content-defaults";
import type { BranchSummary } from "../types";
import { HomePage } from "./home-page";

const OUTLET: PublicOutlet = { branch_id: "b1", slug: "mizu-westhoff", name: "Mizu 1.0", address: null, city: "Bandung", phone: null, open_time: "10:00", close_time: "22:00", slot_minutes: 30 };
const MENU: PublicTreatment[] = [
  { id: "t1", name: "Balinese Massage", category: "Massage", description: null, variants: [{ id: "v1", name: "60", duration_min: 60, price_idr: 185000 }, { id: "v2", name: "90", duration_min: 90, price_idr: 255000 }] },
  { id: "t2", name: "Mizu Signature Ritual", category: "Signature", description: null, variants: [{ id: "v3", name: "150", duration_min: 150, price_idr: 595000 }] },
];
const BRANCH: BranchSummary = { slug: "mizu-westhoff", name: "Mizu 1.0", address: "Jl. Westhoff No. 1", city: "Bandung", postcode: null, lat: null, lng: null, phone: null, instagram: null, hero_image_url: null };

function render(props: Partial<Parameters<typeof HomePage>[0]> = {}) {
  return renderToStaticMarkup(
    <HomePage home={CONTENT_DEFAULTS.home} guide={CONTENT_DEFAULTS.training} social={CONTENT_DEFAULTS.social} branches={[BRANCH]} outlet={OUTLET} treatments={MENU} articles={[]} events={[]} {...props} />,
  );
}

describe("HomePage", () => {
  it("shows the spa hero, the treatment teaser, the promo and outlets with booking links", () => {
    const html = render();
    expect(html).toContain("Rest. Relax. Rejuvenate.");
    expect(html).toContain('href="/booking/spa"');
    expect(html.indexOf("Mizu Signature Ritual")).toBeLessThan(html.indexOf("Balinese Massage"));
    expect(html).toMatch(/mulai Rp185\.000/);
    expect(html).toContain("Buy 1 Get 1 untuk usia 60+");
    expect(html).toContain('href="/locations/mizu-westhoff"');
    expect(html).toContain("https://instagram.com/mizufamily.id");
    expect(html).not.toMatch(/trial|membership|timetable|hyrox/i);
  });

  it("drops the treatment teaser when the menu is unavailable", () => {
    const html = render({ outlet: null, treatments: [] });
    expect(html).not.toContain("Treatment pilihan");
    expect(html).toContain("Siap untuk istirahat sejenak?");
  });
});
