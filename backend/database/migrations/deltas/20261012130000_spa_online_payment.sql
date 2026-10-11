-- Online payment for public spa bookings (Xendit invoice). A booking pays
-- either at the outlet (POS checkout, unchanged) or online before the visit;
-- an online payment settles the booking without a POS order.
ALTER TABLE spa.bookings
  ADD COLUMN payment_method text NOT NULL DEFAULT 'outlet'
    CONSTRAINT spa_bookings_payment_method_check CHECK (payment_method IN ('outlet', 'online')),
  ADD COLUMN xendit_invoice_id text,
  ADD COLUMN xendit_invoice_url text,
  ADD COLUMN invoice_amount_idr numeric(14, 2),
  ADD COLUMN invoice_expires_at timestamptz,
  ADD COLUMN paid_online_at timestamptz;

CREATE UNIQUE INDEX spa_bookings_xendit_invoice_uidx ON spa.bookings (xendit_invoice_id)
  WHERE xendit_invoice_id IS NOT NULL;

COMMENT ON COLUMN spa.bookings.payment_method IS 'outlet = bayar di outlet (POS); online = invoice Xendit sebelum kunjungan';
COMMENT ON COLUMN spa.bookings.invoice_amount_idr IS 'Nominal yang ditagihkan di invoice Xendit; dicocokkan dengan callback PAID';
