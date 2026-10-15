/**
 * Data demo rekrutmen Paddy (schema recruitment): departemen & posisi tambahan, lowongan,
 * 47 kandidat dengan tahap pipeline masing-masing, serta template jawaban/insight yang
 * dipakai seeders/paddy-recruitment.js.
 *
 * Semua nilai enum mengikuti kode Go (backend/internal/modules/recruitment/domain):
 *   status kandidat  : applied, screening, psikotes, interview, offer, hired, talent_pool, rejected, archived
 *   sumber           : portal, internal, referral, jobstreet, instagram, jobfair, walk_in, internal_referral, headhunter, other
 *   ketersediaan     : immediate, 1_week, 2_weeks, 1_month
 *   rekomendasi      : lolos, hold, tidak_lolos
 * Data pribadi kandidat fiktif: email <nama>+paddyseed@example.com, HP 0812-9xxx-xxxx.
 */

/** Penanda kandidat seeder: hanya baris dengan email ini yang dihapus & dibuat ulang. */
const EMAIL_MARK = "+paddyseed@example.com";

/** HR & hiring manager yang tercatat di aktivitas (nama saja, bukan akun login). */
const HR = "Rina Kartika (HR)";
const MANAGERS = { PVJ: "Fikri Maulana", KOPO: "Reza Mahendra", HQ: "Dewi Anggraeni" };

// brand = nama baris item.brands (toko/HQ Paddy).
const BRANDS = { HQ: "Paddy HQ Bandung", PVJ: "Paddy Store PVJ", KOPO: "Paddy Store Kopo" };

// Departemen HRIS. STUDIO-OPS sudah dibuat seeders/paddy-spa.js.
const DEPARTMENTS = [
  { code: "STUDIO-OPS", name: "Paddy Experience", description: "Crew experience, front store, dan manajemen toko Paddy" },
  { code: "RETAIL-STORE", name: "Retail Store", description: "Penjualan & layanan di Paddy Store PVJ dan Paddy Store Kopo", brand: "HQ" },
  { code: "CREATIVE", name: "Kreatif & Konten", description: "Desain produk, stiker, dan konten media sosial @paddy.id", brand: "HQ" },
  { code: "PRODUCTION", name: "Produksi & Gudang", description: "Workshop cetak case, finishing, dan gudang Paddy di Bandung", brand: "HQ" },
  { code: "ECOMMERCE", name: "E-commerce & CS", description: "Toko online, marketplace, dan layanan pelanggan online", brand: "HQ" },
];

// Posisi HRIS: key, title, departemen (kode), level, gaji min/max (Rp, acuan offer).
// Posisi yang sudah ada (Crew Experience, Front Store, Store Manager) hanya dilengkapi
// rentang gajinya bila masih kosong.
const POSITIONS = [
  { key: "crew", title: "Crew Experience", dept: "STUDIO-OPS", level: "staff", min: 4300000, max: 4900000 },
  { key: "front", title: "Front Store", dept: "STUDIO-OPS", level: "staff", min: 4200000, max: 4700000 },
  { key: "manager", title: "Store Manager", dept: "STUDIO-OPS", level: "manager", min: 6500000, max: 8500000 },
  { key: "sales", title: "Sales Associate", dept: "RETAIL-STORE", level: "staff", min: 4200000, max: 4800000 },
  { key: "designer", title: "Graphic Designer", dept: "CREATIVE", level: "staff", min: 5000000, max: 6800000 },
  { key: "content", title: "Content Creator & Social Media", dept: "CREATIVE", level: "staff", min: 4800000, max: 6200000 },
  { key: "operator", title: "Operator Produksi & Cetak", dept: "PRODUCTION", level: "staff", min: 4300000, max: 5000000 },
  { key: "gudang", title: "Admin Gudang", dept: "PRODUCTION", level: "staff", min: 4300000, max: 4900000 },
  { key: "cs", title: "Customer Service Online", dept: "ECOMMERCE", level: "staff", min: 4300000, max: 4900000 },
];

/*
 * Lowongan (recruitment.job_openings), dikenali lewat slug (upsert). description tampil
 * sebagai satu paragraf di /career; requirements & benefits berupa daftar "- " untuk dialog
 * admin dan konteks analisis CV AI. closing = hari dari hari ini (negatif = sudah lewat),
 * published = berapa hari lalu dipublikasikan.
 */
const JOBS = [
  { key: "crew-pvj", slug: "crew-paddy-experience-pvj", title: "Crew Paddy Experience (Custom Case)", position: "crew",
    brand: "PVJ", dept: "STUDIO-OPS", location: "Bandung — Paddy Store PVJ", type: "Full-time", mode: "On-site", headcount: 2,
    status: "published", published: 52, closing: 18, family: "retail", tests: ["papi_kostick", "aritmatika", "baum"],
    description: "Bantu pelanggan mendesain Custom Case di Paddy Experience, cetak dan rapikan hasilnya, lalu pastikan setiap case siap dibawa pulang dengan senyum.",
    requirements: "- Pendidikan minimal SMA/SMK sederajat\n- Ramah, komunikatif, dan suka bertemu orang baru\n- Teliti dan rapi (nama & stiker pelanggan tidak boleh salah cetak)\n- Bersedia bekerja shift pagi/siang dan akhir pekan di PVJ\n- Pengalaman retail atau percetakan menjadi nilai tambah",
    benefits: "- Gaji pokok sesuai UMK Kota Bandung\n- Komisi Custom Case per layanan selesai\n- BPJS Kesehatan & Ketenagakerjaan\n- Diskon karyawan untuk semua produk Paddy\n- Pelatihan desain & mesin cetak" },
  { key: "sales-kopo", slug: "sales-associate-paddy-store-kopo", title: "Sales Associate", position: "sales",
    brand: "KOPO", dept: "RETAIL-STORE", location: "Bandung — Paddy Store Kopo", type: "Full-time", mode: "On-site", headcount: 2,
    status: "published", published: 45, closing: 12, family: "retail", tests: ["papi_kostick", "aritmatika", "dap"],
    description: "Sambut pelanggan, rekomendasikan case, Paddy Pods, tas, dan aksesoris yang pas, serta jaga display dan kasir Paddy Store Kopo tetap rapi.",
    requirements: "- Pendidikan minimal SMA/SMK sederajat\n- Berpenampilan rapi dan senang melayani pelanggan\n- Terbiasa menghitung uang dan memakai aplikasi kasir/QRIS\n- Bersedia shift sampai pukul 22.00 dan masuk akhir pekan\n- Domisili Bandung selatan diutamakan",
    benefits: "- Gaji pokok sesuai UMK Kota Bandung\n- Insentif penjualan bulanan\n- BPJS Kesehatan & Ketenagakerjaan\n- Uang makan per hari kerja\n- Diskon karyawan" },
  { key: "designer", slug: "graphic-designer-custom-case", title: "Graphic Designer (Custom Case & Stiker)", position: "designer",
    brand: "HQ", dept: "CREATIVE", location: "Bandung — Workshop Paddy (Hybrid)", type: "Full-time", mode: "Hybrid", headcount: 1,
    status: "published", published: 38, closing: 30, family: "creative", tests: ["papi_kostick", "matematika", "wartegg"],
    description: "Rancang koleksi stiker, motif, dan template Custom Case Paddy yang adorable, dari ide sampai file siap cetak.",
    requirements: "- D3/S1 Desain Komunikasi Visual atau portofolio setara\n- Mahir Adobe Illustrator dan Photoshop; Procreate menjadi nilai tambah\n- Paham persiapan file cetak (CMYK, bleed, 300 dpi)\n- Punya gaya ilustrasi playful yang cocok dengan karakter Paddy\n- Wajib melampirkan portofolio",
    benefits: "- Gaji kompetitif sesuai pengalaman\n- Hybrid: 3 hari di workshop, 2 hari remote\n- BPJS Kesehatan & Ketenagakerjaan\n- Kredit nama desainer di koleksi rilis\n- Budget lisensi software & aset desain" },
  { key: "operator", slug: "operator-produksi-cetak-uv", title: "Operator Produksi & Cetak UV", position: "operator",
    brand: "HQ", dept: "PRODUCTION", location: "Bandung — Workshop Paddy", type: "Full-time", mode: "On-site", headcount: 2,
    status: "published", published: 33, closing: 20, family: "production", tests: ["papi_kostick", "aritmatika", "baum"],
    description: "Operasikan mesin cetak UV dan laminasi untuk pesanan Custom Case dan katalog, jaga kualitas cetak, serta rawat mesin harian.",
    requirements: "- Pendidikan minimal SMK (Grafika/Multimedia/Teknik diutamakan)\n- Pengalaman operator printer UV/DTF/sablon minimal 1 tahun\n- Teliti memeriksa warna dan posisi cetak\n- Sehat dan kuat berdiri lama\n- Bersedia lembur saat musim ramai",
    benefits: "- Gaji pokok sesuai UMK Kota Bandung\n- Uang lembur sesuai ketentuan\n- BPJS Kesehatan & Ketenagakerjaan\n- Pelatihan mesin dari vendor\n- Makan siang di workshop" },
  { key: "content", slug: "content-creator-social-media", title: "Content Creator & Social Media", position: "content",
    brand: "HQ", dept: "CREATIVE", location: "Bandung (Hybrid)", type: "Contract", mode: "Hybrid", headcount: 1,
    status: "published", published: 28, closing: 25, family: "creative", tests: ["papi_kostick", "matematika", "wartegg"],
    description: "Buat konten foto dan video pendek untuk Instagram dan TikTok @paddy.id, dari ide, syuting di toko, sampai editing dan posting.",
    requirements: "- Aktif di Instagram/TikTok dan paham tren konten Gen Z\n- Bisa syuting & edit video pendek (CapCut/Premiere)\n- Percaya diri tampil di depan kamera\n- Mampu membaca insight dasar (reach, engagement)\n- Lampirkan link portofolio konten",
    benefits: "- Kontrak 12 bulan, peluang diangkat tetap\n- Gaji + bonus performa konten\n- Perangkat syuting disediakan\n- BPJS Kesehatan & Ketenagakerjaan\n- Jam kerja fleksibel (hybrid)" },
  { key: "cs-online", slug: "customer-service-online", title: "Customer Service Online", position: "cs",
    brand: "HQ", dept: "ECOMMERCE", location: "Bandung (Hybrid)", type: "Full-time", mode: "Hybrid", headcount: 1,
    status: "closed", published: 60, closing: -6, family: "retail", tests: ["papi_kostick", "aritmatika", "dap"],
    description: "Layani chat pelanggan marketplace dan WhatsApp, bantu konfirmasi desain custom, status pesanan, dan komplain dengan ramah.",
    requirements: "- Pendidikan minimal SMA/SMK, D3 diutamakan\n- Mengetik cepat dan menulis pesan dengan sopan\n- Pengalaman admin marketplace/CS online minimal 6 bulan\n- Tenang menghadapi komplain pelanggan\n- Bersedia shift hingga pukul 21.00 secara bergiliran",
    benefits: "- Gaji pokok sesuai UMK Kota Bandung\n- Bonus rating toko & respon chat\n- BPJS Kesehatan & Ketenagakerjaan\n- Hybrid setelah masa training\n- Diskon karyawan" },
  { key: "manager-kopo", slug: "store-manager-paddy-store-kopo", title: "Store Manager — Paddy Store Kopo", position: "manager",
    brand: "KOPO", dept: "STUDIO-OPS", location: "Bandung — Paddy Store Kopo", type: "Full-time", mode: "On-site", headcount: 1,
    status: "closed", published: 60, closing: -15, family: "manager", tests: ["papi_kostick", "matematika", "aritmatika", "dap"],
    description: "Pimpin tim Paddy Store Kopo mencapai target penjualan, atur jadwal crew, stok, dan standar layanan toko.",
    requirements: "- Pendidikan minimal D3/S1 semua jurusan\n- Pengalaman supervisor/manajer toko retail minimal 2 tahun\n- Terbiasa membaca laporan penjualan dan stok\n- Mampu memimpin dan melatih 8–10 crew\n- Domisili Bandung",
    benefits: "- Gaji kompetitif + bonus pencapaian target toko\n- BPJS Kesehatan & Ketenagakerjaan\n- Tunjangan transportasi & komunikasi\n- Jenjang karier ke Area Manager\n- Diskon karyawan" },
  { key: "gudang", slug: "admin-gudang-workshop", title: "Admin Gudang", position: "gudang",
    brand: "HQ", dept: "PRODUCTION", location: "Bandung — Workshop Paddy", type: "Full-time", mode: "On-site", headcount: 1,
    status: "draft", published: null, closing: null, family: "production", tests: ["papi_kostick", "aritmatika", "baum"],
    description: "Catat barang masuk dan keluar, siapkan kiriman antar toko dan pesanan online, serta lakukan stock opname rutin.",
    requirements: "- Pendidikan minimal SMA/SMK\n- Menguasai Excel/Google Sheets dasar\n- Teliti dan jujur\n- Pengalaman admin gudang menjadi nilai tambah",
    benefits: "- Gaji pokok sesuai UMK Kota Bandung\n- BPJS Kesehatan & Ketenagakerjaan\n- Uang makan per hari kerja" },
];

/*
 * Kandidat. Kolom: nama, gender (f/m), lowongan (key JOBS, atau null + position/brand),
 * status akhir, lalu detail tahap:
 *   reach  : tahap terjauh yang pernah dicapai (applied < screening < psikotes < interview < offer < hired)
 *   scr    : rekomendasi screening (lolos/hold/tidak_lolos) atau "call" (sudah ditelepon, belum direkomendasikan)
 *   ps     : status sesi psikotes (sent / in_progress / completed / expired)
 *   psRec  : rekomendasi ringkasan psikotes
 *   ai     : status interview AI (sent / in_progress / completed)
 *   offers : status tiap versi offer (urutan v1, v2, …)
 *   q      : kualitas kandidat 0..1 (skor tes, relevansi interview AI, kecocokan CV)
 *   open   : tahap terakhir masih menunggu kandidat (waktu dibuat baru-baru ini)
 */
const CANDIDATES = [
  // Crew Paddy Experience — PVJ
  { name: "Nabila Rahmawati", g: "f", job: "crew-pvj", status: "applied", src: "portal", q: 0.7 },
  { name: "Rangga Saputra", g: "m", job: "crew-pvj", status: "applied", src: "instagram", q: 0.55 },
  { name: "Syifa Aulia", g: "f", job: "crew-pvj", status: "screening", scr: "call", src: "walk_in", q: 0.65, open: true },
  { name: "Dafa Alfarizi", g: "m", job: "crew-pvj", status: "psikotes", scr: "lolos", ps: "sent", src: "portal", q: 0.6, open: true },
  { name: "Kirana Putri", g: "f", job: "crew-pvj", status: "psikotes", scr: "lolos", ps: "completed", src: "instagram", q: 0.82 },
  { name: "Fauzan Hakim", g: "m", job: "crew-pvj", status: "interview", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", src: "referral", q: 0.8 },
  { name: "Aqila Zahra", g: "f", job: "crew-pvj", status: "offer", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", offers: ["sent"], src: "portal", q: 0.88, open: true },
  { name: "Rizki Ananda", g: "m", job: "crew-pvj", status: "hired", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", offers: ["accepted"], src: "jobfair", q: 0.9 },
  { name: "Meisya Larasati", g: "f", job: "crew-pvj", status: "rejected", reach: "screening", scr: "tidak_lolos", src: "portal", q: 0.3 },
  { name: "Bima Prakoso", g: "m", job: "crew-pvj", status: "talent_pool", reach: "interview", scr: "lolos", ps: "completed", psRec: "hold", ai: "completed", src: "portal", q: 0.62 },

  // Sales Associate — Kopo
  { name: "Tiara Anjani", g: "f", job: "sales-kopo", status: "applied", src: "jobstreet", q: 0.6 },
  { name: "Galih Permana", g: "m", job: "sales-kopo", status: "applied", src: "portal", q: 0.5 },
  { name: "Dinda Maharani", g: "f", job: "sales-kopo", status: "screening", scr: "hold", src: "instagram", q: 0.5 },
  { name: "Reza Firmansyah", g: "m", job: "sales-kopo", status: "screening", scr: "call", src: "walk_in", q: 0.6, open: true },
  { name: "Salma Nurjanah", g: "f", job: "sales-kopo", status: "psikotes", scr: "lolos", ps: "in_progress", src: "portal", q: 0.7, open: true },
  { name: "Iqbal Maulana", g: "m", job: "sales-kopo", status: "psikotes", scr: "lolos", ps: "expired", src: "jobstreet", q: 0.5 },
  { name: "Nadya Puspita", g: "f", job: "sales-kopo", status: "interview", scr: "lolos", ps: "completed", psRec: "lolos", ai: "sent", src: "referral", q: 0.75, open: true },
  { name: "Yusuf Ramadhan", g: "m", job: "sales-kopo", status: "offer", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", offers: ["negotiating"], src: "portal", q: 0.78, open: true },
  { name: "Annisa Fitri", g: "f", job: "sales-kopo", status: "rejected", reach: "psikotes", scr: "lolos", ps: "completed", psRec: "tidak_lolos", src: "portal", q: 0.28 },

  // Graphic Designer — workshop (hybrid)
  { name: "Alif Rahman", g: "m", job: "designer", status: "applied", src: "instagram", q: 0.72 },
  { name: "Cindy Valencia", g: "f", job: "designer", status: "applied", src: "jobstreet", q: 0.66 },
  { name: "Haikal Pratama", g: "m", job: "designer", status: "screening", scr: "lolos", src: "portal", q: 0.7, open: true },
  { name: "Laras Wulandari", g: "f", job: "designer", status: "psikotes", scr: "lolos", ps: "completed", psRec: "lolos", src: "instagram", q: 0.85 },
  { name: "Kevin Sutanto", g: "m", job: "designer", status: "interview", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", src: "headhunter", q: 0.92 },
  { name: "Raisa Amelia", g: "f", job: "designer", status: "interview", scr: "lolos", ps: "completed", psRec: "lolos", ai: "in_progress", src: "portal", q: 0.74, open: true },
  { name: "Dimas Aditya", g: "m", job: "designer", status: "offer", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", offers: ["accepted"], src: "referral", q: 0.9 },
  { name: "Putri Ayu Lestari", g: "f", job: "designer", status: "talent_pool", reach: "offer", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", offers: ["declined"], src: "instagram", q: 0.86 },

  // Operator Produksi & Cetak UV
  { name: "Asep Sunandar", g: "m", job: "operator", status: "applied", src: "walk_in", q: 0.55 },
  { name: "Ujang Hermawan", g: "m", job: "operator", status: "screening", scr: "call", src: "internal_referral", q: 0.6, open: true },
  { name: "Wahyu Nugroho", g: "m", job: "operator", status: "psikotes", scr: "lolos", ps: "completed", psRec: "hold", src: "jobstreet", q: 0.55 },
  { name: "Deden Kurniawan", g: "m", job: "operator", status: "interview", scr: "lolos", ps: "completed", psRec: "lolos", ai: "sent", src: "walk_in", q: 0.68, open: true },
  { name: "Fajar Setiadi", g: "m", job: "operator", status: "hired", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", offers: ["accepted"], src: "internal_referral", q: 0.84 },
  { name: "Eko Prasetyo", g: "m", job: "operator", status: "rejected", reach: "interview", scr: "lolos", ps: "completed", psRec: "hold", ai: "completed", src: "jobfair", q: 0.3 },

  // Content Creator & Social Media
  { name: "Zahra Khairunnisa", g: "f", job: "content", status: "applied", src: "instagram", q: 0.7 },
  { name: "Vania Gabriella", g: "f", job: "content", status: "screening", scr: "lolos", src: "instagram", q: 0.72, open: true },
  { name: "Bayu Aji Pamungkas", g: "m", job: "content", status: "interview", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", src: "portal", q: 0.77 },
  { name: "Shafira Nabila", g: "f", job: "content", status: "offer", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", offers: ["negotiating", "sent"], src: "referral", q: 0.83, open: true },
  { name: "Kezia Angelina", g: "f", job: "content", status: "archived", reach: "screening", scr: "hold", src: "jobfair", q: 0.45 },

  // Customer Service Online (lowongan sudah ditutup)
  { name: "Melati Sukmawati", g: "f", job: "cs-online", status: "hired", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", offers: ["accepted"], src: "jobstreet", q: 0.87 },
  { name: "Hendra Gunawan", g: "m", job: "cs-online", status: "rejected", reach: "offer", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", offers: ["declined"], src: "portal", q: 0.72 },
  { name: "Novi Andriani", g: "f", job: "cs-online", status: "talent_pool", reach: "interview", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", src: "jobstreet", q: 0.7 },
  { name: "Rina Oktaviani", g: "f", job: "cs-online", status: "rejected", reach: "screening", scr: "tidak_lolos", src: "other", q: 0.35 },

  // Store Manager — Kopo (lowongan sudah ditutup)
  { name: "Arief Budiman", g: "m", job: "manager-kopo", status: "hired", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", offers: ["negotiating", "accepted"], src: "headhunter", q: 0.9 },
  { name: "Sinta Dewanti", g: "f", job: "manager-kopo", status: "talent_pool", reach: "interview", scr: "lolos", ps: "completed", psRec: "lolos", ai: "completed", src: "jobstreet", q: 0.76 },
  { name: "Teguh Santoso", g: "m", job: "manager-kopo", status: "rejected", reach: "interview", scr: "lolos", ps: "completed", psRec: "hold", ai: "completed", src: "referral", q: 0.35 },

  // Tanpa lowongan: lamaran langsung di toko (posisi Front Store)
  { name: "Lutfi Hidayat", g: "m", job: null, position: "front", brand: "PVJ", status: "applied", src: "walk_in", q: 0.6 },
  { name: "Gita Savitri", g: "f", job: null, position: "front", brand: "KOPO", status: "archived", reach: "applied", src: "walk_in", q: 0.4 },
];

const DOMICILES = ["Sukajadi, Bandung", "Cimahi", "Kopo, Bandung", "Bojongloa Kaler, Bandung", "Margahayu, Kab. Bandung",
  "Antapani, Bandung", "Cicendo, Bandung", "Coblong (Dago), Bandung", "Buahbatu, Bandung", "Soreang, Kab. Bandung",
  "Lembang, Bandung Barat", "Cibaduyut, Bandung", "Arcamanik, Bandung", "Cimahi Utara", "Batununggal, Bandung",
  "Andir, Bandung", "Setiabudi, Bandung", "Rancaekek, Kab. Bandung", "Dayeuhkolot, Kab. Bandung", "Ujungberung, Bandung",
  "Sarijadi, Bandung", "Kiaracondong, Bandung", "Cijerah, Bandung", "Pasteur, Bandung"];

// Pendidikan & pengalaman terakhir per keluarga peran (format "Institusi - Jurusan (tahun)").
const EDUCATION = {
  retail: ["SMA Negeri 9 Bandung - IPS (2022)", "SMK Negeri 3 Bandung - Bisnis Daring & Pemasaran (2023)",
    "SMA Pasundan 2 Bandung - IPS (2021)", "D3 Manajemen Pemasaran - Politeknik Pos Indonesia (2022)",
    "SMK Negeri 1 Cimahi - Akuntansi (2020)", "S1 Manajemen - Universitas Pasundan (2023)",
    "D3 Administrasi Bisnis - Politeknik Negeri Bandung (2021)", "SMA Negeri 15 Bandung - IPA (2023)"],
  creative: ["S1 Desain Komunikasi Visual - Telkom University (2024)", "S1 DKV - Institut Teknologi Nasional (2022)",
    "D3 Desain Grafis - Politeknik Negeri Media Kreatif (2023)", "S1 Ilmu Komunikasi - Universitas Padjadjaran (2023)",
    "SMK Negeri 14 Bandung - Desain Komunikasi Visual (2021)", "S1 Desain Produk - Universitas Kristen Maranatha (2022)"],
  production: ["SMK Grafika Bandung - Teknik Grafika (2020)", "SMK Negeri 4 Bandung - Teknik Mekatronika (2021)",
    "SMK Negeri 2 Cimahi - Multimedia (2022)", "SMA Negeri 1 Margahayu - IPS (2019)", "SMK Negeri 8 Bandung - Teknik Elektronika (2020)"],
  manager: ["S1 Manajemen - Universitas Katolik Parahyangan (2016)", "S1 Administrasi Niaga - Universitas Padjadjaran (2017)",
    "D3 Manajemen Ritel - Politeknik Negeri Bandung (2015)"],
};

const EXPERIENCE = {
  crew: ["Crew Printing Kaos - Konveksi Sablon Cibaduyut (1 tahun)", "Barista - Kedai Kopi di Dago (8 bulan)",
    "Pramuniaga - Gerai Aksesoris HP di Mall Bandung (1,5 tahun)", "Crew Photobooth - Event Organizer Bandung (1 tahun)",
    "Kasir - Minimarket Sukajadi (2 tahun)"],
  sales: ["Sales Promotion Girl - Brand Skincare Lokal (1 tahun)", "Pramuniaga - Toko Fashion Distro Bandung (2 tahun)",
    "Kasir & Pramuniaga - Toko Aksesoris HP Kopo (1 tahun)", "Sales Counter - Gerai Smartphone (1,5 tahun)",
    "Crew Store - Toko Buku & Alat Tulis (10 bulan)"],
  front: ["Resepsionis - Salon & Barbershop (1 tahun)", "Kasir - Coffee Shop Setiabudi (1,5 tahun)"],
  designer: ["Junior Graphic Designer - Agensi Digital Bandung (1,5 tahun)", "Freelance Illustrator - Klien UMKM & Brand Lokal (2 tahun)",
    "Desainer Produk - Brand Merchandise Bandung (1 tahun)", "Intern Desainer - Studio Kreatif Dago (6 bulan)"],
  content: ["Social Media Specialist - Brand Fashion Lokal (1 tahun)", "Content Creator Freelance - UMKM Kuliner Bandung (2 tahun)",
    "Videografer - Event Organizer (1 tahun)", "Admin Instagram - Toko Online Aksesoris (1,5 tahun)"],
  operator: ["Operator Printer UV - Percetakan Merchandise (2 tahun)", "Operator Sablon & DTF - Konveksi Bandung (3 tahun)",
    "Operator Mesin Cutting - Percetakan Digital (1,5 tahun)", "Teknisi Printer - Toko Percetakan (1 tahun)"],
  gudang: ["Admin Gudang - Distributor Aksesoris (1 tahun)"],
  cs: ["Admin Marketplace - Toko Online Fashion (1,5 tahun)", "Customer Service - Startup E-commerce (1 tahun)",
    "Admin Chat WhatsApp - Toko Kosmetik Online (2 tahun)"],
  manager: ["Store Supervisor - Brand Fashion Lokal (3 tahun)", "Assistant Store Manager - Ritel Aksesoris Nasional (2 tahun)",
    "Store Manager - Gerai Sepatu di Mall Bandung (4 tahun)"],
};

const AVAILABILITY_TEXT = { immediate: "segera", "1_week": "dalam satu minggu", "2_weeks": "dalam dua minggu", "1_month": "bulan depan, setelah resign dari tempat lama" };

/* ── PAPI: bobot skala per keluarga peran (pilihan kandidat cenderung ke skala berbobot tinggi) ── */
const PAPI_PROFILE = {
  retail: { S: 3, X: 2, E: 2.5, G: 2, N: 2, B: 1.5, O: 1.5, W: 1.5, F: 1.5, T: 1.5, V: 1.5 },
  creative: { Z: 3, R: 2.5, X: 2, D: 2, A: 2, N: 1.5, I: 1.5, S: 1.2 },
  production: { D: 3, C: 2.5, G: 2.5, W: 2, N: 2, V: 2, F: 1.5, E: 1.5 },
  manager: { L: 3, P: 2.5, I: 2.5, A: 2.5, N: 2, E: 2, K: 1.5, F: 1.2 },
};

/* ── Insight tes gambar (bentuk = psikotes_session_tests.ai_insight dari Go createDrawingInsight) ── */
const DRAWING_NOTES = {
  baum: [
    { observation: "Pohon digambar di tengah kertas dengan ukuran sedang. Batang tegak dengan tekstur kulit kayu, mahkota bulat rimbun berisi beberapa buah, dan akar tipis terlihat di bagian bawah. Garis tegas dan stabil, hampir tanpa penghapusan.",
      ringkasan: "Gambar pohon proporsional dan lengkap. Secara indikatif kandidat cenderung stabil, cukup percaya diri, dan memiliki dorongan untuk menghasilkan sesuatu yang nyata.",
      indikasi: [["Posisi tengah & ukuran sedang", "Cenderung seimbang dalam menempatkan diri di lingkungan baru."],
        ["Batang tegak bertekstur", "Mengindikasikan daya tahan dan kesungguhan dalam bekerja."],
        ["Mahkota rimbun berbuah", "Cenderung berorientasi pada hasil dan senang menunjukkan pencapaian."],
        ["Akar digambar", "Mengindikasikan kebutuhan pijakan dan rasa aman yang cukup terpenuhi."]],
      perhatikan: ["Gali contoh konkret ketika kandidat harus menuntaskan pekerjaan di bawah tekanan.", "Tanyakan bagaimana kandidat beradaptasi dengan perubahan jadwal shift."],
      review: "Gambar stabil dan lengkap; indikasi ketekunan baik. Sesuai untuk pekerjaan yang menuntut konsistensi harian. Validasi daya tahan shift saat interview." },
    { observation: "Pohon berukuran agak kecil di kiri bawah kertas. Batang ramping tanpa akar, mahkota berbentuk awan dengan arsiran ringan. Tekanan garis tipis dan terdapat beberapa bekas penghapusan di bagian dahan.",
      ringkasan: "Gambar pohon cenderung kecil dan berhati-hati. Secara indikatif kandidat mungkin butuh waktu untuk merasa nyaman di lingkungan baru dan lebih nyaman dengan arahan yang jelas.",
      indikasi: [["Ukuran kecil di kiri bawah", "Cenderung berhati-hati dan belum sepenuhnya percaya diri."],
        ["Tanpa akar", "Mengindikasikan kebutuhan dukungan atau struktur kerja yang jelas."],
        ["Garis tipis & penghapusan", "Cenderung teliti namun mudah ragu terhadap hasil sendiri."]],
      perhatikan: ["Tanyakan pengalaman kandidat saat harus mengambil keputusan tanpa atasan.", "Gali kebutuhan pendampingan di minggu-minggu awal kerja.", "Konfirmasi kenyamanan melayani pelanggan yang ramai."],
      review: "Indikasi kehati-hatian dan kebutuhan arahan cukup menonjol. Bisa berkembang dengan onboarding terstruktur; pertimbangkan penempatan bersama crew senior." },
  ],
  dap: [
    { observation: "Figur manusia digambar utuh dari kepala hingga kaki dengan proporsi seimbang. Wajah tersenyum dengan detail mata, alis, dan rambut; memakai kaos dan celana, tangan terbuka di samping badan. Garis jelas dan rapi.",
      ringkasan: "Figur lengkap, proporsional, dan ekspresif. Secara indikatif kandidat cenderung terbuka, ramah, dan cukup nyaman berinteraksi dengan orang lain.",
      indikasi: [["Wajah tersenyum & detail lengkap", "Cenderung hangat dan memperhatikan kesan pertama."],
        ["Tangan terbuka", "Mengindikasikan keterbukaan terhadap interaksi sosial."],
        ["Proporsi seimbang", "Cenderung memiliki gambaran diri yang cukup realistis."]],
      perhatikan: ["Minta contoh menghadapi pelanggan yang sulit.", "Gali cara kandidat menjaga mood saat lelah di akhir shift."],
      review: "Indikasi keterbukaan sosial baik dan selaras dengan peran pelayanan. Tidak ada catatan khusus." },
    { observation: "Figur digambar cukup besar memenuhi dua pertiga kertas, detail wajah lengkap, membawa tas selempang, posisi kaki seperti melangkah. Garis tegas dengan sedikit arsiran pada rambut dan pakaian.",
      ringkasan: "Figur besar dan dinamis. Secara indikatif kandidat cenderung energik, percaya diri, dan berorientasi pada aktivitas.",
      indikasi: [["Ukuran besar", "Cenderung percaya diri dan ingin terlihat."],
        ["Posisi melangkah", "Mengindikasikan dorongan untuk bergerak dan mengambil inisiatif."],
        ["Aksesori (tas)", "Cenderung memperhatikan penampilan dan detail."],
        ["Garis tegas", "Mengindikasikan energi dan ketegasan yang cukup tinggi."]],
      perhatikan: ["Gali cara kandidat bekerja dalam tim saat pendapatnya berbeda.", "Tanyakan contoh inisiatif yang pernah diambil di pekerjaan sebelumnya."],
      review: "Energi dan inisiatif tinggi; perlu dipastikan tetap mengikuti SOP toko. Layak lanjut." },
  ],
  wartegg: [
    { observation: "Delapan kotak terisi semua. Kotak 1 menjadi wajah tersenyum, kotak 2 gelombang laut, kotak 3 tangga naik, kotak 4 rumah kecil, kotak 5 roket, kotak 6 bingkai jendela, kotak 7 untaian manik, kotak 8 payung. Gambar rapi dan sebagian besar memanfaatkan karakter stimulus.",
      ringkasan: "Seluruh stimulus direspons dengan gambar yang orisinal dan sesuai karakter stimulus. Secara indikatif kandidat cenderung kreatif, terstruktur, dan memiliki dorongan berprestasi.",
      indikasi: [["Semua kotak terisi", "Cenderung tuntas dan bertanggung jawab pada tugas."],
        ["Tangga naik & roket", "Mengindikasikan ambisi dan orientasi pada kemajuan."],
        ["Pemanfaatan stimulus yang tepat", "Cenderung peka terhadap detail dan konteks."],
        ["Tema beragam & orisinal", "Mengindikasikan kreativitas yang cukup baik."]],
      perhatikan: ["Minta kandidat menjelaskan proses kreatif dari brief sampai file final.", "Gali cara kandidat menerima revisi desain yang banyak."],
      review: "Respons orisinal dan tuntas; kreativitas serta ketelitian baik. Cocok untuk peran desain/konten." },
    { observation: "Tujuh dari delapan kotak terisi; kotak 6 dibiarkan kosong. Gambar sederhana: matahari, jalan, pagar, kotak hadiah, rumah, pohon, dan bunga. Beberapa gambar mengabaikan bentuk stimulus dan digambar ulang dari awal.",
      ringkasan: "Sebagian besar stimulus direspons dengan gambar sederhana. Secara indikatif kandidat cenderung praktis, namun kurang memanfaatkan stimulus sebagai titik tolak ide.",
      indikasi: [["Satu kotak kosong", "Mengindikasikan kemungkinan kesulitan pada stimulus tertentu atau keterbatasan waktu."],
        ["Gambar sederhana & familiar", "Cenderung praktis dan memilih aman."],
        ["Stimulus diabaikan", "Cenderung bekerja dengan caranya sendiri dibanding mengikuti arahan."]],
      perhatikan: ["Tanyakan bagaimana kandidat mencari ide ketika buntu.", "Gali kesediaan mengikuti brand guideline yang ketat."],
      review: "Kreativitas cukup, namun respons terhadap arahan perlu divalidasi. Pertimbangkan tugas desain singkat sebagai tes lanjutan." },
  ],
};

const DRAWING_LIMIT = "Interpretasi ini bersifat indikatif dari observasi gambar yang terbatas, bukan diagnosis psikologis; keputusan tetap di tangan HRD/psikolog.";
const INTERVIEW_LIMIT = "Kesimpulan indikatif dari interview basic oleh AI — keputusan tetap di tangan HRD.";

/* ── Interview AI: jawaban per keluarga peran & topik (placeholder {…}) ── */
const ANSWERS = {
  retail: {
    pembuka: ["Halo, saya {first}, tinggal di {dom}. Sebelumnya saya bekerja sebagai {exp}. Di sana saya terbiasa melayani pelanggan, merapikan display, dan pegang kasir waktu toko lagi ramai.",
      "Perkenalkan, saya {first}, lulusan {edu}. Pengalaman terakhir saya {exp}. Saya senang kerja yang banyak ketemu orang dan suasananya ceria."],
    keahlian: ["Saya paling kuat di pelayanan pelanggan. Biasanya saya tanya dulu tipe HP dan gaya yang disukai, lalu tunjukkan dua atau tiga pilihan supaya pelanggan tidak bingung. Saya juga terbiasa pakai aplikasi kasir dan QRIS.",
      "Saya teliti soal uang dan stok. Di tempat kerja lama saya jarang sekali selisih kas, dan saya biasa cek ulang barang sebelum diserahkan ke pelanggan."],
    followup: ["Bisa ceritakan pengalaman menghadapi pelanggan yang komplain?",
      "Pernah ada pelanggan marah karena barangnya cacat. Saya minta maaf dulu, dengarkan sampai selesai, lalu tawarkan tukar barang sesuai aturan toko. Akhirnya pelanggannya malah beli satu lagi."],
    motivasi: ["Saya sudah lama pakai case Paddy dan suka konsep custom-nya. Saya ingin kerja di tempat yang suasananya ceria dan bisa bantu orang bikin barang yang personal.",
      "Paddy brand lokal Bandung yang lagi berkembang, jadi saya merasa bisa belajar banyak, terutama soal retail dan desain produk."],
    ketersediaan: ["Saya bisa mulai {avail}. Shift pagi atau siang tidak masalah, dan akhir pekan juga bisa masuk.",
      "Saya bisa mulai {avail}. Dari {dom} ke toko sekitar 30 menit naik motor, jadi shift sampai jam 10 malam masih aman."],
    gaji: ["Untuk gaji saya berharap sekitar {salary} per bulan, tapi masih bisa dibicarakan sesuai benefit yang diberikan.",
      "Ekspektasi saya di kisaran {salary}, kurang lebih sesuai UMK Bandung."],
  },
  creative: {
    pembuka: ["Saya {first}, lulusan {edu}. Terakhir saya {exp}, banyak mengerjakan ilustrasi, desain feed Instagram, dan packaging untuk brand lokal.",
      "Halo, saya {first} dari {dom}. Saya {exp} dan aktif membagikan karya di Instagram dan Behance."],
    keahlian: ["Saya pakai Illustrator dan Procreate untuk ilustrasi, Photoshop untuk mockup, dan sedikit After Effects. Untuk produk cetak saya biasa menyiapkan file CMYK dengan bleed dan resolusi 300 dpi supaya hasilnya tajam.",
      "Saya terbiasa bikin konsep video pendek, syuting pakai HP dan gimbal, lalu edit di CapCut dan Premiere. Salah satu video saya untuk klien pernah tembus 200 ribu views."],
    followup: ["Boleh ceritakan satu proyek yang paling Anda banggakan?",
      "Saya pernah membuat seri stiker karakter untuk kafe lokal, dari sketsa sampai jadi merchandise. Seri itu habis dalam dua minggu dan kliennya minta seri kedua."],
    // Konten: indeks 0 = Graphic Designer, 1 = Content Creator (keahlian, motivasi, follow-up)
    followupContent: ["Boleh ceritakan konten yang performanya paling bagus dan kenapa menurut Anda berhasil?",
      "Video \"satu hari jadi crew toko\" untuk brand fashion lokal, durasinya 25 detik dengan hook di 2 detik pertama. Reach-nya 200 ribu karena relatable dan pakai audio yang lagi tren."],
    motivasi: ["Gaya visual Paddy yang playful cocok dengan gaya ilustrasi saya. Saya ingin desain saya dipakai banyak orang setiap hari di HP mereka.",
      "Saya suka konten @paddy.id yang dekat dengan anak muda Bandung, dan ingin ikut membesarkan brand lokal lewat konten yang kreatif."],
    ketersediaan: ["Saya bisa mulai {avail}. Skema hybrid cocok untuk saya, dan untuk syuting di toko saya fleksibel.",
      "Saya bisa mulai {avail}. Saya tinggal di {dom}, jadi ke workshop tidak terlalu jauh."],
    gaji: ["Ekspektasi saya sekitar {salary} per bulan, menyesuaikan dengan scope kerja dan benefit.",
      "Saya berharap di kisaran {salary}, tapi saya terbuka untuk diskusi."],
  },
  production: {
    pembuka: ["Saya {first} dari {dom}. Sebelumnya saya {exp}, pegang mesin cetak dan finishing.",
      "Perkenalkan, saya {first}, lulusan {edu}. Pengalaman saya {exp}."],
    keahlian: ["Saya bisa mengoperasikan printer UV flatbed dan mesin laminasi, termasuk kalibrasi warna sederhana dan membersihkan head printer. Saya juga biasa cek hasil cetak satu per satu sebelum dikemas.",
      "Saya terbiasa dengan mesin sablon dan DTF, mengatur suhu press, dan menyiapkan bahan sebelum produksi supaya tidak banyak yang reject."],
    followup: ["Apa yang Anda lakukan kalau hasil cetak warnanya tidak sesuai?",
      "Saya cek dulu profil warna file dan setting mesin, lalu tes cetak di bahan sisa. Kalau masih beda, saya lapor ke atasan sebelum lanjut produksi supaya bahan tidak terbuang."],
    motivasi: ["Saya ingin kerja yang stabil dan tetap di bidang percetakan. Produk Paddy banyak variasinya, jadi saya bisa belajar mesin dan bahan yang baru.",
      "Saya tertarik karena workshop Paddy pakai mesin UV yang lebih modern dari tempat saya sebelumnya."],
    ketersediaan: ["Saya bisa mulai {avail}. Lembur saat ramai juga tidak masalah.", "Saya bisa mulai {avail}, jarak dari {dom} ke workshop sekitar 25 menit."],
    gaji: ["Ekspektasi saya sekitar {salary} per bulan.", "Saya berharap {salary}, belum termasuk lembur."],
  },
  manager: {
    pembuka: ["Saya {first}, sudah sekitar lima tahun di retail. Terakhir saya {exp}, memimpin delapan orang crew.",
      "Perkenalkan, saya {first}, lulusan {edu}. Saya {exp} dan terbiasa memegang target bulanan toko."],
    keahlian: ["Saya terbiasa menyusun jadwal shift, membaca laporan penjualan harian, dan membagi target per crew. Waktu omzet toko saya turun, saya ubah layout display dan bikin program bundling; dalam dua bulan penjualan naik sekitar 15 persen.",
      "Saya kuat di pengelolaan tim dan stok. Saya rutin coaching crew baru dan melakukan stock opname mingguan supaya selisih stok kecil."],
    followup: ["Bagaimana Anda menangani crew yang kinerjanya menurun?",
      "Saya ajak bicara empat mata dulu untuk cari penyebabnya, lalu kami sepakati target perbaikan dua minggu. Kalau perlu saya pasangkan dengan crew senior."],
    motivasi: ["Saya ingin memimpin toko dari brand yang punya karakter kuat dan komunitas loyal seperti Paddy.",
      "Saya melihat Paddy Store Kopo punya potensi besar dari pelajar dan keluarga di Bandung selatan, dan saya ingin membantu mengembangkannya."],
    ketersediaan: ["Saya bisa mulai {avail}.", "Saya bisa mulai {avail}, dan siap menyesuaikan jam operasional mall."],
    gaji: ["Ekspektasi saya sekitar {salary} per bulan, ditambah bonus target.", "Saya berharap di kisaran {salary}."],
  },
};

const SKILLS = {
  designer: ["Adobe Illustrator", "Photoshop", "Procreate", "Persiapan file cetak (CMYK, bleed)", "Ilustrasi karakter & stiker", "Mockup produk"],
  content: ["Konsep konten media sosial", "Video pendek (CapCut/Premiere)", "Fotografi produk", "Copywriting caption", "Membaca insight Instagram/TikTok"],
  retail: ["Pelayanan pelanggan", "Mengoperasikan kasir & QRIS", "Penataan display", "Penanganan komplain", "Rekomendasi produk", "Ketelitian hitung uang"],
  creative: ["Adobe Illustrator", "Photoshop", "Procreate", "Persiapan file cetak", "Video pendek (CapCut/Premiere)", "Konsep konten media sosial"],
  production: ["Printer UV flatbed", "Mesin laminasi", "Kalibrasi warna dasar", "Quality control cetak", "Perawatan mesin harian"],
  manager: ["Penyusunan jadwal shift", "Analisis penjualan harian", "Coaching crew", "Stock opname", "Program promosi toko"],
};

const OFFER_BENEFITS = {
  retail: ["BPJS Kesehatan & Ketenagakerjaan", "Uang makan Rp25.000/hari kerja", "Komisi/insentif penjualan bulanan", "Diskon karyawan 30% produk Paddy", "THR sesuai ketentuan"],
  creative: ["BPJS Kesehatan & Ketenagakerjaan", "Skema kerja hybrid (3 hari workshop)", "Bonus performa per rilis koleksi/konten", "Tunjangan internet Rp200.000/bulan", "THR sesuai ketentuan"],
  production: ["BPJS Kesehatan & Ketenagakerjaan", "Makan siang di workshop", "Uang lembur sesuai ketentuan", "Seragam & APD", "THR sesuai ketentuan"],
  manager: ["BPJS Kesehatan & Ketenagakerjaan", "Bonus pencapaian target toko", "Tunjangan transportasi Rp750.000/bulan", "Tunjangan komunikasi", "THR sesuai ketentuan"],
};

module.exports = {
  EMAIL_MARK, HR, MANAGERS, BRANDS, DEPARTMENTS, POSITIONS, JOBS, CANDIDATES, DOMICILES, EDUCATION, EXPERIENCE,
  AVAILABILITY_TEXT, PAPI_PROFILE, DRAWING_NOTES, DRAWING_LIMIT, INTERVIEW_LIMIT, ANSWERS, SKILLS, OFFER_BENEFITS,
};
