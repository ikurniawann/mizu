-- Pindahkan laporan/payroll dari menu Spa utama; pengaturan komisi ada di Harga Outlet.
UPDATE iam.menus child
SET menu_name = 'Laporan Komisi', route_path = '/dashboard/spa/report/commissions',
    parent_id = parent.id, module = 'spa', level = 3, order_number = 50,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'spa.commissions' AND parent.code = 'report';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT DISTINCT p.role_id, target.id, '["read"]'::jsonb
FROM iam.role_menu_permissions p
JOIN iam.menus source ON source.id = p.menu_id
CROSS JOIN iam.menus target
WHERE source.code = 'spa.commissions' AND target.code = 'report'
  AND p.is_active AND p.granted_actions ? 'read'
ON CONFLICT (role_id, menu_id) DO NOTHING;

-- Bekukan aturan lama yang berlaku lintas outlet menjadi aturan per varian/outlet.
INSERT INTO spa.commission_rules (variant_id, branch_id, commission_type, value, is_active)
SELECT v.id, o.branch_id, chosen.commission_type, chosen.value, true
FROM spa.treatment_variants v
JOIN spa.outlets o ON true
JOIN LATERAL (
  SELECT r.commission_type, r.value
  FROM spa.commission_rules r
  WHERE r.is_active
    AND (r.branch_id = o.branch_id OR r.branch_id IS NULL)
    AND (r.variant_id = v.id OR r.treatment_id = v.treatment_id
         OR (r.variant_id IS NULL AND r.treatment_id IS NULL))
  ORDER BY CASE
    WHEN r.variant_id = v.id AND r.branch_id = o.branch_id THEN 0
    WHEN r.variant_id = v.id THEN 1
    WHEN r.treatment_id = v.treatment_id AND r.branch_id = o.branch_id THEN 2
    WHEN r.treatment_id = v.treatment_id THEN 3
    WHEN r.branch_id = o.branch_id THEN 4 ELSE 5 END
  LIMIT 1
) chosen ON true
ON CONFLICT (COALESCE(treatment_id, '00000000-0000-0000-0000-000000000000'::uuid),
             COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
             COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

UPDATE spa.commission_rules
SET is_active = false, updated_at = now()
WHERE is_active AND (variant_id IS NULL OR branch_id IS NULL);
