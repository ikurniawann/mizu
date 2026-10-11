-- Booking is the assignment owner. Item therapist_id remains a read-only
-- projection for existing reports, and preserves historical completed work.
LOCK TABLE spa.bookings, spa.booking_items IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE conflicts text;
BEGIN
  SELECT string_agg(booking_code, ', ') INTO conflicts FROM (
    SELECT b.booking_code
    FROM spa.bookings b JOIN spa.booking_items i ON i.booking_id = b.id
    WHERE b.status NOT IN ('completed', 'cancelled', 'expired') AND i.status <> 'cancelled'
    GROUP BY b.id
    HAVING count(DISTINCT i.therapist_id) > 1
      OR (count(i.therapist_id) > 0 AND count(i.therapist_id) < count(*))
    ORDER BY b.booking_code LIMIT 20
  ) ambiguous;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Resolve mixed/partial therapist assignments before migration: %', conflicts;
  END IF;
END $$;

ALTER TABLE spa.bookings ADD COLUMN therapist_id uuid REFERENCES spa.therapists(id);
CREATE INDEX idx_spa_bookings_therapist_time ON spa.bookings (therapist_id, scheduled_at)
  WHERE therapist_id IS NOT NULL;

UPDATE spa.bookings b SET therapist_id = x.therapist_id::uuid
FROM (
  SELECT booking_id, min(therapist_id::text) AS therapist_id
  FROM spa.booking_items WHERE status <> 'cancelled'
  GROUP BY booking_id HAVING count(DISTINCT therapist_id) = 1
) x WHERE x.booking_id = b.id;

CREATE FUNCTION spa.inherit_booking_therapist() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
    RAISE EXCEPTION 'Treatment cannot be moved to another booking';
  END IF;
  SELECT therapist_id INTO owner_id FROM spa.bookings WHERE id = NEW.booking_id FOR UPDATE;
  -- Completed/cancelled rows retain their historical performer. They cannot
  -- be used to introduce a new, independently assigned treatment.
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND NEW.status <> 'completed' THEN
    RAISE EXCEPTION 'Completed treatment cannot be reopened';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('completed', 'cancelled') AND NEW.status = OLD.status THEN
    IF NEW.therapist_id IS DISTINCT FROM OLD.therapist_id THEN
      RAISE EXCEPTION 'Historical treatment therapist cannot be changed';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.therapist_id IS NOT NULL AND NEW.therapist_id IS DISTINCT FROM owner_id THEN
    RAISE EXCEPTION 'Assign the therapist on the booking, not its treatment';
  END IF;
  NEW.therapist_id := owner_id;
  IF NEW.status IN ('unassigned', 'assigned') THEN
    NEW.status := CASE WHEN owner_id IS NULL THEN 'unassigned' ELSE 'assigned' END;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER spa_items_inherit_therapist BEFORE INSERT OR UPDATE OF therapist_id, status, booking_id
  ON spa.booking_items FOR EACH ROW EXECUTE FUNCTION spa.inherit_booking_therapist();

CREATE FUNCTION spa.propagate_booking_therapist() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.therapist_id IS NOT DISTINCT FROM OLD.therapist_id THEN RETURN NEW; END IF;
  IF OLD.status IN ('completed', 'cancelled', 'expired') OR EXISTS (
    SELECT 1 FROM spa.booking_items WHERE booking_id = NEW.id AND status IN ('in_treatment', 'completed')
  ) THEN
    RAISE EXCEPTION 'Booking assignment is locked after treatment starts';
  END IF;
  UPDATE spa.booking_items SET therapist_id = NEW.therapist_id,
    status = CASE WHEN NEW.therapist_id IS NULL THEN 'unassigned' ELSE 'assigned' END,
    updated_at = now()
  WHERE booking_id = NEW.id AND status IN ('unassigned', 'assigned');
  RETURN NEW;
END $$;

CREATE TRIGGER spa_booking_propagate_therapist AFTER UPDATE OF therapist_id ON spa.bookings
  FOR EACH ROW EXECUTE FUNCTION spa.propagate_booking_therapist();
