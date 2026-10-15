/**
 * Paddy Experience — desain custom case (The Experience Room).
 *
 * Katalog (merk & tipe HP, layout 2/3 gambar, tema stiker, font nama, background)
 * berasal dari backend (`GET /api/public/spa/experience-catalog`, sumbernya
 * backend/internal/modules/spa/catalog/experience.json); gambarnya di
 * public/experience/**. Server memvalidasi ulang setiap desain dan menyimpan
 * snapshot lengkap (kode + nama + gambar) per layanan booking.
 */

export interface ExperienceLayout {
  code: string;
  name: string;
  slots: number;
}

export interface ExperienceBrand {
  code: string;
  name: string;
  models: string[];
}

export interface ExperienceImage {
  code: string;
  name: string;
  image: string;
}

export interface ExperienceTheme {
  code: string;
  name: string;
  cover: string;
  stickers: ExperienceImage[];
}

export interface ExperienceFont {
  code: string;
  name: string;
  sample: string;
}

export interface ExperienceCatalog {
  price: number;
  layouts: ExperienceLayout[];
  brands: ExperienceBrand[];
  backgrounds: ExperienceImage[];
  themes: ExperienceTheme[];
  fonts: ExperienceFont[];
  name_max_length: number;
}

export interface CaseDesignSticker {
  theme: string;
  theme_name?: string;
  code: string;
  name?: string;
  image?: string;
}

/** Desain tersimpan (snapshot server) atau yang dikirim (cukup kodenya). */
export interface CaseDesign {
  brand: string;
  brand_name?: string;
  model: string;
  layout: string;
  layout_name?: string;
  stickers: CaseDesignSticker[];
  background: string;
  background_name?: string;
  background_image?: string;
  name: string;
  font: string;
  font_name?: string;
}

/** Desain yang sedang diisi pelanggan/crew (boleh belum lengkap). */
export interface CaseDraft {
  brand: string;
  model: string;
  layout: string;
  /** Satu entri per slot layout; `null` = slot belum diisi. */
  stickers: (CaseDesignSticker | null)[];
  /** Tema yang sedang dibuka per slot (bisa beda dari stiker terpilih). */
  slotThemes: string[];
  withName: boolean | null;
  name: string;
  font: string;
  background: string;
}

export function emptyDraft(catalog?: ExperienceCatalog | null): CaseDraft {
  const layout = catalog?.layouts.find((l) => l.slots === 3) ?? catalog?.layouts[0];
  const slots = layout?.slots ?? 3;
  const theme = catalog?.themes[0]?.code ?? "";
  return {
    brand: "",
    model: "",
    layout: layout?.code ?? "",
    stickers: Array.from({ length: slots }, () => null),
    slotThemes: Array.from({ length: slots }, (_, i) => catalog?.themes[i % (catalog?.themes.length || 1)]?.code ?? theme),
    withName: null,
    name: "",
    font: "",
    background: "",
  };
}

/** Desain tersimpan → draft yang bisa diedit. */
export function draftFromDesign(design: CaseDesign | null | undefined, catalog: ExperienceCatalog): CaseDraft {
  if (!design) return emptyDraft(catalog);
  const layout = catalog.layouts.find((l) => l.code === design.layout);
  const slots = layout?.slots ?? design.stickers.length;
  const stickers = Array.from({ length: slots }, (_, i) => design.stickers[i] ?? null);
  return {
    brand: design.brand,
    model: design.model,
    layout: layout?.code ?? design.layout,
    stickers,
    slotThemes: stickers.map((s, i) => s?.theme ?? catalog.themes[i % catalog.themes.length]?.code ?? ""),
    withName: design.name ? true : false,
    name: design.name ?? "",
    font: design.font ?? "",
    background: design.background,
  };
}

/** Ganti layout: stiker yang sudah dipilih dipertahankan sebanyak slot baru. */
export function withLayout(draft: CaseDraft, layout: ExperienceLayout, catalog: ExperienceCatalog): CaseDraft {
  const stickers = Array.from({ length: layout.slots }, (_, i) => draft.stickers[i] ?? null);
  const slotThemes = Array.from(
    { length: layout.slots },
    (_, i) => draft.slotThemes[i] ?? catalog.themes[i % catalog.themes.length]?.code ?? ""
  );
  return { ...draft, layout: layout.code, stickers, slotThemes };
}

export type DraftSection = "hp" | "layout" | "stiker" | "nama" | "background";

/** Bagian yang belum lengkap, berurutan seperti di konfigurator. */
export function missingSections(draft: CaseDraft, catalog: ExperienceCatalog): DraftSection[] {
  const missing: DraftSection[] = [];
  const brand = catalog.brands.find((b) => b.code === draft.brand);
  if (!brand || !brand.models.includes(draft.model)) missing.push("hp");
  const layout = catalog.layouts.find((l) => l.code === draft.layout);
  if (!layout) missing.push("layout");
  if (!layout || draft.stickers.length !== layout.slots || draft.stickers.some((s) => !s)) missing.push("stiker");
  if (draft.withName === null) missing.push("nama");
  else if (draft.withName && (!cleanName(draft.name) || !catalog.fonts.some((f) => f.code === draft.font))) missing.push("nama");
  if (!catalog.backgrounds.some((b) => b.code === draft.background)) missing.push("background");
  return missing;
}

export function isDraftComplete(draft: CaseDraft | undefined, catalog: ExperienceCatalog | undefined): boolean {
  return !!draft && !!catalog && missingSections(draft, catalog).length === 0;
}

/** Nama dirapikan seperti di server: spasi ganda dipadatkan, ujung dipangkas. */
export function cleanName(name: string): string {
  return name.split(/\s+/).filter(Boolean).join(" ");
}

/** Draft lengkap → body `design` untuk API (hanya kode). */
export function draftToDesign(draft: CaseDraft): CaseDesign {
  const named = !!draft.withName && !!cleanName(draft.name);
  return {
    brand: draft.brand,
    model: draft.model,
    layout: draft.layout,
    stickers: draft.stickers.filter((s): s is CaseDesignSticker => !!s).map((s) => ({ theme: s.theme, code: s.code })),
    background: draft.background,
    name: named ? cleanName(draft.name) : "",
    font: named ? draft.font : "",
  };
}

/**
 * Draft (lengkap atau belum) → tampilan desain dengan nama & gambar dari katalog,
 * untuk pratinjau dan ringkasan sebelum disimpan.
 */
export function resolveDraft(draft: CaseDraft, catalog: ExperienceCatalog): CaseDesign {
  const brand = catalog.brands.find((b) => b.code === draft.brand);
  const layout = catalog.layouts.find((l) => l.code === draft.layout);
  const bg = catalog.backgrounds.find((b) => b.code === draft.background);
  const font = catalog.fonts.find((f) => f.code === draft.font);
  const named = !!draft.withName && !!cleanName(draft.name);
  return {
    brand: draft.brand,
    brand_name: brand?.name,
    model: draft.model,
    layout: draft.layout,
    layout_name: layout?.name,
    stickers: draft.stickers.map((s) => {
      if (!s) return { theme: "", code: "" };
      const theme = catalog.themes.find((t) => t.code === s.theme);
      const sticker = theme?.stickers.find((x) => x.code === s.code);
      return { theme: s.theme, theme_name: theme?.name, code: s.code, name: sticker?.name, image: sticker?.image };
    }),
    background: draft.background,
    background_name: bg?.name,
    background_image: bg?.image,
    name: named ? cleanName(draft.name) : "",
    font: named ? draft.font : "",
    font_name: named ? font?.name : undefined,
  };
}

/** Ringkasan satu baris — sama dengan spa.DesignSummary (Go) untuk catatan kasir. */
export function designSummary(design: CaseDesign): string {
  const stickers = design.stickers.filter((s) => s.code);
  const parts = [
    design.model,
    design.background_name ?? design.background,
    `${stickers.length} stiker: ${stickers.map((s) => s.name ?? s.code).join(", ")}`,
    design.name ? `Nama: ${design.name} (${design.font_name ?? design.font})` : "Tanpa nama",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Posisi stiker di punggung case (persen kotak HP), per jumlah slot. */
export interface StickerSpot {
  x: number;
  y: number;
  size: number;
  rotate: number;
}

const SPOTS: Record<number, StickerSpot[]> = {
  1: [{ x: 52, y: 50, size: 56, rotate: -6 }],
  2: [
    { x: 64, y: 31, size: 48, rotate: -8 },
    { x: 37, y: 60, size: 50, rotate: 7 },
  ],
  3: [
    { x: 71, y: 25, size: 40, rotate: 9 },
    { x: 33, y: 47, size: 42, rotate: -8 },
    { x: 66, y: 66, size: 40, rotate: 6 },
  ],
};

export function stickerSpots(slots: number): StickerSpot[] {
  if (SPOTS[slots]) return SPOTS[slots];
  // Cadangan untuk layout baru: zig-zag dari atas ke bawah.
  return Array.from({ length: slots }, (_, i) => ({
    x: i % 2 === 0 ? 66 : 34,
    y: 22 + (i * 52) / Math.max(1, slots - 1),
    size: Math.max(26, 44 - slots * 2),
    rotate: i % 2 === 0 ? 7 : -7,
  }));
}

/** Kotak HP di dalam gambar background (piksel gambar 638×640, mockup seragam). */
export const CASE_FRAME = { imageWidth: 638, imageHeight: 640, left: 219, top: 103, width: 199, height: 394 } as const;

/** Model HP yang cocok dengan pencarian (abaikan huruf besar & spasi). */
export function filterModels(models: string[], query: string): string[] {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return models;
  return models.filter((m) => m.toLowerCase().replace(/\s+/g, "").includes(q));
}
