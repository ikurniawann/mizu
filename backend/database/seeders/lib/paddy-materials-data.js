/**
 * Data demo BAHAN BAKU, WIP (barang setengah jadi), BOM, stok, dan order produksi Paddy.
 * Dipakai oleh seeders/paddy-materials.js.
 *
 * Model aplikasi yang diikuti (lihat backend/internal/modules/inventory):
 *   - item.raw_materials material_type 'PURCHASED' (bahan baku) | 'WIP' (setengah jadi)
 *   - manufacturing.raw_material_bom_items  resep WIP (output bahan ← komponen bahan)
 *   - manufacturing.bom_items               resep produk jadi (item.products ← bahan/WIP)
 *   - waste_factor = pecahan 0..1 (0,05 = 5%), dipakai sebagai qty × (1 + waste)
 *
 * SATUAN: inventory.qty_available & unit_cost dicatat dalam SATUAN DASAR bahan, sedangkan
 * perhitungan HPP BOM (v_products_cogs, GET /bom) membagi avg_cost dengan konversi_factor
 * bila ada satuan kecil. Supaya semua jalur angka konsisten, satuan dasar (pakai di resep &
 * stok) dicatat sebagai satuan_besar dengan konversi 1, dan satuan beli supplier (botol,
 * pack, roll, …) dicatat sebagai kemasan di item.raw_material_unit_conversions
 * (is_purchase_default). harga_beli = harga per satuan dasar.
 *
 * Harga, stok, takaran, dan supplier = ASUMSI demo (bukan data Paddy sebenarnya).
 */

// Satuan per company Paddy: [kode, nama, tipe, deskripsi]
const UNITS = [
  ["PCS", "Pieces", "KECIL", "Per buah / per unit"],
  ["ML", "Mililiter", "KECIL", "Takaran cairan (tinta UV, varnish, primer, alkohol)"],
  ["GR", "Gram", "KECIL", "Takaran berat (resin, glitter, benang rajut)"],
  ["M", "Meter", "KECIL", "Panjang kain, kulit sintetis, webbing, tali, pita"],
  ["LBR", "Lembar", "KECIL", "Lembar kertas stiker, laminasi, tissue"],
  ["BTL", "Botol", "BESAR", "Kemasan botol dari supplier"],
  ["JRG", "Jerigen", "BESAR", "Jerigen cairan 5 liter"],
  ["PACK", "Pack", "BESAR", "Kemasan pack dari supplier"],
  ["BOX", "Box", "BESAR", "Kemasan box dari supplier"],
  ["ROLL", "Roll", "BESAR", "Gulungan kain, tali, pita, stiker segel"],
  ["LSN", "Lusin", "BESAR", "12 pcs"],
  ["CONE", "Cone", "BESAR", "Cone benang jahit"],
  ["SET", "Set", "BESAR", "Set dua komponen (resin A+B)"],
];

// item.raw_material_categories (kode tampil apa adanya di halaman stok, jadi dibuat mudah dibaca)
const CATEGORIES = [
  { code: "BLANK_CASE", nama: "Blank Case HP", deskripsi: "Case HP polos per keluarga model untuk dicetak UV atau dijual polos" },
  { code: "BLANK_AKSESORIS", nama: "Blank Pods & Pop Socket", deskripsi: "Blank case AirPods, base & top pop socket, gantungan" },
  { code: "TINTA_UV", nama: "Tinta UV & Bahan Cetak", deskripsi: "Tinta UV LED CMYK + White, varnish, primer, film pelindung" },
  { code: "STIKER_DEKOR", nama: "Stiker & Dekorasi", deskripsi: "Kertas stiker vinyl, laminasi, transfer tape, resin, glitter" },
  { code: "BEADS_CHARM", nama: "Beads, Charm & Strap", deskripsi: "Manik, charm, tali, ring, dan pengait untuk charm strap" },
  { code: "BAHAN_TAS", nama: "Bahan Tas", deskripsi: "Kulit sintetis, kanvas, furing, zipper, webbing, benang, aksesori tas" },
  { code: "KEMASAN", nama: "Kemasan & Packaging", deskripsi: "Box, pouch, kartu, segel, paper bag, hang tag, dust bag" },
  { code: "BAHAN_PENOLONG", nama: "Bahan Penolong Workshop", deskripsi: "Alkohol IPA, cairan flush printer, microfiber, sarung tangan, lap" },
  { code: "WIP", nama: "Barang Setengah Jadi (WIP)", deskripsi: "Hasil produksi internal yang belum menjadi produk jadi" },
];

// Supplier dari seeders/purchasing-paddy-suppliers.js → lead time (hari) untuk daftar harga.
const SUPPLIER_LEAD = {
  "SUP-PDY-001": 4, "SUP-PDY-003": 3, "SUP-PDY-004": 2, "SUP-PDY-005": 4,
  "SUP-PDY-006": 2, "SUP-PDY-008": 1, "SUP-PDY-009": 2,
};

/**
 * Bahan baku: [kode, nama, kategori, satuan dasar, satuan beli, isi per satuan beli,
 *   harga per satuan beli (Rp), stok minimum (satuan dasar), supplier, umur simpan (hari|null),
 *   kondisi simpan, deskripsi]
 */
const BLANK_GROUPS = [
  ["I16", "iPhone 16 Series", "iPhone 16 Pro Max / 16 Pro"],
  ["I13", "iPhone 13–15", "iPhone 15 / iPhone 13"],
  ["AND", "Android", "Samsung Galaxy A55 / Redmi Note 13"],
];
const BLANK_FAMILIES = [
  ["TPU", "TPU Clear Anti-Crack", [9500, 8500, 7500], [60, 40, 30], "Case TPU bening anti-kuning untuk cetak UV (Catalogue Case & Custom Case)"],
  ["UT", "Ultra Tech+ (PC/TPU)", [32000, 29000, 26000], [20, 15, 10], "Hybrid PC + TPU, sudut air-cushion, bibir kamera tinggi"],
  ["UG", "Ultra Grip 2.0", [26000, 24000, 21000], [15, 10, 8], "Case grip bertekstur, dijual polos"],
  ["BP", "Bumper Pocket", [21000, 19500, 17500], [15, 10, 8], "Bumper dengan kantong kartu di belakang"],
  ["CC", "Camera Cover", [18500, 17000, 15000], [15, 10, 8], "Case dengan penutup kamera geser"],
];

const MATERIALS = [
  ...BLANK_FAMILIES.flatMap(([fam, famName, prices, mins, desc]) => BLANK_GROUPS.map(([g, gName, models], i) => [
    `RM-PDY-BC-${fam}-${g}`, `Blank Case ${famName} — ${gName}`, "BLANK_CASE", "PCS", "PACK", 10, prices[i] * 10, mins[i],
    "SUP-PDY-001", null, "SUHU_RUANG", `${desc}. Model: ${models}. Pack isi 10.`,
  ])),

  ["RM-PDY-PD-AP2", "Blank Case AirPods 2 PC Hard Matte", "BLANK_AKSESORIS", "PCS", "PACK", 10, 135000, 10, "SUP-PDY-001", null, "SUHU_RUANG", "Hard case PC doff untuk cetak UV, pack isi 10"],
  ["RM-PDY-PD-AP3", "Blank Case AirPods 3 PC Hard Matte", "BLANK_AKSESORIS", "PCS", "PACK", 10, 145000, 10, "SUP-PDY-001", null, "SUHU_RUANG", "Hard case PC doff untuk cetak UV, pack isi 10"],
  ["RM-PDY-PD-APP2", "Blank Case AirPods Pro 2 PC Hard Matte", "BLANK_AKSESORIS", "PCS", "PACK", 10, 155000, 15, "SUP-PDY-001", null, "SUHU_RUANG", "Hard case PC doff untuk cetak UV, pack isi 10 — model terlaris"],
  ["RM-PDY-PD-APP2S", "Blank Case AirPods Pro 2 Silikon", "BLANK_AKSESORIS", "PCS", "PACK", 10, 110000, 10, "SUP-PDY-001", null, "SUHU_RUANG", "Case silikon lembut, pack isi 10"],
  ["RM-PDY-PS-BASE", "Base Pop Socket Premium (grip lipat + perekat 3M)", "BLANK_AKSESORIS", "PCS", "PACK", 50, 325000, 40, "SUP-PDY-001", null, "SUHU_RUANG", "Mekanisme grip lipat dengan perekat 3M, pack isi 50"],
  ["RM-PDY-PS-BASES", "Base Pop Socket Standar", "BLANK_AKSESORIS", "PCS", "PACK", 50, 200000, 30, "SUP-PDY-001", null, "SUHU_RUANG", "Base grip standar untuk Printed Popsocket, pack isi 50"],
  ["RM-PDY-PS-TOP", "Top Pop Socket Akrilik Blank 40 mm", "BLANK_AKSESORIS", "PCS", "PACK", 100, 250000, 50, "SUP-PDY-001", null, "SUHU_RUANG", "Top akrilik bening 40 mm untuk dicetak UV, pack isi 100"],
  ["RM-PDY-PD-HOOK", "Gantungan Carabiner Pods", "BLANK_AKSESORIS", "PCS", "PACK", 50, 125000, 30, "SUP-PDY-001", null, "SUHU_RUANG", "Carabiner logam untuk case AirPods, pack isi 50"],

  ["RM-PDY-INK-C", "Tinta UV LED Cyan", "TINTA_UV", "ML", "BTL", 1000, 1250000, 500, "SUP-PDY-005", 365, "KHUSUS", "Tinta UV LED botol 1 L — simpan tertutup, hindari cahaya & panas"],
  ["RM-PDY-INK-M", "Tinta UV LED Magenta", "TINTA_UV", "ML", "BTL", 1000, 1250000, 500, "SUP-PDY-005", 365, "KHUSUS", "Tinta UV LED botol 1 L — simpan tertutup, hindari cahaya & panas"],
  ["RM-PDY-INK-Y", "Tinta UV LED Yellow", "TINTA_UV", "ML", "BTL", 1000, 1250000, 500, "SUP-PDY-005", 365, "KHUSUS", "Tinta UV LED botol 1 L — simpan tertutup, hindari cahaya & panas"],
  ["RM-PDY-INK-K", "Tinta UV LED Black", "TINTA_UV", "ML", "BTL", 1000, 1250000, 400, "SUP-PDY-005", 365, "KHUSUS", "Tinta UV LED botol 1 L — simpan tertutup, hindari cahaya & panas"],
  ["RM-PDY-INK-W", "Tinta UV LED White", "TINTA_UV", "ML", "BTL", 1000, 1650000, 800, "SUP-PDY-005", 270, "KHUSUS", "Tinta putih underbase untuk case bening — kocok sebelum dipakai"],
  ["RM-PDY-INK-VRN", "Varnish UV Gloss", "TINTA_UV", "ML", "BTL", 1000, 1450000, 500, "SUP-PDY-005", 365, "KHUSUS", "Lapisan gloss pelindung hasil cetak, botol 1 L"],
  ["RM-PDY-PRIMER", "Primer / Adhesion Promoter UV", "TINTA_UV", "ML", "BTL", 250, 450000, 200, "SUP-PDY-005", 365, "KHUSUS", "Primer daya rekat tinta di TPU/PC, botol 250 ml"],
  ["RM-PDY-FILM", "Film Pelindung Case (pre-cut)", "TINTA_UV", "PCS", "PACK", 100, 35000, 100, "SUP-PDY-005", null, "SUHU_RUANG", "Film PET pelindung permukaan cetak saat pengiriman, pack isi 100"],

  ["RM-PDY-VNL-A4", "Kertas Stiker Vinyl Glossy A4", "STIKER_DEKOR", "LBR", "PACK", 50, 95000, 60, "SUP-PDY-005", null, "SUHU_RUANG", "Vinyl glossy tahan air untuk stiker die-cut, pack isi 50 lembar"],
  ["RM-PDY-LAM-A4", "Laminasi Doff A4", "STIKER_DEKOR", "LBR", "PACK", 100, 80000, 50, "SUP-PDY-005", null, "SUHU_RUANG", "Laminasi dingin doff, pack isi 100 lembar"],
  ["RM-PDY-TRF", "Transfer Tape Stiker 30 cm", "STIKER_DEKOR", "M", "ROLL", 50, 85000, 10, "SUP-PDY-005", null, "SUHU_RUANG", "Transfer tape untuk aplikasi stiker, roll 50 m"],
  ["RM-PDY-RESIN", "Resin Epoksi Bening (A+B)", "STIKER_DEKOR", "GR", "SET", 1000, 165000, 300, "SUP-PDY-008", 365, "KHUSUS", "Resin dome untuk top pop socket, set 1 kg (A+B)"],
  ["RM-PDY-GLTR", "Glitter Halus Hologram", "STIKER_DEKOR", "GR", "PACK", 100, 25000, 50, "SUP-PDY-008", null, "SUHU_RUANG", "Glitter hologram untuk dekor resin, pack 100 g"],

  ["RM-PDY-BD-AKR", "Manik Akrilik Bening 8 mm", "BEADS_CHARM", "PCS", "PACK", 500, 35000, 300, "SUP-PDY-008", null, "SUHU_RUANG", "Manik akrilik warna-warni, pack isi 500"],
  ["RM-PDY-BD-CEKO", "Manik Kaca Ceko 6 mm", "BEADS_CHARM", "PCS", "PACK", 100, 25000, 150, "SUP-PDY-008", null, "SUHU_RUANG", "Manik kaca ceko berkilau, pack isi 100"],
  ["RM-PDY-BD-PRL", "Mutiara Sintetis 8 mm", "BEADS_CHARM", "PCS", "PACK", 100, 30000, 100, "SUP-PDY-008", null, "SUHU_RUANG", "Mutiara sintetis putih gading, pack isi 100"],
  ["RM-PDY-CHM-ENM", "Charm Enamel Lucu (bintang/hati/ceri)", "BEADS_CHARM", "PCS", "PACK", 50, 75000, 50, "SUP-PDY-008", null, "SUHU_RUANG", "Charm enamel motif campur, pack isi 50"],
  ["RM-PDY-TALI-NY", "Tali Nylon 0,8 mm", "BEADS_CHARM", "M", "ROLL", 100, 45000, 20, "SUP-PDY-008", null, "SUHU_RUANG", "Tali nylon kuat untuk merangkai manik, roll 100 m"],
  ["RM-PDY-JRING", "Jump Ring Stainless 6 mm", "BEADS_CHARM", "PCS", "PACK", 200, 30000, 100, "SUP-PDY-008", null, "SUHU_RUANG", "Jump ring stainless anti karat, pack isi 200"],
  ["RM-PDY-CLASP", "Lobster Clasp Stainless", "BEADS_CHARM", "PCS", "PACK", 100, 60000, 50, "SUP-PDY-008", null, "SUHU_RUANG", "Pengait lobster stainless, pack isi 100"],
  ["RM-PDY-LOOP", "Strap Loop / Patch Tali HP", "BEADS_CHARM", "PCS", "PACK", 50, 75000, 40, "SUP-PDY-008", null, "SUHU_RUANG", "Patch tali yang diselipkan di antara HP dan case, pack isi 50"],

  ["RM-PDY-PU", "Kulit Sintetis PU Premium (lebar 140 cm)", "BAHAN_TAS", "M", "ROLL", 25, 1375000, 10, "SUP-PDY-003", null, "SUHU_RUANG", "PU leather doff warna pastel, roll 25 m"],
  ["RM-PDY-KNV", "Kain Kanvas Katun 12 oz (lebar 150 cm)", "BAHAN_TAS", "M", "ROLL", 50, 2100000, 10, "SUP-PDY-009", null, "SUHU_RUANG", "Kanvas katun natural untuk tas kolaborasi, roll 50 m"],
  ["RM-PDY-FRG", "Kain Furing Polyester (lebar 150 cm)", "BAHAN_TAS", "M", "ROLL", 50, 700000, 15, "SUP-PDY-009", null, "SUHU_RUANG", "Furing dalam tas, roll 50 m"],
  ["RM-PDY-ZIP", "Zipper YKK No. 5 (60 cm, lengkap kepala)", "BAHAN_TAS", "PCS", "LSN", 12, 66000, 24, "SUP-PDY-009", null, "SUHU_RUANG", "Zipper YKK coil no. 5, per lusin"],
  ["RM-PDY-WEB", "Webbing Polypropylene 3 cm", "BAHAN_TAS", "M", "ROLL", 50, 150000, 20, "SUP-PDY-009", null, "SUHU_RUANG", "Webbing tali ransel, roll 50 m"],
  ["RM-PDY-BUCKLE", "Gesper Plastik 3 cm", "BAHAN_TAS", "PCS", "PACK", 100, 180000, 30, "SUP-PDY-003", null, "SUHU_RUANG", "Gesper pengatur tali ransel, pack isi 100"],
  ["RM-PDY-DRING", "D-Ring & Pengait Logam 3 cm", "BAHAN_TAS", "PCS", "PACK", 100, 200000, 30, "SUP-PDY-003", null, "SUHU_RUANG", "D-ring logam gold untuk tas, pack isi 100"],
  ["RM-PDY-BNG", "Benang Jahit Nilon Bonded", "BAHAN_TAS", "M", "CONE", 3000, 52500, 1500, "SUP-PDY-009", null, "SUHU_RUANG", "Benang jahit kulit/kanvas, cone 3.000 m"],
  ["RM-PDY-BUSA", "Busa Spons 3 mm (lebar 150 cm)", "BAHAN_TAS", "M", "ROLL", 50, 900000, 8, "SUP-PDY-009", null, "SUHU_RUANG", "Busa pengisi punggung & dasar ransel, roll 50 m"],
  ["RM-PDY-LBL", "Label Woven Paddy", "BAHAN_TAS", "PCS", "PACK", 500, 450000, 100, "SUP-PDY-009", null, "SUHU_RUANG", "Label tenun logo Paddy untuk tas, pack isi 500"],
  ["RM-PDY-RAJUT", "Benang Rajut Katun Susu", "BAHAN_TAS", "GR", "ROLL", 100, 24000, 1000, "SUP-PDY-004", null, "SUHU_RUANG", "Benang katun susu untuk Paddy Knitted Bag, gulung 100 g"],
  ["RM-PDY-HANDLE", "Handle Tas Kulit Sintetis (sepasang)", "BAHAN_TAS", "PCS", "PACK", 20, 170000, 10, "SUP-PDY-004", null, "SUHU_RUANG", "Handle tas jadi untuk knitted bag, pack isi 20 pasang"],
  ["RM-PDY-MAGNET", "Kancing Magnet 14 mm", "BAHAN_TAS", "PCS", "PACK", 100, 150000, 20, "SUP-PDY-004", null, "SUHU_RUANG", "Kancing magnet penutup tas, pack isi 100"],

  ["RM-PDY-BOX-CS", "Box Case Printed Paddy", "KEMASAN", "PCS", "PACK", 100, 320000, 150, "SUP-PDY-006", null, "SUHU_RUANG", "Box art paper bermotif Paddy untuk case HP, pack isi 100"],
  ["RM-PDY-BOX-PD", "Box Pods Printed Paddy", "KEMASAN", "PCS", "PACK", 100, 280000, 60, "SUP-PDY-006", null, "SUHU_RUANG", "Box kecil untuk case AirPods, pack isi 100"],
  ["RM-PDY-CARD-PS", "Kartu Backing Pop Socket", "KEMASAN", "PCS", "PACK", 100, 90000, 50, "SUP-PDY-006", null, "SUHU_RUANG", "Kartu display pop socket, pack isi 100"],
  ["RM-PDY-CARD-CHM", "Hang Card Charm Strap", "KEMASAN", "PCS", "PACK", 100, 70000, 40, "SUP-PDY-006", null, "SUHU_RUANG", "Kartu gantung charm strap, pack isi 100"],
  ["RM-PDY-GIFTBOX", "Gift Box Kraft Paddy", "KEMASAN", "PCS", "PACK", 50, 375000, 20, "SUP-PDY-006", null, "SUHU_RUANG", "Gift box kraft dengan tutup, pack isi 50"],
  ["RM-PDY-ZIPLOCK", "Pouch Zip-lock Case (frosted)", "KEMASAN", "PCS", "PACK", 100, 45000, 150, "SUP-PDY-006", null, "SUHU_RUANG", "Pouch frosted untuk case HP, pack isi 100"],
  ["RM-PDY-OPP", "Plastik OPP Seal Aksesoris", "KEMASAN", "PCS", "PACK", 200, 50000, 100, "SUP-PDY-006", null, "SUHU_RUANG", "Plastik OPP perekat untuk aksesoris, pack isi 200"],
  ["RM-PDY-TYCARD", "Thank You Card Paddy", "KEMASAN", "PCS", "PACK", 500, 300000, 200, "SUP-PDY-006", null, "SUHU_RUANG", "Kartu ucapan terima kasih, pack isi 500"],
  ["RM-PDY-SEAL", "Stiker Segel Paddy", "KEMASAN", "PCS", "ROLL", 500, 125000, 200, "SUP-PDY-006", null, "SUHU_RUANG", "Stiker segel bulat logo Paddy, roll isi 500"],
  ["RM-PDY-TISSUE", "Tissue Paper Paddy", "KEMASAN", "LBR", "PACK", 100, 40000, 50, "SUP-PDY-006", null, "SUHU_RUANG", "Kertas tissue pembungkus bermotif, pack isi 100 lembar"],
  ["RM-PDY-PITA", "Pita Satin 1 cm", "KEMASAN", "M", "ROLL", 50, 60000, 15, "SUP-PDY-006", null, "SUHU_RUANG", "Pita satin pink untuk gift box, roll 50 m"],
  ["RM-PDY-PB-S", "Paper Bag Paddy S", "KEMASAN", "PCS", "PACK", 100, 180000, 100, "SUP-PDY-006", null, "SUHU_RUANG", "Paper bag kecil untuk case & aksesoris, pack isi 100"],
  ["RM-PDY-PB-M", "Paper Bag Paddy M", "KEMASAN", "PCS", "PACK", 100, 250000, 60, "SUP-PDY-006", null, "SUHU_RUANG", "Paper bag sedang untuk tas, pack isi 100"],
  ["RM-PDY-BUBBLE", "Bubble Wrap (lebar 125 cm)", "KEMASAN", "M", "ROLL", 50, 150000, 20, "SUP-PDY-006", null, "SUHU_RUANG", "Bubble wrap untuk pengiriman online, roll 50 m"],
  ["RM-PDY-HTAG", "Hang Tag Paddy + Tali", "KEMASAN", "PCS", "PACK", 500, 300000, 80, "SUP-PDY-006", null, "SUHU_RUANG", "Hang tag produk tas & apparel, pack isi 500"],
  ["RM-PDY-DUSTBAG", "Dust Bag Spunbond Paddy", "KEMASAN", "PCS", "PACK", 50, 175000, 30, "SUP-PDY-006", null, "SUHU_RUANG", "Dust bag sablon logo untuk tas, pack isi 50"],

  ["RM-PDY-IPA", "Alkohol IPA 99% (pembersih case)", "BAHAN_PENOLONG", "ML", "JRG", 5000, 275000, 2000, "SUP-PDY-005", 730, "KHUSUS", "Isopropyl alcohol untuk membersihkan permukaan sebelum cetak — mudah terbakar"],
  ["RM-PDY-FLUSH", "Cairan Pembersih Head UV (Flush)", "BAHAN_PENOLONG", "ML", "BTL", 500, 350000, 300, "SUP-PDY-005", 365, "KHUSUS", "Flush perawatan head printer UV, botol 500 ml"],
  ["RM-PDY-MICRO", "Kain Microfiber 30×30", "BAHAN_PENOLONG", "PCS", "PACK", 10, 35000, 10, "SUP-PDY-005", null, "SUHU_RUANG", "Lap microfiber bebas debu, pack isi 10"],
  ["RM-PDY-NITRIL", "Sarung Tangan Nitril", "BAHAN_PENOLONG", "PCS", "BOX", 100, 65000, 50, "SUP-PDY-005", null, "SUHU_RUANG", "Sarung tangan nitril operator cetak, box isi 100"],
  ["RM-PDY-WIPE", "Kertas Lap Bebas Serat (lint-free)", "BAHAN_PENOLONG", "LBR", "PACK", 100, 40000, 100, "SUP-PDY-005", null, "SUHU_RUANG", "Lap lint-free untuk head printer & permukaan case, pack isi 100"],
];

// COA per kategori (akun ada di seeders/accounting-paddy-coa.js).
const COA = {
  default: { asset: "1301008", production: "5301002" }, // Inv - ST Other / Cost of Merchandise
  "WIP": { asset: "1301006", production: "5301002" }, // akun WIP persediaan
  "BAHAN_PENOLONG": { asset: "1301008", production: "6201002" }, // Chemical, Cleaning and Sanitation Supplies
};

// Komponen tinta per cetak (ml): [C, M, Y, K, White, Varnish, Primer]
function inkLines([c, m, y, k, w, vrn, primer], waste = 0.05) {
  const out = [];
  for (const [kode, qty] of [["RM-PDY-INK-C", c], ["RM-PDY-INK-M", m], ["RM-PDY-INK-Y", y], ["RM-PDY-INK-K", k],
    ["RM-PDY-INK-W", w], ["RM-PDY-INK-VRN", vrn], ["RM-PDY-PRIMER", primer]]) {
    if (qty > 0) out.push([kode, qty, waste]);
  }
  return out;
}

/**
 * WIP (material_type 'WIP', satuan PCS) dan resepnya di raw_material_bom_items.
 * conversion = ongkos kerja/overhead standar per unit (Rp) yang ikut di HPP WIP
 * dan dicatat sebagai labor/overhead di order produksi.
 * lines: [kode komponen, qty per 1 WIP (satuan dasar komponen), waste 0..1]
 */
const WIPS = [
  { kode: "WIP-PDY-CS-PRT", nama: "Case Catalogue Tercetak UV (belum QC)", min: 10, conversion: { overhead: 1500 },
    deskripsi: "Blank TPU clear iPhone 16 Series yang sudah dicetak desain katalog (CMYK + white underbase), menunggu QC & varnish",
    lines: [["RM-PDY-BC-TPU-I16", 1, 0.02], ...inkLines([1.2, 1.2, 1.2, 0.8, 2.0, 0, 0.5]), ["RM-PDY-IPA", 3, 0], ["RM-PDY-WIPE", 0.5, 0]] },
  { kode: "WIP-PDY-CS-VRN", nama: "Case Catalogue Tercetak + Varnish (lolos QC)", min: 15, conversion: { overhead: 500 },
    deskripsi: "Case katalog yang sudah di-varnish gloss dan lolos QC, siap dikemas",
    lines: [["WIP-PDY-CS-PRT", 1, 0.02], ["RM-PDY-INK-VRN", 1.5, 0.05], ["RM-PDY-MICRO", 0.02, 0]] },
  { kode: "WIP-PDY-CC-PRT", nama: "Custom Case Tercetak (Paddy Experience)", min: 5, conversion: { overhead: 1500 },
    deskripsi: "Custom Case pesanan Paddy Experience (background + 2–3 stiker + nama) yang dicetak lebih dulu di workshop",
    lines: [["RM-PDY-BC-TPU-I16", 1, 0.02], ...inkLines([1.5, 1.5, 1.5, 1.0, 2.5, 1.8, 0.6]), ["RM-PDY-IPA", 4, 0], ["RM-PDY-MICRO", 0.02, 0]] },
  { kode: "WIP-PDY-STK-DC", nama: "Lembar Stiker Die-cut Paddy (A6)", min: 30, conversion: { overhead: 300 },
    deskripsi: "Stiker vinyl dicetak, dilaminasi doff, dan di-die-cut ukuran A6 (bonus gift box)",
    lines: [["RM-PDY-VNL-A4", 0.25, 0.05], ["RM-PDY-LAM-A4", 0.25, 0.05], ...inkLines([0.15, 0.15, 0.15, 0.1, 0, 0, 0]),
      ["RM-PDY-TRF", 0.1, 0.05]] },
  { kode: "WIP-PDY-PS-TOP", nama: "Top Pop Socket Tercetak", min: 20, conversion: { overhead: 500 },
    deskripsi: "Top akrilik 40 mm yang sudah dicetak UV dan di-varnish, siap dirakit ke base",
    lines: [["RM-PDY-PS-TOP", 1, 0.03], ...inkLines([0.3, 0.3, 0.3, 0.2, 0.5, 0.4, 0.15]), ["RM-PDY-IPA", 1, 0]] },
  { kode: "WIP-PDY-PD-PRT", nama: "Pods Case Tercetak UV", min: 10, conversion: { overhead: 1000 },
    deskripsi: "Case AirPods Pro 2 PC yang sudah dicetak motif Paddy Pods dan di-varnish",
    lines: [["RM-PDY-PD-APP2", 1, 0.02], ...inkLines([0.8, 0.8, 0.8, 0.5, 1.2, 1.0, 0.3]), ["RM-PDY-IPA", 2, 0]] },
  { kode: "WIP-PDY-CHM-ASM", nama: "Charm Strap Terangkai (belum packing)", min: 15, conversion: { labor: 2500 },
    deskripsi: "Rangkaian manik + charm + pengait yang sudah jadi, belum dipasang hang card",
    lines: [["RM-PDY-BD-AKR", 14, 0.05], ["RM-PDY-BD-CEKO", 6, 0.05], ["RM-PDY-BD-PRL", 4, 0.05], ["RM-PDY-CHM-ENM", 2, 0],
      ["RM-PDY-TALI-NY", 0.3, 0.1], ["RM-PDY-JRING", 2, 0.05], ["RM-PDY-CLASP", 1, 0], ["RM-PDY-LOOP", 1, 0]] },
  { kode: "WIP-PDY-BG-LTH", nama: "Badan Backpack Kulit Sintetis Mini (belum finishing)", min: 4, conversion: { labor: 22500 },
    deskripsi: "Badan ransel mini (Small Kelly / Yuppie / Kayya) hasil jahit maklon, belum dipasang label & dikemas",
    lines: [["RM-PDY-PU", 0.5, 0.08], ["RM-PDY-FRG", 0.5, 0.08], ["RM-PDY-BUSA", 0.25, 0.05], ["RM-PDY-ZIP", 2, 0],
      ["RM-PDY-WEB", 1.4, 0.03], ["RM-PDY-BUCKLE", 2, 0], ["RM-PDY-DRING", 2, 0], ["RM-PDY-BNG", 60, 0.1]] },
  { kode: "WIP-PDY-BG-LTHL", nama: "Badan Backpack Kulit Sintetis Besar (belum finishing)", min: 2, conversion: { labor: 30000 },
    deskripsi: "Badan ransel besar (Gizli) hasil jahit maklon, belum dipasang label & dikemas",
    lines: [["RM-PDY-PU", 0.75, 0.08], ["RM-PDY-FRG", 0.75, 0.08], ["RM-PDY-BUSA", 0.4, 0.05], ["RM-PDY-ZIP", 3, 0],
      ["RM-PDY-WEB", 1.8, 0.03], ["RM-PDY-BUCKLE", 2, 0], ["RM-PDY-DRING", 4, 0], ["RM-PDY-BNG", 90, 0.1]] },
  { kode: "WIP-PDY-BG-KNT", nama: "Badan Tas Rajut (belum finishing)", min: 3, conversion: { labor: 35000 },
    deskripsi: "Badan Paddy Knitted Bag hasil rajut tangan, belum dipasang furing & label",
    lines: [["RM-PDY-RAJUT", 160, 0.05], ["RM-PDY-FRG", 0.4, 0.08], ["RM-PDY-HANDLE", 1, 0], ["RM-PDY-MAGNET", 1, 0],
      ["RM-PDY-BNG", 20, 0.1]] },
  { kode: "WIP-PDY-BG-CNV", nama: "Badan Tas Kanvas Dijahit + Cetak (belum finishing)", min: 3, conversion: { labor: 20000 },
    deskripsi: "Badan Menari Shoulder Bag (Paddy x Ify Alyssa): kanvas dicetak UV ilustrasi lalu dijahit",
    lines: [["RM-PDY-KNV", 0.7, 0.08], ["RM-PDY-FRG", 0.5, 0.08], ["RM-PDY-ZIP", 1, 0], ["RM-PDY-WEB", 1.2, 0.03],
      ["RM-PDY-BNG", 45, 0.1], ...inkLines([0.8, 0.8, 0.8, 0.6, 1.5, 0, 0])] },
];

// Paket kemasan yang dipakai berulang di BOM produk.
const PACK_CASE = [["RM-PDY-FILM", 1, 0], ["RM-PDY-BOX-CS", 1, 0.01], ["RM-PDY-ZIPLOCK", 1, 0.01], ["RM-PDY-TYCARD", 1, 0], ["RM-PDY-SEAL", 1, 0.02]];
const PACK_PODS = [["RM-PDY-PD-HOOK", 1, 0], ["RM-PDY-BOX-PD", 1, 0.01], ["RM-PDY-TYCARD", 1, 0], ["RM-PDY-SEAL", 1, 0.02]];
const PACK_BAG = [["RM-PDY-LBL", 1, 0], ["RM-PDY-HTAG", 1, 0], ["RM-PDY-DUSTBAG", 1, 0], ["RM-PDY-PB-M", 1, 0], ["RM-PDY-TYCARD", 1, 0]];

/**
 * BOM produk jadi per SKU katalog (seeders/data/paddy-catalog.json), ditulis untuk produk
 * di kedua toko. Produk yang dibeli jadi dari supplier/maklon (Paddy Watch, strap, apparel,
 * parfum, tempered glass, hand sanitizer) dimodelkan katalog sebagai barang dagang
 * (harga_modal tetap) dan TIDAK diberi BOM.
 * Blank case di BOM memakai grup iPhone 16 Series (varian terlaris) — BOM aplikasi per
 * produk, bukan per SKU varian.
 */
const CATALOGUE_SKUS = Array.from({ length: 16 }, (_, i) => `PDY-CT-${String(i + 1).padStart(3, "0")}`);
const PODS_SKUS = Array.from({ length: 6 }, (_, i) => `PDY-PD-${String(i + 1).padStart(3, "0")}`);
const POPSOCKET_PREMIUM = Array.from({ length: 6 }, (_, i) => `PDY-PS-${String(i + 1).padStart(3, "0")}`);
const RESIN_DOME = new Set(["PDY-PS-002", "PDY-PS-006"]);

const PRODUCT_BOMS = {
  "PDY-CS-001": [["RM-PDY-BC-UT-I16", 1, 0.01], ...PACK_CASE],
  "PDY-CS-002": [["RM-PDY-BC-UG-I16", 1, 0.01], ...PACK_CASE],
  "PDY-CS-003": [["RM-PDY-BC-BP-I16", 1, 0.01], ...PACK_CASE],
  "PDY-CS-004": [["RM-PDY-BC-CC-I16", 1, 0.01], ...PACK_CASE],
  ...Object.fromEntries(CATALOGUE_SKUS.map((sku) => [sku, [["WIP-PDY-CS-VRN", 1, 0], ...PACK_CASE]])),
  ...Object.fromEntries(PODS_SKUS.map((sku) => [sku, [["WIP-PDY-PD-PRT", 1, 0], ...PACK_PODS]])),
  ...Object.fromEntries(POPSOCKET_PREMIUM.map((sku) => [sku, [
    ["WIP-PDY-PS-TOP", 1, 0], ["RM-PDY-PS-BASE", 1, 0.01],
    ...(RESIN_DOME.has(sku) ? [["RM-PDY-RESIN", 2, 0.1], ["RM-PDY-GLTR", 0.3, 0.1]] : []),
    ["RM-PDY-CARD-PS", 1, 0], ["RM-PDY-OPP", 1, 0.02], ["RM-PDY-SEAL", 1, 0.02],
  ]])),
  "PDY-PS-007": [["WIP-PDY-PS-TOP", 1, 0], ["RM-PDY-PS-BASES", 1, 0.01], ["RM-PDY-OPP", 1, 0.02], ["RM-PDY-SEAL", 1, 0.02]],
  "PDY-AC-004": [["WIP-PDY-CHM-ASM", 1, 0], ["RM-PDY-CARD-CHM", 1, 0], ["RM-PDY-OPP", 1, 0.02], ["RM-PDY-SEAL", 1, 0.02]],
  "PDY-AC-005": [["WIP-PDY-CHM-ASM", 1, 0], ["RM-PDY-CARD-CHM", 1, 0], ["RM-PDY-OPP", 1, 0.02], ["RM-PDY-SEAL", 1, 0.02]],
  "PDY-AC-006": [["RM-PDY-GIFTBOX", 1, 0.01], ["RM-PDY-TISSUE", 2, 0.05], ["RM-PDY-PITA", 0.6, 0.05], ["WIP-PDY-STK-DC", 1, 0],
    ["RM-PDY-TYCARD", 1, 0], ["RM-PDY-SEAL", 2, 0.02]],
  "PDY-BG-001": [["WIP-PDY-BG-LTH", 1, 0], ...PACK_BAG],
  "PDY-BG-002": [["WIP-PDY-BG-LTH", 1, 0], ...PACK_BAG],
  "PDY-BG-003": [["WIP-PDY-BG-LTH", 1, 0], ...PACK_BAG],
  "PDY-BG-004": [["WIP-PDY-BG-LTHL", 1, 0], ...PACK_BAG],
  "PDY-BG-005": [["WIP-PDY-BG-KNT", 1, 0], ["RM-PDY-LBL", 1, 0], ["RM-PDY-HTAG", 1, 0], ["RM-PDY-TISSUE", 1, 0.05],
    ["RM-PDY-PB-M", 1, 0], ["RM-PDY-TYCARD", 1, 0]],
  "PDY-BG-006": [["WIP-PDY-BG-CNV", 1, 0], ...PACK_BAG],
};

/**
 * BOM layanan Custom Case (Paddy Experience, Rp119.000) — dicetak langsung di toko:
 * blank case + tinta per cetak (CMYK + white + varnish + primer) + pembersih + kemasan.
 */
const CUSTOM_CASE_BOM = [
  ["RM-PDY-BC-TPU-I16", 1, 0.02],
  ...inkLines([1.5, 1.5, 1.5, 1.0, 2.5, 1.8, 0.6]),
  ["RM-PDY-IPA", 4, 0], ["RM-PDY-MICRO", 0.02, 0], ["RM-PDY-NITRIL", 0.1, 0],
  ...PACK_CASE, ["RM-PDY-PB-S", 1, 0],
];

/**
 * Sebaran stok akhir per gudang (porsi dari total). Kunci gudang:
 *   GDG_PVJ = Gudang Paddy Store PVJ (gudang pusat, terima dari supplier, bahan tas ke maklon)
 *   MAIN_PVJ = Toko Paddy Store PVJ (stall default, workshop cetak UV & stok WIP)
 *   MAIN_KOPO = Toko Paddy Store Kopo (meja Paddy Experience)
 *   GDG_KOPO = Gudang Paddy Store Kopo (stok kemasan)
 */
const SPLIT = {
  "BLANK_CASE": { GDG_PVJ: 0.6, MAIN_PVJ: 0.25, MAIN_KOPO: 0.15 },
  "BLANK_CASE_OTHER": { GDG_PVJ: 0.7, MAIN_PVJ: 0.3 },
  "BLANK_AKSESORIS": { GDG_PVJ: 0.6, MAIN_PVJ: 0.4 },
  "TINTA_UV": { GDG_PVJ: 0.5, MAIN_PVJ: 0.3, MAIN_KOPO: 0.2 },
  "STIKER_DEKOR": { GDG_PVJ: 0.5, MAIN_PVJ: 0.5 },
  "BEADS_CHARM": { GDG_PVJ: 0.5, MAIN_PVJ: 0.5 },
  "BAHAN_TAS": { GDG_PVJ: 1 },
  "KEMASAN": { GDG_PVJ: 0.5, MAIN_PVJ: 0.2, MAIN_KOPO: 0.15, GDG_KOPO: 0.15 },
  "KEMASAN_TAS": { GDG_PVJ: 0.7, MAIN_PVJ: 0.3 },
  "BAHAN_PENOLONG": { GDG_PVJ: 0.4, MAIN_PVJ: 0.35, MAIN_KOPO: 0.25 },
};
const BAG_PACKAGING = new Set(["RM-PDY-HTAG", "RM-PDY-DUSTBAG", "RM-PDY-PB-M", "RM-PDY-BUBBLE", "RM-PDY-GIFTBOX", "RM-PDY-PITA"]);

// Status stok yang sengaja dibuat supaya indikator Menipis/Habis terlihat.
const STOCK_HABIS = new Set(["RM-PDY-BC-CC-AND", "RM-PDY-BD-PRL", "RM-PDY-GLTR"]);
const STOCK_MENIPIS = new Set(["RM-PDY-INK-W", "RM-PDY-BOX-PD", "RM-PDY-BC-UG-I13", "RM-PDY-ZIP", "RM-PDY-PB-M",
  "RM-PDY-TALI-NY", "RM-PDY-VNL-A4"]);

const RAK = {
  GDG_PVJ: (i) => `Rak ${"ABCDEF"[i % 6]}-${String((i % 12) + 1).padStart(2, "0")}`,
  MAIN_PVJ: () => "Workshop UV PVJ",
  MAIN_KOPO: () => "Meja Paddy Experience",
  GDG_KOPO: (i) => `Rak K-${String((i % 8) + 1).padStart(2, "0")}`,
};

/**
 * Order produksi demo (nomor PROD-PDY-…). Gudang: tempat bahan dipakai (MAIN_PVJ = workshop,
 * GDG_PVJ = bahan tas yang dikirim ke maklon). Output WIP selalu masuk stall default PVJ,
 * sama seperti aplikasi (ResolveLocation). days = berapa hari lalu order dibuat.
 *   item: kode WIP (production_context raw_material) atau { sku } produk jadi (context product)
 */
const PRODUCTION_ORDERS = [
  { n: 1, item: "WIP-PDY-CS-PRT", qty: 40, status: "COMPLETED", days: 13, wh: "MAIN_PVJ", catatan: "Batch cetak katalog minggu ke-1 (desain Sasa Khalisa & Channidraw)" },
  { n: 2, item: "WIP-PDY-CS-VRN", qty: 36, status: "COMPLETED", days: 12, wh: "MAIN_PVJ", catatan: "Varnish + QC; 4 pcs masih menunggu QC ulang" },
  { n: 3, item: "WIP-PDY-PD-PRT", qty: 18, status: "COMPLETED", days: 10, wh: "MAIN_PVJ", catatan: "Cetak Paddy Pods motif Totoro Flower & Rainbow Fleur" },
  { n: 4, item: { sku: "PDY-CT-001" }, qty: 12, status: "COMPLETED", days: 9, wh: "MAIN_PVJ", packaging: 0, catatan: "Restock Strawberry Matcha untuk display PVJ" },
  { n: 5, item: "WIP-PDY-PS-TOP", qty: 30, status: "COMPLETED", days: 8, wh: "MAIN_PVJ", catatan: "Top pop socket seri Bandung" },
  { n: 6, item: "WIP-PDY-CHM-ASM", qty: 25, status: "COMPLETED", days: 7, wh: "MAIN_PVJ", catatan: "Rangkai charm strap Icy & Candy" },
  { n: 7, item: "WIP-PDY-BG-LTH", qty: 8, status: "COMPLETED", days: 6, wh: "GDG_PVJ", catatan: "Jahit badan ransel mini — maklon CV Kulit Garut Mandiri" },
  { n: 8, item: { sku: "PDY-AC-004" }, qty: 10, status: "COMPLETED", days: 5, wh: "MAIN_PVJ", catatan: "Packing Beads Charm Icy" },
  { n: 9, item: "WIP-PDY-STK-DC", qty: 60, status: "COMPLETED", days: 4, wh: "MAIN_PVJ", catatan: "Stiker bonus gift box" },
  { n: 10, item: "WIP-PDY-CC-PRT", qty: 12, status: "COMPLETED", days: 2, wh: "MAIN_PVJ", catatan: "Pre-print Custom Case booking online akhir pekan" },
  { n: 11, item: { sku: "PDY-BG-001" }, qty: 6, status: "IN_PROGRESS", days: 1, wh: "MAIN_PVJ", catatan: "Finishing Small Kelly Two Tone — pasang label & packing" },
  { n: 12, item: { sku: "PDY-PD-002" }, qty: 10, status: "RELEASED", days: 1, wh: "MAIN_PVJ", catatan: "Packing Totoro Flower – Pods untuk restock Kopo" },
  { n: 13, item: "WIP-PDY-BG-KNT", qty: 6, status: "IN_PROGRESS", days: 3, wh: "GDG_PVJ", catatan: "Rajut badan Paddy Knitted Bag — Rajut Craft Bandung" },
  { n: 14, item: "WIP-PDY-CS-PRT", qty: 50, status: "DRAFT", days: 0, wh: "MAIN_PVJ", catatan: "Rencana cetak katalog batch berikutnya" },
  { n: 15, item: { sku: "PDY-PS-003" }, qty: 20, status: "CANCELLED", days: 5, wh: "MAIN_PVJ", catatan: "Dibatalkan — desain Tahura direvisi ilustrator" },
];

/** Stok awal WIP (dibuat sebelum periode demo) pada stall default PVJ, dinilai di HPP standar. */
const WIP_OPENING = { "WIP-PDY-BG-LTHL": 3, "WIP-PDY-BG-CNV": 4 };

/** Penanda baris stok/produksi yang dibuat seeder ini. */
const ORDER_PREFIX = "PROD-PDY-";
const OPENING_REF = "SA-PDY";

module.exports = {
  UNITS, CATEGORIES, SUPPLIER_LEAD, MATERIALS, COA, WIPS, PRODUCT_BOMS, CUSTOM_CASE_BOM, SPLIT, BAG_PACKAGING,
  STOCK_HABIS, STOCK_MENIPIS, RAK, PRODUCTION_ORDERS, WIP_OPENING, ORDER_PREFIX, OPENING_REF,
};
