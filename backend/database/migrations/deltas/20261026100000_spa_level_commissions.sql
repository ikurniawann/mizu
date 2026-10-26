-- Reset komisi lama disetujui pengguna. Booking, pembayaran pelanggan dan
-- komponen gaji nonkomisi dipertahankan.
ALTER TABLE spa.booking_items
  ADD COLUMN commission_level smallint CHECK (commission_level BETWEEN 0 AND 2),
  ADD COLUMN commission_reset boolean NOT NULL DEFAULT false;
UPDATE spa.booking_items SET commission_reset = true, commission_type = NULL,
  commission_value = NULL, commission_idr = 0 WHERE status = 'completed';
DELETE FROM spa.pay_commission_items;
UPDATE spa.pay_lines SET commission_idr = 0, commission_count = 0,
  total_idr = base_salary_idr + allowance_idr + bonus_idr - deduction_idr;
UPDATE spa.pay_runs r SET total_idr = COALESCE(
  (SELECT sum(l.total_idr) FROM spa.pay_lines l WHERE l.run_id = r.id), 0), updated_at = now();
DELETE FROM spa.commission_rules;
DROP INDEX spa.uq_spa_commission_rules_scope;
ALTER TABLE spa.commission_rules
  ADD COLUMN therapist_level smallint NOT NULL CHECK (therapist_level BETWEEN 0 AND 2),
  ADD COLUMN updated_by uuid,
  ALTER COLUMN variant_id SET NOT NULL,
  ADD CONSTRAINT spa_rules_level_variant UNIQUE (variant_id, therapist_level),
  ADD CONSTRAINT spa_rules_global_fixed CHECK (
    branch_id IS NULL AND treatment_id IS NULL AND commission_type = 'fixed'
    AND value = trunc(value) AND value <= 999999999999);

INSERT INTO iam.menus(parent_id,code,menu_name,route_path,module,menu_type,icon,level,order_number,permission_context)
SELECT id,'spa.commission-settings','Pengaturan Komisi','/dashboard/spa/commission-settings','spa','sidebar','banknotes',2,55,
  '{"actions":["read","update"]}'::jsonb FROM iam.menus WHERE code='spa'
ON CONFLICT(code) DO UPDATE SET menu_name=EXCLUDED.menu_name,route_path=EXCLUDED.route_path,
  parent_id=EXCLUDED.parent_id,permission_context=EXCLUDED.permission_context,is_active=true,is_visible=true,deleted_at=NULL;
INSERT INTO iam.role_menu_permissions(role_id,menu_id,granted_actions)
SELECT p.role_id,m.id,
  CASE WHEN p.granted_actions ? 'update' THEN '["read","update"]'::jsonb ELSE '["read"]'::jsonb END
FROM iam.role_menu_permissions p
JOIN iam.menus source ON source.id=p.menu_id AND source.code='spa.commissions'
JOIN iam.menus m ON m.code='spa.commission-settings'
WHERE p.is_active AND (p.granted_actions ? 'read' OR p.granted_actions ? 'update')
ON CONFLICT(role_id,menu_id) DO NOTHING;
