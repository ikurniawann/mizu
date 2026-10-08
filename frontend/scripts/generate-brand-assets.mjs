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
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = path.join(ROOT, "public", "brand");
mkdirSync(BRAND, { recursive: true });

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

const JOBS = [
  ["wordmark-black.png", wordmark(COLORS.mocha, COLORS.goldDeep), true],
  ["wordmark-white.png", wordmark(COLORS.ivory, COLORS.gold), true],
  ["lockup-black.png", lockup(COLORS.mocha, COLORS.goldDeep), true],
  ["lockup-white.png", lockup(COLORS.ivory, COLORS.gold), true],
  ["mark-lime.png", mark(COLORS.gold), true],
  ["mark-black.png", mark(COLORS.mocha), true],
  ["mark-white.png", mark(COLORS.ivory), true],
  ["favicon-64.png", appIcon(64, 14), true],
  ["icon-192.png", appIcon(192, 42), true],
  ["icon-512.png", appIcon(512, 112), true],
  ["apple-touch-icon.png", appIcon(180, 0), false],
  ["pattern.png", pattern(), true],
  ["wallpaper.webp", wallpaper(), false],
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const p = await ctx.newPage();
for (const [file, html, transparent] of JOBS) {
  await p.setContent(html, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  const size = await p.evaluate(() => ({ width: document.body.clientWidth, height: document.body.clientHeight }));
  await p.setViewportSize(size);
  const out = file.endsWith(".webp") ? path.join(BRAND, file.replace(".webp", ".png")) : path.join(BRAND, file);
  await p.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, ...size } });
  console.log("ok", file, `${size.width}x${size.height}`);
}
await browser.close();
