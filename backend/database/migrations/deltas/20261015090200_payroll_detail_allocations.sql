-- =============================================================================
-- Alokasi biaya gaji per toko. Satu karyawan tetap punya SATU slip
-- (hris.payroll_details: satu perhitungan PPh 21/BPJS), tetapi biayanya dibagi
-- ke toko tempat ia bekerja pada periode itu.
--
-- Dasar pembagian (basis):
--   hours   : jam kerja absensi per toko (attendance.work_hours; hari tanpa jam
--             diisi rata-rata jam karyawan itu)
--   days    : jumlah hari hadir per toko (tidak ada jam kerja sama sekali)
--   primary : tidak ada absensi → 100% penempatan utama
--   none    : tidak ada penempatan → bucket "Tanpa toko" (branch_id NULL)
-- Absensi tanpa toko dihitung ke penempatan utama.
--
-- Setiap kolom nominal dibagi proporsional dengan pembulatan sen metode sisa
-- terbesar (largest remainder), sehingga jumlah per toko = nilai slip PERSIS.
-- Baris ditulis ulang setiap run dihitung (hanya status draft) dan ikut terhapus
-- bersama detailnya; setelah run disetujui/dibayar tidak berubah lagi.
--
-- Menu laporan: HRIS → Penggajian → Biaya Gaji per Toko
-- (hris.compensation.store-costs, /dashboard/hris/payroll/store-costs).
-- =============================================================================

CREATE TABLE IF NOT EXISTS hris.payroll_detail_allocations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_detail_id      uuid NOT NULL REFERENCES hris.payroll_details(id) ON DELETE CASCADE,
  payroll_run_id         uuid NOT NULL REFERENCES hris.payroll_runs(id) ON DELETE CASCADE,
  employee_id            uuid NOT NULL REFERENCES hris.employees(id),
  branch_id              uuid REFERENCES configuration.branches(id) ON DELETE SET NULL,
  basis                  text NOT NULL CHECK (basis IN ('hours', 'days', 'primary', 'none')),
  days                   numeric(6, 2) NOT NULL DEFAULT 0,
  hours                  numeric(8, 2) NOT NULL DEFAULT 0,
  ratio                  numeric(9, 6) NOT NULL CHECK (ratio >= 0 AND ratio <= 1),
  base_salary            numeric(12, 2) NOT NULL DEFAULT 0,
  fixed_allowance        numeric(12, 2) NOT NULL DEFAULT 0,
  variable_allowance     numeric(12, 2) NOT NULL DEFAULT 0,
  transport_allowance    numeric(12, 2) NOT NULL DEFAULT 0,
  meal_allowance         numeric(12, 2) NOT NULL DEFAULT 0,
  housing_allowance      numeric(12, 2) NOT NULL DEFAULT 0,
  overtime_pay           numeric(12, 2) NOT NULL DEFAULT 0,
  thr                    numeric(12, 2) NOT NULL DEFAULT 0,
  bonus                  numeric(12, 2) NOT NULL DEFAULT 0,
  other_earning          numeric(12, 2) NOT NULL DEFAULT 0,
  gross_amount           numeric(12, 2) NOT NULL DEFAULT 0,
  bpjs_tk_jht_deduction  numeric(12, 2) NOT NULL DEFAULT 0,
  bpjs_tk_jp_deduction   numeric(12, 2) NOT NULL DEFAULT 0,
  bpjs_kes_deduction     numeric(12, 2) NOT NULL DEFAULT 0,
  tapera_deduction       numeric(12, 2) NOT NULL DEFAULT 0,
  pph21_deduction        numeric(12, 2) NOT NULL DEFAULT 0,
  unpaid_leave_deduction numeric(12, 2) NOT NULL DEFAULT 0,
  late_deduction         numeric(12, 2) NOT NULL DEFAULT 0,
  loan_deduction         numeric(12, 2) NOT NULL DEFAULT 0,
  other_deduction        numeric(12, 2) NOT NULL DEFAULT 0,
  deductions_amount      numeric(12, 2) NOT NULL DEFAULT 0,
  net_amount             numeric(12, 2) NOT NULL DEFAULT 0,
  bpjs_tk_jht_employer   numeric(12, 2) NOT NULL DEFAULT 0,
  bpjs_tk_jp_employer    numeric(12, 2) NOT NULL DEFAULT 0,
  bpjs_tk_jkk_employer   numeric(12, 2) NOT NULL DEFAULT 0,
  bpjs_tk_jkm_employer   numeric(12, 2) NOT NULL DEFAULT 0,
  bpjs_kes_employer      numeric(12, 2) NOT NULL DEFAULT 0,
  tapera_employer        numeric(12, 2) NOT NULL DEFAULT 0,
  employer_contribution_amount numeric(12, 2) NOT NULL DEFAULT 0,
  sort_order             integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_detail_allocations_detail_branch_key UNIQUE NULLS NOT DISTINCT (payroll_detail_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_detail_allocations_run ON hris.payroll_detail_allocations (payroll_run_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_payroll_detail_allocations_detail ON hris.payroll_detail_allocations (payroll_detail_id);

COMMENT ON TABLE hris.payroll_detail_allocations IS
  'Bagian biaya slip gaji (payroll_details) per toko; jumlah setiap kolom nominal per detail sama persis dengan detailnya.';

-- ── Menu laporan ─────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('hris.compensation.store-costs', 'Biaya Gaji per Toko', '/dashboard/hris/payroll/store-costs',
   'reports', 'sidebar', 15, '{"actions":["read","export"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus child SET parent_id = parent.id, module = 'hris', level = 3, updated_at = now()
FROM iam.menus parent
WHERE child.code = 'hris.compensation.store-costs' AND parent.code = 'hris.compensation';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code = 'hris.compensation.store-costs'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","export"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'hrd' AND m.code = 'hris.compensation.store-costs'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
