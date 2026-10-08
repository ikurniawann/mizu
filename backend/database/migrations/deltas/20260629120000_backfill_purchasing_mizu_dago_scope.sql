-- Backfill company_id + branch_id pada dokumen purchasing yang masih NULL
-- ke Company Mizu / Cabang Mizu Bandung (default operasional).

DO $$
DECLARE
    v_company_id uuid;
    v_branch_id uuid;
BEGIN
    SELECT c.id, b.id
    INTO v_company_id, v_branch_id
    FROM configuration.companies c
    JOIN configuration.branches b ON b.company_id = c.id
    WHERE c.code = 'MIZU'
      AND b.code = 'MIZU-BANDUNG'
      AND c.is_active = true
      AND b.is_active = true
    LIMIT 1;

    IF v_company_id IS NULL OR v_branch_id IS NULL THEN
        RAISE NOTICE 'Mizu / Mizu Bandung tidak ditemukan — skip backfill purchasing scope';
        RETURN;
    END IF;

    UPDATE purchasing.purchase_requests
    SET company_id = v_company_id,
        branch_id = v_branch_id
    WHERE company_id IS NULL
       OR branch_id IS NULL;

    UPDATE purchasing.purchase_orders
    SET company_id = v_company_id,
        branch_id = v_branch_id
    WHERE company_id IS NULL
       OR branch_id IS NULL;

    UPDATE purchasing.grn
    SET company_id = v_company_id,
        branch_id = v_branch_id
    WHERE company_id IS NULL
       OR branch_id IS NULL;
END $$;
