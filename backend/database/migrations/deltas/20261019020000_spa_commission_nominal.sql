-- Persentase lama diubah menjadi rupiah berdasarkan harga outlet yang berlaku sekarang.
-- Komisi pada item booking yang sudah selesai tetap tersimpan seperti semula.
UPDATE spa.commission_rules r
SET commission_type = 'fixed',
    value = round(coalesce((SELECT p.price_idr
                            FROM spa.variant_outlet_prices p
                            WHERE p.variant_id = r.variant_id AND p.branch_id = r.branch_id), v.price_idr)
                  * r.value / 100),
    updated_at = now()
FROM spa.treatment_variants v
WHERE r.variant_id = v.id AND r.branch_id IS NOT NULL
  AND r.is_active AND r.commission_type = 'percent';
