import type { PayRun } from "./types";

/** Label jenis & status payroll terapis (revisi R1). */
export const PAY_KIND_LABEL: Record<PayRun["kind"], string> = {
  commission: "Tengah Bulan (tanggal 1 - 15)",
  regular: "Akhir Bulan (tanggal 15 - akhir bulan)",
};

export const PAY_STATUS_LABEL: Record<PayRun["status"], string> = {
  draft: "Draft",
  approved: "Disetujui",
  paid: "Dibayar",
};

export const PAY_STATUS_VARIANT: Record<PayRun["status"], "muted" | "info" | "success"> = {
  draft: "muted",
  approved: "info",
  paid: "success",
};

export const PAY_TYPE_LABEL = {
  salary_commission: "Gaji tetap + komisi",
  commission_only: "Komisi saja",
} as const;

/** Total satu baris: gaji + tunjangan + komisi + bonus − potongan. */
export function payLineTotal(l: { base_salary_idr: number; allowance_idr: number; commission_idr: number; bonus_idr: number; deduction_idr: number }): number {
  return l.base_salary_idr + l.allowance_idr + l.commission_idr + l.bonus_idr - l.deduction_idr;
}
