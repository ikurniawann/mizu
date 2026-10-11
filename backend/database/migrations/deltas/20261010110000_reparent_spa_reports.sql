-- Preserve report menu IDs, routes, and role grants while changing the sidebar tree.
UPDATE iam.menus child
SET parent_id = parent.id, module = 'spa', level = 2, order_number = 70, updated_at = now()
FROM iam.menus parent
WHERE child.code = 'spa.rush-hour' AND parent.code = 'spa';

UPDATE iam.menus child
SET parent_id = parent.id, module = 'report', level = 2, order_number = 20, updated_at = now()
FROM iam.menus parent
WHERE child.code = 'spa.trend' AND parent.code = 'report';

UPDATE iam.menus
SET is_active = false, is_visible = false, deleted_at = now(), updated_at = now()
WHERE code = 'spa-report' AND deleted_at IS NULL;
