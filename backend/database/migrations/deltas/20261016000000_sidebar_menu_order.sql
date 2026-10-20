-- Urutan menu utama dan label Leads; kode serta rute tetap berlaku.
UPDATE iam.menus
SET menu_name = CASE code
      WHEN 'dashboard' THEN 'Dashboard'
      WHEN 'sales-funnel' THEN 'Leads'
      ELSE menu_name
    END,
    order_number = CASE code
      WHEN 'dashboard' THEN 0
      WHEN 'ess' THEN 10
      WHEN 'hris' THEN 20
      WHEN 'sales-funnel' THEN 30
      WHEN 'items' THEN 40
      WHEN 'crm' THEN 50
      WHEN 'pos' THEN 60
      WHEN 'ticketing' THEN 70
      WHEN 'dataroom' THEN 80
      WHEN 'accounting' THEN 90
      WHEN 'settings' THEN 100
    END,
    parent_id = CASE WHEN code = 'sales-funnel' THEN NULL ELSE parent_id END,
    level = CASE WHEN code = 'sales-funnel' THEN 1 ELSE level END,
    updated_at = now()
WHERE code IN ('dashboard', 'ess', 'hris', 'sales-funnel', 'items', 'crm', 'pos',
               'ticketing', 'dataroom', 'accounting', 'settings')
  AND deleted_at IS NULL;

WITH RECURSIVE sales_tree AS (
  SELECT id, 1 AS depth FROM iam.menus WHERE code = 'sales-funnel' AND deleted_at IS NULL
  UNION ALL
  SELECT child.id, parent.depth + 1
  FROM iam.menus child
  JOIN sales_tree parent ON child.parent_id = parent.id
  WHERE child.deleted_at IS NULL
)
UPDATE iam.menus menu
SET level = sales_tree.depth, updated_at = now()
FROM sales_tree
WHERE menu.id = sales_tree.id AND menu.level IS DISTINCT FROM sales_tree.depth;
