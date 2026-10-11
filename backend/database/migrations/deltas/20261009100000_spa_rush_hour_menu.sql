-- Spa booking counts: read-only capability, inherited from booking readers.
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('spa.rush-hour', 'Rush Hour', '/dashboard/spa/report/rush-hour', 'clock', 'sidebar', 10, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
 icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
 permission_context = EXCLUDED.permission_context, is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'spa', level = 2 WHERE code = 'spa.rush-hour';
UPDATE iam.menus child SET parent_id = parent.id FROM iam.menus parent
 WHERE child.code = 'spa.rush-hour' AND parent.code = 'spa';
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT DISTINCT p.role_id, target.id, '["read"]'::jsonb
 FROM iam.role_menu_permissions p JOIN iam.menus source ON source.id = p.menu_id
 CROSS JOIN iam.menus target
 WHERE target.code = 'spa.rush-hour' AND source.code IN ('spa.bookings', 'spa.book-order')
 AND source.deleted_at IS NULL AND source.is_active AND p.is_active AND p.granted_actions ? 'read'
ON CONFLICT (role_id, menu_id) DO NOTHING;
