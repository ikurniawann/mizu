/**
 * Gambar placeholder hasil tes proyektif (Baum / DAP / Wartegg) untuk data demo rekrutmen:
 * sketsa SVG bergaya pensil di atas kertas, dirender ke PNG lewat sharp (dipinjam dari
 * frontend/node_modules). Variasi kecil per kandidat lewat rand() supaya tidak identik.
 */
const path = require("path");

function loadSharp() {
  for (const candidate of ["sharp", path.join(__dirname, "..", "..", "..", "..", "frontend", "node_modules", "sharp")]) {
    try {
      return require(candidate);
    } catch {
      // coba lokasi berikutnya
    }
  }
  return null;
}

const W = 600;
const H = 800;
const INK = "#3a3a3a";

function paper(content, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#fbfaf6"/>
  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="#e6e1d6" stroke-width="2"/>
  <g fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">${content}</g>
  <text x="${W - 40}" y="${H - 34}" font-family="sans-serif" font-size="14" fill="#b3ab9c" text-anchor="end">${label}</text>
</svg>`;
}

const j = (rand, n) => (rand() - 0.5) * 2 * n;

function tree(rand, variant) {
  const small = variant === 1;
  const s = small ? 0.7 : 1;
  const cx = small ? 220 + j(rand, 20) : 300 + j(rand, 15);
  const base = small ? 640 : 610;
  const trunkW = (small ? 26 : 44) * s;
  const trunkH = 230 * s;
  const crownR = 150 * s;
  const crownY = base - trunkH - crownR * 0.55;
  let g = `<path stroke-width="${small ? 1.6 : 3}" d="M${cx - trunkW / 2} ${base} C ${cx - trunkW / 2 + 4} ${base - trunkH / 2}, ${cx - trunkW / 2 - 3} ${base - trunkH * 0.8}, ${cx - trunkW / 2 + 6} ${base - trunkH}"/>`;
  g += `<path stroke-width="${small ? 1.6 : 3}" d="M${cx + trunkW / 2} ${base} C ${cx + trunkW / 2 - 4} ${base - trunkH / 2}, ${cx + trunkW / 2 + 3} ${base - trunkH * 0.8}, ${cx + trunkW / 2 - 6} ${base - trunkH}"/>`;
  for (let i = 0; i < 6; i++) {
    const y = base - 30 - i * trunkH / 7;
    g += `<path stroke-width="1" d="M${cx - trunkW / 4 + j(rand, 4)} ${y} q 6 -8 ${trunkW / 3} -2"/>`;
  }
  const lobes = small ? 6 : 9;
  for (let i = 0; i < lobes; i++) {
    const a = (Math.PI * 2 * i) / lobes;
    const r = crownR * (0.62 + rand() * 0.12);
    const x = cx + Math.cos(a) * r;
    const y = crownY + Math.sin(a) * r * 0.75;
    g += `<circle stroke-width="${small ? 1.4 : 2.6}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(crownR * 0.42).toFixed(1)}"/>`;
  }
  if (!small) {
    for (let i = 0; i < 7; i++) {
      const x = cx + j(rand, crownR * 0.8);
      const y = crownY + j(rand, crownR * 0.5);
      g += `<circle stroke-width="2" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="#d9534f" fill-opacity="0.35"/>`;
    }
    for (const dx of [-1, 1]) {
      g += `<path stroke-width="2" d="M${cx + dx * trunkW / 2} ${base} q ${dx * 30} 10 ${dx * 70} 30"/>`;
      g += `<path stroke-width="1.6" d="M${cx + dx * 6} ${base} q ${dx * 10} 20 ${dx * 24} 45"/>`;
    }
  } else {
    g += `<path stroke-width="1" stroke="#9b968c" d="M${cx - 60} ${crownY - 40} l 40 30 M${cx + 10} ${crownY - 60} l 30 25"/>`;
  }
  g += `<path stroke-width="1.4" stroke="#8c877d" d="M60 ${base + 2} L ${W - 60} ${base + 2}"/>`;
  return paper(g, "Baum");
}

function person(rand, variant) {
  const big = variant === 1;
  const s = big ? 1.25 : 1;
  const cx = 300 + j(rand, 12);
  const top = big ? 90 : 150;
  const headR = 48 * s;
  const neckY = top + headR * 2;
  const hipY = neckY + 190 * s;
  const footY = hipY + 210 * s;
  let g = `<circle stroke-width="3" cx="${cx}" cy="${top + headR}" r="${headR}"/>`;
  g += `<circle stroke-width="0" fill="${INK}" cx="${cx - 16 * s}" cy="${top + headR - 6}" r="4"/><circle stroke-width="0" fill="${INK}" cx="${cx + 16 * s}" cy="${top + headR - 6}" r="4"/>`;
  g += `<path stroke-width="2.4" d="M${cx - 18 * s} ${top + headR + 16 * s} q ${18 * s} ${16 * s} ${36 * s} 0"/>`;
  g += `<path stroke-width="2" d="M${cx - headR} ${top + headR - 10} q ${headR} -${headR * 1.3} ${headR * 2} 0"/>`;
  g += `<path stroke-width="3" d="M${cx - 55 * s} ${neckY + 20} L ${cx + 55 * s} ${neckY + 20} L ${cx + 45 * s} ${hipY} L ${cx - 45 * s} ${hipY} Z"/>`;
  const armDrop = big ? 120 : 150;
  g += `<path stroke-width="3" d="M${cx - 55 * s} ${neckY + 25} L ${cx - 105 * s} ${neckY + armDrop * s}"/>`;
  g += `<path stroke-width="3" d="M${cx + 55 * s} ${neckY + 25} L ${cx + 105 * s} ${neckY + (big ? 90 : armDrop) * s}"/>`;
  const step = big ? 40 : 0;
  g += `<path stroke-width="3" d="M${cx - 25 * s} ${hipY} L ${cx - 35 * s - step} ${footY}"/><path stroke-width="3" d="M${cx + 25 * s} ${hipY} L ${cx + 35 * s + step / 2} ${footY}"/>`;
  g += `<path stroke-width="3" d="M${cx - 35 * s - step} ${footY} l -26 0"/><path stroke-width="3" d="M${cx + 35 * s + step / 2} ${footY} l 26 0"/>`;
  if (big) g += `<path stroke-width="2" d="M${cx - 50 * s} ${neckY + 25} L ${cx + 40 * s} ${hipY - 20}"/><rect stroke-width="2.4" x="${cx + 30 * s}" y="${hipY - 40}" width="${44 * s}" height="${36 * s}" rx="6"/>`;
  return paper(g, "DAP");
}

function wartegg(rand, variant) {
  const box = 120;
  const gap = 24;
  const x0 = (W - (box * 4 + gap * 3)) / 2;
  const y0 = 240;
  let g = "";
  const stimuli = [
    (x, y) => `<circle stroke-width="0" fill="${INK}" cx="${x + 60}" cy="${y + 60}" r="3"/>`,
    (x, y) => `<path stroke-width="2" d="M${x + 25} ${y + 30} q 10 -12 20 0"/>`,
    (x, y) => `<path stroke-width="2" d="M${x + 70} ${y + 95} v -12 M${x + 80} ${y + 95} v -22 M${x + 90} ${y + 95} v -32"/>`,
    (x, y) => `<rect stroke-width="0" fill="${INK}" x="${x + 88}" y="${y + 18}" width="14" height="14"/>`,
    (x, y) => `<path stroke-width="2" d="M${x + 20} ${y + 100} l 25 -25 M${x + 100} ${y + 100} l -25 -25"/>`,
    (x, y) => `<path stroke-width="2" d="M${x + 40} ${y + 30} h 30 v 20 M${x + 80} ${y + 80} h -30"/>`,
    (x, y) => `<path stroke-width="0" fill="${INK}" d="M${x + 70} ${y + 90} m -2 0 a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0 m 10 6 a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0 m 10 -2 a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0"/>`,
    (x, y) => `<path stroke-width="2" d="M${x + 20} ${y + 40} q 40 -35 80 0"/>`,
  ];
  const fills = variant === 0
    ? [
      (x, y) => `<circle stroke-width="2.2" cx="${x + 60}" cy="${y + 60}" r="34"/><path stroke-width="2" d="M${x + 46} ${y + 70} q 14 12 28 0"/>`,
      (x, y) => `<path stroke-width="2" d="M${x + 10} ${y + 70} q 15 -15 30 0 t 30 0 t 30 0 t 25 0"/>`,
      (x, y) => `<path stroke-width="2" d="M${x + 20} ${y + 100} h 20 v -20 h 20 v -20 h 20 v -20 h 20"/>`,
      (x, y) => `<path stroke-width="2.2" d="M${x + 30} ${y + 100} v -45 l 30 -25 l 30 25 v 45 z"/>`,
      (x, y) => `<path stroke-width="2.2" d="M${x + 60} ${y + 20} q 20 30 0 70 q -20 -40 0 -70 z M${x + 48} ${y + 82} l -10 15 M${x + 72} ${y + 82} l 10 15"/>`,
      (x, y) => `<rect stroke-width="2" x="${x + 30}" y="${y + 25}" width="60" height="70"/><path stroke-width="1.6" d="M${x + 60} ${y + 25} v 70 M${x + 30} ${y + 60} h 60"/>`,
      (x, y) => `<path stroke-width="1.6" d="M${x + 15} ${y + 40} q 50 70 95 0"/>`,
      (x, y) => `<path stroke-width="2.2" d="M${x + 60} ${y + 25} v 75 q 0 10 -10 8"/>`,
    ]
    : [
      (x, y) => `<circle stroke-width="2" cx="${x + 60}" cy="${y + 60}" r="22"/><path stroke-width="1.6" d="M${x + 60} ${y + 25} v -12 M${x + 60} ${y + 95} v 12 M${x + 25} ${y + 60} h -12 M${x + 95} ${y + 60} h 12"/>`,
      (x, y) => `<path stroke-width="2" d="M${x + 15} ${y + 100} L ${x + 55} ${y + 30} M${x + 105} ${y + 100} L ${x + 65} ${y + 30}"/>`,
      (x, y) => `<path stroke-width="2" d="M${x + 15} ${y + 90} h 90 M${x + 25} ${y + 90} v -30 M${x + 55} ${y + 90} v -30 M${x + 85} ${y + 90} v -30 M${x + 15} ${y + 70} h 90"/>`,
      (x, y) => `<rect stroke-width="2" x="${x + 30}" y="${y + 45}" width="60" height="50"/><path stroke-width="2" d="M${x + 60} ${y + 45} v 50 M${x + 30} ${y + 45} q 30 -25 60 0"/>`,
      (x, y) => `<path stroke-width="2.2" d="M${x + 30} ${y + 100} v -45 l 30 -25 l 30 25 v 45 z"/>`,
      () => "",
      (x, y) => `<path stroke-width="2" d="M${x + 60} ${y + 100} v -50"/><circle stroke-width="2" cx="${x + 60}" cy="${y + 40}" r="20"/>`,
      (x, y) => `<circle stroke-width="2" cx="${x + 60}" cy="${y + 50}" r="10"/><path stroke-width="1.6" d="M${x + 60} ${y + 60} v 40 M${x + 45} ${y + 45} q -10 -10 0 -20 M${x + 75} ${y + 45} q 10 -10 0 -20"/>`,
    ];
  for (let i = 0; i < 8; i++) {
    const x = x0 + (i % 4) * (box + gap);
    const y = y0 + Math.floor(i / 4) * (box + gap + 40);
    g += `<rect stroke-width="2.4" x="${x}" y="${y}" width="${box}" height="${box}"/>`;
    g += stimuli[i](x, y);
    g += `<g transform="translate(${j(rand, 3).toFixed(1)} ${j(rand, 3).toFixed(1)})">${fills[i](x, y)}</g>`;
    g += `<text x="${x + 6}" y="${y + box + 20}" font-family="sans-serif" font-size="13" stroke="none" fill="#8c877d">${i + 1}</text>`;
  }
  return paper(g, "Wartegg");
}

const DRAW = { baum: tree, dap: person, wartegg };

/** PNG (Buffer) untuk instrumen gambar, atau null bila sharp tidak tersedia. */
async function drawingPng(sharp, code, rand, variant) {
  if (!sharp || !DRAW[code]) return null;
  return sharp(Buffer.from(DRAW[code](rand, variant))).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { loadSharp, drawingPng };
