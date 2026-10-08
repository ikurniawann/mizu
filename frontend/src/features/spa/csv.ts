/** Pembuat CSV sisi klien untuk laporan komisi terapis. */
import type { CommissionReport } from "./types";
import { commissionValueLabel } from "./rules";
import { wibClockOf, wibDateOf } from "./time";

export type CsvCell = string | number | boolean | null | undefined;

/**
 * Escape satu sel CSV (RFC 4180): kutip bila ada koma, kutip, CR/LF, atau
 * spasi di tepi. Teks yang diawali = + - @ (atau tab/CR) diberi awalan `'`
 * supaya spreadsheet tidak mengeksekusinya sebagai formula. Angka dibiarkan.
 */
export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || text !== text.trim()) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Baris → teks CSV (CRLF). */
export function toCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

export const COMMISSION_CSV_HEADER = [
  "Terapis",
  "NIP",
  "Kode booking",
  "Outlet",
  "Tanggal selesai",
  "Jam selesai",
  "Treatment",
  "Varian",
  "Harga (Rp)",
  "Aturan komisi",
  "Komisi (Rp)",
];

/** Laporan komisi → CSV: satu baris per item + baris subtotal per terapis + total. */
export function commissionReportCsv(report: CommissionReport): string {
  const rows: CsvCell[][] = [COMMISSION_CSV_HEADER];
  for (const t of report.therapists) {
    for (const line of t.lines) {
      rows.push([
        t.full_name,
        t.nip,
        line.booking_code,
        line.branch_name,
        line.completed_at ? wibDateOf(line.completed_at) : "",
        line.completed_at ? wibClockOf(line.completed_at) : "",
        line.treatment_name,
        line.variant_name,
        line.price_idr,
        commissionValueLabel(line.commission_type, line.commission_value),
        line.commission_idr,
      ]);
    }
    rows.push([`Subtotal ${t.full_name}`, t.nip, "", "", "", "", `${t.treatment_count} treatment`, "", t.revenue_idr, "", t.commission_idr]);
  }
  rows.push(["Total", "", "", "", "", "", "", "", "", "", report.total_idr]);
  return toCsv(rows);
}

/** Unduh teks CSV di browser (BOM agar Excel membaca UTF-8). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
