-- =============================================================================
-- Payroll multi-entitas (EPIC-054).
--
-- hris.employee_salary.company_id: entitas (configuration.companies) yang
--   membayar struktur gaji ini. Satu karyawan boleh punya satu versi aktif PER
--   entitas (mis. Paddy Rp1jt + Kantor Pusat Rp1jt → dua slip).
--   Backfill: semua versi lama → entitas penempatan utama karyawan saat ini.
-- hris.payroll_runs.company_id: entitas yang diproses run. Run baru wajib
--   berentitas (dijaga aplikasi); NULL = run lama "semua entitas".
-- =============================================================================

ALTER TABLE hris.employee_salary
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES configuration.companies(id) ON DELETE RESTRICT;

UPDATE hris.employee_salary s
   SET company_id = pc.company_id
  FROM (SELECT DISTINCT ON (p.employee_id) p.employee_id, b.company_id
          FROM hris.employee_placements p
          JOIN configuration.branches b ON b.id = p.branch_id
         WHERE p.is_primary AND p.start_date <= CURRENT_DATE
           AND (p.end_date IS NULL OR p.end_date >= CURRENT_DATE)
         ORDER BY p.employee_id, p.start_date DESC) pc
 WHERE s.company_id IS NULL AND s.employee_id = pc.employee_id;

-- Satu versi aktif per (karyawan, entitas): yang lebih lama dinonaktifkan,
-- sama dengan versi yang selama ini dipakai payroll (effective_date terbaru).
UPDATE hris.employee_salary s SET is_active = false, updated_at = now()
 WHERE s.is_active AND EXISTS (
   SELECT 1 FROM hris.employee_salary n
    WHERE n.employee_id = s.employee_id AND n.company_id IS NOT DISTINCT FROM s.company_id
      AND n.is_active AND n.id <> s.id
      AND (n.effective_date, n.created_at) > (s.effective_date, s.created_at));

ALTER TABLE hris.employee_salary DROP CONSTRAINT IF EXISTS unique_employee_salary;
CREATE UNIQUE INDEX IF NOT EXISTS employee_salary_entity_effective_key
  ON hris.employee_salary (employee_id, company_id, effective_date) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS employee_salary_one_active_per_entity
  ON hris.employee_salary (employee_id, company_id) NULLS NOT DISTINCT WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_employee_salary_company ON hris.employee_salary (company_id);

ALTER TABLE hris.payroll_runs
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES configuration.companies(id) ON DELETE RESTRICT;
ALTER TABLE hris.payroll_runs DROP CONSTRAINT IF EXISTS unique_period;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_period_company_key
  ON hris.payroll_runs (period_month, period_year, company_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_payroll_runs_company ON hris.payroll_runs (company_id);

COMMENT ON COLUMN hris.employee_salary.company_id IS 'Entitas yang membayar struktur gaji ini (satu versi aktif per entitas).';
COMMENT ON COLUMN hris.payroll_runs.company_id IS 'Entitas yang diproses run; NULL = run lama semua entitas.';
