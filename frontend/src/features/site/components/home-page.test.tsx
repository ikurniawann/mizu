import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicOutlet, PublicTreatment } from "@/features/spa/types";
import { CONTENT_DEFAULTS } from "../content-defaults";
import type { BranchSummary } from "../types";
import { HomePage } from "./home-page";

const OUTLET: PublicOutlet = { branch_id: "b1", slug: "paddy-store-pvj", name: "Paddy Store PVJ", address: null, city: "Bandung", phone: null, open_time: "10:00", close_time: "22:00", slot_minutes: 30 };
const MENU: PublicTreatment[] = [
  { id: "t1", name: "Custom Case Design", category: "Custom Case", description: null, variants: [{ id: "v1", name: "30", duration_min: 30, price_idr: 150000 }, { id: "v2", name: "60", duration_min: 60, price_idr: 250000 }] },
  { id: "t2", name: "Paddy Signature Party", category: "Signature", description: null, variants: [{ id: "v3", name: "120", duration_min: 120, price_idr: 595000 }] },
];
const BRANCH: BranchSummary = { slug: "paddy-store-pvj", name: "Paddy Store PVJ", address: "Paris Van Java Mall, Jl. Sukajadi No. 131–139", city: "Bandung", postcode: null, lat: null, lng: null, phone: null, instagram: null, hero_image_url: null };

function render(props: Partial<Parameters<typeof HomePage>[0]> = {}) {
  return renderToStaticMarkup(
    <HomePage home={CONTENT_DEFAULTS.home} social={CONTENT_DEFAULTS.social} branches={[BRANCH]} outlet={OUTLET} treatments={MENU} {...props} />,
  );
}

describe("HomePage", () => {
  it("keeps the Paddy home: hero, hello, studio card, offers and a closing call to action", () => {
    const html = render();
    expect(html).toContain("Your Adorable Companion.");
    expect(html).toContain("Paddy — Your Adorable Companion");
    expect(html).toContain('href="/booking/spa"');
    expect(html).toMatch(/Mulai Rp 150\.000 di Paddy Store PVJ/);
    expect(html).toContain("Student Day: diskon 15% Paddy Experience");
    expect(html).toContain('href="/booking/spa?outlet=paddy-store-pvj"');
    // The signature session is the featured offer and links straight to it.
    expect(html).toContain('href="/booking/spa?outlet=paddy-store-pvj&amp;treatment=t2"');
    expect(html).toContain("https://www.instagram.com/paddy.id/");
    expect(html).toContain("Grab it, love it!");
    expect(html).not.toMatch(/mizu|massage|pijat|trial|membership|timetable|hyrox/i);
    expect(html).not.toContain("Treatment pilihan");
  });

  it("still renders without a menu", () => {
    const html = render({ outlet: null, treatments: [] });
    expect(html).not.toContain("Paddy Signature Party");
    expect(html).toContain("Better with besties.");
    expect(html).toContain("Grab it, love it!");
  });
});
