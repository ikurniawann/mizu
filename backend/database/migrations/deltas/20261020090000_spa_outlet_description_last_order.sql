-- Revisi bot booking WhatsApp: deskripsi/keunggulan outlet (menjawab "bedanya
-- Mizu 1.0 dan Mizu Signature apa?") dan jam last order per outlet (booking
-- online tidak boleh mulai setelah last order; kosong = sampai jam tutup).
ALTER TABLE spa.outlets
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_order_time time;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spa_outlets_last_order') THEN
    ALTER TABLE spa.outlets ADD CONSTRAINT spa_outlets_last_order
      CHECK (last_order_time IS NULL OR (last_order_time >= open_time AND last_order_time < close_time));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spa_outlets_description_len') THEN
    ALTER TABLE spa.outlets ADD CONSTRAINT spa_outlets_description_len CHECK (char_length(description) <= 1000);
  END IF;
END $$;
