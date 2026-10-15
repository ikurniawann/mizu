package domain

import "testing"

func TestEntityOf(t *testing.T) {
	str := func(s string) *string { return &s }
	branches := map[string]string{"pvj": "paddy", "kopo": "paddy", "hq": "pusat"}
	const end = "2026-10-20"
	cases := []struct {
		name       string
		placements []Placement
		want       string
	}{
		{"tanpa penempatan", nil, ""},
		{"utama aktif di akhir periode", []Placement{{BranchID: "pvj", IsPrimary: true, Start: "2025-01-01"}}, "paddy"},
		{"pindah di tengah periode: entitas di akhir periode", []Placement{
			{BranchID: "hq", IsPrimary: true, Start: "2025-01-01", End: str("2026-10-05")},
			{BranchID: "pvj", IsPrimary: true, Start: "2026-10-06"},
		}, "paddy"},
		{"utama berakhir sebelum akhir periode: utama yang mulai paling akhir", []Placement{
			{BranchID: "hq", IsPrimary: true, Start: "2025-01-01", End: str("2026-10-10")},
			{BranchID: "kopo", Start: "2026-09-25"},
		}, "pusat"},
		{"tanpa utama: penempatan yang mulai paling akhir", []Placement{
			{BranchID: "hq", Start: "2025-01-01"}, {BranchID: "kopo", Start: "2026-09-25"},
		}, "paddy"},
		{"toko tanpa company diabaikan", []Placement{
			{BranchID: "unknown", IsPrimary: true, Start: "2026-01-01"}, {BranchID: "hq", Start: "2025-01-01"},
		}, "pusat"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := EntityOf(c.placements, branches, end); got != c.want {
				t.Fatalf("EntityOf = %q, want %q", got, c.want)
			}
		})
	}
}

func TestPrimaryEntity(t *testing.T) {
	salaries := []EntitySalary{{CompanyID: "b", Base: 1_000_000}, {CompanyID: "a", Base: 3_000_000}, {CompanyID: "c", Base: 3_000_000}}
	cases := []struct {
		name, placement string
		salaries        []EntitySalary
		want            string
	}{
		{"entitas penempatan punya gaji", "b", salaries, "b"},
		{"entitas penempatan tanpa gaji: gaji pokok terbesar, seri → id terkecil", "x", salaries, "a"},
		{"tanpa penempatan", "", salaries, "a"},
		{"satu entitas", "x", []EntitySalary{{CompanyID: "b", Base: 1}}, "b"},
		{"tanpa gaji", "b", nil, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := PrimaryEntity(c.placement, c.salaries); got != c.want {
				t.Fatalf("PrimaryEntity = %q, want %q", got, c.want)
			}
		})
	}
}

func TestScopeToCompany(t *testing.T) {
	pvj, hq := "pvj", "hq"
	branches := map[string]string{"pvj": "paddy", "hq": "pusat"}
	days := []BranchDay{
		{Date: "2026-10-01", Status: "present", BranchID: &pvj},
		{Date: "2026-10-02", Status: "present", BranchID: &hq},
		{Date: "2026-10-03", Status: "present"},
	}
	placements := []Placement{{BranchID: "pvj", IsPrimary: true, Start: "2025-01-01"}, {BranchID: "hq", Start: "2025-01-01"}}

	d, p := ScopeToCompany(days, placements, branches, "pusat")
	if len(d) != 2 || d[0].Date != "2026-10-02" || d[1].BranchID != nil {
		t.Fatalf("days %+v", d)
	}
	if len(p) != 1 || p[0].BranchID != "hq" {
		t.Fatalf("placements %+v", p)
	}
	if d, p := ScopeToCompany(days, placements, branches, "lain"); len(d) != 1 || len(p) != 0 {
		t.Fatalf("other company: days %+v placements %+v", d, p)
	}
}
