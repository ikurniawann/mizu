/**
 * Logika form struktur gaji (tambah & edit). Input nominal ditampilkan dengan
 * pemisah ribuan ("5.000.000") dan dikirim ke API sebagai angka bulat.
 */

export const SALARY_AMOUNT_FIELDS = [
  "base_salary",
  "fixed_allowance",
  "variable_allowance",
  "transport_allowance",
  "meal_allowance",
  "housing_allowance",
  "position_allowance",
  "health_allowance",
  "loan_deduction",
  "other_deduction",
] as const;

/** Aturan perhitungan dari rule penggajian Odoo (EPIC-055). */
export type PayBasis = "monthly" | "monthly_prorated" | "daily";
export type AllowanceMode = "flat" | "per_day";
export type OvertimeScheme = "standard" | "production" | "freelance" | "daily_worker";

export interface SalaryRuleState {
  pay_basis: PayBasis;
  /** Pembagi hari struktur; "" = hari kerja hasil hitung. */
  working_days_divisor: string;
  transport_mode: AllowanceMode;
  meal_mode: AllowanceMode;
  position_mode: AllowanceMode;
  health_min_service_days: string;
  overtime_scheme: OvertimeScheme;
}

export interface SalaryRulePayload {
  pay_basis: PayBasis;
  working_days_divisor: number | null;
  transport_mode: AllowanceMode;
  meal_mode: AllowanceMode;
  position_mode: AllowanceMode;
  health_min_service_days: number;
  overtime_scheme: OvertimeScheme;
}

export const EMPTY_SALARY_RULES: SalaryRuleState = {
  pay_basis: "monthly",
  working_days_divisor: "",
  transport_mode: "flat",
  meal_mode: "flat",
  position_mode: "flat",
  health_min_service_days: "0",
  overtime_scheme: "standard",
};

export type SalaryAmountField = (typeof SALARY_AMOUNT_FIELDS)[number];

export interface SalaryFormState extends Record<SalaryAmountField, string>, SalaryRuleState {
  ptkp_status: string;
  is_taxable: boolean;
  bpjs_tk_enrolled: boolean;
  bpjs_kes_enrolled: boolean;
  tapera_enrolled: boolean;
  notes: string;
}

export interface SalaryFormPayload extends Record<SalaryAmountField, number>, SalaryRulePayload {
  ptkp_status: string;
  is_taxable: boolean;
  bpjs_tk_enrolled: boolean;
  bpjs_kes_enrolled: boolean;
  tapera_enrolled: boolean;
  notes?: string;
}

/** Ambil digit saja dari ketikan pengguna: "Rp 1.250.000" → 1250000. */
export function parseRupiahInput(value: string): number {
  return parseInt(value.replace(/[^0-9]/g, ""), 10) || 0;
}

/** Format ketikan pengguna jadi "1.250.000". */
export function formatRupiahInput(value: string): string {
  return parseRupiahInput(value).toLocaleString("id-ID");
}

/** Nilai dari DB (numeric bisa datang sebagai "5000000.00") → teks input. */
function amountToInput(value: number | string | null | undefined): string {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString("id-ID");
}

export const EMPTY_SALARY_FORM: SalaryFormState = {
  base_salary: "",
  fixed_allowance: "0",
  variable_allowance: "0",
  transport_allowance: "0",
  meal_allowance: "0",
  housing_allowance: "0",
  position_allowance: "0",
  health_allowance: "0",
  loan_deduction: "0",
  other_deduction: "0",
  ptkp_status: "TK/0",
  is_taxable: true,
  bpjs_tk_enrolled: true,
  bpjs_kes_enrolled: true,
  tapera_enrolled: true,
  notes: "",
  ...EMPTY_SALARY_RULES,
};

export interface SalaryRecordLike
  extends Partial<Record<SalaryAmountField, number | string | null>> {
  ptkp_status?: string | null;
  is_taxable?: boolean | null;
  bpjs_tk_enrolled?: boolean | null;
  bpjs_kes_enrolled?: boolean | null;
  tapera_enrolled?: boolean | null;
  notes?: string | null;
  pay_basis?: string | null;
  working_days_divisor?: number | string | null;
  transport_mode?: string | null;
  meal_mode?: string | null;
  position_mode?: string | null;
  health_min_service_days?: number | null;
  overtime_scheme?: string | null;
}

function oneOf<T extends string>(value: string | null | undefined, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

const PAY_BASES = ["monthly", "monthly_prorated", "daily"] as const;
const ALLOWANCE_MODES = ["flat", "per_day"] as const;
const OVERTIME_SCHEMES = ["standard", "production", "freelance", "daily_worker"] as const;

export function salaryToForm(data: SalaryRecordLike): SalaryFormState {
  const form = { ...EMPTY_SALARY_FORM };
  for (const field of SALARY_AMOUNT_FIELDS) form[field] = amountToInput(data[field]);
  if (!Number(data.base_salary)) form.base_salary = "";
  return {
    ...form,
    ptkp_status: data.ptkp_status || "TK/0",
    is_taxable: data.is_taxable ?? true,
    bpjs_tk_enrolled: data.bpjs_tk_enrolled ?? true,
    bpjs_kes_enrolled: data.bpjs_kes_enrolled ?? true,
    tapera_enrolled: data.tapera_enrolled ?? true,
    notes: data.notes || "",
    pay_basis: oneOf(data.pay_basis, PAY_BASES, "monthly"),
    working_days_divisor: Number(data.working_days_divisor) > 0 ? String(Number(data.working_days_divisor)) : "",
    transport_mode: oneOf(data.transport_mode, ALLOWANCE_MODES, "flat"),
    meal_mode: oneOf(data.meal_mode, ALLOWANCE_MODES, "flat"),
    position_mode: oneOf(data.position_mode, ALLOWANCE_MODES, "flat"),
    health_min_service_days: String(data.health_min_service_days ?? 0),
    overtime_scheme: oneOf(data.overtime_scheme, OVERTIME_SCHEMES, "standard"),
  };
}

export function formToSalaryPayload(form: SalaryFormState): SalaryFormPayload {
  const amounts = Object.fromEntries(
    SALARY_AMOUNT_FIELDS.map((field) => [field, parseRupiahInput(form[field])])
  ) as Record<SalaryAmountField, number>;
  return {
    ...amounts,
    ptkp_status: form.ptkp_status,
    is_taxable: form.is_taxable,
    bpjs_tk_enrolled: form.bpjs_tk_enrolled,
    bpjs_kes_enrolled: form.bpjs_kes_enrolled,
    tapera_enrolled: form.tapera_enrolled,
    notes: form.notes,
    pay_basis: form.pay_basis,
    working_days_divisor: Number(form.working_days_divisor) > 0 ? Number(form.working_days_divisor) : null,
    transport_mode: form.transport_mode,
    meal_mode: form.meal_mode,
    position_mode: form.position_mode,
    health_min_service_days: Math.max(0, Math.round(Number(form.health_min_service_days) || 0)),
    overtime_scheme: form.overtime_scheme,
  };
}
