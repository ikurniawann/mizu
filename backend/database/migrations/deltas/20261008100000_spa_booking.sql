-- Spa (Mizu): outlet spa, treatment + varian durasi, terapis, perbantuan,
-- PIC outlet, booking + item treatment per terapis, aturan komisi.
-- EPIC-052 (docs/epics/EPIC-052-mizu-spa-booking-terapis.md). Idempotent.
--
-- Outlet = configuration.branches; treatment dijual lewat POS sebagai produk
-- station 'spa' yang dibuat modul spa per (varian, outlet) — station baru itu
-- ditambahkan ke CHECK POS di bagian 1 dan tidak dikirim ke dapur/printer.

CREATE SCHEMA IF NOT EXISTS spa;

-- 1. Station POS 'spa' ---------------------------------------------------------
ALTER TABLE item.products DROP CONSTRAINT IF EXISTS products_station_check;
ALTER TABLE item.products ADD CONSTRAINT products_station_check
  CHECK (station = ANY (ARRAY['kitchen','bar','bakery','dessert','merchandise','photobooth','spa']));
ALTER TABLE pos.pos_products DROP CONSTRAINT IF EXISTS pos_products_station_check;
ALTER TABLE pos.pos_products ADD CONSTRAINT pos_products_station_check
  CHECK (station = ANY (ARRAY['kitchen','bar','bakery','dessert','merchandise','photobooth','spa']));
ALTER TABLE pos.pos_order_items DROP CONSTRAINT IF EXISTS pos_order_items_station_check;
ALTER TABLE pos.pos_order_items ADD CONSTRAINT pos_order_items_station_check
  CHECK (station = ANY (ARRAY['kitchen','bar','bakery','dessert','merchandise','photobooth','spa']));
ALTER TABLE pos.pos_print_jobs DROP CONSTRAINT IF EXISTS pos_print_jobs_station_check;
ALTER TABLE pos.pos_print_jobs ADD CONSTRAINT pos_print_jobs_station_check
  CHECK (station = ANY (ARRAY['kitchen','bar','bakery','dessert','merchandise','photobooth','spa']));

INSERT INTO pos.pos_categories (name, display_order, is_active)
SELECT 'Spa Treatment', 90, true
WHERE NOT EXISTS (SELECT 1 FROM pos.pos_categories WHERE lower(name) = 'spa treatment');

-- 2. Outlet spa -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spa.outlets (
  branch_id      uuid PRIMARY KEY REFERENCES configuration.branches(id) ON DELETE CASCADE,
  warehouse_id   uuid NOT NULL REFERENCES configuration.warehouses(id),
  open_time      time NOT NULL DEFAULT '10:00',
  close_time     time NOT NULL DEFAULT '22:00',
  slot_minutes   int  NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
  public_booking boolean NOT NULL DEFAULT true,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spa_outlets_hours CHECK (close_time > open_time)
);

-- 3. Treatment + varian ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spa.treatments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  category    text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spa_treatments_code ON spa.treatments (code);

CREATE TABLE IF NOT EXISTS spa.treatment_variants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id uuid NOT NULL REFERENCES spa.treatments(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (btrim(name) <> ''),
  duration_min int  NOT NULL CHECK (duration_min BETWEEN 5 AND 600),
  buffer_min   int  NOT NULL DEFAULT 0 CHECK (buffer_min BETWEEN 0 AND 120),
  price_idr    numeric(14,2) NOT NULL CHECK (price_idr >= 0),
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spa_variants_treatment ON spa.treatment_variants (treatment_id);

CREATE TABLE IF NOT EXISTS spa.variant_outlet_prices (
  variant_id uuid NOT NULL REFERENCES spa.treatment_variants(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES configuration.branches(id) ON DELETE CASCADE,
  price_idr  numeric(14,2) NOT NULL CHECK (price_idr >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, branch_id)
);

-- Produk POS yang dibuat modul spa untuk menjual varian di outlet.
CREATE TABLE IF NOT EXISTS spa.variant_pos_products (
  variant_id     uuid NOT NULL REFERENCES spa.treatment_variants(id) ON DELETE CASCADE,
  branch_id      uuid NOT NULL REFERENCES configuration.branches(id) ON DELETE CASCADE,
  pos_product_id uuid NOT NULL REFERENCES pos.pos_products(id) ON DELETE CASCADE,
  synced_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, branch_id)
);

-- 4. Terapis, perbantuan, PIC outlet ------------------------------------------------
CREATE TABLE IF NOT EXISTS spa.therapists (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
  home_branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  gender         text CHECK (gender IN ('male', 'female')),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spa_therapists_employee ON spa.therapists (employee_id);
CREATE INDEX IF NOT EXISTS idx_spa_therapists_branch ON spa.therapists (home_branch_id);

CREATE TABLE IF NOT EXISTS spa.therapist_assists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES spa.therapists(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL REFERENCES configuration.branches(id),
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  note         text NOT NULL DEFAULT '',
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spa_assists_dates CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_spa_assists_branch ON spa.therapist_assists (branch_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS spa.outlet_pics (
  branch_id   uuid NOT NULL REFERENCES configuration.branches(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, employee_id)
);

-- 5. Booking ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spa.bookings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code          text NOT NULL,
  company_id            uuid REFERENCES configuration.companies(id),
  branch_id             uuid NOT NULL REFERENCES configuration.branches(id),
  warehouse_id          uuid NOT NULL REFERENCES configuration.warehouses(id),
  booking_type          text NOT NULL CHECK (booking_type IN ('walk_in', 'reservation')),
  source                text NOT NULL DEFAULT 'front_office' CHECK (source IN ('front_office', 'public')),
  customer_id           uuid REFERENCES pos.pos_customers(id) ON DELETE SET NULL,
  customer_name         text NOT NULL CHECK (btrim(customer_name) <> ''),
  customer_phone        text NOT NULL DEFAULT '',
  therapist_gender_pref text NOT NULL DEFAULT 'any' CHECK (therapist_gender_pref IN ('any', 'male', 'female')),
  notes                 text NOT NULL DEFAULT '',
  scheduled_at          timestamptz NOT NULL,
  status                text NOT NULL DEFAULT 'unassigned'
                        CHECK (status IN ('unassigned', 'assigned', 'in_treatment', 'completed', 'cancelled', 'expired')),
  payment_status        text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'void')),
  pos_order_id          uuid,
  checked_out_at        timestamptz,
  paid_at               timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spa_bookings_code ON spa.bookings (booking_code);
CREATE INDEX IF NOT EXISTS idx_spa_bookings_branch_time ON spa.bookings (branch_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_spa_bookings_order ON spa.bookings (pos_order_id) WHERE pos_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS spa.booking_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES spa.bookings(id) ON DELETE CASCADE,
  variant_id       uuid NOT NULL REFERENCES spa.treatment_variants(id),
  treatment_name   text NOT NULL,
  variant_name     text NOT NULL,
  duration_min     int  NOT NULL CHECK (duration_min > 0),
  buffer_min       int  NOT NULL DEFAULT 0 CHECK (buffer_min >= 0),
  price_idr        numeric(14,2) NOT NULL CHECK (price_idr >= 0),
  therapist_id     uuid REFERENCES spa.therapists(id),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'unassigned'
                   CHECK (status IN ('unassigned', 'assigned', 'in_treatment', 'completed', 'cancelled')),
  started_at       timestamptz,
  completed_at     timestamptz,
  commission_type  text CHECK (commission_type IN ('percent', 'fixed')),
  commission_value numeric(14,2),
  commission_idr   numeric(14,2),
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spa_items_time_ordered CHECK (ends_at > starts_at),
  CONSTRAINT spa_items_assigned_has_therapist
    CHECK (status IN ('unassigned', 'cancelled') OR therapist_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_spa_items_booking ON spa.booking_items (booking_id);
CREATE INDEX IF NOT EXISTS idx_spa_items_therapist_time ON spa.booking_items (therapist_id, starts_at)
  WHERE therapist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spa_items_completed ON spa.booking_items (completed_at) WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS spa.booking_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES spa.bookings(id) ON DELETE CASCADE,
  item_id       uuid REFERENCES spa.booking_items(id) ON DELETE SET NULL,
  action        text NOT NULL,
  from_status   text,
  to_status     text,
  actor_user_id uuid,
  note          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spa_events_booking ON spa.booking_events (booking_id, created_at);

-- 6. Aturan komisi -------------------------------------------------------------------
-- treatment_id/variant_id NULL = default; branch_id NULL = semua outlet.
CREATE TABLE IF NOT EXISTS spa.commission_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id    uuid REFERENCES spa.treatments(id) ON DELETE CASCADE,
  variant_id      uuid REFERENCES spa.treatment_variants(id) ON DELETE CASCADE,
  branch_id       uuid REFERENCES configuration.branches(id) ON DELETE CASCADE,
  commission_type text NOT NULL CHECK (commission_type IN ('percent', 'fixed')),
  value           numeric(14,2) NOT NULL CHECK (value >= 0),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spa_rules_one_target CHECK (treatment_id IS NULL OR variant_id IS NULL),
  CONSTRAINT spa_rules_percent_max CHECK (commission_type <> 'percent' OR value <= 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spa_commission_rules_scope ON spa.commission_rules (
  COALESCE(treatment_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 7. Menu IAM -------------------------------------------------------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('spa', 'Spa', NULL, 'calendar', 'group', 2, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context) VALUES
  ('spa.bookings',    'Booking',        '/dashboard/spa/bookings',    'ticket',         'sidebar', 10, '{"actions":["read","create","update"]}'::jsonb),
  ('spa.book-order',  'Book Order',     '/dashboard/spa/book-order',  'clock',          'sidebar', 20, '{"actions":["read","update"]}'::jsonb),
  ('spa.treatments',  'Treatment',      '/dashboard/spa/treatments',  'package',        'sidebar', 30, '{"actions":["read","create","update"]}'::jsonb),
  ('spa.therapists',  'Terapis',        '/dashboard/spa/therapists',  'identification', 'sidebar', 40, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('spa.commissions', 'Komisi Terapis', '/dashboard/spa/commissions', 'banknotes',      'sidebar', 50, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('spa.outlets',     'Outlet Spa',     '/dashboard/spa/outlets',     'store',          'sidebar', 60, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'spa', level = 1 WHERE code = 'spa';
UPDATE iam.menus SET module = 'spa', level = 2
WHERE code IN ('spa.bookings', 'spa.book-order', 'spa.treatments', 'spa.therapists', 'spa.commissions', 'spa.outlets');
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code IN ('spa.bookings', 'spa.book-order', 'spa.treatments', 'spa.therapists', 'spa.commissions', 'spa.outlets')
  AND parent.code = 'spa';

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ess.spa', 'Tugas Terapis', '/dashboard/me/spa', 'clock', 'sidebar', 5, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'ess', level = 2 WHERE code = 'ess.spa';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'ess.spa' AND parent.code = 'ess';

-- 8. Role ------------------------------------------------------------------------------
INSERT INTO iam.roles (code, name, description, is_system, is_active) VALUES
  ('spa_frontdesk', 'Resepsionis Spa', 'Front office spa: booking, penugasan terapis, checkout ke kasir', false, true),
  ('spa_therapist', 'Terapis Spa', 'Terapis: melihat dan menjalankan tugas treatment sendiri', false, true)
ON CONFLICT (code) DO NOTHING;

-- Admin: semua menu spa.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code IN ('spa', 'spa.bookings', 'spa.book-order', 'spa.treatments', 'spa.therapists',
                 'spa.commissions', 'spa.outlets', 'ess.spa')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- Resepsionis: booking + book order (+ kasir POS dan area karyawan).
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'spa_frontdesk'
  AND (m.code IN ('spa', 'spa.bookings', 'spa.book-order')
       OR m.code IN (SELECT m2.code FROM iam.role_menu_permissions rmp
                       JOIN iam.roles r2 ON r2.id = rmp.role_id
                       JOIN iam.menus m2 ON m2.id = rmp.menu_id
                      WHERE r2.code = 'pos' AND rmp.is_active)
       OR (m.code LIKE 'ess%' AND m.code <> 'ess.spa'))
ON CONFLICT (role_id, menu_id) DO NOTHING;

-- Terapis: area karyawan + tugas terapis.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'spa_therapist' AND m.code LIKE 'ess%' AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO NOTHING;
