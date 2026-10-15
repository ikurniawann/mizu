-- =============================================================================
-- Absensi per toko: hris.attendance.branch_id = toko tempat karyawan bekerja
-- pada hari itu (dipilih saat clock-in dari penempatan aktifnya, atau dikoreksi
-- HRD). NULL = tidak diketahui; payroll lalu memakai penempatan utama.
--
-- Backfill: baris lama diisi toko penempatan utama yang berlaku pada tanggal
-- absensi (bila ada). Aman diulang (hanya baris yang masih NULL).
-- =============================================================================

ALTER TABLE hris.attendance
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES configuration.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_branch_date ON hris.attendance (branch_id, date)
  WHERE branch_id IS NOT NULL;

UPDATE hris.attendance a
   SET branch_id = p.branch_id
  FROM hris.employee_placements p
 WHERE a.branch_id IS NULL
   AND p.employee_id = a.employee_id
   AND p.is_primary
   AND p.start_date <= a.date
   AND (p.end_date IS NULL OR p.end_date >= a.date);

COMMENT ON COLUMN hris.attendance.branch_id IS
  'Toko (configuration.branches) tempat karyawan bekerja pada hari ini; dasar alokasi biaya gaji per toko.';
