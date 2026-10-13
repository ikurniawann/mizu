-- Therapist day-off booking (revisi R5): therapists book their weekly days
-- off from the therapist app; HRD sets per outlet the minimum number of
-- female and male therapists that must work each day and the weekly limit.
-- A request is approved on the spot (first come, first served) or refused
-- when it would break the quota.
CREATE TABLE IF NOT EXISTS spa.day_off_quotas (
  branch_id    uuid PRIMARY KEY REFERENCES configuration.branches(id) ON DELETE CASCADE,
  min_female   int NOT NULL DEFAULT 0 CHECK (min_female BETWEEN 0 AND 100),
  min_male     int NOT NULL DEFAULT 0 CHECK (min_male BETWEEN 0 AND 100),
  max_per_week int NOT NULL DEFAULT 2 CHECK (max_per_week BETWEEN 0 AND 7),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid
);
CREATE TABLE IF NOT EXISTS spa.day_off_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id  uuid NOT NULL REFERENCES spa.therapists(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES configuration.branches(id) ON DELETE CASCADE,
  off_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  cancelled_at  timestamptz,
  cancelled_by  uuid,
  cancel_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS spa_day_off_one_per_day ON spa.day_off_requests (therapist_id, off_date) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS spa_day_off_branch_date ON spa.day_off_requests (branch_id, off_date) WHERE status = 'approved';
