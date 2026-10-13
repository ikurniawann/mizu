-- Banned members (revisi R8): a banned customer account is never told it is
-- banned; the website and the WhatsApp bot simply report the schedule as
-- unavailable. Front-office bookings are unaffected (staff decision).
ALTER TABLE pos.pos_customers
  ADD COLUMN IF NOT EXISTS banned_at timestamptz,
  ADD COLUMN IF NOT EXISTS banned_reason text,
  ADD COLUMN IF NOT EXISTS banned_by uuid;
CREATE INDEX IF NOT EXISTS pos_customers_banned_phone_idx ON pos.pos_customers (phone) WHERE banned_at IS NOT NULL;
