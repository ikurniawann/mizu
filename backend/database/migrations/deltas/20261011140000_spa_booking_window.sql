-- The visit owns its schedule. Treatments keep duration and actual progress only.
ALTER TABLE spa.bookings ADD COLUMN ends_at timestamptz;
UPDATE spa.bookings b SET ends_at = b.scheduled_at + make_interval(mins => COALESCE((
  SELECT sum(i.duration_min)::int FROM spa.booking_items i
  WHERE i.booking_id = b.id AND i.status <> 'cancelled'
), 0));
ALTER TABLE spa.bookings ALTER COLUMN ends_at SET NOT NULL;
ALTER TABLE spa.bookings ADD CONSTRAINT spa_bookings_time_ordered CHECK (ends_at >= scheduled_at);

DROP INDEX IF EXISTS spa.idx_spa_items_therapist_time;
ALTER TABLE spa.booking_items DROP CONSTRAINT spa_items_time_ordered;
ALTER TABLE spa.booking_items DROP COLUMN starts_at, DROP COLUMN ends_at, DROP COLUMN buffer_min;
ALTER TABLE spa.treatment_variants DROP COLUMN buffer_min;
