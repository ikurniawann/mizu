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
    <HomePage home={CONTENT_DEFAULTS.home} social={CONTENT_DEFAULTS.social} branches={[BRANCH]} outlet={OUTLET} treatments={MENU} {...props} />,
  );
}

describe("HomePage", () => {
  it("keeps the home calm: hero, about, menu card, offers and a closing call to action", () => {
    const html = render();
    expect(html).toContain("Rest. Relax. Rejuvenate.");
    expect(html).toContain("Mizu Family Massage &amp; Reflexology");
    expect(html).toContain('href="/booking/spa"');
    expect(html).toMatch(/Mulai Rp185\.000 di Mizu 1\.0/);
    expect(html).toContain("Buy 1 Get 1 untuk usia 60+");
    expect(html).toContain('href="/booking/spa?outlet=mizu-westhoff"');
    // The signature ritual is the featured offer and links straight to it.
    expect(html).toContain('href="/booking/spa?outlet=mizu-westhoff&amp;treatment=t2"');
    expect(html).toContain("https://instagram.com/mizufamily.id");
    expect(html).toContain("Siap untuk istirahat sejenak?");
    expect(html).not.toMatch(/trial|membership|timetable|hyrox/i);
    expect(html).not.toContain("Treatment pilihan");
  });

  it("still renders without a menu", () => {
    const html = render({ outlet: null, treatments: [] });
    expect(html).not.toContain("Mizu Signature Ritual");
    expect(html).toContain("Better together.");
    expect(html).toContain("Siap untuk istirahat sejenak?");
  });
});
