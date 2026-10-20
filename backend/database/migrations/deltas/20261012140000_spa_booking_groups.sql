-- Several individual spa visits may be settled on one POS bill.
CREATE TABLE IF NOT EXISTS spa.booking_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  payer_customer_id uuid REFERENCES pos.pos_customers(id) ON DELETE SET NULL,
  payer_name text NOT NULL CHECK (btrim(payer_name) <> ''),
  payer_phone text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE spa.bookings ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES spa.booking_groups(id);
ALTER TABLE spa.bookings ADD COLUMN IF NOT EXISTS group_position integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_spa_bookings_group ON spa.bookings (group_id) WHERE group_id IS NOT NULL;
