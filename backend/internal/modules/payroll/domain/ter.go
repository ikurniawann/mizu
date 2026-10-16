package domain

import (
	"math"
	"strings"
)

// terBracket is one TER layer: monthly gross up to Upper (inclusive) taxed
// at Rate. The last layer is unbounded.
type terBracket struct {
	Upper float64
	Rate  float64
}

// TER bulanan PP 58/2023 Lampiran A, B, C (44 / 40 / 41 lapisan), disalin
// dari PDF resmi BPK (peraturan.bpk.go.id, Download/332609).
var terTableA = []terBracket{
	{5_400_000, 0}, {5_650_000, 0.0025}, {5_950_000, 0.005}, {6_300_000, 0.0075}, {6_750_000, 0.01},
	{7_500_000, 0.0125}, {8_550_000, 0.015}, {9_650_000, 0.0175}, {10_050_000, 0.02}, {10_350_000, 0.0225},
	{10_700_000, 0.025}, {11_050_000, 0.03}, {11_600_000, 0.035}, {12_500_000, 0.04}, {13_750_000, 0.05},
	{15_100_000, 0.06}, {16_950_000, 0.07}, {19_750_000, 0.08}, {24_150_000, 0.09}, {26_450_000, 0.10},
	{28_000_000, 0.11}, {30_050_000, 0.12}, {32_400_000, 0.13}, {35_400_000, 0.14}, {39_100_000, 0.15},
	{43_850_000, 0.16}, {47_800_000, 0.17}, {51_400_000, 0.18}, {56_300_000, 0.19}, {62_200_000, 0.20},
	{68_600_000, 0.21}, {77_500_000, 0.22}, {89_000_000, 0.23}, {103_000_000, 0.24}, {125_000_000, 0.25},
	{157_000_000, 0.26}, {206_000_000, 0.27}, {337_000_000, 0.28}, {454_000_000, 0.29}, {550_000_000, 0.30},
	{695_000_000, 0.31}, {910_000_000, 0.32}, {1_400_000_000, 0.33}, {math.Inf(1), 0.34},
}

var terTableB = []terBracket{
	{6_200_000, 0}, {6_500_000, 0.0025}, {6_850_000, 0.005}, {7_300_000, 0.0075}, {9_200_000, 0.01},
	{10_750_000, 0.015}, {11_250_000, 0.02}, {11_600_000, 0.025}, {12_600_000, 0.03}, {13_600_000, 0.04},
	{14_950_000, 0.05}, {16_400_000, 0.06}, {18_450_000, 0.07}, {21_850_000, 0.08}, {26_000_000, 0.09},
	{27_700_000, 0.10}, {29_350_000, 0.11}, {31_450_000, 0.12}, {33_950_000, 0.13}, {37_100_000, 0.14},
	{41_100_000, 0.15}, {45_800_000, 0.16}, {49_500_000, 0.17}, {53_800_000, 0.18}, {58_500_000, 0.19},
	{64_000_000, 0.20}, {71_000_000, 0.21}, {80_000_000, 0.22}, {93_000_000, 0.23}, {109_000_000, 0.24},
	{129_000_000, 0.25}, {163_000_000, 0.26}, {211_000_000, 0.27}, {374_000_000, 0.28}, {459_000_000, 0.29},
	{555_000_000, 0.30}, {704_000_000, 0.31}, {957_000_000, 0.32}, {1_405_000_000, 0.33}, {math.Inf(1), 0.34},
}

var terTableC = []terBracket{
	{6_600_000, 0}, {6_950_000, 0.0025}, {7_350_000, 0.005}, {7_800_000, 0.0075}, {8_850_000, 0.01},
	{9_800_000, 0.0125}, {10_950_000, 0.015}, {11_200_000, 0.0175}, {12_050_000, 0.02}, {12_950_000, 0.03},
	{14_150_000, 0.04}, {15_550_000, 0.05}, {17_050_000, 0.06}, {19_500_000, 0.07}, {22_700_000, 0.08},
	{26_600_000, 0.09}, {28_100_000, 0.10}, {30_100_000, 0.11}, {32_600_000, 0.12}, {35_400_000, 0.13},
	{38_900_000, 0.14}, {43_000_000, 0.15}, {47_400_000, 0.16}, {51_200_000, 0.17}, {55_800_000, 0.18},
	{60_400_000, 0.19}, {66_700_000, 0.20}, {74_500_000, 0.21}, {83_200_000, 0.22}, {95_600_000, 0.23},
	{110_000_000, 0.24}, {134_000_000, 0.25}, {169_000_000, 0.26}, {221_000_000, 0.27}, {390_000_000, 0.28},
	{463_000_000, 0.29}, {561_000_000, 0.30}, {709_000_000, 0.31}, {965_000_000, 0.32}, {1_419_000_000, 0.33},
	{math.Inf(1), 0.34},
}

// TERCategory is the PP 58/2023 category of a PTKP status: A (TK/0, TK/1,
// K/0), B (TK/2, TK/3, K/1, K/2), C (K/3). Unknown statuses are A, like the
// TK/0 fallback of PTKPAmount.
func TERCategory(ptkp string) string {
	switch strings.ToUpper(strings.TrimSpace(ptkp)) {
	case "TK/2", "TK/3", "K/1", "K/2":
		return "B"
	case "K/3":
		return "C"
	}
	return "A"
}

// TERRate is the monthly effective rate for a gross monthly income.
func TERRate(category string, gross float64) float64 {
	table := terTableA
	switch category {
	case "B":
		table = terTableB
	case "C":
		table = terTableC
	}
	for _, b := range table {
		if gross <= b.Upper {
			return b.Rate
		}
	}
	return table[len(table)-1].Rate
}

// YearToDate is an employee's earlier slips of the tax year at the same
// entity (January–November), for the December Pasal 17 reconciliation.
type YearToDate struct {
	Months          int
	Bruto           float64 // sum of the monthly TER DPP
	Pph21           float64 // PPh21 withheld
	PensionEmployee float64 // employee JHT + JP
}

// pph21TER is the TER withholding of one slip: dpp × TER rate in January–
// November; in December the annual Pasal 17 tax minus what was withheld.
func pph21TER(in Input, dpp, pensionEmployee float64, c Config) (pph, annual float64, rate float64) {
	category := TERCategory(in.PTKPStatus)
	if in.PeriodMonth != 12 {
		rate = TERRate(category, dpp)
		return Round(dpp * rate), 0, rate
	}
	months := float64(in.Ytd.Months + 1)
	bruto := in.Ytd.Bruto + dpp
	jabatan := math.Min(bruto*c.JabatanPercentage, c.JabatanMaxPerYear/12*months)
	netto := bruto - jabatan - (in.Ytd.PensionEmployee + pensionEmployee)
	annual, _ = PPh21(math.Max(0, netto), in.PTKPStatus, c)
	return math.Max(0, annual-in.Ytd.Pph21), annual, 0
}
