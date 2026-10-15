#!/usr/bin/env node
/**
 * Menghasilkan aset brand Paddy (paddy.id · @paddy.id) di public/brand,
 * public/member-assets dan src/app (icon, apple-icon) dari sumber di
 * scripts/brand-source:
 *   - paddy-wordmark.png  lettering "Paddy" magenta #e3066f (transparan)
 *   - paddy-p.png         monogram "P" (favicon lama Paddy)
 *   - doodle-*.webp       latar doodle Paddy (mata, bintang, hati, coretan)
 *   - Roundo-Bold.ttf     font tagline (OFL, lihat Roundo-OFL.txt)
 *
 * Doodle tambahan (mata "googly", sparkle, hati, coretan) digambar sebagai SVG.
 * Ukuran kanvas mengikuti aset lama supaya width/height di komponen tetap valid.
 * Jalankan: node scripts/generate-brand-assets.mjs (butuh `sharp`, dependensi app).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "scripts", "brand-source");
const BRAND = path.join(ROOT, "public", "brand");
const MEMBER_ICONS = path.join(ROOT, "public", "member-assets", "icons");
const MEMBER_BRAND = path.join(ROOT, "public", "member-assets", "brand");
for (const dir of [BRAND, MEMBER_ICONS, MEMBER_BRAND]) mkdirSync(dir, { recursive: true });

export const COLORS = {
  magenta: "#e3066f",
  berry: "#b8045a",
  plum: "#2a1024",
  navy: "#232c6b",
  sunny: "#ffcf3f",
  lilac: "#b9a4f2",
  cream: "#fffdf9",
  white: "#ffffff",
};

const FONT_FILE = path.join(SRC, "Roundo-Bold.ttf");
const WORDMARK_SRC = path.join(SRC, "paddy-wordmark.png");
const P_SRC = path.join(SRC, "paddy-p.png");

// ── Doodle SVG ──────────────────────────────────────────────────────────────

const svg = (w, h, body) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);

/** Sparkle empat sudut berpusat di (cx, cy). */
function sparkle(cx, cy, r, fill, stroke = "none", sw = 0) {
  const k = r * 0.2;
  return `<path d="M${cx} ${cy - r} C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy} C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r} C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy} C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r}Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
}

/** Hati berpusat di (cx, cy), lebar ±2r. */
function heart(cx, cy, r, fill, stroke = "none", sw = 0) {
  const s = r / 10;
  const p = (x, y) => `${(cx + x * s).toFixed(1)} ${(cy + y * s).toFixed(1)}`;
  return `<path d="M${p(0, 9)} C${p(-4, 6)} ${p(-10, 2)} ${p(-10, -3)} C${p(-10, -7)} ${p(-7, -9)} ${p(-4.5, -9)} C${p(-2.5, -9)} ${p(-1, -8)} ${p(0, -6)} C${p(1, -8)} ${p(2.5, -9)} ${p(4.5, -9)} C${p(7, -9)} ${p(10, -7)} ${p(10, -3)} C${p(10, 2)} ${p(4, 6)} ${p(0, 9)}Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
}

/** Sepasang mata "googly" khas doodle Paddy. (x, y) = pojok kiri atas, w = lebar total. */
function googlyEyes(x, y, w, { outline = COLORS.navy, pupil = COLORS.navy } = {}) {
  const rx = w * 0.235;
  const ry = rx * 1.18;
  const sw = Math.max(2, w * 0.045);
  const eye = (cx, tilt) => {
    const cy = y + ry + sw;
    const px = cx + rx * 0.18;
    const py = cy + ry * 0.12;
    const pr = rx * 0.62;
    return `<g transform="rotate(${tilt} ${cx} ${cy})">
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#ffffff" stroke="${outline}" stroke-width="${sw}"/>
      <circle cx="${px}" cy="${py}" r="${pr}" fill="${pupil}"/>
      ${sparkle(px - pr * 0.05, py - pr * 0.08, pr * 0.55, "#ffffff")}
    </g>`;
  };
  const left = x + sw + rx;
  const right = left + rx * 2 + w * 0.06;
  return eye(left, -8) + eye(right, 6);
}

/** Coretan bergelombang (squiggle). */
function squiggle(x, y, len, amp, stroke, sw, waves = 4) {
  const step = len / (waves * 2);
  let d = `M${x} ${y}`;
  for (let i = 0; i < waves * 2; i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    d += ` q${step / 2} ${dir * amp * 2} ${step} 0`;
  }
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`;
}

// ── Helpers raster ─────────────────────────────────────────────────────────

const canvas = (w, h, background = { r: 0, g: 0, b: 0, alpha: 0 }) =>
  sharp({ create: { width: w, height: h, channels: 4, background } });

/** Warnai ulang PNG transparan: bentuk dari alpha, isi warna solid. */
async function tint(file, color, width, height) {
  const shape = await sharp(file).resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const meta = await sharp(shape).metadata();
  return canvas(meta.width, meta.height, color).composite([{ input: shape, blend: "dest-in" }]).png().toBuffer();
}

/** Garis luar "stiker": salinan bentuk digeser melingkar di bawah bentuk asli. */
async function stickerOutline(shapePng, color, thickness) {
  const meta = await sharp(shapePng).metadata();
  const pad = thickness + 2;
  const w = meta.width + pad * 2;
  const h = meta.height + pad * 2;
  const solid = await canvas(meta.width, meta.height, color).composite([{ input: shapePng, blend: "dest-in" }]).png().toBuffer();
  const layers = [];
  for (let a = 0; a < 360; a += 15) {
    const rad = (a * Math.PI) / 180;
    layers.push({ input: solid, left: Math.round(pad + Math.cos(rad) * thickness), top: Math.round(pad + Math.sin(rad) * thickness) });
  }
  layers.push({ input: solid, left: pad, top: pad });
  layers.push({ input: shapePng, left: pad, top: pad });
  return canvas(w, h).composite(layers).png().toBuffer();
}

async function text(markup, size, color) {
  return sharp({
    text: {
      text: `<span foreground="${color}" letter_spacing="${Math.round(size * 0.04 * 1024)}">${markup}</span>`,
      font: `Roundo Bold ${size}`,
      fontfile: FONT_FILE,
      rgba: true,
      dpi: 72,
      spacing: Math.round(size * 0.12),
    },
  }).png().toBuffer();
}

async function save(buffer, file, dir = BRAND) {
  const out = path.join(dir, file);
  writeFileSync(out, buffer);
  const { width, height } = await sharp(buffer).metadata();
  console.log("ok", path.relative(ROOT, out), `${width}x${height}`);
  return out;
}

// ── Logo ───────────────────────────────────────────────────────────────────

/** Wordmark UI (sidebar, header): lettering Paddy + mata googly, kanvas 640 × 165. */
export const WORDMARK = { width: 640, height: 165 };
async function wordmark(color) {
  const mark = await tint(WORDMARK_SRC, color, 499, 165);
  return canvas(WORDMARK.width, WORDMARK.height)
    .composite([
      { input: mark, left: 0, top: 0 },
      { input: svg(130, 165, googlyEyes(4, 8, 108) + sparkle(92, 130, 15, COLORS.sunny, COLORS.navy, 3)), left: 504, top: 0 },
    ])
    .png()
    .toBuffer();
}

/** Lockup 1200 × 165: wordmark | garis | tagline dua baris. */
async function lockup(color, taglineColor, dividerColor) {
  const mark = await tint(WORDMARK_SRC, color, 499, 165);
  const tagline = await text("YOUR ADORABLE\nCOMPANION", 44, taglineColor);
  const tMeta = await sharp(tagline).metadata();
  return canvas(1200, 165)
    .composite([
      { input: mark, left: 40, top: 0 },
      { input: svg(130, 165, googlyEyes(6, 4, 112) + heart(100, 128, 15, COLORS.magenta, COLORS.navy, 3)), left: 546, top: 0 },
      { input: svg(6, 110, `<rect width="6" height="110" rx="3" fill="${dividerColor}"/>`), left: 700, top: 28 },
      { input: tagline, left: 736, top: Math.round((165 - tMeta.height) / 2) },
    ])
    .png()
    .toBuffer();
}

/** Monogram P persegi 210 × 210. */
async function mark(color, outline) {
  const p = await tint(P_SRC, color, 150, 170);
  const shape = outline ? await stickerOutline(p, outline, 12) : p;
  const meta = await sharp(shape).metadata();
  return canvas(210, 210)
    .composite([{ input: shape, left: Math.round((210 - meta.width) / 2), top: Math.round((210 - meta.height) / 2) }])
    .png()
    .toBuffer();
}

/** Ikon aplikasi: kotak magenta membulat, P putih, sparkle kuning. */
async function appIcon(size, radius, { bleed = false, scale = 0.62, sparkles = true } = {}) {
  const pSize = Math.round(size * scale);
  const p = await tint(P_SRC, COLORS.white, pSize, pSize);
  const meta = await sharp(p).metadata();
  const bg = svg(size, size, `<defs><radialGradient id="g" cx="30%" cy="22%" r="95%">
      <stop offset="0" stop-color="#f4529a"/><stop offset=".55" stop-color="${COLORS.magenta}"/><stop offset="1" stop-color="${COLORS.berry}"/></radialGradient></defs>
    <rect width="${size}" height="${size}" rx="${bleed ? 0 : radius}" fill="url(#g)"/>`);
  const deco = sparkles
    ? svg(size, size, sparkle(size * 0.78, size * 0.22, size * 0.085, COLORS.sunny) + sparkle(size * 0.2, size * 0.8, size * 0.05, "#ffffff"))
    : null;
  const layers = [{ input: bg, left: 0, top: 0 }];
  if (deco) layers.push({ input: deco, left: 0, top: 0 });
  layers.push({ input: p, left: Math.round((size - meta.width) / 2), top: Math.round((size - meta.height) / 2) });
  const img = canvas(size, size).composite(layers);
  return bleed ? img.flatten({ background: COLORS.magenta }).png().toBuffer() : img.png().toBuffer();
}

/** Favicon tab: digambar 256 px dengan P besar lalu diperkecil agar terbaca di 16–48 px. */
async function favicon(size) {
  const big = await appIcon(256, 56, { scale: 0.82, sparkles: false });
  return sharp(big).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();
}

// ── Pola & wallpaper ───────────────────────────────────────────────────────

/** Pola doodle putih transparan (dipakai di atas permukaan gelap, mix-blend screen). */
function patternSvg(w, h, seed) {
  let s = seed;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  let body = "";
  const cols = 8;
  const rows = 4;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = (i + 0.5) * (w / cols) + (r() - 0.5) * 60;
      const y = (j + 0.5) * (h / rows) + (r() - 0.5) * 50;
      const kind = Math.floor(r() * 5);
      const op = (0.55 + r() * 0.45).toFixed(2);
      if (kind === 0) body += `<g opacity="${op}">${sparkle(x, y, 14 + r() * 12, "#ffffff")}</g>`;
      else if (kind === 1) body += `<g opacity="${op}">${heart(x, y, 10 + r() * 8, "none", "#ffffff", 3)}</g>`;
      else if (kind === 2) body += `<g opacity="${op}">${squiggle(x - 40, y, 80, 6, "#ffffff", 4, 3)}</g>`;
      else if (kind === 3) body += `<circle cx="${x}" cy="${y}" r="${4 + r() * 4}" fill="#ffffff" opacity="${op}"/>`;
      else body += `<g opacity="${op}"><circle cx="${x - 9}" cy="${y}" r="8" fill="none" stroke="#ffffff" stroke-width="3"/><circle cx="${x + 9}" cy="${y}" r="8" fill="none" stroke="#ffffff" stroke-width="3"/><circle cx="${x - 7}" cy="${y + 2}" r="3.5" fill="#ffffff"/><circle cx="${x + 11}" cy="${y + 2}" r="3.5" fill="#ffffff"/></g>`;
    }
  }
  for (let k = 0; k < 70; k++) body += `<circle cx="${(r() * w).toFixed(1)}" cy="${(r() * h).toFixed(1)}" r="${(1 + r() * 2).toFixed(1)}" fill="#ffffff" opacity="${(0.4 + r() * 0.5).toFixed(2)}"/>`;
  return svg(w, h, body);
}

/** Latar doodle Paddy di-crop "cover" ke ukuran wallpaper lama (2560 × 1600). */
const wallpaper = (name) =>
  sharp(path.join(SRC, `doodle-${name}.webp`)).resize(2560, 1600, { fit: "cover", position: "centre" }).webp({ quality: 86 }).toBuffer();

/** ICO berisi PNG (didukung semua browser modern). */
function ico(pngs) {
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
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

// ── Jalankan ───────────────────────────────────────────────────────────────

await save(await wordmark(COLORS.magenta), "wordmark-black.png");
await save(await wordmark(COLORS.white), "wordmark-white.png");
await save(await lockup(COLORS.magenta, COLORS.plum, COLORS.magenta), "lockup-black.png");
await save(await lockup(COLORS.white, COLORS.white, COLORS.sunny), "lockup-white.png");
// "lime" = varian aksen untuk permukaan gelap (sidebar, dock): P magenta berbingkai stiker putih.
await save(await mark(COLORS.magenta, COLORS.white), "mark-lime.png");
await save(await mark(COLORS.magenta), "mark-black.png");
await save(await mark(COLORS.white), "mark-white.png");

// Favicon: nama berawalan "paddy-" supaya browser tidak memakai cache favicon merek lama.
const favs = {};
for (const s of [16, 32, 48, 64]) favs[s] = await save(await favicon(s), `paddy-favicon-${s}.png`);
await save(await favicon(64), "favicon-64.png");
await save(await appIcon(192, 42), "icon-192.png");
await save(await appIcon(512, 112), "icon-512.png");
const apple = await appIcon(180, 0, { bleed: true });
await save(apple, "apple-touch-icon.png");
await save(apple, "paddy-apple-touch-icon.png");
await save(await appIcon(192, 42), "icon-192.png", MEMBER_ICONS);
await save(await appIcon(512, 112), "icon-512.png", MEMBER_ICONS);
await save(await appIcon(512, 0, { bleed: true, scale: 0.46 }), "icon-512-maskable.png", MEMBER_ICONS);
await save(apple, "apple-touch-icon.png", MEMBER_ICONS);

await save(await sharp(patternSvg(1200, 563, 7)).png().toBuffer(), "pattern.png");
const pink = await wallpaper("pink");
await save(pink, "wallpaper.webp");
await save(pink, "paddy-wallpaper.webp");
await save(await wallpaper("lilac"), "paddy-wallpaper-lilac.webp");
await save(await wallpaper("sunny"), "paddy-wallpaper-sunny.webp");

writeFileSync(path.join(ROOT, "public", "favicon.ico"), ico([16, 32, 48].map((s) => ({ size: s, data: readFileSync(favs[s]) }))));
console.log("ok public/favicon.ico (16, 32, 48)");

// Aplikasi member memakai salinan logonya sendiri (public/member-assets/brand).
for (const f of ["mark-lime.png", "mark-white.png", "wordmark-black.png", "wordmark-white.png", "lockup-white.png", "pattern.png", "wallpaper.webp", "paddy-wallpaper.webp"]) {
  copyFileSync(path.join(BRAND, f), path.join(MEMBER_BRAND, f));
}
console.log("ok public/member-assets/brand/*");
// Konvensi Next (app/icon.png, app/apple-icon.png) ikut diperbarui.
copyFileSync(favs[64], path.join(ROOT, "src", "app", "icon.png"));
copyFileSync(path.join(BRAND, "apple-touch-icon.png"), path.join(ROOT, "src", "app", "apple-icon.png"));
console.log("ok src/app/icon.png, src/app/apple-icon.png");
