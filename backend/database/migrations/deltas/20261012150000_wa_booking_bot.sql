-- EPIC-053: WhatsApp booking chatbot. One bot session per conversation; the
-- conversation remembers whether the bot answers it or an agent took over.
CREATE TABLE IF NOT EXISTS crm.wa_bot_sessions (
  conversation_id uuid PRIMARY KEY REFERENCES crm.wa_conversations(id) ON DELETE CASCADE,
  phone           text NOT NULL,
  step            text NOT NULL DEFAULT 'greet',
  state           jsonb NOT NULL DEFAULT '{}'::jsonb,
  misses          integer NOT NULL DEFAULT 0,
  last_customer_at timestamptz,
  last_bot_at     timestamptz,
  -- reply latency of the last bot turn (ms), for the funnel/latency report
  last_latency_ms integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crm.wa_conversations
  ADD COLUMN IF NOT EXISTS bot_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_handover_at timestamptz,
  ADD COLUMN IF NOT EXISTS bot_handover_reason text;

COMMENT ON COLUMN crm.wa_conversations.bot_active IS 'Bot menjawab percakapan ini; false setelah admin membalas (bot_handover_*) atau dimatikan';

-- Bot replies are logged as their own message type.
ALTER TABLE crm.wa_messages DROP CONSTRAINT wa_messages_type_check;
ALTER TABLE crm.wa_messages ADD CONSTRAINT wa_messages_type_check
  CHECK (message_type = ANY (ARRAY['otp','notification','chat','broadcast','system','bot']));

-- Bookings made through the bot keep their origin.
ALTER TABLE spa.bookings DROP CONSTRAINT bookings_source_check;
ALTER TABLE spa.bookings ADD CONSTRAINT bookings_source_check
  CHECK (source IN ('front_office', 'public', 'whatsapp'));

-- Bot settings live with the CS settings (crm_settings values are jsonb).
INSERT INTO crm.crm_settings (key, value) VALUES
  ('bot_enabled', 'false'::jsonb),
  ('bot_name', '"Mizu Assistant"'::jsonb),
  ('bot_greeting', '"Halo! Saya asisten booking Mizu. Saya bantu pilih outlet, treatment dan jamnya ya 🙏"'::jsonb),
  ('bot_handover_keywords', '"admin, cs, manusia, operator"'::jsonb)
ON CONFLICT (key) DO NOTHING;
