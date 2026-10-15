/**
 * Sample photos for the public site (see public/site/photos/CREDITS.md):
 * Paddy products stuck like stickers on the Paddy doodle backgrounds. Every
 * page prefers the photo set in the CMS; these fill the gaps until real
 * Paddy Store photos are uploaded, chosen so the same subject always gets the
 * same photo.
 */
export const SITE_PHOTOS = {
  hero: "/site/photos/paddy-hero.webp",
  cases: "/site/photos/paddy-cases.webp",
  bags: "/site/photos/paddy-bags.webp",
  pods: "/site/photos/paddy-pods.webp",
  accessories: "/site/photos/paddy-accessories.webp",
  watch: "/site/photos/paddy-watch.webp",
  studio: "/site/photos/paddy-studio.webp",
} as const;

/** The CMS photo when set, otherwise the sample. */
export function photoOr(src: string | null | undefined, fallback: string): string {
  return src?.trim() ? src : fallback;
}

const OUTLET_PHOTOS = [SITE_PHOTOS.cases, SITE_PHOTOS.accessories, SITE_PHOTOS.pods, SITE_PHOTOS.bags] as const;

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** A stable photo per store (by slug), so the list and the store page match. */
export function outletPhoto(slug: string): string {
  return OUTLET_PHOTOS[hash(slug) % OUTLET_PHOTOS.length];
}

/** A photo for a "Suasana" section, picked from its title, else by position. */
export function spacePhoto(title: string, index: number): string {
  const t = title.toLowerCase();
  if (/workshop|kelas|class|charm|beads|rangkai/.test(t)) return SITE_PHOTOS.accessories;
  if (/studio|experience|custom|desain|design|cetak|print/.test(t)) return SITE_PHOTOS.studio;
  if (/case|etalase|display|rak|koleksi/.test(t)) return SITE_PHOTOS.cases;
  if (/tas|bag|foto|photo|spot|selfie/.test(t)) return SITE_PHOTOS.bags;
  if (/kasir|tunggu|lounge|santai|kopi/.test(t)) return SITE_PHOTOS.pods;
  const rotation = [SITE_PHOTOS.cases, SITE_PHOTOS.studio, SITE_PHOTOS.accessories, SITE_PHOTOS.bags];
  return rotation[index % rotation.length];
}

/** A photo for a studio-service category heading. */
export function categoryPhoto(category: string): string {
  const c = category.toLowerCase();
  if (/workshop|kelas|class|craft/.test(c)) return SITE_PHOTOS.accessories;
  if (/case|desain|design/.test(c)) return SITE_PHOTOS.cases;
  if (/personal|nama|engrav|grafir/.test(c)) return SITE_PHOTOS.pods;
  if (/gadget|care|watch|servis|service/.test(c)) return SITE_PHOTOS.watch;
  if (/signature|party|paket|package/.test(c)) return SITE_PHOTOS.studio;
  return SITE_PHOTOS.bags;
}
