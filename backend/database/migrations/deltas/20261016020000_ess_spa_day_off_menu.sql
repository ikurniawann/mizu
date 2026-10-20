-- Terapis mengajukan libur dari Area Karyawan, terpisah dari Tugas Terapis.
INSERT INTO iam.menus (parent_id, code, menu_name, route_path, module, menu_type, icon, level, order_number, permission_context)
SELECT parent.id, 'ess.day-offs', 'Jadwal Libur', '/dashboard/me/jadwal-libur',
       'ess', 'sidebar', 'calendar', 2, 6, '{"actions":["read","update"]}'::jsonb
FROM iam.menus parent
WHERE parent.code = 'ess' AND parent.deleted_at IS NULL
ON CONFLICT (code) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  module = EXCLUDED.module,
  menu_type = EXCLUDED.menu_type,
  icon = EXCLUDED.icon,
  level = EXCLUDED.level,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true,
  is_visible = true,
  deleted_at = NULL,
  updated_at = now();

-- Menu baru mengikuti akses Tugas Terapis, termasuk role khusus terapis.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT permission.role_id, target.id, '["read","update"]'::jsonb
FROM iam.role_menu_permissions permission
JOIN iam.menus source ON source.id = permission.menu_id AND source.code = 'ess.spa'
JOIN iam.menus target ON target.code = 'ess.day-offs'
WHERE permission.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
