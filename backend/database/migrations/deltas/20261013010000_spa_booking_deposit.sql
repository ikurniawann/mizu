-- Deposit (DP) for online bookings: a website/chat booking holds its slot
-- only while the deposit is pending within the hold window; once paid the
-- remainder is settled at the outlet (the POS bill is reduced by the DP).
ALTER TABLE spa.bookings
  ADD COLUMN IF NOT EXISTS deposit_idr numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'none'
    CONSTRAINT spa_bookings_deposit_status_check CHECK (deposit_status IN ('none', 'pending', 'paid', 'waived', 'expired')),
  ADD COLUMN IF NOT EXISTS deposit_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_hold_until timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_invoice_id text,
  ADD COLUMN IF NOT EXISTS deposit_invoice_url text,
  ADD COLUMN IF NOT EXISTS deposit_invoice_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_note text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_spa_bookings_deposit_hold ON spa.bookings (deposit_hold_until)
  WHERE deposit_status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS spa_bookings_deposit_invoice_uidx ON spa.bookings (deposit_invoice_id)
  WHERE deposit_invoice_id IS NOT NULL;

COMMENT ON COLUMN spa.bookings.deposit_status IS 'none = tanpa DP (FO); pending = menunggu DP; paid = DP diterima; waived = dibebaskan FO; expired = DP tidak dibayar, booking dibatalkan';
COMMENT ON COLUMN spa.bookings.deposit_hold_until IS 'Batas waktu DP; lewat ini booking pending dibatalkan dan slot dilepas';

INSERT INTO configuration.app_settings (key, value) VALUES
  ('spa_deposit_idr', '100000'),
  ('spa_deposit_hold_minutes', '60')
ON CONFLICT (key) DO NOTHING;
