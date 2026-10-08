import { describe, expect, it } from "vitest";
import { commissionReportCsv, escapeCsvCell, toCsv } from "./csv";
import type { CommissionReport } from "./types";

describe("escapeCsvCell", () => {
  it("membiarkan teks dan angka sederhana", () => {
    expect(escapeCsvCell("Ayu")).toBe("Ayu");
    expect(escapeCsvCell(150000)).toBe("150000");
    expect(escapeCsvCell(-5)).toBe("-5");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
    expect(escapeCsvCell(Number.NaN)).toBe("");
  });
  it("mengutip koma, kutip, dan baris baru", () => {
    expect(escapeCsvCell("Pijat, Refleksi")).toBe('"Pijat, Refleksi"');
    expect(escapeCsvCell('Paket "Gold"')).toBe('"Paket ""Gold"""');
    expect(escapeCsvCell("baris\nkedua")).toBe('"baris\nkedua"');
    expect(escapeCsvCell(" spasi ")).toBe('" spasi "');
  });
  it("menetralkan formula spreadsheet", () => {
    expect(escapeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvCell("+62812")).toBe("'+62812");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
    expect(escapeCsvCell("=1,2")).toBe("\"'=1,2\"");
  });
});

describe("toCsv & commissionReportCsv", () => {
  it("menggabungkan baris dengan CRLF", () => {
    expect(toCsv([["a", "b"], [1, null]])).toBe("a,b\r\n1,");
  });

  it("menulis baris item, subtotal per terapis, dan total", () => {
    const report: CommissionReport = {
      from: "2026-10-01",
      to: "2026-10-31",
      total_idr: 30000,
      therapists: [
        {
          therapist_id: "t1",
          full_name: "Sari, A.",
          nip: "M-01",
          treatment_count: 1,
          revenue_idr: 300000,
          commission_idr: 30000,
          lines: [
            {
              item_id: "i1",
              booking_id: "b1",
              booking_code: "SPA-001",
              branch_name: "Mizu Kemang",
              completed_at: "2026-10-07T17:30:00.000Z",
              treatment_name: "Balinese Massage",
              variant_name: "90 menit",
              price_idr: 300000,
              commission_type: "percent",
              commission_value: 10,
              commission_idr: 30000,
            },
          ],
        },
      ],
    };
    const lines = commissionReportCsv(report).split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Terapis,NIP,Kode booking");
    // completed_at 17:30Z = 8 Okt 00:30 WIB
    expect(lines[1]).toBe('"Sari, A.",M-01,SPA-001,Mizu Kemang,2026-10-08,00:30,Balinese Massage,90 menit,300000,10%,30000');
    expect(lines[2]).toBe('"Subtotal Sari, A.",M-01,,,,,1 treatment,,300000,,30000');
    expect(lines[3]).toBe("Total,,,,,,,,,,30000");
  });
});
