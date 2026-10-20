-- Revisi bot booking WhatsApp: gift voucher dibeli lewat chat. Satu baris per
-- pembelian; dibayar lewat invoice Xendit (external_id "spa-gv-<id>"), lalu
-- gift card (giftcard.gift_cards, source_type 'xendit_invoice') terbit untuk
-- outlet yang dipilih dan kodenya dikirim ke pembeli lewat WhatsApp.
CREATE TABLE IF NOT EXISTS spa.gift_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token       uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id          uuid NOT NULL REFERENCES configuration.branches(id),
  company_id         uuid NOT NULL REFERENCES configuration.companies(id),
  nominal_idr        numeric(14,2) NOT NULL CHECK (nominal_idr > 0),
  buyer_name         text NOT NULL CHECK (btrim(buyer_name) <> '' AND char_length(buyer_name) <= 120),
  buyer_phone        text NOT NULL CHECK (char_length(buyer_phone) BETWEEN 8 AND 25),
  recipient_name     text CHECK (recipient_name IS NULL OR char_length(recipient_name) <= 120),
  source             text NOT NULL DEFAULT 'whatsapp' CHECK (source IN ('whatsapp', 'public')),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired')),
  xendit_invoice_id  text,
  xendit_invoice_url text,
  invoice_expires_at timestamptz,
  gift_card_id       uuid REFERENCES giftcard.gift_cards(id),
  gift_card_code     text,
  card_expires_at    timestamptz,
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spa_gift_orders_token ON spa.gift_orders (public_token);
CREATE INDEX IF NOT EXISTS idx_spa_gift_orders_phone ON spa.gift_orders (buyer_phone, created_at DESC);

-- Mutasi saldo "isi" untuk gift card yang dibeli online merujuk ke pembelian ini.
ALTER TABLE giftcard.gift_card_ledger DROP CONSTRAINT IF EXISTS gift_card_ledger_context_type_check;
ALTER TABLE giftcard.gift_card_ledger ADD CONSTRAINT gift_card_ledger_context_type_check
  CHECK (context_type::text = ANY (ARRAY['pos_order', 'ticket_booking', 'manual', 'reload', 'xendit_invoice']::text[]));
