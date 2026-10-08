#!/usr/bin/env node
/**
 * Menghasilkan aset brand Mizu di public/brand dan src/app (icon, apple-icon)
 * dari SVG: ikon tumpukan batu zen bergaya garis + wordmark "MIZU" serif
 * berspasi lebar (referensi: instagram.com/mizufamily.id).
 *
 * Ukuran kanvas mengikuti aset lama supaya width/height di komponen tetap valid.
 * Butuh Chromium Playwright: PLAYWRIGHT_CORE=/path/ke/playwright-core node scripts/generate-brand-assets.mjs
 */
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = path.join(ROOT, "public", "brand");
const MEMBER_ICONS = path.join(ROOT, "public", "member-assets", "icons");
mkdirSync(BRAND, { recursive: true });
mkdirSync(MEMBER_ICONS, { recursive: true });

export const COLORS = {
  espresso: "#241b16",
  mocha: "#3d2b20",
  gold: "#d6b47a",
  goldDeep: "#b8893f",
  ivory: "#fffaf2",
  sand: "#f3ece2",
};

/** Tumpukan batu: kepala bulat, batu tengah, batu dasar pipih. viewBox 0 0 100 100. */
function stones(color, stroke = 3.2) {
  return `<g fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="50" cy="22" r="9.5"/>
    <path d="M33 47.5c0-8 7.6-13.5 17-13.5s17 5.5 17 13.5-7.6 12-17 12-17-4-17-12z"/>
    <path d="M20 78c0-10.5 13.4-17.5 30-17.5S80 67.5 80 78s-13.4 14-30 14-30-3.5-30-14z"/>
  </g>`;
}

const FONT = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Manrope:wght@500&display=swap" rel="stylesheet">`;

function page(w, h, body, bg = "transparent") {
  return `<!doctype html><html><head><meta charset="utf-8">${FONT}<style>
    html,body{margin:0;width:${w}px;height:${h}px;background:${bg};overflow:hidden}
    .wm{font-family:'Cormorant Garamond',serif;font-weight:500;letter-spacing:.42em;line-height:1}
  </style></head><body>${body}</body></html>`;
}

function lockup(textColor, iconColor) {
  // 1200 × 165 lockup horizontal: ikon | MIZU | garis | tagline dua baris.
  return page(1200, 165, `<div style="display:flex;align-items:center;justify-content:center;height:165px;gap:34px">
    <svg width="148" height="148" viewBox="0 0 100 100">${stones(iconColor, 3.6)}</svg>
    <div class="wm" style="font-size:124px;color:${textColor};margin-right:-.42em;padding-top:6px">MIZU</div>
    <div style="width:2px;height:96px;background:${iconColor};opacity:.8"></div>
    <div style="font-family:Manrope,sans-serif;font-weight:500;font-size:27px;line-height:1.55;letter-spacing:.3em;color:${textColor};opacity:.85;text-transform:uppercase">Family Massage<br>&amp; Reflexology</div>
  </div>`);
}

/** Wordmark ringkas untuk UI (sidebar, header): ikon + MIZU, kanvas pas isi. */
export const WORDMARK = { width: 640, height: 165 };
function wordmark(textColor, iconColor) {
  return page(WORDMARK.width, WORDMARK.height, `<div style="display:flex;align-items:center;height:165px;gap:30px;padding-left:2px">
    <svg width="150" height="150" viewBox="0 0 100 100">${stones(iconColor, 3.8)}</svg>
    <div class="wm" style="font-size:132px;color:${textColor};letter-spacing:.3em;margin-right:-.3em;padding-top:8px">MIZU</div>
  </div>`);
}

/** Ikon saja, persegi. */
function mark(color) {
  return page(210, 210, `<svg width="210" height="210" viewBox="0 0 100 100">${stones(color, 4.6)}</svg>`);
}

function appIcon(size, radius) {
  const inner = Math.round(size * 0.62);
  return page(size, size, `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(120% 120% at 30% 20%, ${COLORS.mocha}, ${COLORS.espresso} 70%)">
    <svg width="${inner}" height="${inner}" viewBox="0 0 100 100">${stones(COLORS.gold, size < 100 ? 6 : 4.4)}</svg></div>`);
}

/**
 * Favicon tab browser: digambar besar (256) dengan garis tebal lalu diperkecil
 * browser, supaya tumpukan batu tetap terbaca di 16–48 px.
 */
function favicon(size) {
  const inner = Math.round(size * 0.86);
  return page(size, size, `<div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.22)}px;display:flex;align-items:center;justify-content:center;background:${COLORS.espresso}">
    <svg width="${inner}" height="${inner}" viewBox="0 0 100 100">${stones(COLORS.gold, 9)}</svg></div>`);
}

/** Ikon maskable PWA: latar penuh, ikon di zona aman (radius 40%). */
function maskableIcon(size) {
  const inner = Math.round(size * 0.46);
  return page(size, size, `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(120% 120% at 30% 20%, ${COLORS.mocha}, ${COLORS.espresso} 70%)">
    <svg width="${inner}" height="${inner}" viewBox="0 0 100 100">${stones(COLORS.gold, 4.6)}</svg></div>`);
}

function veins(w, h, color, opacity, count, seed) {
  let s = seed;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  let paths = "";
  for (let i = 0; i < count; i++) {
    let x = r() * w;
    let y = -40;
    let d = `M${x.toFixed(1)} ${y}`;
    while (y < h + 40) {
      const nx = x + (r() - 0.35) * 220;
      const ny = y + 80 + r() * 160;
      d += ` Q${(x + (r() - 0.5) * 260).toFixed(1)} ${((y + ny) / 2).toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}`;
      x = nx;
      y = ny;
    }
    paths += `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${(opacity * (0.4 + r() * 0.6)).toFixed(2)}" stroke-width="${(0.8 + r() * 1.8).toFixed(1)}"/>`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="position:absolute;inset:0">${paths}</svg>`;
}

function pattern() {
  return page(1200, 563, `<div style="position:relative;width:1200px;height:563px">${veins(1200, 563, COLORS.ivory, 0.9, 9, 7)}</div>`);
}

function wallpaper() {
  return page(2560, 1600, `<div style="position:relative;width:2560px;height:1600px;overflow:hidden;
      background:radial-gradient(60% 70% at 78% 30%, #5a4334 0%, transparent 60%), radial-gradient(70% 80% at 10% 100%, #4a3628 0%, transparent 65%), linear-gradient(135deg, ${COLORS.espresso}, #2f231b 55%, ${COLORS.mocha})">
    ${veins(2560, 1600, COLORS.gold, 0.28, 7, 11)}
    <svg style="position:absolute;right:220px;top:330px;opacity:.16" width="900" height="900" viewBox="0 0 100 100">${stones(COLORS.gold, 1.4)}</svg>
  </div>`, COLORS.espresso);
}

// [file, html, transparent, dir?, downscaleTo?]
const JOBS = [
  ["wordmark-black.png", wordmark(COLORS.mocha, COLORS.goldDeep), true],
  ["wordmark-white.png", wordmark(COLORS.ivory, COLORS.gold), true],
  ["lockup-black.png", lockup(COLORS.mocha, COLORS.goldDeep), true],
  ["lockup-white.png", lockup(COLORS.ivory, COLORS.gold), true],
  ["mark-lime.png", mark(COLORS.gold), true],
  ["mark-black.png", mark(COLORS.mocha), true],
  ["mark-white.png", mark(COLORS.ivory), true],
  // Favicon: nama berawalan "mizu-" supaya browser tidak memakai cache favicon lama.
  ["mizu-favicon-16.png", favicon(256), true, BRAND, 16],
  ["mizu-favicon-32.png", favicon(256), true, BRAND, 32],
  ["mizu-favicon-48.png", favicon(256), true, BRAND, 48],
  ["mizu-favicon-64.png", favicon(256), true, BRAND, 64],
  ["favicon-64.png", favicon(256), true, BRAND, 64],
  ["icon-192.png", appIcon(192, 42), true],
  ["icon-512.png", appIcon(512, 112), true],
  ["apple-touch-icon.png", appIcon(180, 0), false],
  ["mizu-apple-touch-icon.png", appIcon(180, 0), false],
  ["icon-192.png", appIcon(192, 42), true, MEMBER_ICONS],
  ["icon-512.png", appIcon(512, 112), true, MEMBER_ICONS],
  ["icon-512-maskable.png", maskableIcon(512), false, MEMBER_ICONS],
  ["apple-touch-icon.png", appIcon(180, 0), false, MEMBER_ICONS],
  ["pattern.png", pattern(), true],
  ["wallpaper.webp", wallpaper(), false],
];

/** ICO berisi PNG (didukung semua browser modern). */
function writeIco(out, pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  writeFileSync(out, Buffer.concat([header, ...pngs.map((p) => p.data)]));
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const p = await ctx.newPage();

/** Perkecil PNG / ubah ke WebP lewat canvas Chromium (tanpa dependensi gambar). */
async function convert(file, { size, type = "image/png", quality } = {}) {
  const data = readFileSync(file).toString("base64");
  const url = await p.evaluate(async ({ data, size, type, quality }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const w = size || img.naturalWidth;
    const h = size || img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, w, h);
    return c.toDataURL(type, quality);
  }, { data, size, type, quality });
  return Buffer.from(url.split(",")[1], "base64");
}

for (const [file, html, transparent, dir = BRAND, downscale] of JOBS) {
  await p.setContent(html, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  const size = await p.evaluate(() => ({ width: document.body.clientWidth, height: document.body.clientHeight }));
  await p.setViewportSize(size);
  const out = path.join(dir, file.endsWith(".webp") ? file.replace(".webp", ".png") : file);
  await p.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, ...size } });
  if (downscale) writeFileSync(out, await convert(out, { size: downscale }));
  if (file.endsWith(".webp")) {
    await p.setContent("<html><body></body></html>");
    writeFileSync(path.join(dir, file), await convert(out, { type: "image/webp", quality: 0.86 }));
    unlinkSync(out);
  }
  console.log("ok", path.relative(ROOT, path.join(dir, file)), downscale ? `${downscale}px` : `${size.width}x${size.height}`);
}

await p.setContent("<html><body></body></html>");
writeIco(path.join(ROOT, "public", "favicon.ico"), [16, 32, 48].map((s) => ({
  size: s, data: readFileSync(path.join(BRAND, `mizu-favicon-${s}.png`)),
})));
console.log("ok public/favicon.ico (16, 32, 48)");
// Aplikasi member memakai salinan logonya sendiri (public/member-assets/brand).
for (const f of ["mark-lime.png", "mark-white.png", "wordmark-black.png", "wordmark-white.png", "lockup-white.png", "pattern.png", "wallpaper.webp"]) {
  copyFileSync(path.join(BRAND, f), path.join(ROOT, "public", "member-assets", "brand", f));
}
console.log("ok public/member-assets/brand/*");
// Konvensi Next (app/icon.png, app/apple-icon.png) ikut diperbarui.
copyFileSync(path.join(BRAND, "mizu-favicon-64.png"), path.join(ROOT, "src", "app", "icon.png"));
copyFileSync(path.join(BRAND, "apple-touch-icon.png"), path.join(ROOT, "src", "app", "apple-icon.png"));
console.log("ok src/app/icon.png, src/app/apple-icon.png");
await browser.close();
