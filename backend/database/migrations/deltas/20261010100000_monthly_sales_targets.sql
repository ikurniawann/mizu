CREATE TABLE IF NOT EXISTS configuration.monthly_sales_targets (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 branch_id uuid NOT NULL REFERENCES configuration.branches(id),
 month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1 AND EXTRACT(YEAR FROM month) BETWEEN 2000 AND 2100),
 amount numeric(15,2) NOT NULL CHECK (amount > 0 AND amount <= 100000000000),
 created_by uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
 updated_by uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (branch_id, month)
);
COMMENT ON TABLE configuration.monthly_sales_targets IS 'Target penjualan POS per outlet dan bulan; satu target untuk setiap outlet/bulan.';

INSERT INTO iam.menus (code,menu_name,route_path,icon,menu_type,order_number,permission_context)
VALUES
 ('report','Report',NULL,'chart','group',4,'{"actions":["read"]}'::jsonb),
 ('report.sales-vs-target','Sales vs Target','/dashboard/report/sales-vs-target','chart','sidebar',10,'{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET menu_name=EXCLUDED.menu_name,route_path=EXCLUDED.route_path,
 icon=EXCLUDED.icon,menu_type=EXCLUDED.menu_type,order_number=EXCLUDED.order_number,
 permission_context=EXCLUDED.permission_context,is_active=true,is_visible=true,deleted_at=NULL,updated_at=now();
UPDATE iam.menus SET module='report',level=1,parent_id=NULL WHERE code='report';
UPDATE iam.menus child SET module='report',level=2,parent_id=parent.id
 FROM iam.menus parent WHERE child.code='report.sales-vs-target' AND parent.code='report';
INSERT INTO iam.role_menu_permissions (role_id,menu_id,granted_actions)
SELECT r.id,m.id,'["read","create","update","delete"]'::jsonb
 FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.code IN ('super_admin','admin') AND m.code IN ('report','report.sales-vs-target')
ON CONFLICT (role_id,menu_id) DO NOTHING;
