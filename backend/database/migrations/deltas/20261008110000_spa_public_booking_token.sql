ALTER TABLE spa.bookings
  ADD COLUMN IF NOT EXISTS public_token uuid DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS uq_spa_bookings_public_token
  ON spa.bookings (public_token);
