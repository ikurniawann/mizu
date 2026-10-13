-- Therapist payroll (revisi R1): two pay types (fixed salary + commission, or
-- commission only) and two paydays a month — commission for days 1..cutoff on
-- the commission day (default 15th), salary plus the rest of the month's
-- commission on the salary day (default 30th). Each commission item is paid
-- exactly once (pay_commission_items.item_id is unique).
ALTER TABLE spa.therapists
  ADD COLUMN IF NOT EXISTS pay_type text NOT NULL DEFAULT 'salary_commission'
    CONSTRAINT spa_therapists_pay_type_check CHECK (pay_type IN ('salary_commission', 'commission_only'));

CREATE TABLE IF NOT EXISTS spa.pay_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month text NOT NULL CHECK (period_month ~ '^\d{4}-\d{2}$'),
  kind         text NOT NULL CHECK (kind IN ('commission', 'regular')),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  pay_date     date NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  total_idr    numeric(14, 2) NOT NULL DEFAULT 0,
  notes        text NOT NULL DEFAULT '',
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  approved_by  uuid,
  approved_at  timestamptz,
  paid_by      uuid,
  paid_at      timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spa_pay_runs_period_kind_key UNIQUE (period_month, kind)
);

CREATE TABLE IF NOT EXISTS spa.pay_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES spa.pay_runs(id) ON DELETE CASCADE,
  therapist_id     uuid NOT NULL REFERENCES spa.therapists(id),
  pay_type         text NOT NULL,
  base_salary_idr  numeric(14, 2) NOT NULL DEFAULT 0,
  allowance_idr    numeric(14, 2) NOT NULL DEFAULT 0,
  commission_idr   numeric(14, 2) NOT NULL DEFAULT 0,
  commission_count int NOT NULL DEFAULT 0,
  bonus_idr        numeric(14, 2) NOT NULL DEFAULT 0,
  deduction_idr    numeric(14, 2) NOT NULL DEFAULT 0,
  total_idr        numeric(14, 2) NOT NULL DEFAULT 0,
  note             text NOT NULL DEFAULT '',
  CONSTRAINT spa_pay_lines_run_therapist_key UNIQUE (run_id, therapist_id)
);

CREATE TABLE IF NOT EXISTS spa.pay_commission_items (
  run_id         uuid NOT NULL REFERENCES spa.pay_runs(id) ON DELETE CASCADE,
  line_id        uuid NOT NULL REFERENCES spa.pay_lines(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES spa.booking_items(id),
  commission_idr numeric(14, 2) NOT NULL DEFAULT 0,
  CONSTRAINT spa_pay_commission_items_item_key UNIQUE (item_id)
);

INSERT INTO configuration.app_settings (key, value) VALUES ('spa_pay_commission_day', '15'), ('spa_pay_salary_day', '30')
ON CONFLICT (key) DO NOTHING;
