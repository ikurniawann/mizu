-- Rooms (revisi R6/R9): each outlet has rooms with a price; a booking may
-- occupy one room for its window, the board shows who is in which room and
-- the timer counts the running treatment down.
CREATE TABLE IF NOT EXISTS spa.rooms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES configuration.branches(id) ON DELETE CASCADE,
  name        text NOT NULL,
  capacity    int  NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 10),
  price_idr   numeric(14, 2) NOT NULL DEFAULT 0 CHECK (price_idr >= 0),
  description text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spa_rooms_branch_name_key UNIQUE (branch_id, name)
);
ALTER TABLE spa.bookings
  ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES spa.rooms(id),
  ADD COLUMN IF NOT EXISTS room_price_idr numeric(14, 2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS spa_bookings_room_window_idx ON spa.bookings (room_id, scheduled_at, ends_at) WHERE room_id IS NOT NULL;
