-- =============================================================================
-- Penempatan Karyawan (multi-toko): satu karyawan bisa ditempatkan di lebih dari
-- satu toko (configuration.branches) dalam satu perusahaan. Dipakai untuk:
--   - memilih toko saat clock-in (hris.attendance.branch_id, migrasi berikutnya)
--   - membagi biaya gaji per toko (hris.payroll_detail_allocations)
--
-- Aturan (dijaga constraint, bukan hanya aplikasi):
--   - paling banyak SATU penempatan utama (is_primary) aktif per karyawan pada
--     rentang tanggal yang tumpang tindih;
--   - tidak boleh ada dua penempatan aktif di toko yang SAMA dengan rentang
--     tanggal yang tumpang tindih.
-- end_date NULL = masih berlaku. Rentang inklusif [start_date, end_date].
--
-- Menu: HRIS → Master Data → Penempatan Karyawan (hris.master.placements),
-- route /dashboard/hris/placements. API memakai prefix menu ini ATAU pengelola
-- data karyawan (hris.kepegawaian / settings.users).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS hris.employee_placements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES configuration.branches(id) ON DELETE RESTRICT,
  is_primary  boolean NOT NULL DEFAULT false,
  start_date  date NOT NULL DEFAULT CURRENT_DATE,
  end_date    date,
  notes       text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_placements_dates_check CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT employee_placements_one_primary EXCLUDE USING gist (
    employee_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (is_primary),
  CONSTRAINT employee_placements_no_overlap EXCLUDE USING gist (
    employee_id WITH =,
    branch_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
);

CREATE INDEX IF NOT EXISTS idx_employee_placements_employee ON hris.employee_placements (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_placements_branch ON hris.employee_placements (branch_id);

DROP TRIGGER IF EXISTS employee_placements_updated_at ON hris.employee_placements;
CREATE TRIGGER employee_placements_updated_at BEFORE UPDATE ON hris.employee_placements
  FOR EACH ROW EXECUTE FUNCTION public.update_hris_updated_at();

COMMENT ON TABLE hris.employee_placements IS
  'Penempatan karyawan per toko (configuration.branches); dasar pilihan toko saat clock-in dan alokasi biaya gaji per toko.';

-- ── Menu ─────────────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('hris.master.placements', 'Penempatan Karyawan', '/dashboard/hris/placements',
   'building', 'sidebar', 40, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus child SET parent_id = parent.id, module = 'hris', level = 3, updated_at = now()
FROM iam.menus parent
WHERE child.code = 'hris.master.placements' AND parent.code = 'hris.master';

-- super_admin / admin: semua aksi (pola iam-admin-permissions).
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code = 'hris.master.placements'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- HRD: kelola penempatan.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'hrd' AND m.code = 'hris.master.placements'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
