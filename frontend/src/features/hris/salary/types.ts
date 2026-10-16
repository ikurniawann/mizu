export interface SalaryEmployeeLite {
  id: string;
  full_name: string;
  nip: string;
  position?: { title: string };
  department?: { name: string };
}

export interface EmployeeSalary {
  id: string;
  employee_id: string;
  base_salary: number;
  fixed_allowance: number;
  variable_allowance?: number;
  transport_allowance: number;
  meal_allowance: number;
  housing_allowance?: number;
  position_allowance?: number;
  health_allowance?: number;
  loan_deduction?: number;
  other_deduction?: number;
  ptkp_status: string;
  is_taxable: boolean;
  bpjs_tk_enrolled?: boolean;
  bpjs_kes_enrolled?: boolean;
  tapera_enrolled?: boolean;
  pay_basis?: "monthly" | "monthly_prorated" | "daily";
  working_days_divisor?: number | string | null;
  transport_mode?: "flat" | "per_day";
  meal_mode?: "flat" | "per_day";
  position_mode?: "flat" | "per_day";
  health_min_service_days?: number;
  overtime_scheme?: "standard" | "production" | "freelance" | "daily_worker";
  is_active?: boolean;
  effective_date?: string;
  notes?: string;
  company_id?: string | null;
  company?: { id: string; name: string } | null;
  employee?: SalaryEmployeeLite;
}

export interface SalaryPayload {
  employee_id?: string;
  company_id?: string;
  base_salary: number;
  fixed_allowance: number;
  variable_allowance: number;
  transport_allowance: number;
  meal_allowance: number;
  housing_allowance: number;
  position_allowance: number;
  health_allowance: number;
  loan_deduction: number;
  other_deduction: number;
  ptkp_status: string;
  is_taxable: boolean;
  bpjs_tk_enrolled: boolean;
  bpjs_kes_enrolled: boolean;
  tapera_enrolled: boolean;
  pay_basis: "monthly" | "monthly_prorated" | "daily";
  working_days_divisor: number | null;
  transport_mode: "flat" | "per_day";
  meal_mode: "flat" | "per_day";
  position_mode: "flat" | "per_day";
  health_min_service_days: number;
  overtime_scheme: "standard" | "production" | "freelance" | "daily_worker";
  notes?: string;
}
