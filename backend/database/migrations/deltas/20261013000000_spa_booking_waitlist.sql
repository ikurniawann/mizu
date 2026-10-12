-- EPIC-053 Fase 3: daftar tunggu. Ketika hari/jam yang diminta penuh, bot
-- (atau FO) mencatat keinginan tamu; pengawas bot mengecek ulang
-- ketersediaan dan mengabari lewat WhatsApp begitu ada jam kosong.
CREATE TABLE IF NOT EXISTS spa.booking_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL CHECK (btrim(customer_phone) <> ''),
  conversation_id uuid REFERENCES crm.wa_conversations(id) ON DELETE SET NULL,
  visit_date date NOT NULL,
  period text NOT NULL DEFAULT '' CHECK (period IN ('', 'pagi', 'siang', 'sore', 'malam')),
  people integer NOT NULL DEFAULT 1 CHECK (people BETWEEN 1 AND 10),
  variant_ids uuid[] NOT NULL DEFAULT '{}',
  variant_labels text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'whatsapp' CHECK (source IN ('whatsapp', 'front_office', 'public')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'notified', 'booked', 'cancelled', 'expired')),
  note text NOT NULL DEFAULT '',
  notified_at timestamptz,
  resolved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spa_booking_waitlist_open ON spa.booking_waitlist (visit_date, branch_id)
  WHERE status IN ('open', 'notified');
CREATE INDEX IF NOT EXISTS idx_spa_booking_waitlist_phone ON spa.booking_waitlist (customer_phone, created_at DESC);

COMMENT ON TABLE spa.booking_waitlist IS 'Daftar tunggu booking spa: tamu yang ingin dikabari saat jam kosong (EPIC-053)';
COMMENT ON COLUMN spa.booking_waitlist.status IS 'open = menunggu; notified = sudah dikabari ada jam; booked = jadi booking; cancelled; expired = tanggal lewat';
