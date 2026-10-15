#!/usr/bin/env node
/**
 * Menghasilkan foto contoh website Paddy (public/site/photos/paddy-*.webp):
 * foto produk Paddy ditempel sebagai "stiker" miring di atas latar doodle
 * Paddy (scripts/brand-source/doodle-*.webp). Dipakai src/features/site/lib/photos.ts
 * sampai foto asli diunggah lewat CMS.
 *
 * Foto produk dibaca dari public/products/paddy (atau PADDY_PRODUCTS_DIR).
 * Jalankan: node scripts/generate-site-photos.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "scripts", "brand-source");
const PRODUCTS = process.env.PADDY_PRODUCTS_DIR || path.join(ROOT, "public", "products", "paddy");
const OUT = path.join(ROOT, "public", "site", "photos");
mkdirSync(OUT, { recursive: true });

const W = 1600;
const H = 1000;
const NAVY = "#232c6b";

/** Kartu stiker: foto produk membulat, bingkai putih, bayangan navy tegas, miring. */
async function sticker(file, size, angle) {
  const radius = Math.round(size * 0.12);
  const border = Math.round(size * 0.035);
  const inner = size - border * 2;
  const mask = Buffer.from(`<svg width="${inner}" height="${inner}"><rect width="${inner}" height="${inner}" rx="${radius - border}" fill="#fff"/></svg>`);
  const photo = await sharp(path.join(PRODUCTS, file)).resize(inner, inner, { fit: "cover" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const shadowOffset = Math.round(size * 0.035);
  const full = size + shadowOffset;
  const frame = Buffer.from(`<svg width="${full}" height="${full}">
    <rect x="${shadowOffset}" y="${shadowOffset}" width="${size}" height="${size}" rx="${radius}" fill="${NAVY}"/>
    <rect width="${size}" height="${size}" rx="${radius}" fill="#ffffff" stroke="${NAVY}" stroke-width="${Math.max(3, Math.round(size * 0.012))}"/>
  </svg>`);
  return sharp(frame)
    .composite([{ input: photo, left: border, top: border }])
    .png()
    .toBuffer()
    .then((b) => sharp(b).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
}

/** Satu adegan: latar doodle + beberapa stiker produk (x, y = titik tengah). */
async function scene(name, background, items) {
  const layers = [];
  for (const { file, size, angle, x, y } of items) {
    const buf = await sticker(file, size, angle);
    const meta = await sharp(buf).metadata();
    layers.push({ input: buf, left: Math.round(x - meta.width / 2), top: Math.round(y - meta.height / 2) });
  }
  const out = path.join(OUT, `paddy-${name}.webp`);
  await sharp(path.join(SRC, `doodle-${background}.webp`))
    .resize(W, H, { fit: "cover" })
    .composite(layers)
    .webp({ quality: 82 })
    .toFile(out);
  console.log("ok", path.relative(ROOT, out));
}

// Hero: koleksi Catalogue Case (kolaborasi ilustrator lokal) di latar magenta.
await scene("hero", "pink", [
  { file: "pdy-ct-003.webp", size: 380, angle: -12, x: 980, y: 430 },
  { file: "pdy-ct-007.webp", size: 400, angle: 6, x: 1300, y: 360 },
  { file: "pdy-ct-011.webp", size: 340, angle: -4, x: 1130, y: 720 },
  { file: "pdy-ct-005.webp", size: 300, angle: 14, x: 1440, y: 740 },
]);
// Kartu layanan studio: case custom.
await scene("cases", "sunny", [
  { file: "pdy-ct-001.webp", size: 420, angle: -8, x: 520, y: 470 },
  { file: "pdy-ct-012.webp", size: 440, angle: 7, x: 960, y: 520 },
  { file: "pdy-cs-001.webp", size: 330, angle: -3, x: 1330, y: 430 },
]);
// Promo pelajar / bundle: tas Paddy Bags.
await scene("bags", "lilac", [
  { file: "pdy-bg-001.webp", size: 400, angle: -9, x: 480, y: 500 },
  { file: "pdy-bg-002.webp", size: 420, angle: 5, x: 860, y: 470 },
  { file: "pdy-bg-004.webp", size: 380, angle: -4, x: 1220, y: 520 },
]);
// Layanan unggulan: Paddy Pods & Pop Socket.
await scene("pods", "pink", [
  { file: "pdy-pd-002.webp", size: 360, angle: 8, x: 470, y: 470 },
  { file: "pdy-ps-002.webp", size: 380, angle: -7, x: 820, y: 520 },
  { file: "pdy-pd-005.webp", size: 360, angle: 4, x: 1170, y: 460 },
]);
// Belanja bareng teman: aksesori, strap beads, pop socket.
await scene("accessories", "lilac", [
  { file: "pdy-ac-005.webp", size: 360, angle: -10, x: 430, y: 480 },
  { file: "pdy-ps-003.webp", size: 380, angle: 6, x: 800, y: 520 },
  { file: "pdy-ac-004.webp", size: 340, angle: -3, x: 1150, y: 450 },
  { file: "pdy-ps-006.webp", size: 300, angle: 12, x: 1420, y: 640 },
]);
// Header wizard booking: G-Series Watch & strap.
await scene("watch", "sunny", [
  { file: "pdy-wt-001.webp", size: 420, angle: -6, x: 560, y: 470 },
  { file: "pdy-wt-004.webp", size: 340, angle: 8, x: 960, y: 520 },
  { file: "pdy-st-002.webp", size: 300, angle: -12, x: 1280, y: 450 },
]);
// Status booking / studio: pop socket printing & tempered glass.
await scene("studio", "pink", [
  { file: "pdy-ps-007.webp", size: 440, angle: -6, x: 560, y: 480 },
  { file: "pdy-ac-001.webp", size: 380, angle: 7, x: 1000, y: 520 },
  { file: "pdy-ct-015.webp", size: 320, angle: -4, x: 1340, y: 450 },
]);
