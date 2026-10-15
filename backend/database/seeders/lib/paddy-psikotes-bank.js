/**
 * Bank soal psikotes demo Paddy (recruitment.psikotes_questions) untuk instrumen
 * Aritmatika, Matematika (mcq) dan PAPI Kostick (forced_choice).
 *
 * Bentuk data HARUS sama dengan yang disimpan route bank soal Go
 * (backend/internal/modules/recruitment/input.go parseMcqQuestion / parsePapiQuestion):
 *   - mcq           : options = [{key: "a".."f", text}], answer_key = {correct: "<key>"}
 *   - forced_choice : options = {a: {text, scale}, b: {text, scale}}, answer_key = NULL,
 *                     scale ∈ domain.PapiScaleCodes, scale A ≠ scale B, body opsional ("")
 *
 * Semua soal di sini ORIGINAL (ditulis untuk demo Paddy). Pernyataan PAPI BUKAN butir
 * PAPI Kostick resmi — hanya mengikuti format pasangan pilihan paksa dengan 20 skala yang
 * dipakai skoring (domain.ScorePapi). GANTI dengan butir berlisensi sebelum dipakai untuk
 * seleksi sungguhan.
 */

const MCQ_KEYS = ["a", "b", "c", "d", "e", "f"];

// [soal, jawaban benar, [pengecoh...]] — teks opsi apa adanya (format Indonesia).
const ARITMATIKA = [
  ["236 + 487 = …", "723", ["713", "623", "733"]],
  ["1.205 − 678 = …", "527", ["537", "627", "517"]],
  ["48 × 25 = …", "1.200", ["1.020", "1.250", "960"]],
  ["1.512 ÷ 24 = …", "63", ["62", "73", "64"]],
  ["17 × 19 = …", "323", ["313", "333", "343"]],
  ["3.750 + 1.480 − 925 = …", "4.305", ["4.205", "4.315", "5.305"]],
  ["0,75 + 1,6 = …", "2,35", ["1,81", "2,25", "2,45"]],
  ["12,5 × 8 = …", "100", ["96", "105", "125"]],
  ["25% dari 840 = …", "210", ["200", "220", "240"]],
  ["15% dari 2.400 = …", "360", ["340", "320", "380"]],
  ["3/4 dari 96 = …", "72", ["64", "68", "76"]],
  ["1/2 + 1/3 = …", "5/6", ["2/5", "1/6", "2/3"]],
  ["(45 + 35) × 6 = …", "480", ["255", "460", "500"]],
  ["144 ÷ 12 + 18 = …", "30", ["28", "32", "8"]],
  ["9² − 4² = …", "65", ["25", "55", "75"]],
  ["√225 = …", "15", ["13", "25", "17"]],
  ["Pelanggan membeli satu Custom Case seharga Rp119.000 dan membayar dengan uang Rp150.000. Berapa kembaliannya?",
    "Rp31.000", ["Rp21.000", "Rp41.000", "Rp29.000"]],
  ["Harga satu pop socket Rp45.000. Berapa harga 3 pop socket?", "Rp135.000", ["Rp125.000", "Rp145.000", "Rp90.000"]],
  ["Sebuah case seharga Rp89.000 mendapat diskon 20%. Berapa harga setelah diskon?",
    "Rp71.200", ["Rp69.000", "Rp72.100", "Rp17.800"]],
  ["Total belanja Rp237.500 dibayar dengan Rp300.000. Berapa kembaliannya?", "Rp62.500", ["Rp63.500", "Rp72.500", "Rp52.500"]],
  ["Kasir menerima 7 lembar Rp50.000, 4 lembar Rp20.000, dan 3 lembar Rp5.000. Berapa total uangnya?",
    "Rp445.000", ["Rp435.000", "Rp455.000", "Rp425.000"]],
  ["Stok awal 240 case, terjual 87 case, lalu masuk kiriman 60 case. Berapa stok akhirnya?", "213", ["93", "207", "223"]],
  ["Satu mesin cetak menyelesaikan 12 case per jam. Berapa case selesai dalam 7,5 jam?", "90", ["84", "96", "86"]],
  ["Pesanan 5 Custom Case @Rp119.000 ditambah ongkir Rp18.000. Berapa total tagihannya?",
    "Rp613.000", ["Rp595.000", "Rp603.000", "Rp631.000"]],
  ["Komisi crew 10% dari penjualan Rp2.350.000. Berapa komisinya?", "Rp235.000", ["Rp23.500", "Rp225.000", "Rp253.000"]],
  ["7.008 ÷ 8 = …", "876", ["867", "886", "786"]],
  ["2.046 − 1.987 = …", "59", ["69", "61", "49"]],
  ["36 × 0,25 = …", "9", ["8", "12", "6"]],
  ["Rata-rata dari 12, 18, 21, dan 29 adalah …", "20", ["19", "21", "80"]],
  ["1.000 − 37 × 12 = …", "556", ["11.556", "544", "566"]],
  ["64 ÷ 0,8 = …", "80", ["8", "51,2", "72"]],
  ["2/5 dari Rp1.250.000 = …", "Rp500.000", ["Rp450.000", "Rp520.000", "Rp250.000"]],
  ["Toko buka pukul 10.15 dan tutup pukul 17.45. Berapa menit toko buka?", "450", ["430", "460", "390"]],
];

const MATEMATIKA = [
  ["Bilangan berikutnya dari deret 3, 7, 11, 15, … adalah", "19", ["18", "21", "17", "23"]],
  ["Bilangan berikutnya dari deret 2, 6, 18, 54, … adalah", "162", ["108", "72", "148", "216"]],
  ["Bilangan berikutnya dari deret 1, 4, 9, 16, 25, … adalah", "36", ["34", "30", "49", "35"]],
  ["Bilangan berikutnya dari deret 5, 8, 13, 20, 29, … adalah", "40", ["38", "41", "36", "42"]],
  ["Bilangan berikutnya dari deret 100, 95, 85, 70, 50, … adalah", "25", ["30", "20", "35", "15"]],
  ["Bilangan berikutnya dari deret 1, 1, 2, 3, 5, 8, … adalah", "13", ["11", "12", "16", "10"]],
  ["Jika 2x + 5 = 17, maka x = …", "6", ["11", "7", "5", "8"]],
  ["Jika 3x − 7 = 2x + 4, maka x = …", "11", ["3", "-3", "-11", "7"]],
  ["Empat crew menyelesaikan 60 case dalam 5 jam. Dengan kecepatan yang sama, berapa case diselesaikan enam crew dalam 5 jam?",
    "90", ["75", "80", "100", "72"]],
  ["Perbandingan crew Paddy Store PVJ dan Paddy Store Kopo adalah 3 : 2. Jika total crew 25 orang, berapa crew di PVJ?",
    "15", ["10", "12", "18", "20"]],
  ["Harga sebuah tas naik dari Rp80.000 menjadi Rp100.000. Berapa persen kenaikannya?", "25%", ["20%", "15%", "30%", "125%"]],
  ["Penjualan case Senin 40, Selasa 55, Rabu 45, dan Kamis 60. Berapa rata-rata penjualan per hari?",
    "50", ["45", "55", "52", "200"]],
  ["Luas persegi panjang berukuran 12 cm × 7 cm adalah …", "84 cm²", ["38 cm²", "76 cm²", "94 cm²", "19 cm²"]],
  ["Keliling persegi dengan sisi 9 cm adalah …", "36 cm", ["81 cm", "18 cm", "27 cm", "45 cm"]],
  ["Jika x = 3 dan y = 4, maka x² + y² = …", "25", ["49", "14", "7", "24"]],
  ["Barang dibeli Rp60.000 dan dijual Rp75.000. Berapa persen keuntungan dari harga beli?",
    "25%", ["20%", "15%", "30%", "75%"]],
  ["Kurir melaju 40 km/jam untuk menempuh jarak 30 km. Berapa lama waktu tempuhnya?",
    "45 menit", ["40 menit", "1 jam 15 menit", "50 menit", "30 menit"]],
  ["5 dari 20 pelanggan memilih layout 3 gambar. Berapa persen pelanggan yang memilih layout itu?",
    "25%", ["20%", "5%", "15%", "40%"]],
  ["Peluang muncul mata dadu genap pada sekali lempar adalah …", "1/2", ["1/3", "1/6", "2/3", "1/4"]],
  ["Jika 3 case harganya Rp270.000, maka harga 7 case adalah …", "Rp630.000", ["Rp540.000", "Rp610.000", "Rp700.000", "Rp560.000"]],
  ["Jika 15% dari suatu bilangan adalah 45, bilangan tersebut adalah …", "300", ["150", "675", "250", "450"]],
  ["Bilangan berikutnya dari deret 2, 3, 5, 7, 11, … adalah", "13", ["15", "12", "17", "14"]],
  ["Nilai dari (−3) × (−4) + 2 adalah …", "14", ["-10", "10", "-14", "24"]],
  ["Jika a : b = 2 : 5 dan b = 35, maka a = …", "14", ["10", "70", "17", "7"]],
  ["Toko buka pukul 10.00–22.00 setiap hari. Berapa jam toko buka dalam seminggu?", "84", ["72", "77", "91", "70"]],
  ["Diskon 10% lalu diskon tambahan 10% dari harga setelah diskon pertama setara dengan diskon total …",
    "19%", ["20%", "18%", "21%", "11%"]],
  ["Dua sudut sebuah segitiga adalah 50° dan 60°. Besar sudut ketiga adalah …", "70°", ["80°", "60°", "90°", "110°"]],
  ["Hasil dari 1 + 2 + 3 + … + 20 adalah …", "210", ["200", "190", "220", "420"]],
  ["Huruf berikutnya dari deret A, C, F, J, O, … adalah", "U", ["T", "V", "S", "W"]],
  ["Semua crew Paddy memakai seragam. Dimas adalah crew Paddy. Kesimpulan yang tepat adalah …",
    "Dimas memakai seragam", ["Dimas tidak memakai seragam", "Semua yang memakai seragam adalah crew Paddy",
      "Dimas mungkin bukan crew Paddy", "Tidak dapat disimpulkan"]],
  ["Volume kubus dengan rusuk 5 cm adalah …", "125 cm³", ["25 cm³", "150 cm³", "75 cm³", "100 cm³"]],
  ["Median dari data 7, 3, 9, 5, 11 adalah …", "7", ["5", "9", "35", "6"]],
  ["Rata-rata 4 bilangan adalah 15. Setelah ditambah satu bilangan, rata-ratanya menjadi 16. Bilangan yang ditambahkan adalah …",
    "20", ["16", "17", "19", "21"]],
];

/** Soal mcq dengan opsi diacak deterministik; kunci jawaban ikut posisi opsi benar. */
function mcqItems(rows, rand) {
  return rows.map(([body, correct, wrong], i) => {
    const texts = [correct, ...wrong];
    for (let j = texts.length - 1; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1));
      [texts[j], texts[k]] = [texts[k], texts[j]];
    }
    const options = texts.map((text, j) => ({ key: MCQ_KEYS[j], text }));
    const key = options.find((o) => o.text === correct).key;
    return { body, options, answer_key: { correct: key }, sort_order: (i + 1) * 10 };
  });
}

/*
 * PAPI: 9 pernyataan ORIGINAL per skala (20 skala × 9 = 180 pernyataan = 90 pasangan),
 * urutan skala = domain.PapiScaleCodes.
 */
const PAPI_STATEMENTS = {
  N: ["Saya merasa belum tenang sebelum pekerjaan saya benar-benar tuntas.",
    "Saya menyelesaikan satu tugas dulu sebelum mengambil tugas berikutnya.",
    "Saya tetap mengerjakan tugas sampai selesai walaupun terasa membosankan.",
    "Saya puas setiap kali bisa mencoret daftar pekerjaan yang sudah beres.",
    "Saya jarang meninggalkan pekerjaan dalam keadaan setengah jadi.",
    "Saya ingin setiap pesanan yang saya pegang selesai tepat waktu.",
    "Saya senang menutup shift tanpa ada pekerjaan yang tertunda.",
    "Saya bertanggung jawab menuntaskan apa yang sudah saya mulai.",
    "Saya lebih suka fokus menyelesaikan daripada memulai banyak hal baru."],
  G: ["Saya bersedia bekerja ekstra ketika toko sedang ramai.",
    "Saya bekerja sungguh-sungguh walaupun tidak ada yang mengawasi.",
    "Saya terbiasa bekerja dengan tempo cepat dalam waktu lama.",
    "Saya tidak keberatan lembur ketika ada target penting.",
    "Saya percaya kerja keras adalah kunci keberhasilan.",
    "Saya mencurahkan tenaga penuh pada setiap tugas.",
    "Saya jarang mengeluh walaupun beban kerja bertambah.",
    "Saya mau berusaha lebih keras demi hasil terbaik.",
    "Saya menikmati hari kerja yang padat."],
  A: ["Saya ingin menjadi yang terbaik di tim saya.",
    "Saya menetapkan target pribadi yang lebih tinggi dari target toko.",
    "Saya senang ketika hasil kerja saya diakui sebagai prestasi.",
    "Saya ingin cepat naik ke posisi yang lebih tinggi.",
    "Saya terdorong oleh tantangan yang sulit dicapai.",
    "Saya membandingkan hasil kerja saya dengan standar terbaik.",
    "Saya ingin dikenal sebagai karyawan yang berprestasi.",
    "Saya terus mencari cara agar penjualan saya meningkat.",
    "Saya tertantang untuk memecahkan rekor penjualan toko."],
  L: ["Saya nyaman mengambil peran pemimpin dalam kelompok.",
    "Rekan kerja sering meminta saya mengarahkan pekerjaan.",
    "Saya senang memimpin briefing sebelum toko buka.",
    "Saya percaya diri memimpin tim yang baru dibentuk.",
    "Saya senang bertanggung jawab atas hasil kerja tim.",
    "Saya mudah mengajak orang lain mengikuti rencana saya.",
    "Saya ingin dipercaya memimpin sebuah toko.",
    "Saya biasanya tampil di depan ketika kelompok butuh arahan.",
    "Saya menikmati membimbing rekan kerja yang baru bergabung."],
  P: ["Saya suka membagi tugas kepada rekan agar pekerjaan tertata.",
    "Saya merasa perlu memantau pekerjaan orang lain.",
    "Saya senang menyusun jadwal kerja tim.",
    "Saya cenderung memberi tahu orang lain cara terbaik mengerjakan sesuatu.",
    "Saya ingin punya wewenang mengatur anggota tim.",
    "Saya memastikan setiap orang mengerjakan bagiannya.",
    "Saya tidak ragu menegur rekan yang lalai.",
    "Saya suka mengoordinasikan beberapa orang sekaligus.",
    "Saya merasa cocok menjadi pengawas di lapangan."],
  I: ["Saya cepat mengambil keputusan walaupun informasinya terbatas.",
    "Saya berani memutuskan sendiri ketika atasan sedang tidak ada.",
    "Saya tidak suka menunda-nunda keputusan.",
    "Saya yakin dengan keputusan yang sudah saya ambil.",
    "Saya bisa memilih solusi dengan cepat saat pelanggan komplain.",
    "Saya lebih suka memutuskan daripada menunggu arahan.",
    "Saya siap menanggung risiko dari keputusan saya.",
    "Saya jarang ragu ketika harus memilih.",
    "Saya terbiasa memutuskan hal penting dalam waktu singkat."],
  T: ["Saya mengerjakan sesuatu dengan cepat.",
    "Saya suka menangani beberapa hal dalam waktu bersamaan.",
    "Saya merasa gelisah bila tidak ada kegiatan.",
    "Saya bergerak cepat dari satu tugas ke tugas lain.",
    "Saya ingin tetap sibuk sepanjang jam kerja.",
    "Saya tidak betah menunggu terlalu lama.",
    "Saya menyukai suasana kerja yang serba cepat.",
    "Saya biasanya selesai lebih cepat dari perkiraan.",
    "Saya bersemangat ketika antrean pelanggan sedang panjang."],
  V: ["Saya suka pekerjaan yang membuat saya banyak bergerak.",
    "Saya kuat berdiri dan berjalan sepanjang shift.",
    "Saya lebih bersemangat bekerja di lantai toko daripada di balik meja.",
    "Saya senang membantu mengangkat dan menata stok barang.",
    "Saya rutin berolahraga agar tetap bugar.",
    "Saya cepat bosan bila harus duduk terlalu lama.",
    "Saya merasa berenergi saat bekerja secara fisik.",
    "Saya menikmati menata display toko walaupun butuh tenaga.",
    "Saya jarang merasa lelah walaupun bekerja seharian."],
  X: ["Saya senang menjadi pusat perhatian.",
    "Saya suka tampil beda dari orang lain.",
    "Saya senang ketika hasil desain saya dipajang.",
    "Saya ingin orang lain memperhatikan ide-ide saya.",
    "Saya menikmati tampil di konten media sosial toko.",
    "Saya suka bercerita tentang pencapaian saya.",
    "Saya senang dipuji di depan banyak orang.",
    "Saya ingin dikenal oleh banyak pelanggan.",
    "Saya suka berpenampilan mencolok."],
  S: ["Saya mudah akrab dengan orang yang baru dikenal.",
    "Saya senang mengobrol dengan pelanggan.",
    "Saya punya banyak teman dari berbagai kalangan.",
    "Saya menikmati acara kumpul bersama rekan kerja.",
    "Saya suka pekerjaan yang banyak berinteraksi dengan orang.",
    "Saya mudah memulai percakapan.",
    "Saya senang menyapa setiap pelanggan yang datang.",
    "Saya bersemangat berada di tengah keramaian.",
    "Saya menjaga hubungan baik dengan banyak orang."],
  B: ["Saya ingin diterima dengan baik oleh tim.",
    "Saya menyesuaikan diri dengan kebiasaan kelompok.",
    "Saya tidak suka berbeda pendapat dengan teman satu tim.",
    "Saya mengikuti keputusan bersama walaupun kurang setuju.",
    "Saya nyaman bekerja dalam kelompok yang kompak.",
    "Bagi saya penting merasa menjadi bagian dari tim.",
    "Saya senang ikut kegiatan bersama tim.",
    "Saya menghindari hal yang membuat saya dijauhi rekan.",
    "Pendapat kelompok sangat penting bagi saya."],
  O: ["Saya ingin punya hubungan dekat dengan rekan kerja.",
    "Saya peduli pada perasaan teman satu tim.",
    "Saya senang berbagi cerita dengan teman dekat di kantor.",
    "Saya nyaman bila atasan memperhatikan saya secara pribadi.",
    "Saya mudah tersentuh oleh kebaikan orang lain.",
    "Saya ingin disukai oleh orang-orang di sekitar saya.",
    "Saya suka memberi perhatian kecil kepada rekan kerja.",
    "Hubungan yang hangat membuat saya betah bekerja.",
    "Saya memperhatikan suasana hati rekan kerja."],
  R: ["Saya suka memikirkan alasan di balik sebuah aturan.",
    "Saya senang mempelajari teori atau konsep baru.",
    "Saya suka menganalisis data penjualan.",
    "Saya senang membaca tentang tren desain dan bahan produk.",
    "Saya suka berdiskusi tentang ide-ide.",
    "Saya berpikir mendalam sebelum bertindak.",
    "Saya ingin memahami cara kerja mesin cetak secara mendetail.",
    "Saya senang memecahkan teka-teki logika.",
    "Saya lebih tertarik pada konsep daripada praktik langsung."],
  D: ["Saya teliti memeriksa setiap detail pekerjaan.",
    "Saya memeriksa ulang hasil cetak sebelum diserahkan.",
    "Saya menyadari kesalahan kecil yang sering terlewat orang lain.",
    "Saya suka pekerjaan yang menuntut ketelitian.",
    "Saya mencocokkan stok dan nota dengan cermat.",
    "Saya tidak keberatan mengerjakan tugas yang rumit dan detail.",
    "Saya memastikan ejaan nama pelanggan pada case sudah benar.",
    "Saya mencatat hal-hal kecil agar tidak terlupa.",
    "Saya terganggu bila ada detail yang tidak rapi."],
  C: ["Saya suka meja kerja yang selalu rapi.",
    "Saya bekerja mengikuti urutan yang sudah direncanakan.",
    "Saya menata barang sesuai tempatnya.",
    "Saya membuat rencana sebelum mulai bekerja.",
    "Saya suka sistem kerja yang jelas dan teratur.",
    "Saya menyimpan dokumen dengan tertata.",
    "Saya nyaman bila segala sesuatu terorganisasi.",
    "Saya mengembalikan peralatan ke tempat semula setelah dipakai.",
    "Saya suka jadwal kerja yang tetap."],
  Z: ["Saya senang mencoba cara kerja yang baru.",
    "Saya cepat bosan dengan rutinitas yang sama.",
    "Saya suka berganti tugas supaya ada variasi.",
    "Saya antusias ketika ada produk atau koleksi baru.",
    "Saya mudah beradaptasi dengan perubahan.",
    "Saya senang ditempatkan di lokasi yang berbeda-beda.",
    "Saya suka mencari ide desain yang belum pernah ada.",
    "Saya menyambut perubahan aturan sebagai hal yang menarik.",
    "Saya menikmati suasana kerja yang terus berubah."],
  E: ["Saya tetap tenang menghadapi pelanggan yang marah.",
    "Saya tidak mudah menunjukkan rasa kesal.",
    "Saya bisa menahan emosi saat sedang ditekan.",
    "Saya jarang terbawa perasaan ketika bekerja.",
    "Saya mampu berpikir jernih walaupun suasana tegang.",
    "Saya tidak mudah tersinggung oleh kritik.",
    "Saya menyimpan urusan perasaan pribadi selama bekerja.",
    "Saya tetap ramah walaupun sedang lelah.",
    "Saya bisa mengendalikan diri ketika terjadi konflik."],
  K: ["Saya berani mempertahankan pendapat saya.",
    "Saya langsung mengatakan bila ada yang tidak beres.",
    "Saya tidak takut berdebat demi hal yang benar.",
    "Saya tegas menolak permintaan yang tidak masuk akal.",
    "Saya siap menghadapi persaingan secara terbuka.",
    "Saya berterus terang walaupun membuat orang lain kurang nyaman.",
    "Saya akan melawan bila diperlakukan tidak adil.",
    "Saya berani mengkritik cara kerja yang keliru.",
    "Saya gigih memperjuangkan target yang saya yakini."],
  F: ["Saya setia mendukung keputusan atasan.",
    "Saya ingin atasan puas dengan hasil kerja saya.",
    "Saya menjaga nama baik perusahaan di depan orang lain.",
    "Saya menjalankan instruksi atasan dengan sungguh-sungguh.",
    "Saya senang membantu atasan menyelesaikan pekerjaannya.",
    "Saya menghormati keputusan manajemen walaupun terasa berat.",
    "Saya rutin melaporkan perkembangan pekerjaan kepada atasan.",
    "Saya merasa loyal kepada tempat saya bekerja.",
    "Saya mendukung program yang dibuat pimpinan toko."],
  W: ["Saya lebih nyaman bila ada SOP yang jelas.",
    "Saya bekerja sesuai petunjuk yang diberikan.",
    "Saya menunggu arahan sebelum mengerjakan hal yang baru.",
    "Saya patuh pada aturan toko.",
    "Saya suka mengetahui dengan jelas apa yang diharapkan dari saya.",
    "Saya tenang bila ada atasan yang memberi arahan.",
    "Saya mengikuti prosedur walaupun ada cara yang lebih cepat.",
    "Saya butuh instruksi rinci untuk tugas yang baru.",
    "Saya menghargai aturan kerja yang tertulis."],
};

const PAPI_SCALES = ["N", "G", "A", "L", "P", "I", "T", "V", "X", "S", "B", "O", "R", "D", "C", "Z", "E", "K", "F", "W"];

/**
 * 90 pasangan pilihan paksa: 9 putaran round-robin (metode lingkaran) atas 20 skala,
 * sehingga setiap skala muncul tepat 9 kali, tidak pernah berpasangan dengan dirinya
 * sendiri, dan tidak ada pasangan skala yang berulang.
 */
function papiItems() {
  const n = PAPI_SCALES.length;
  const used = Object.fromEntries(PAPI_SCALES.map((s) => [s, 0]));
  const items = [];
  const ring = PAPI_SCALES.slice(1);
  for (let round = 0; round < 9; round++) {
    const order = [PAPI_SCALES[0], ...ring];
    for (let i = 0; i < n / 2; i++) {
      let a = order[i];
      let b = order[n - 1 - i];
      if ((round + i) % 2) [a, b] = [b, a];
      items.push({ a, b });
    }
    ring.unshift(ring.pop());
  }
  // Selang-seling pasangan antar putaran supaya skala yang sama tidak bergerombol.
  const mixed = [];
  for (let i = 0; i < n / 2; i++) for (let r = 0; r < 9; r++) mixed.push(items[r * (n / 2) + i]);
  return mixed.map(({ a, b }, i) => ({
    body: "",
    options: {
      a: { text: PAPI_STATEMENTS[a][used[a]++], scale: a },
      b: { text: PAPI_STATEMENTS[b][used[b]++], scale: b },
    },
    answer_key: null,
    sort_order: (i + 1) * 10,
  }));
}

module.exports = { ARITMATIKA, MATEMATIKA, PAPI_STATEMENTS, PAPI_SCALES, mcqItems, papiItems };
