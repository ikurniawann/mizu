-- Accounting masters: fokus per company (Mizu Wonderland).
-- Remap referensi dari COA global → COA MIZU, assign master global ke MIZU,
-- lalu soft-delete COA global agar list tidak double.

DO $$
DECLARE
  v_mizu uuid;
BEGIN
  SELECT id INTO v_mizu
  FROM configuration.companies
  WHERE code = 'MIZU'
  LIMIT 1;

  IF v_mizu IS NULL THEN
    RAISE EXCEPTION 'Company MIZU tidak ditemukan';
  END IF;

  -- 1) Remap journal entry lines: global account_id → MIZU by code
  UPDATE accounting.journal_entry_lines l
  SET account_id = s.id
  FROM accounting.chart_of_accounts g
  JOIN accounting.chart_of_accounts s
    ON s.code = g.code
   AND s.company_id = v_mizu
   AND s.deleted_at IS NULL
  WHERE l.account_id = g.id
    AND g.company_id IS NULL
    AND g.deleted_at IS NULL;

  -- 2) Remap journal mapping lines
  UPDATE accounting.journal_mapping_lines l
  SET account_id = s.id
  FROM accounting.chart_of_accounts g
  JOIN accounting.chart_of_accounts s
    ON s.code = g.code
   AND s.company_id = v_mizu
   AND s.deleted_at IS NULL
  WHERE l.account_id = g.id
    AND g.company_id IS NULL
    AND g.deleted_at IS NULL;

  -- 3) Assign journal mappings global → MIZU
  UPDATE accounting.journal_mappings
  SET company_id = v_mizu,
      updated_at = now()
  WHERE company_id IS NULL
    AND deleted_at IS NULL;

  -- 4) Assign fiscal years global → MIZU
  UPDATE accounting.fiscal_years
  SET company_id = v_mizu,
      updated_at = now()
  WHERE company_id IS NULL
    AND deleted_at IS NULL;

  -- 5) Assign journal entries global → MIZU
  UPDATE accounting.journal_entries
  SET company_id = v_mizu,
      updated_at = now()
  WHERE company_id IS NULL
    AND deleted_at IS NULL;

  -- 6) Soft-delete COA global (MIZU tree tetap)
  UPDATE accounting.chart_of_accounts
  SET deleted_at = now(),
      updated_at = now()
  WHERE company_id IS NULL
    AND deleted_at IS NULL;
END $$;
