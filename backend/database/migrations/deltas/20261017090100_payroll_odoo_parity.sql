-- =============================================================================
-- Payroll paritas rule Odoo (EPIC-055, gap G1–G9).
--
-- Semua kolom baru punya default yang mempertahankan perilaku lama: struktur
-- gaji bulanan flat, potongan telat sesuai mode lama, PPh21 disetahunkan,
-- lembur wajib clock-out, tanpa potongan izin pribadi/sakit.
-- =============================================================================

-- Struktur gaji: basis gaji, pembagi hari struktur, mode tunjangan, tunjangan
-- jabatan & kesehatan terpisah (kena pajak, bukan dasar BPJS), skema lembur.
ALTER TABLE hris.employee_salary
  ADD COLUMN IF NOT EXISTS pay_basis text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS working_days_divisor numeric(5,2),
  ADD COLUMN IF NOT EXISTS transport_mode text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS meal_mode text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS position_allowance numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position_mode text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS health_allowance numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_min_service_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_scheme text NOT NULL DEFAULT 'standard';

ALTER TABLE hris.employee_salary
  DROP CONSTRAINT IF EXISTS employee_salary_pay_basis_check,
  ADD CONSTRAINT employee_salary_pay_basis_check CHECK (pay_basis IN ('monthly', 'monthly_prorated', 'daily')),
  DROP CONSTRAINT IF EXISTS employee_salary_divisor_check,
  ADD CONSTRAINT employee_salary_divisor_check CHECK (working_days_divisor IS NULL OR working_days_divisor > 0),
  DROP CONSTRAINT IF EXISTS employee_salary_allowance_modes_check,
  ADD CONSTRAINT employee_salary_allowance_modes_check CHECK (
    transport_mode IN ('flat', 'per_day') AND meal_mode IN ('flat', 'per_day') AND position_mode IN ('flat', 'per_day')),
  DROP CONSTRAINT IF EXISTS employee_salary_new_amounts_check,
  ADD CONSTRAINT employee_salary_new_amounts_check CHECK (
    position_allowance >= 0 AND health_allowance >= 0 AND health_min_service_days >= 0),
  DROP CONSTRAINT IF EXISTS employee_salary_overtime_scheme_check,
  ADD CONSTRAINT employee_salary_overtime_scheme_check CHECK (
    overtime_scheme IN ('standard', 'production', 'freelance', 'daily_worker'));

COMMENT ON COLUMN hris.employee_salary.pay_basis IS
  'monthly: gaji pokok penuh; monthly_prorated: pokok / pembagi × hari hadir; daily: base_salary = upah per hari × hari hadir';
COMMENT ON COLUMN hris.employee_salary.working_days_divisor IS
  'Pembagi hari struktur (Odoo struct worked_days). NULL = hari kerja hasil hitung jadwal/absensi';
COMMENT ON COLUMN hris.employee_salary.health_min_service_days IS
  'Tunjangan kesehatan dibayar bila masa kerja sejak join_date >= nilai ini (Odoo INSURANCE: 365)';

-- Setting payroll.
ALTER TABLE hris.payroll_settings
  ADD COLUMN IF NOT EXISTS late_tier_rules jsonb NOT NULL DEFAULT
    '[{"min": 4, "max": 6, "days": 1, "basis": "thp"}, {"min": 7, "max": 9, "days": 2, "basis": "base"}, {"min": 10, "days": 3, "basis": "base"}]'::jsonb,
  ADD COLUMN IF NOT EXISTS late_min_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pph21_method text NOT NULL DEFAULT 'annualized',
  ADD COLUMN IF NOT EXISTS pph21_bpjs_basis text NOT NULL DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS overtime_production_rate numeric(15,2) NOT NULL DEFAULT 18000,
  ADD COLUMN IF NOT EXISTS overtime_requires_clockout boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS overtime_rest_from_schedule boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS personal_leave_deduction boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sick_leave_deduction boolean NOT NULL DEFAULT false;

ALTER TABLE hris.payroll_settings
  DROP CONSTRAINT IF EXISTS payroll_settings_pph21_method_check,
  ADD CONSTRAINT payroll_settings_pph21_method_check CHECK (pph21_method IN ('annualized', 'ter')),
  DROP CONSTRAINT IF EXISTS payroll_settings_pph21_bpjs_basis_check,
  ADD CONSTRAINT payroll_settings_pph21_bpjs_basis_check CHECK (pph21_bpjs_basis IN ('employer', 'employee', 'both')),
  DROP CONSTRAINT IF EXISTS payroll_settings_late_min_minutes_check,
  ADD CONSTRAINT payroll_settings_late_min_minutes_check CHECK (late_min_minutes >= 0),
  DROP CONSTRAINT IF EXISTS payroll_settings_overtime_production_rate_check,
  ADD CONSTRAINT payroll_settings_overtime_production_rate_check CHECK (overtime_production_rate >= 0);

-- Jenis hari pengajuan lembur: rest_day = hari istirahat mingguan (tarif libur).
ALTER TABLE hris.overtime_requests
  ADD COLUMN IF NOT EXISTS day_type text NOT NULL DEFAULT 'regular';
ALTER TABLE hris.overtime_requests
  DROP CONSTRAINT IF EXISTS overtime_requests_day_type_check,
  ADD CONSTRAINT overtime_requests_day_type_check CHECK (day_type IN ('regular', 'rest_day'));

-- Komponen manual per slip (Odoo "Other Inputs"): diisi HR sebelum Hitung.
CREATE TABLE IF NOT EXISTS hris.payroll_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES hris.payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
  code text NOT NULL,
  amount numeric(15,2) NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_inputs_code_check CHECK (code IN (
    'BONUS', 'INCENTIVE', 'NATURA', 'TRANSPORT_LOCATION', 'OTHER_EARNING',
    'OTHER_EARNING_NONTAX',
    'PENALTY', 'ABSENCE', 'UNION', 'OTHER_DEDUCTION',
    'LATE_OVERRIDE')),
  CONSTRAINT payroll_inputs_amount_check CHECK (amount >= 0),
  CONSTRAINT payroll_inputs_unique UNIQUE (payroll_run_id, employee_id, code)
);
CREATE INDEX IF NOT EXISTS idx_payroll_inputs_run ON hris.payroll_inputs (payroll_run_id);

-- Slip: komponen baru + jejak audit PPh21.
ALTER TABLE hris.payroll_details
  ADD COLUMN IF NOT EXISTS position_allowance numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_allowance numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS personal_leave_deduction numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sick_leave_deduction numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_earning_nontax numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attendance_days numeric(6,2),
  ADD COLUMN IF NOT EXISTS allowance_days numeric(6,2),
  ADD COLUMN IF NOT EXISTS divisor_days numeric(6,2),
  ADD COLUMN IF NOT EXISTS pay_basis text,
  ADD COLUMN IF NOT EXISTS pph21_method text,
  ADD COLUMN IF NOT EXISTS pph21_dpp numeric(15,2),
  ADD COLUMN IF NOT EXISTS ter_category text,
  ADD COLUMN IF NOT EXISTS ter_rate numeric(6,4);

-- Alokasi per toko: komponen baru ikut dibagi (laporan biaya & jurnal per toko).
ALTER TABLE hris.payroll_detail_allocations
  ADD COLUMN IF NOT EXISTS position_allowance numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_allowance numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_earning_nontax numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS personal_leave_deduction numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sick_leave_deduction numeric(15,2) NOT NULL DEFAULT 0;
