-- Nest the existing Report group under Spa without changing menu IDs or grants.
UPDATE iam.menus child
SET menu_name = 'Laporan', parent_id = parent.id, module = 'spa',
    level = 2, order_number = 80, updated_at = now()
FROM iam.menus parent
WHERE child.code = 'report' AND parent.code = 'spa';

UPDATE iam.menus child
SET parent_id = parent.id, module = 'spa', level = 3, updated_at = now()
FROM iam.menus parent
WHERE child.code IN ('report.sales-vs-target', 'spa.trend', 'spa.bookings')
  AND parent.code = 'report';
