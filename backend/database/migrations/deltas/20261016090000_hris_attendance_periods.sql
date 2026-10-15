-- =============================================================================
-- Closing periode absensi + penyesuaian manual HRD.
--
-- hris.attendance_settings (satu baris): cut-off periode absensi.
--   cutoff_day = 0  → periode = bulan kalender (1 s.d. akhir bulan) — default,
--                     sama dengan perilaku sebelumnya.
--   cutoff_day = N  → periode bulan M = tanggal N+1 bulan M-1 s.d. tanggal N bulan M
--                     (mis. 20 → 21 Sep – 20 Okt untuk periode Oktober).
--   closing_offset_days = tanggal closing otomatis = akhir periode + N hari.
--
-- hris.attendance_periods: periode yang sudah "dimaterialisasi" (dibuat saat
--   dibuka di halaman, saat closing, atau saat absensi di periode itu disentuh).
--   period_year/period_month = bulan tempat periode BERAKHIR (bulan payroll).
--   Selama belum pernah di-closing, rentang tanggal & tanggal closing mengikuti
--   pengaturan; begitu pernah di-closing (range_frozen) rentangnya tetap walau
--   pengaturan cut-off diubah. Periode yang tanggal closing-nya sudah lewat
--   dianggap tertutup (ditandai close_mode = 'auto' oleh "Sistem" saat pertama
--   kali disentuh aplikasi).
--
-- hris.attendance_period_events: riwayat closing / closing otomatis / buka ulang /
--   ubah tanggal closing (selain jejak di audit.audit_log).
--
-- hris.attendance_adjustments: setiap tambah/ubah/hapus absensi oleh HRD wajib
--   beralasan; before/after disimpan di sini (tetap ada walau baris absensinya
--   dihapus). hris.attendance diberi penanda is_manual/adjusted_*.
--
-- Trigger hris.attendance_closed_period_guard menolak INSERT/UPDATE/DELETE absensi
-- yang tanggalnya ada di periode berstatus closed (lapisan terakhir; aplikasi
-- sudah menolak lebih dulu dengan pesan yang jelas). Penghapusan berantai
-- (karyawan dihapus) tidak dihalangi. Seeder/ops bisa melewati dengan
-- SET LOCAL hris.allow_closed_period_write = 'on'.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Pengaturan ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hris.attendance_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  cutoff_day          smallint NOT NULL DEFAULT 0 CHECK (cutoff_day BETWEEN 0 AND 28),
  closing_offset_days smallint NOT NULL DEFAULT 3 CHECK (closing_offset_days BETWEEN 0 AND 31),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  updated_by_name     text
);

INSERT INTO hris.attendance_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE hris.attendance_settings IS
  'Pengaturan periode absensi (satu baris): cutoff_day 0 = bulan kalender, N = tgl N+1 bulan lalu s.d. tgl N; closing_offset_days = closing otomatis N hari setelah akhir periode.';

-- ── Periode ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hris.attendance_periods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year         integer  NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  period_month        smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  closing_date        date NOT NULL,
  closing_date_custom boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  range_frozen        boolean NOT NULL DEFAULT false,
  closed_at           timestamptz,
  closed_by           uuid,
  closed_by_name      text,
  close_mode          text CHECK (close_mode IN ('manual', 'auto')),
  close_summary       jsonb,
  reopened_at         timestamptz,
  reopened_by         uuid,
  reopened_by_name    text,
  reopen_reason       text,
  reopen_count        integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_periods_month_unique UNIQUE (period_year, period_month),
  CONSTRAINT attendance_periods_dates_check CHECK (end_date >= start_date AND closing_date >= end_date),
  CONSTRAINT attendance_periods_closed_check CHECK (status = 'open' OR closed_at IS NOT NULL),
  CONSTRAINT attendance_periods_no_overlap EXCLUDE USING gist (
    daterange(start_date, end_date, '[]') WITH &&
  ) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_attendance_periods_closed
  ON hris.attendance_periods (start_date, end_date) WHERE status = 'closed';

DROP TRIGGER IF EXISTS attendance_periods_updated_at ON hris.attendance_periods;
CREATE TRIGGER attendance_periods_updated_at BEFORE UPDATE ON hris.attendance_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_hris_updated_at();

COMMENT ON TABLE hris.attendance_periods IS
  'Periode absensi (bulan payroll) dengan status closing; closed = absensi di rentang tanggalnya terkunci.';

CREATE TABLE IF NOT EXISTS hris.attendance_period_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id  uuid NOT NULL REFERENCES hris.attendance_periods(id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('close', 'auto_close', 'reopen', 'closing_date')),
  actor_id   uuid,
  actor_name text,
  reason     text,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_period_events_period
  ON hris.attendance_period_events (period_id, created_at);

-- ── Penyesuaian manual ───────────────────────────────────────────────────────
ALTER TABLE hris.attendance
  ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS adjusted_at timestamptz,
  ADD COLUMN IF NOT EXISTS adjusted_by uuid,
  ADD COLUMN IF NOT EXISTS adjusted_by_name text,
  ADD COLUMN IF NOT EXISTS adjustment_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN hris.attendance.is_manual IS
  'true = baris dibuat manual oleh HRD (bukan clock-in karyawan).';
COMMENT ON COLUMN hris.attendance.adjusted_at IS
  'Waktu penyesuaian manual terakhir oleh HRD; riwayat di hris.attendance_adjustments.';

CREATE TABLE IF NOT EXISTS hris.attendance_adjustments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id  uuid NOT NULL,
  employee_id    uuid NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
  date           date NOT NULL,
  action         text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  reason         text NOT NULL CHECK (length(btrim(reason)) > 0),
  changed_fields text[] NOT NULL DEFAULT '{}',
  before         jsonb,
  after          jsonb,
  actor_id       uuid,
  actor_name     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_attendance
  ON hris.attendance_adjustments (attendance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_employee_date
  ON hris.attendance_adjustments (employee_id, date);

COMMENT ON TABLE hris.attendance_adjustments IS
  'Log penyesuaian manual absensi oleh HRD (alasan wajib, before/after).';

-- ── Penjaga periode tertutup ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hris.attendance_closed_period_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  d date;
  p record;
BEGIN
  -- Penghapusan berantai (FK ON DELETE CASCADE / SET NULL) tidak dihalangi.
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF COALESCE(current_setting('hris.allow_closed_period_write', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  FOREACH d IN ARRAY (
    CASE TG_OP
      WHEN 'INSERT' THEN ARRAY[NEW.date]
      WHEN 'DELETE' THEN ARRAY[OLD.date]
      ELSE ARRAY[OLD.date, NEW.date]
    END
  ) LOOP
    SELECT start_date, end_date INTO p
      FROM hris.attendance_periods
     WHERE status = 'closed' AND d BETWEEN start_date AND end_date
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Periode absensi % s.d. % sudah di-closing',
        to_char(p.start_date, 'DD-MM-YYYY'), to_char(p.end_date, 'DD-MM-YYYY')
        USING ERRCODE = 'P0001', HINT = 'attendance_period_closed';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS attendance_closed_period_guard ON hris.attendance;
CREATE TRIGGER attendance_closed_period_guard
  BEFORE INSERT OR UPDATE OR DELETE ON hris.attendance
  FOR EACH ROW EXECUTE FUNCTION hris.attendance_closed_period_guard();
