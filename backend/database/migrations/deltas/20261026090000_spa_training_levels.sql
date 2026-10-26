-- Training per periode; level mengikuti kelulusan dalam siklus kerja saat ini.
ALTER TABLE spa.therapists
  ADD COLUMN level smallint NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 2),
  ADD COLUMN employment_cycle integer NOT NULL DEFAULT 1 CHECK (employment_cycle > 0),
  ADD COLUMN rehire_pending boolean NOT NULL DEFAULT false;

CREATE TABLE spa.trainings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 150),
  topic_code text NOT NULL CHECK (length(btrim(topic_code)) BETWEEN 1 AND 80),
  period text NOT NULL CHECK (length(btrim(period)) BETWEEN 1 AND 80),
  training_date date NOT NULL,
  trainer_name text NOT NULL CHECK (length(btrim(trainer_name)) BETWEEN 1 AND 150),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_code, period)
);
CREATE TABLE spa.training_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id uuid NOT NULL REFERENCES spa.trainings(id),
  therapist_id uuid NOT NULL REFERENCES spa.therapists(id),
  employment_cycle integer NOT NULL CHECK (employment_cycle > 0),
  status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','pending','passed','failed','cancelled')),
  notes text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX spa_training_no_repeat ON spa.training_participants(training_id, therapist_id)
  WHERE status IN ('enrolled','pending','passed');
CREATE INDEX spa_training_participant_history ON spa.training_participants(therapist_id, employment_cycle);
CREATE TABLE spa.level_requirements (
  target_level smallint NOT NULL CHECK (target_level IN (1,2)),
  training_id uuid NOT NULL REFERENCES spa.trainings(id),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_level, training_id)
);
CREATE TABLE spa.therapist_level_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES spa.therapists(id),
  employment_cycle integer NOT NULL,
  from_level smallint NOT NULL,
  to_level smallint NOT NULL,
  reason text NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spa_level_history_therapist ON spa.therapist_level_history(therapist_id, created_at);

-- Shared by approvals, requirement edits and HRIS reactivation.
CREATE OR REPLACE FUNCTION spa.promote_therapist(therapist uuid, actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE t record; target integer; eligible boolean;
BEGIN
  SELECT * INTO t FROM spa.therapists WHERE id=therapist FOR UPDATE;
  IF NOT FOUND OR NOT t.is_active OR t.rehire_pending THEN RETURN; END IF;
  FOR target IN 1..2 LOOP
    IF t.level >= target THEN CONTINUE; END IF;
    SELECT EXISTS(SELECT 1 FROM spa.level_requirements WHERE target_level=target)
      AND NOT EXISTS(SELECT 1 FROM spa.level_requirements req WHERE req.target_level=target
        AND NOT EXISTS(SELECT 1 FROM spa.training_participants p
          WHERE p.training_id=req.training_id AND p.therapist_id=t.id
            AND p.employment_cycle=t.employment_cycle AND p.status='passed')) INTO eligible;
    IF t.level<>target-1 OR NOT eligible THEN EXIT; END IF;
    UPDATE spa.therapists SET level=target,updated_at=now() WHERE id=t.id;
    INSERT INTO spa.therapist_level_history(therapist_id,employment_cycle,from_level,to_level,reason,changed_by)
      VALUES(t.id,t.employment_cycle,t.level,target,'Syarat training terpenuhi',actor);
    t.level:=target;
  END LOOP;
END $$;

-- Employee writes also arrive from the legacy Next.js API and offboarding.
-- Keep the employment boundary atomic for every writer, not just Spa handlers.
CREATE OR REPLACE FUNCTION spa.employee_training_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t record;
BEGIN
  IF NEW.employment_status = 'resigned' THEN
    NEW.is_active := false;
    UPDATE spa.therapists SET is_active=false, rehire_pending=true, updated_at=now() WHERE employee_id=NEW.id;
    UPDATE spa.training_participants p SET status='cancelled', notes='Dibatalkan karena resign', updated_at=now()
      FROM spa.therapists th WHERE p.therapist_id=th.id AND th.employee_id=NEW.id AND p.status IN ('enrolled','pending');
  ELSE
    SELECT * INTO t FROM spa.therapists WHERE employee_id=NEW.id FOR UPDATE;
    IF FOUND AND t.rehire_pending AND COALESCE(NEW.is_active,true) THEN
      UPDATE spa.therapists SET level=0, employment_cycle=employment_cycle+1, rehire_pending=false,
        is_active=true, updated_at=now() WHERE id=t.id;
      INSERT INTO spa.therapist_level_history(therapist_id, employment_cycle, from_level, to_level, reason)
        VALUES(t.id,t.employment_cycle+1,t.level,0,'Masuk kembali setelah resign');
    ELSIF FOUND AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      UPDATE spa.therapists SET is_active=COALESCE(NEW.is_active,true), updated_at=now() WHERE id=t.id;
      IF COALESCE(NEW.is_active,true) THEN PERFORM spa.promote_therapist(t.id); END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER spa_employee_training_lifecycle BEFORE UPDATE OF employment_status,is_active ON hris.employees
  FOR EACH ROW EXECUTE FUNCTION spa.employee_training_lifecycle();

-- Existing resigned records must participate in the same rehire boundary.
UPDATE spa.therapists t SET is_active=false, rehire_pending=true
  FROM hris.employees e WHERE e.id=t.employee_id AND e.employment_status='resigned';
UPDATE hris.employees SET is_active=false WHERE employment_status='resigned' AND is_active IS DISTINCT FROM false;
INSERT INTO hris.employment_statuses(code,name,color,description)
  VALUES('resigned','Resign','gray','Hubungan kerja berakhir; terpisah dari status aktif/nonaktif.')
  ON CONFLICT(code) DO UPDATE SET is_active=true;

INSERT INTO iam.menus(parent_id,code,menu_name,route_path,module,menu_type,icon,level,order_number,permission_context)
SELECT id,'spa.training','Training','/dashboard/spa/training','spa','sidebar','academic-cap',2,45,
  '{"actions":["read","create","update"]}'::jsonb FROM iam.menus WHERE code='spa'
ON CONFLICT(code) DO UPDATE SET parent_id=EXCLUDED.parent_id,route_path=EXCLUDED.route_path,
  permission_context=EXCLUDED.permission_context,is_active=true,is_visible=true,deleted_at=NULL;
INSERT INTO iam.role_menu_permissions(role_id,menu_id,granted_actions)
SELECT p.role_id,m.id,p.granted_actions FROM iam.role_menu_permissions p
JOIN iam.menus source ON source.id=p.menu_id AND source.code='spa.therapists'
JOIN iam.menus m ON m.code='spa.training' WHERE p.is_active
ON CONFLICT(role_id,menu_id) DO NOTHING;
INSERT INTO iam.menus(parent_id,code,menu_name,route_path,module,menu_type,icon,level,order_number,permission_context)
SELECT id,'ess.training','Training Saya','/dashboard/me/training','ess','sidebar','academic-cap',2,7,
  '{"actions":["read"]}'::jsonb FROM iam.menus WHERE code='ess'
ON CONFLICT(code) DO UPDATE SET parent_id=EXCLUDED.parent_id,route_path=EXCLUDED.route_path,
  is_active=true,is_visible=true,deleted_at=NULL;
INSERT INTO iam.role_menu_permissions(role_id,menu_id,granted_actions)
SELECT p.role_id,m.id,'["read"]'::jsonb FROM iam.role_menu_permissions p
JOIN iam.menus source ON source.id=p.menu_id AND source.code='ess.spa'
JOIN iam.menus m ON m.code='ess.training' WHERE p.is_active
ON CONFLICT(role_id,menu_id) DO NOTHING;
