-- =============================================================================
-- configuration.users.role: izinkan semua peran aplikasi yang diterima
-- Manajemen User (AdminUserRoles di accounts/domain): employee (Karyawan/ESS,
-- 2026-07-16), sales (EPIC-022), marketing (EPIC-032). Constraint dari skema
-- awal belum memuatnya, sehingga akun karyawan ESS gagal dibuat.
-- =============================================================================

ALTER TABLE configuration.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE configuration.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'super_admin', 'admin', 'hrd', 'hiring_manager', 'direksi', 'purchasing_admin',
  'purchasing_manager', 'purchasing_staff', 'finance_staff', 'warehouse_staff',
  'warehouse_admin', 'pos', 'pos_supervisor', 'qc_staff', 'employee', 'sales', 'marketing'
]::text[]));
