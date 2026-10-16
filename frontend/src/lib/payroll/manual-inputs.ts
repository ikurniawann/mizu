/**
 * Komponen manual slip (EPIC-055, "Other Inputs" Odoo): diisi HR per run ×
 * karyawan sebelum Hitung. Kode sama dengan hris.payroll_inputs_code_check.
 */

export type ManualInputKind = "earning_taxable" | "earning_nontax" | "deduction" | "late_override";

export interface ManualInputCode {
  code: string;
  label: string;
  kind: ManualInputKind;
}

export const MANUAL_INPUT_CODES: ManualInputCode[] = [
  { code: "BONUS", label: "Bonus", kind: "earning_taxable" },
  { code: "INCENTIVE", label: "Insentif", kind: "earning_taxable" },
  { code: "NATURA", label: "Natura", kind: "earning_taxable" },
  { code: "TRANSPORT_LOCATION", label: "Tunjangan Transport per Lokasi", kind: "earning_taxable" },
  { code: "OTHER_EARNING", label: "Penghasilan Lain (kena pajak)", kind: "earning_taxable" },
  { code: "OTHER_EARNING_NONTAX", label: "Penghasilan Tidak Kena Pajak", kind: "earning_nontax" },
  { code: "PENALTY", label: "Denda", kind: "deduction" },
  { code: "ABSENCE", label: "Potongan Absen", kind: "deduction" },
  { code: "UNION", label: "Iuran Serikat", kind: "deduction" },
  { code: "OTHER_DEDUCTION", label: "Potongan Lain", kind: "deduction" },
  { code: "LATE_OVERRIDE", label: "Override Potongan Telat", kind: "late_override" },
];

export const MANUAL_INPUT_KIND_LABELS: Record<ManualInputKind, string> = {
  earning_taxable: "Penghasilan",
  earning_nontax: "Penghasilan (tidak kena pajak)",
  deduction: "Potongan",
  late_override: "Menggantikan potongan telat otomatis",
};

export function manualInputLabel(code: string): string {
  return MANUAL_INPUT_CODES.find((c) => c.code === code)?.label ?? code;
}

export function manualInputKind(code: string): ManualInputKind | undefined {
  return MANUAL_INPUT_CODES.find((c) => c.code === code)?.kind;
}

/** Contoh isi CSV untuk import (header opsional). */
export const MANUAL_INPUT_CSV_EXAMPLE = "nip,kode,nominal,catatan\n202503182,BONUS,500000,Bonus target\n202503182,PENALTY,25000,Denda seragam";
