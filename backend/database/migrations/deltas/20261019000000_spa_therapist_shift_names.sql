-- Nama shift spa mengikuti dua jam kerja yang sudah dipakai terapis.
-- Batasi pada pasangan nama dan jam spa agar shift HRIS umum tidak ikut berubah.
UPDATE hris.shifts
SET name = 'Shift Siang'
WHERE name IN ('Shift Pagi', 'Spa Pagi')
  AND start_time = '09:00'::time AND end_time = '17:00'::time;

UPDATE hris.shifts
SET name = 'Shift Malam'
WHERE name IN ('Shift Siang', 'Spa Siang')
  AND start_time = '13:00'::time AND end_time = '22:00'::time;
