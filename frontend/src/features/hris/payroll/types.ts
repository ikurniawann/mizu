import type { LoanInstallmentDetail } from "@/lib/payroll/loans";

/** Periode absensi (cut-off) yang dibaca payroll untuk bulan run. */
export interface PayrollAttendancePeriod {
  id?: string;
  start_date: string;
  end_date: string;
  closing_date?: string;
  /** "21 Sep – 20 Okt 2026" */
  label: string;
  status: "open" | "closed";
}

export interface PayrollRun {
  id: string;
  run_name: string;
  period_month: number;
  period_year: number;
  status: string;
  total_employees: number;
  total_gross: number;
  total_net: number;
  total_deductions: number;
  created_at: string;
  processed_at?: string;
  approved_at?: string;
  paid_at?: string;
  attendance_period?: PayrollAttendancePeriod;
}

export interface CreatePayrollPayload {
  period_month: number;
  period_year: number;
}

/** Slip yang biayanya (sebagian) tidak punya toko. */
export interface AllocationWarning {
  employee_id: string;
  full_name: string;
  reason: string;
}

export interface CalculatePayrollResult {
  attendance_period?: PayrollAttendancePeriod;
  /** Diisi saat periode absensi belum di-closing. */
  warning?: string;
  summary?: {
    total_employees?: number;
    employee_names?: string[];
    allocation_warnings?: AllocationWarning[];
  };
}

/** Dasar pembagian biaya slip ke toko. */
export type AllocationBasis = "hours" | "days" | "primary" | "none";

/** Bagian satu toko dari sebuah slip (hris.payroll_detail_allocations). */
export interface SlipAllocation {
  branch_id: string | null;
  branch_code: string | null;
  branch_name: string | null;
  basis: AllocationBasis;
  ratio: number;
  days: number;
  hours: number;
  gross_amount: number;
  deductions_amount: number;
  net_amount: number;
  employer_contribution_amount: number;
  sort_order: number;
}

/** Total satu toko dalam run (numeric pg sebagai string). */
export interface StoreAllocationTotal {
  branch_id: string | null;
  branch_code: string | null;
  branch_name: string | null;
  employee_count: number;
  fte: string | number;
  gross_amount: string | number;
  employer_contribution_amount: string | number;
  labor_cost: string | number;
}

export interface RunStoreAllocation {
  stores: StoreAllocationTotal[];
  unassigned: { employee_id: string; gross_amount: string | number; employee?: { id: string; full_name: string; nip: string } }[];
  allocated_slips: number;
}

/** Baris payroll_details ringkas di halaman detail run. */
export interface PayrollRunDetailRow {
  id: string;
  employee_id: string;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  pph21_deduction: number;
  bpjs_tk_jht_deduction: number;
  bpjs_kes_deduction: number;
  status: string;
  payslip_sent?: boolean;
  allocations?: SlipAllocation[];
  employee?: {
    id: string;
    full_name: string;
    nip: string;
    department?: { name: string };
  };
}

export interface PayrollRunDetail extends PayrollRun {
  total_pph21: number;
  total_bjtk_employee: number;
  total_bjtk_employer: number;
  notes?: string;
  payroll_details?: PayrollRunDetailRow[];
  store_allocation?: RunStoreAllocation;
}

/** Nominal biaya satu toko / satu bagian karyawan di laporan Biaya Gaji per Toko. */
export interface StoreCostAmounts {
  gross_amount: number;
  deductions_amount: number;
  pph21_amount: number;
  bpjs_employee_amount: number;
  net_amount: number;
  employer_bpjs_tk_amount: number;
  employer_bpjs_kes_amount: number;
  employer_tapera_amount: number;
  employer_contribution_amount: number;
  labor_cost: number;
}

export interface StoreCostStore extends StoreCostAmounts {
  branch_id: string | null;
  branch_code: string | null;
  branch_name: string;
  employee_count: number;
  fte: number;
  days: number;
  hours: number;
}

export interface StoreCostEmployee extends StoreCostAmounts {
  employee_id: string;
  full_name: string;
  nip: string | null;
  department: string | null;
  position: string | null;
  branch_id: string | null;
  branch_name: string;
  basis: AllocationBasis;
  ratio: number;
  days: number;
  hours: number;
}

/** GET /api/hris/payroll/{id}/store-costs */
export interface StoreCostReport {
  run: { id: string; run_name: string; period_month: number; period_year: number; status: string };
  stores: StoreCostStore[];
  totals: StoreCostAmounts & { employee_count: number };
  employees: StoreCostEmployee[];
  unallocated_slips: number;
}

/** Nominal slip gaji (pg numeric bisa datang sebagai string). */
export interface PayslipAmounts {
  id: string;
  base_salary: number;
  fixed_allowance: number;
  variable_allowance: number;
  transport_allowance: number;
  meal_allowance: number;
  housing_allowance: number;
  overtime_pay: number;
  thr: number;
  bonus: number;
  gross_salary: number;
  bpjs_tk_jht_deduction: number;
  bpjs_tk_jp_deduction: number;
  bpjs_kes_deduction: number;
  tapera_deduction: number;
  pph21_deduction: number;
  unpaid_leave_deduction: number;
  late_deduction?: number;
  loan_deduction?: number;
  loan_details?: LoanInstallmentDetail[];
  other_deduction: number;
  total_deductions: number;
  net_salary: number;
  working_days: number;
  present_days: number;
  late_days: number;
  /** Faktor proraté cakupan kontrak (0..1); pg numeric datang sebagai string */
  prorate_factor?: number | string;
  /** Snapshot gaji pokok penuh sebelum proraté (null utk baris lama) */
  full_base_salary?: number | string | null;
}

/** Slip gaji satu karyawan (halaman admin). */
export interface PayslipDetail extends PayslipAmounts {
  employee_id: string;
  payroll_run_id: string;
  other_earning: number;
  unpaid_leave_days: number;
  status: string;
  created_at: string;
  /** Rincian per toko (payroll multi-toko); kosong untuk run lama */
  allocations?: SlipAllocation[];
  employee?: {
    id: string;
    full_name: string;
    nip: string;
    email: string;
    phone: string;
    position?: { title: string };
    department?: { name: string };
  };
  payroll_run?: {
    id: string;
    period_month: number;
    period_year: number;
    run_name: string;
  };
}

/** Entitas (perusahaan) yang membayar gaji dan memproses payroll. */
export interface PayrollEntity {
  id: string;
  code: string;
  name: string;
  holding_name: string;
}
