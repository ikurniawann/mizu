CREATE TABLE IF NOT EXISTS spa.treatment_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (name = btrim(name) AND length(name) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Empty category is the existing optional value and is hidden from the editor.
INSERT INTO spa.treatment_categories (name) VALUES ('') ON CONFLICT (name) DO NOTHING;
UPDATE spa.treatments SET category = btrim(category) WHERE category <> btrim(category);
INSERT INTO spa.treatment_categories (name)
SELECT DISTINCT category FROM spa.treatments WHERE category <> ''
ON CONFLICT (name) DO NOTHING;

ALTER TABLE spa.treatments
  ADD CONSTRAINT spa_treatments_category_fk FOREIGN KEY (category)
  REFERENCES spa.treatment_categories (name) ON UPDATE CASCADE ON DELETE RESTRICT;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('spa.categories', 'Kategori Treatment', '/dashboard/spa/categories', 'tag', 'sidebar', 29,
        '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus child SET parent_id = parent.id, module = 'spa', level = 2, updated_at = now()
FROM iam.menus parent WHERE child.code = 'spa.categories' AND parent.code = 'spa';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT DISTINCT p.role_id, target.id, '["read","create","update","delete"]'::jsonb
FROM iam.role_menu_permissions p
JOIN iam.menus source ON source.id = p.menu_id
CROSS JOIN iam.menus target
WHERE target.code = 'spa.categories' AND source.code = 'spa.treatments'
  AND source.deleted_at IS NULL AND source.is_active AND p.is_active AND p.granted_actions ? 'create'
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true,
  granted_actions = EXCLUDED.granted_actions, updated_at = now();
