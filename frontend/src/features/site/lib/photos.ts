/**
 * Sample photos for the public site (CC0 stock, see public/site/photos/CREDITS.md).
 * Every page prefers the photo set in the CMS; these fill the gaps until real
 * Mizu photos are uploaded, chosen so the same subject always gets the same photo.
 */
export const SITE_PHOTOS = {
  hero: "/site/photos/mizu-hero.webp",
  hotStone: "/site/photos/mizu-hot-stone.webp",
  reflexology: "/site/photos/mizu-reflexology.webp",
  stonesOrchid: "/site/photos/mizu-stones-orchid.webp",
  relax: "/site/photos/mizu-relax.webp",
  backMassage: "/site/photos/mizu-back-massage.webp",
  headMassage: "/site/photos/mizu-head-massage.webp",
} as const;

/** The CMS photo when set, otherwise the sample. */
export function photoOr(src: string | null | undefined, fallback: string): string {
  return src?.trim() ? src : fallback;
}

const OUTLET_PHOTOS = [SITE_PHOTOS.stonesOrchid, SITE_PHOTOS.hotStone, SITE_PHOTOS.relax, SITE_PHOTOS.hero] as const;

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** A stable photo per outlet (by slug), so the list and the outlet page match. */
export function outletPhoto(slug: string): string {
  return OUTLET_PHOTOS[hash(slug) % OUTLET_PHOTOS.length];
}

/** A photo for a "Suasana" section, picked from its title, else by position. */
export function spacePhoto(title: string, index: number): string {
  const t = title.toLowerCase();
  if (/refleks|kaki|foot/.test(t)) return SITE_PHOTOS.reflexology;
  if (/couple|keluarga|pasangan|berdua|family/.test(t)) return SITE_PHOTOS.relax;
  if (/ganti|loker|mandi|shower|locker/.test(t)) return SITE_PHOTOS.hero;
  if (/tunggu|lobi|lobby|resepsi/.test(t)) return SITE_PHOTOS.stonesOrchid;
  if (/treatment|pijat|massage|ruang/.test(t)) return SITE_PHOTOS.backMassage;
  const rotation = [SITE_PHOTOS.backMassage, SITE_PHOTOS.reflexology, SITE_PHOTOS.relax, SITE_PHOTOS.hero];
  return rotation[index % rotation.length];
}

/** A photo for a treatment category heading. */
export function categoryPhoto(category: string): string {
  const c = category.toLowerCase();
  if (/refleks|reflex|kaki/.test(c)) return SITE_PHOTOS.reflexology;
  if (/signature|ritual|stone|batu/.test(c)) return SITE_PHOTOS.stonesOrchid;
  if (/facial|wajah|kepala|head|totok/.test(c)) return SITE_PHOTOS.headMassage;
  if (/body|lulur|scrub|spa/.test(c)) return SITE_PHOTOS.hero;
  return SITE_PHOTOS.backMassage;
}
