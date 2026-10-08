/**
 * Data demo Mizu Spa (EPIC-052): scope bisnis, outlet, treatment, staf,
 * pelanggan. Dipakai bersama oleh seeders/mizu-spa.js (master) dan
 * seeders/mizu-spa-transactions.js (transaksi) supaya kode konsisten.
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

const HOLDING = { code: "MIZU", name: "Mizu Group" };
const COMPANY = { code: "MIZU-SPA", name: "Mizu Spa" };

// Outlet asli Mizu (bio instagram.com/mizufamily.id). Jam buka belum dikonfirmasi
// pemilik — 10:00–22:00 hanya asumsi demo; telepon dan koordinat sengaja kosong.
const OUTLETS = [
  { code: "MZ-WESTHOFF", name: "Mizu 1.0", address: "Jl. Westhoff No. 1", open: "10:00", close: "22:00",
    slug: "mizu-westhoff", load: 1.0 },
  { code: "MZ-RIAU", name: "Mizu Signature", address: "Jl. Riau No. 142", open: "10:00", close: "22:00",
    slug: "mizu-signature-riau", load: 1.2 },
];

// Outlet demo lama (sebelum disesuaikan ke outlet asli 2026-10-08): dinonaktifkan seeder.
const RETIRED_OUTLETS = ["MZ-DAGO", "MZ-SETIABUDI"];
// Login demo lama yang diganti: dinonaktifkan seeder.
const RETIRED_LOGINS = ["fo.dago@mizu.id", "fo.riau@mizu.id", "fo.setiabudi@mizu.id"];

// code, name, category, description, [variant name, duration, buffer, price], weight
const TREATMENTS = [
  { code: "BALI", name: "Balinese Massage", category: "Massage", weight: 24,
    description: "Pijat tradisional Bali dengan minyak aromaterapi hangat untuk melemaskan otot dan melancarkan peredaran darah.",
    variants: [["60 menit", 60, 15, 185000], ["90 menit", 90, 15, 255000], ["120 menit", 120, 15, 325000]] },
  { code: "JAVA", name: "Pijat Tradisional Jawa", category: "Massage", weight: 10,
    description: "Pijat urut khas Jawa dengan tekanan sedang-kuat dan minyak kelapa.",
    variants: [["60 menit", 60, 15, 165000], ["90 menit", 90, 15, 230000]] },
  { code: "THAI", name: "Thai Massage", category: "Massage", weight: 6,
    description: "Peregangan dan tekanan ala Thailand tanpa minyak, menggunakan pakaian longgar.",
    variants: [["60 menit", 60, 15, 195000], ["90 menit", 90, 15, 270000]] },
  { code: "SHIATSU", name: "Shiatsu", category: "Massage", weight: 7,
    description: "Teknik tekanan jari ala Jepang pada titik meridian tubuh.",
    variants: [["60 menit", 60, 15, 210000], ["90 menit", 90, 15, 290000]] },
  { code: "DEEP", name: "Deep Tissue Massage", category: "Massage", weight: 7,
    description: "Tekanan dalam untuk otot tegang dan nyeri kronis, cocok setelah olahraga.",
    variants: [["60 menit", 60, 15, 225000], ["90 menit", 90, 15, 310000]] },
  { code: "AROMA", name: "Aromatherapy Massage", category: "Massage", weight: 8,
    description: "Pijat lembut dengan pilihan essential oil lavender, sereh, atau jahe.",
    variants: [["60 menit", 60, 15, 200000], ["90 menit", 90, 15, 275000]] },
  { code: "HEAD", name: "Head & Shoulder Massage", category: "Massage", weight: 3,
    description: "Pijat kepala, leher, dan bahu untuk meredakan pegal setelah bekerja.",
    variants: [["30 menit", 30, 10, 95000], ["45 menit", 45, 10, 125000]] },
  { code: "REFLEX", name: "Refleksi Kaki", category: "Refleksi", weight: 18,
    description: "Pijat refleksi pada titik saraf telapak kaki.",
    variants: [["45 menit", 45, 10, 120000], ["60 menit", 60, 10, 150000], ["90 menit", 90, 10, 210000]] },
  { code: "HOTSTONE", name: "Hot Stone Therapy", category: "Signature", weight: 6,
    description: "Batu vulkanik hangat dikombinasikan dengan pijat untuk relaksasi otot dalam.",
    variants: [["90 menit", 90, 20, 365000], ["120 menit", 120, 20, 450000]] },
  { code: "LULUR", name: "Lulur & Body Scrub", category: "Body Treatment", weight: 4,
    description: "Lulur tradisional rempah untuk mengangkat sel kulit mati, diakhiri bilas air hangat.",
    variants: [["60 menit", 60, 20, 180000]] },
  { code: "TOTOK", name: "Totok Wajah", category: "Facial", weight: 4,
    description: "Totok wajah untuk melancarkan peredaran darah dan menyegarkan kulit.",
    variants: [["45 menit", 45, 10, 130000]] },
  { code: "MIZU", name: "Mizu Signature Ritual", category: "Signature", weight: 3,
    description: "Ritual lengkap: Balinese massage, body scrub, dan totok wajah.",
    variants: [["150 menit", 150, 30, 595000]] },
];

// Harga per outlet: Mizu Signature (premium) lebih tinggi untuk treatment signature.
const OUTLET_PRICES = [
  ["MZ-RIAU", "HOTSTONE", "90 menit", 395000],
  ["MZ-RIAU", "HOTSTONE", "120 menit", 485000],
  ["MZ-RIAU", "MIZU", "150 menit", 650000],
  ["MZ-RIAU", "BALI", "120 menit", 345000],
];

// scope: treatment code, variant name, outlet code (null = semua)
const COMMISSION_RULES = [
  { type: "percent", value: 10 },
  { outlet: "MZ-RIAU", type: "percent", value: 12 },
  { treatment: "REFLEX", type: "percent", value: 12 },
  { treatment: "HOTSTONE", type: "fixed", value: 60000 },
  { treatment: "MIZU", type: "fixed", value: 100000 },
  { treatment: "HEAD", variant: "30 menit", type: "fixed", value: 15000 },
];

// Shift kerja spa (hris.shifts) dan pola libur mingguan terapis.
const SHIFTS = [
  { key: "pagi", name: "Spa Pagi", start: "09:00", end: "17:00" },
  { key: "siang", name: "Spa Siang", start: "13:00", end: "22:00" },
];

// nip suffix, name, gender, outlet, role (therapist|frontdesk|manager), shift, day off (1=Senin..7), login email
const STAFF = [
  ["001", "Ayu Lestari", "female", "MZ-WESTHOFF", "therapist", "pagi", 3, "ayu@mizu.id"],
  ["002", "Rina Marlina", "female", "MZ-WESTHOFF", "therapist", "siang", 2],
  ["003", "Sri Wahyuni", "female", "MZ-WESTHOFF", "therapist", "pagi", 4],
  ["004", "Nengsih Rahayu", "female", "MZ-WESTHOFF", "therapist", "siang", 5],
  ["005", "Asep Hidayat", "male", "MZ-WESTHOFF", "therapist", "siang", 1],
  ["006", "Dedi Kurniawan", "male", "MZ-WESTHOFF", "therapist", "pagi", 2],
  ["012", "Wulan Sari", "female", "MZ-WESTHOFF", "therapist", "pagi", 6, "wulan@mizu.id"],
  ["016", "Agus Setiawan", "male", "MZ-WESTHOFF", "therapist", "siang", 4],
  ["007", "Euis Komalasari", "female", "MZ-RIAU", "therapist", "pagi", 1, "euis@mizu.id"],
  ["008", "Yanti Susanti", "female", "MZ-RIAU", "therapist", "siang", 3],
  ["009", "Lina Herlina", "female", "MZ-RIAU", "therapist", "siang", 4],
  ["010", "Ujang Saputra", "male", "MZ-RIAU", "therapist", "pagi", 5],
  ["011", "Rudi Hartono", "male", "MZ-RIAU", "therapist", "siang", 2],
  ["013", "Fitri Handayani", "female", "MZ-RIAU", "therapist", "siang", 1],
  ["014", "Neneng Suryani", "female", "MZ-RIAU", "therapist", "pagi", 6],
  ["015", "Maya Puspita", "female", "MZ-RIAU", "therapist", "siang", 3],
  ["017", "Iwan Gunawan", "male", "MZ-RIAU", "therapist", "pagi", 6],
  ["101", "Tiara Anjani", "female", "MZ-WESTHOFF", "frontdesk", "pagi", 7, "fo.westhoff@mizu.id"],
  ["102", "Putri Amelia", "female", "MZ-RIAU", "frontdesk", "pagi", 7, "fo.signature@mizu.id"],
  ["103", "Salsa Nabila", "female", "MZ-RIAU", "frontdesk", "siang", 1],
  ["201", "Hendra Wijaya", "male", "MZ-WESTHOFF", "manager", "pagi", 7],
  ["202", "Rahmat Hidayat", "male", "MZ-RIAU", "manager", "pagi", 7],
  ["203", "Anisa Rahma", "female", "MZ-RIAU", "manager", "siang", 1],
];

// Perbantuan: terapis Mizu 1.0 membantu Mizu Signature pada akhir pekan bulan berjalan.
const ASSISTS = [
  { nip: "006", outlet: "MZ-RIAU", note: "Perbantuan akhir pekan (ramai)" },
];

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

/** created_by penanda baris yang dibuat seeder transaksi (bukan user nyata). */
const SEED_ACTOR = "00000000-0000-4000-8000-00000000a5ed";

module.exports = {
  loadEnv, HOLDING, COMPANY, OUTLETS, RETIRED_OUTLETS, RETIRED_LOGINS, TREATMENTS, OUTLET_PRICES, COMMISSION_RULES, SHIFTS, STAFF, ASSISTS,
  customers, rng, posCodes, SEED_ACTOR,
};
