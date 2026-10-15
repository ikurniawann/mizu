/**
 * Data demo Paddy Experience: scope bisnis, toko, layanan experience (modul "spa"),
 * crew, pelanggan. Dipakai bersama oleh seeders/paddy-spa.js (master),
 * seeders/paddy-spa-transactions.js (transaksi), seeders/paddy-products.js
 * (katalog retail) dan seeders/paddy-parkir.js supaya kode konsisten.
 *
 * Paddy (https://paddy.id, IG @paddy.id): brand Bandung sejak 2016 (dulu
 * "Paddycases") — custom phone case & adorable goods. Modul booking "spa"
 * dipakai apa adanya untuk layanan Paddy Experience di toko (Custom Case dengan
 * desain sendiri): layanan = "treatment", crew experience = "therapist" (kunci peran
 * fitur, tidak diganti).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

function loadEnv() {
  const shellKeys = new Set(Object.keys(process.env));
  for (const name of [".env", ".env.local"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

/**
 * Password login demo: PADDY_DEMO_PASSWORD, nama lama MIZU_DEMO_PASSWORD tetap
 * diterima sebagai cadangan. Mengembalikan nama env yang dipakai seedPassword().
 */
function demoPasswordEnv() {
  if (!process.env.PADDY_DEMO_PASSWORD && process.env.MIZU_DEMO_PASSWORD) return "MIZU_DEMO_PASSWORD";
  return "PADDY_DEMO_PASSWORD";
}

const HOLDING = { code: "PADDY", name: "Paddy Group" };
const COMPANY = { code: "PADDY-RETAIL", name: "Paddy" };
const BRAND = { name: "Paddy", site: "https://paddy.id", instagram: "paddy.id", emailDomain: "paddy.id" };

// Toko Paddy di Bandung. Jam buka 10:00–22:00 = ASUMSI demo (jam mall);
// telepon dan koordinat sengaja kosong.
const OUTLETS = [
  { code: "PD-PVJ", name: "Paddy Store PVJ", address: "Paris Van Java Mall, Jl. Sukajadi No. 131–139",
    open: "10:00", close: "22:00", slug: "paddy-store-pvj", load: 1.2, short: "PVJ" },
  { code: "PD-KOPO", name: "Paddy Store Kopo", address: "Jl. Kopo",
    open: "10:00", close: "22:00", slug: "paddy-store-kopo", load: 1.0, short: "KOPO" },
];

// Belum ada toko/login demo Paddy yang dipensiunkan (mekanisme tetap tersedia).
const RETIRED_OUTLETS = [];
const RETIRED_LOGINS = [];

// Layanan Paddy Experience (tabel spa.treatments): code, name, category, description,
// customizable (butuh desain case), [variant name, duration, buffer, price], weight (bobot seeder transaksi).
// Paddy Experience hanya menawarkan satu layanan: Custom Case dari The Experience Room
// (https://theexperienceroom.paddy.id/product-category/customization/) seharga Rp119.000.
// Desainnya (merk/tipe HP, layout 2/3 stiker, tema & stiker, nama + font, background) mengikuti
// katalog backend/internal/modules/spa/catalog/experience.json. Layanan demo lama dinonaktifkan
// oleh seeders/paddy-spa.js (riwayat booking tetap utuh).
const TREATMENTS = [
  { code: "CUSTOM", name: "Custom Case", category: "Custom Case", customizable: true, weight: 1,
    description: "Desain case HP sendiri di The Experience Room: pilih merk & tipe HP, layout 2 atau 3 gambar, "
      + "stiker dari 16 tema, nama dengan font favorit, dan background case — lalu dicetak crew Paddy di toko.",
    variants: [["Sesi desain", 30, 10, 119000]] },
];

// Harga per toko: Custom Case sama di semua toko (Rp119.000), jadi tidak ada override.
const OUTLET_PRICES = [];

// scope: treatment code, variant name, outlet code (null = semua)
const COMMISSION_RULES = [
  { type: "percent", value: 10 },
  { outlet: "PD-PVJ", type: "percent", value: 12 },
];

// Shift kerja toko (hris.shifts) dan pola libur mingguan crew.
const SHIFTS = [
  // Nama shift kerja biasa. `legacy` = nama lama di database salinan.
  { key: "pagi", name: "Shift Pagi", legacy: "Spa Pagi", start: "09:00", end: "17:00" },
  { key: "siang", name: "Shift Siang", legacy: "Spa Siang", start: "13:00", end: "22:00" },
];

// nip suffix, name, gender, outlet, role (therapist = crew experience | frontdesk | manager), shift,
// day off (1=Senin..7), login email
const STAFF = [
  ["001", "Nadia Putri", "female", "PD-PVJ", "therapist", "pagi", 3, "nadia@paddy.id"],
  ["002", "Raka Pratama", "male", "PD-PVJ", "therapist", "siang", 2],
  ["003", "Salsabila Azzahra", "female", "PD-PVJ", "therapist", "pagi", 4],
  ["004", "Keisha Amanda", "female", "PD-PVJ", "therapist", "siang", 5],
  ["005", "Dimas Ardiansyah", "male", "PD-PVJ", "therapist", "siang", 1],
  ["006", "Fadhil Ramadhan", "male", "PD-PVJ", "therapist", "pagi", 2],
  ["012", "Alya Nurfadilah", "female", "PD-PVJ", "therapist", "pagi", 6, "alya@paddy.id"],
  ["016", "Rizal Firmansyah", "male", "PD-PVJ", "therapist", "siang", 4],
  ["007", "Shafa Kamila", "female", "PD-KOPO", "therapist", "pagi", 1, "shafa@paddy.id"],
  ["008", "Tasya Maharani", "female", "PD-KOPO", "therapist", "siang", 3],
  ["009", "Nabila Khairunnisa", "female", "PD-KOPO", "therapist", "siang", 4],
  ["010", "Gilang Ramadhan", "male", "PD-KOPO", "therapist", "pagi", 5],
  ["011", "Yoga Pratama", "male", "PD-KOPO", "therapist", "siang", 2],
  ["013", "Zahra Aulia", "female", "PD-KOPO", "therapist", "siang", 1],
  ["014", "Cantika Dewi", "female", "PD-KOPO", "therapist", "pagi", 6],
  ["015", "Hana Safitri", "female", "PD-KOPO", "therapist", "siang", 3],
  ["017", "Bagas Saputra", "male", "PD-KOPO", "therapist", "pagi", 6],
  ["101", "Aurel Febriani", "female", "PD-PVJ", "frontdesk", "pagi", 7, "fo.pvj@paddy.id"],
  ["102", "Intan Permatasari", "female", "PD-KOPO", "frontdesk", "pagi", 7, "fo.kopo@paddy.id"],
  ["103", "Della Anggraini", "female", "PD-KOPO", "frontdesk", "siang", 1],
  ["201", "Fikri Maulana", "male", "PD-PVJ", "manager", "pagi", 7],
  ["202", "Reza Mahendra", "male", "PD-KOPO", "manager", "pagi", 7],
  ["203", "Putri Lestari", "female", "PD-KOPO", "manager", "siang", 1],
];

// Perbantuan: crew Paddy Store PVJ membantu Paddy Store Kopo pada akhir pekan bulan berjalan.
const ASSISTS = [
  { nip: "006", outlet: "PD-KOPO", note: "Perbantuan akhir pekan (ramai)" },
];

// Prefiks NIP crew (hris.employees.nip = `${NIP_PREFIX}${suffix}`), 3 karakter.
const NIP_PREFIX = "PD-";
// Prefiks nomor shift kasir yang dibuat seeder transaksi (pos.pos_shifts.shift_number).
const SHIFT_PREFIX = "PDS-";

const FIRST = ["Andi", "Budi", "Citra", "Dewi", "Eka", "Fajar", "Gita", "Hana", "Indra", "Joko", "Kartika", "Lia",
  "Mega", "Nadia", "Oki", "Putra", "Ratna", "Sinta", "Tono", "Umi", "Vina", "Wawan", "Yudi", "Zahra", "Bayu", "Dian",
  "Fikri", "Gilang", "Intan", "Laras", "Melati", "Nanda", "Rizky", "Sari", "Tasya", "Wulan", "Yoga", "Anggi", "Cahya", "Farah"];
const LAST = ["Pratama", "Saputra", "Wijaya", "Lestari", "Permata", "Nugraha", "Kusuma", "Hidayat", "Rahman", "Setiawan",
  "Maharani", "Anggraini", "Putri", "Santoso", "Firmansyah"];

/** 80 pelanggan demo deterministik: nama, HP 0812-…, gender. */
function customers() {
  const out = [];
  for (let i = 0; i < 80; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    const female = ["Citra", "Dewi", "Eka", "Gita", "Hana", "Kartika", "Lia", "Mega", "Nadia", "Ratna", "Sinta", "Umi",
      "Vina", "Zahra", "Dian", "Intan", "Laras", "Melati", "Nanda", "Sari", "Tasya", "Wulan", "Anggi", "Cahya", "Farah"].includes(first);
    out.push({ name: `${first} ${last}`, phone: `08129${String(310000 + i * 137).padStart(6, "0")}`, gender: female ? "female" : "male" });
  }
  return out;
}

/** PRNG deterministik (mulberry32) supaya seeder transaksi bisa diulang. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Kode produk POS — HARUS sama dengan service.go ensureProduct. */
function posCodes(treatmentCode, variantId, branchId) {
  const variant = variantId.replace(/-/g, "").toUpperCase();
  const branch = branchId.replace(/-/g, "").toUpperCase().slice(0, 6);
  return { kode: `SPA-${variant.slice(0, 12)}`, sku: `SPA-${treatmentCode}-${variant.slice(0, 8)}-${branch}` };
}

/** Katalog desain Paddy Experience (sumber tunggal, di-embed modul Go). */
const EXPERIENCE_FILE = path.join(ROOT, "internal", "modules", "spa", "catalog", "experience.json");
let experienceCache = null;
function experience() {
  if (!experienceCache) experienceCache = JSON.parse(fs.readFileSync(EXPERIENCE_FILE, "utf-8"));
  return experienceCache;
}

/**
 * Desain case acak tapi valid (deterministik lewat rand), dalam bentuk snapshot
 * ternormalisasi yang sama dengan spa.Design di Go (kode + nama + gambar).
 * `name` opsional: nama pelanggan untuk dicetak di case (dipotong ke name_max_length).
 */
function randomDesign(rand, name) {
  const cat = experience();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const brand = rand() < 0.7 ? cat.brands[0] : pick(cat.brands);
  const layout = pick(cat.layouts);
  const stickers = [];
  for (let i = 0; i < layout.slots; i++) {
    const theme = pick(cat.themes);
    const s = pick(theme.stickers);
    stickers.push({ theme: theme.code, theme_name: theme.name, code: s.code, name: s.name, image: s.image });
  }
  const bg = pick(cat.backgrounds);
  const design = {
    brand: brand.code, brand_name: brand.name, model: pick(brand.models), layout: layout.code, layout_name: layout.name,
    stickers, background: bg.code, background_name: bg.name, background_image: bg.image, name: "", font: "", font_name: "",
  };
  const clean = (name || "").replace(/[^A-Za-z ]/g, "").trim().slice(0, cat.name_max_length).trim();
  if (clean) {
    const font = pick(cat.fonts);
    Object.assign(design, { name: clean, font: font.code, font_name: font.name });
  }
  return design;
}

/** Ringkasan desain satu baris — HARUS sama dengan spa.DesignSummary (Go). */
function designSummary(d) {
  if (!d) return "";
  const parts = [d.model, d.background_name, `${d.stickers.length} stiker: ${d.stickers.map((s) => s.name).join(", ")}`];
  parts.push(d.name ? `Nama: ${d.name} (${d.font_name})` : "Tanpa nama");
  return parts.join(" · ");
}

/** created_by penanda baris yang dibuat seeder transaksi (bukan user nyata). */
const SEED_ACTOR = "00000000-0000-4000-8000-00000000a5ed";

module.exports = {
  loadEnv, demoPasswordEnv, HOLDING, COMPANY, BRAND, OUTLETS, RETIRED_OUTLETS, RETIRED_LOGINS, TREATMENTS, OUTLET_PRICES,
  COMMISSION_RULES, SHIFTS, STAFF, ASSISTS, NIP_PREFIX, SHIFT_PREFIX, customers, rng, posCodes, SEED_ACTOR,
  experience, randomDesign, designSummary,
};
