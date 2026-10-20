INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('spa.rooms', 'Room Spa', '/dashboard/spa/rooms', 'building', 'sidebar', 65,
        '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus child SET parent_id = parent.id, module = 'spa', level = 2, updated_at = now()
FROM iam.menus parent WHERE child.code = 'spa.rooms' AND parent.code = 'spa';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT source.role_id, target.id,
  CASE WHEN source.granted_actions ? 'update'
    THEN '["read","create","update","delete"]'::jsonb
    ELSE '["read"]'::jsonb END
FROM iam.role_menu_permissions source
JOIN iam.menus outlet ON outlet.id = source.menu_id AND outlet.code = 'spa.outlets'
JOIN iam.menus target ON target.code = 'spa.rooms'
WHERE source.is_active AND source.granted_actions ? 'read'
ON CONFLICT (role_id, menu_id) DO NOTHING;
