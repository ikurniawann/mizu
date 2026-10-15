-- Paddy Experience custom case designer: a customizable treatment ("Custom
-- Case") takes a case design per booking item — phone brand/model, layout,
-- stickers per slot, background and an optional name + font. The design is
-- a normalized snapshot (codes plus display names and images) validated by
-- the API against the embedded catalog (spa/catalog/experience.json), so
-- later catalog edits keep history readable. NULL = no design (yet): staff
-- and WhatsApp bookings let the crew fill it in store.
ALTER TABLE spa.treatments
  ADD COLUMN IF NOT EXISTS customizable boolean NOT NULL DEFAULT false;

ALTER TABLE spa.booking_items
  ADD COLUMN IF NOT EXISTS design jsonb;

ALTER TABLE spa.booking_items DROP CONSTRAINT IF EXISTS spa_booking_items_design_object;
ALTER TABLE spa.booking_items
  ADD CONSTRAINT spa_booking_items_design_object CHECK (design IS NULL OR jsonb_typeof(design) = 'object');
