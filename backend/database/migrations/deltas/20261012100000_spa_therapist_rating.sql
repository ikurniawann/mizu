ALTER TABLE spa.bookings
  ADD COLUMN therapist_rating smallint CHECK (therapist_rating BETWEEN 1 AND 5),
  ADD CONSTRAINT spa_bookings_rating_has_therapist CHECK (therapist_rating IS NULL OR therapist_id IS NOT NULL);
