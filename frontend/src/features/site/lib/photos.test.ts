import { describe, expect, it } from "vitest";
import { categoryPhoto, outletPhoto, photoOr, SITE_PHOTOS, spacePhoto } from "./photos";

describe("site photos", () => {
  it("CMS photo wins over the sample", () => {
    expect(photoOr("https://cdn/x.jpg", SITE_PHOTOS.hero)).toBe("https://cdn/x.jpg");
    expect(photoOr("  ", SITE_PHOTOS.hero)).toBe(SITE_PHOTOS.hero);
    expect(photoOr(null, SITE_PHOTOS.hero)).toBe(SITE_PHOTOS.hero);
  });

  it("each outlet keeps its own photo, and the two Mizu outlets differ", () => {
    expect(outletPhoto("mizu-westhoff")).toBe(outletPhoto("mizu-westhoff"));
    expect(outletPhoto("mizu-westhoff")).not.toBe(outletPhoto("mizu-signature-riau"));
  });

  it("Suasana sections follow their subject", () => {
    expect(spacePhoto("Ruang refleksi", 1)).toBe(SITE_PHOTOS.reflexology);
    expect(spacePhoto("Couple & keluarga", 2)).toBe(SITE_PHOTOS.relax);
    expect(spacePhoto("Ruang ganti", 3)).toBe(SITE_PHOTOS.hero);
    expect(spacePhoto("Ruang treatment", 0)).toBe(SITE_PHOTOS.backMassage);
  });

  it("treatment categories", () => {
    expect(categoryPhoto("Refleksi")).toBe(SITE_PHOTOS.reflexology);
    expect(categoryPhoto("Signature")).toBe(SITE_PHOTOS.stonesOrchid);
    expect(categoryPhoto("Facial")).toBe(SITE_PHOTOS.headMassage);
    expect(categoryPhoto("Body Treatment")).toBe(SITE_PHOTOS.hero);
    expect(categoryPhoto("Massage")).toBe(SITE_PHOTOS.backMassage);
  });
});
