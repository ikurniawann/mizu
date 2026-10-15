import { describe, expect, it } from "vitest";
import { isPublicAuthPath } from "./middleware";

describe("aset foto website publik", () => {
  it("foto stok beranda & booking tidak dialihkan ke /login", () => {
    expect(isPublicAuthPath("/site/photos/paddy-hero.webp")).toBe(true);
    expect(isPublicAuthPath("/site/sample/training-session.webp")).toBe(true);
  });
  it("gambar katalog desain custom case terbuka untuk booking online", () => {
    expect(isPublicAuthPath("/experience/backgrounds/black-sky.webp")).toBe(true);
    expect(isPublicAuthPath("/experience/stickers/baking-pals/baking-pals-a.webp")).toBe(true);
  });
  it("prefix lain di /site tetap tidak terbuka", () => {
    expect(isPublicAuthPath("/site/private.webp")).toBe(false);
  });
});
