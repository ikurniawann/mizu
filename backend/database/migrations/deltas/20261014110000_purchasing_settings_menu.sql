-- =============================================================================
-- Pengaturan Pembelian — aturan "PO wajib dari PR" (configuration.app_settings
-- po_requires_pr_raw_material / po_requires_pr_product, dibaca procurement).
-- Menu sidebar di grup Pembelian Bahan Baku dan Pembelian Produk; keduanya
-- membuka halaman yang sama (GET/PUT /api/purchasing/settings).
-- PUT butuh aksi "update" pada menu ini: super_admin, admin, purchasing_admin,
-- purchasing_manager. Staf tetap bisa membaca aturan lewat prefix items.
-- Nilai aturan TIDAK di-seed: key kosong = perilaku lama (bahan baku wajib PR,
-- produk opsional).
-- =============================================================================

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('items.raw-material.purchasing.settings', 'Pengaturan Pembelian', '/dashboard/raw-material/purchasing/settings',
   'settings', 'sidebar', 90, '{"actions":["read","update"]}'::jsonb),
  ('items.product.purchasing.settings', 'Pengaturan Pembelian', '/dashboard/product/purchasing/settings',
   'settings', 'sidebar', 90, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus child SET parent_id = parent.id, module = 'items', level = 4, updated_at = now()
FROM iam.menus parent
WHERE (child.code = 'items.raw-material.purchasing.settings' AND parent.code = 'items.raw-material.purchasing')
   OR (child.code = 'items.product.purchasing.settings' AND parent.code = 'items.product.purchasing');

-- super_admin / admin: semua aksi (pola iam-admin-permissions).
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code IN ('items.raw-material.purchasing.settings', 'items.product.purchasing.settings')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- Pengelola pembelian: baca + ubah aturan.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","update"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('purchasing_admin', 'purchasing_manager')
  AND m.code IN ('items.raw-material.purchasing.settings', 'items.product.purchasing.settings')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
