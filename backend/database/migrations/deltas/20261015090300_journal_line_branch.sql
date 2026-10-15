-- =============================================================================
-- Dimensi toko/cost center pada baris jurnal: accounting.journal_entry_lines
-- .branch_id (NULL = tingkat perusahaan). Jurnal payroll memecah baris beban
-- (beban gaji, BPJS & Tapera pemberi kerja) per toko sesuai alokasi
-- hris.payroll_detail_allocations; baris utang (utang gaji, BPJS, PPh 21) tetap
-- di tingkat perusahaan. Jurnal manual dan modul lain tidak berubah.
-- =============================================================================

ALTER TABLE accounting.journal_entry_lines
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES configuration.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_branch ON accounting.journal_entry_lines (branch_id, account_id)
  WHERE branch_id IS NOT NULL;

COMMENT ON COLUMN accounting.journal_entry_lines.branch_id IS
  'Toko/cost center baris jurnal (configuration.branches); NULL = tingkat perusahaan.';
