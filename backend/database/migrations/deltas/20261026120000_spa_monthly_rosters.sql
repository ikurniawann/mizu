-- Daily overrides preserve weekly patterns and historical attendance snapshots.
CREATE TABLE IF NOT EXISTS hris.employee_shift_dates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
 work_date date NOT NULL,
 shift_id uuid REFERENCES hris.shifts(id),
 created_by_name text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(employee_id, work_date)
);
CREATE OR REPLACE VIEW hris.effective_employee_shifts AS
 SELECT id,employee_id,day_of_week,shift_id,effective_from,effective_to,created_by_name,created_at FROM hris.employee_shifts
 UNION ALL
 SELECT id,employee_id,extract(isodow FROM work_date)::int,shift_id,work_date,work_date,created_by_name,created_at FROM hris.employee_shift_dates;
ALTER TABLE spa.day_off_quotas ADD COLUMN IF NOT EXISTS min_per_week int NOT NULL DEFAULT 0 CHECK (min_per_week BETWEEN 0 AND 7);
ALTER TABLE spa.day_off_quotas ADD CONSTRAINT day_off_min_max CHECK (min_per_week <= max_per_week);
ALTER TABLE spa.therapist_assists ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE spa.therapist_assists ADD COLUMN IF NOT EXISTS ends_at timestamptz;
ALTER TABLE spa.therapist_assists ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE spa.therapist_assists ADD COLUMN IF NOT EXISTS cancelled_by uuid;
UPDATE spa.therapist_assists SET starts_at=start_date::timestamp AT TIME ZONE 'Asia/Jakarta', ends_at=(end_date+1)::timestamp AT TIME ZONE 'Asia/Jakarta' WHERE starts_at IS NULL;
ALTER TABLE spa.therapist_assists ADD CONSTRAINT assist_time_order CHECK (ends_at > starts_at);
-- Keep legacy date-only inserts (including seeders) working.
CREATE OR REPLACE FUNCTION spa.assist_default_times() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.starts_at := COALESCE(NEW.starts_at, NEW.start_date::timestamp AT TIME ZONE 'Asia/Jakarta');
 NEW.ends_at := COALESCE(NEW.ends_at, (NEW.end_date+1)::timestamp AT TIME ZONE 'Asia/Jakarta');
 RETURN NEW;
END $$;
CREATE TRIGGER assist_default_times BEFORE INSERT ON spa.therapist_assists FOR EACH ROW EXECUTE FUNCTION spa.assist_default_times();
CREATE INDEX IF NOT EXISTS assist_interval_lookup ON spa.therapist_assists(therapist_id,starts_at,ends_at) WHERE cancelled_at IS NULL;

ALTER TABLE spa.therapist_assists ALTER COLUMN starts_at SET NOT NULL;
ALTER TABLE spa.therapist_assists ALTER COLUMN ends_at SET NOT NULL;
-- Refuse ambiguous legacy intervals so they can be reconciled explicitly.
DO $$
DECLARE conflicting_ids text;
BEGIN
 SELECT string_agg(a.id::text || ' / ' || b.id::text, ', ')
 INTO conflicting_ids
 FROM spa.therapist_assists a JOIN spa.therapist_assists b
 ON a.therapist_id=b.therapist_id AND a.id<b.id
 AND a.starts_at<b.ends_at AND b.starts_at<a.ends_at
 WHERE a.cancelled_at IS NULL AND b.cancelled_at IS NULL;
 IF conflicting_ids IS NOT NULL THEN
  RAISE EXCEPTION 'Perbantuan lama bertumpang tindih; rekonsiliasi sebelum migrasi: %', conflicting_ids;
 END IF;
END $$;
