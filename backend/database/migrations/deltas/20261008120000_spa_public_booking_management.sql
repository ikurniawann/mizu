-- One-time phone verification for changes to public spa bookings.
CREATE TABLE IF NOT EXISTS spa.public_booking_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES spa.bookings(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  grant_hash text,
  grant_expires_at timestamptz,
  grant_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spa_public_booking_challenges_booking
  ON spa.public_booking_challenges (booking_id, created_at DESC);

-- Anonymous funnel events contain no contact details or booking token.
CREATE TABLE IF NOT EXISTS spa.public_booking_funnel_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL,
  step text NOT NULL CHECK (step IN ('open', 'outlet', 'treatment', 'time', 'contact', 'submit', 'success', 'error')),
  branch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_spa_public_funnel_session_step UNIQUE (session_id, step)
);
CREATE INDEX IF NOT EXISTS idx_spa_public_funnel_created
  ON spa.public_booking_funnel_events (created_at, step);
