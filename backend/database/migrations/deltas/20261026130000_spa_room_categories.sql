-- Category is independent of tariff/capacity. Existing room tariffs and
-- booking price snapshots are unchanged; classify legacy Private/VIP rooms
-- explicitly in the room master instead of guessing from names or prices.
ALTER TABLE spa.rooms
  ADD COLUMN category text NOT NULL DEFAULT 'public'
  CONSTRAINT spa_rooms_category_check CHECK (category IN ('public', 'private'));
