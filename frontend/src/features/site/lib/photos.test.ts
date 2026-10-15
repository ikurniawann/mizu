import { describe, expect, it } from "vitest";
import { categoryPhoto, outletPhoto, photoOr, SITE_PHOTOS, spacePhoto } from "./photos";

describe("site photos", () => {
  it("CMS photo wins over the sample", () => {
    expect(photoOr("https://cdn/x.jpg", SITE_PHOTOS.hero)).toBe("https://cdn/x.jpg");
    expect(photoOr("  ", SITE_PHOTOS.hero)).toBe(SITE_PHOTOS.hero);
    expect(photoOr(null, SITE_PHOTOS.hero)).toBe(SITE_PHOTOS.hero);
  });

  it("each store keeps its own photo, and the two Paddy stores differ", () => {
    expect(outletPhoto("paddy-store-pvj")).toBe(outletPhoto("paddy-store-pvj"));
    expect(outletPhoto("paddy-store-pvj")).not.toBe(outletPhoto("paddy-store-kopo"));
  });

  it("Suasana sections follow their subject", () => {
    expect(spacePhoto("Meja workshop", 1)).toBe(SITE_PHOTOS.accessories);
    expect(spacePhoto("Paddy Experience", 2)).toBe(SITE_PHOTOS.studio);
    expect(spacePhoto("Etalase case", 3)).toBe(SITE_PHOTOS.cases);
    expect(spacePhoto("Spot foto", 0)).toBe(SITE_PHOTOS.bags);
  });

  it("studio service categories", () => {
    expect(categoryPhoto("Custom Case")).toBe(SITE_PHOTOS.cases);
    expect(categoryPhoto("Personalisasi")).toBe(SITE_PHOTOS.pods);
    expect(categoryPhoto("Workshop")).toBe(SITE_PHOTOS.accessories);
    expect(categoryPhoto("Gadget Care")).toBe(SITE_PHOTOS.watch);
    expect(categoryPhoto("Signature")).toBe(SITE_PHOTOS.studio);
    expect(categoryPhoto("Lainnya")).toBe(SITE_PHOTOS.bags);
  });
});
