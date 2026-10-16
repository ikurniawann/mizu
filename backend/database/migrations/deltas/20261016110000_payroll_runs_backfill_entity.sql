-- =============================================================================
-- Run payroll dari sebelum payroll per entitas (EPIC-054) dinisbatkan ke entitasnya.
--
-- hris.payroll_runs.company_id NULL = run "gabungan" (semua karyawan aktif dalam satu run).
-- Bila SEMUA slip run itu milik satu entitas, run tersebut sebenarnya run entitas itu: company_id
-- diisi supaya run tampil di tab entitasnya, bukan di kelompok terpisah.
--
-- Entitas karyawan = entitas struktur gajinya (semua baris, aktif maupun tidak); karyawan tanpa gaji
-- ber-entitas memakai entitas penempatan utama terakhir yang sudah berlaku. Run TETAP NULL (gabungan) bila:
--   - ada slip karyawan yang digaji lebih dari satu entitas, atau entitasnya tidak diketahui;
--   - slipnya berasal dari lebih dari satu entitas, atau run tidak punya slip;
--   - sudah ada jurnal run itu yang terposting ke entitas lain;
--   - entitas tersebut sudah punya run pada periode yang sama (unique periode+entitas).
-- Idempoten: hanya menyentuh run dengan company_id NULL.
-- =============================================================================

WITH salary_companies AS (
  SELECT employee_id, array_agg(DISTINCT company_id) AS companies
    FROM hris.employee_salary
   WHERE company_id IS NOT NULL
   GROUP BY employee_id
), employee_company AS (
  SELECT e.id AS employee_id,
         CASE
           WHEN sc.companies IS NULL THEN (
             SELECT b.company_id
               FROM hris.employee_placements p
               JOIN configuration.branches b ON b.id = p.branch_id
              WHERE p.employee_id = e.id AND p.is_primary AND p.start_date <= CURRENT_DATE
              ORDER BY p.start_date DESC
              LIMIT 1)
           WHEN cardinality(sc.companies) = 1 THEN sc.companies[1]
         END AS company_id
    FROM hris.employees e
    LEFT JOIN salary_companies sc ON sc.employee_id = e.id
), run_company AS (
  SELECT d.payroll_run_id AS run_id, (array_agg(DISTINCT ec.company_id))[1] AS company_id
    FROM hris.payroll_details d
    LEFT JOIN employee_company ec ON ec.employee_id = d.employee_id
   GROUP BY d.payroll_run_id
  HAVING count(*) FILTER (WHERE ec.company_id IS NULL) = 0
     AND count(DISTINCT ec.company_id) = 1
)
UPDATE hris.payroll_runs r
   SET company_id = rc.company_id, updated_at = now()
  FROM run_company rc
 WHERE r.id = rc.run_id
   AND r.company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM accounting.journal_entries j
      WHERE j.source_document_id = r.id
        AND j.company_id IS DISTINCT FROM rc.company_id)
   AND NOT EXISTS (
     SELECT 1 FROM hris.payroll_runs o
      WHERE o.period_month = r.period_month AND o.period_year = r.period_year
        AND o.company_id = rc.company_id);

COMMENT ON COLUMN hris.payroll_runs.company_id IS
  'Entitas yang diproses run; NULL = run gabungan sebelum payroll per entitas (tidak bisa dipastikan milik satu entitas).';
