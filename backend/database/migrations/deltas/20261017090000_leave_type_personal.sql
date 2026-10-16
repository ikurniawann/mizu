-- =============================================================================
-- Tipe cuti "personal" (Izin Pribadi) — EPIC-055.
--
-- Odoo memotong gaji untuk Izin Pribadi (rule PIP), tidak untuk Cuti Menikah;
-- keduanya selama ini sama-sama "emergency". File terpisah: nilai enum baru
-- baru bisa dipakai setelah transaksi yang menambahkannya selesai.
-- =============================================================================

ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'personal';
