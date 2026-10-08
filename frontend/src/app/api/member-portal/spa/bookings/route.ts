import { getPool } from "@/lib/db";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";

/** Spa reservations belonging to the signed-in POS customer. */
export const GET = withMemberSession("Gagal memuat booking spa", async (customerId) => {
  const { rows } = await getPool().query(
    `SELECT b.id, b.booking_code, b.scheduled_at, b.status, b.payment_status,
            br.name AS branch_name, br.phone AS branch_phone,
            COALESCE(json_agg(json_build_object(
              'treatment_name', i.treatment_name,
              'variant_name', i.variant_name,
              'duration_min', i.duration_min,
              'price_idr', i.price_idr
            ) ORDER BY i.sort_order) FILTER (WHERE i.id IS NOT NULL AND i.status <> 'cancelled'), '[]'::json) AS items
       FROM spa.bookings b
       JOIN configuration.branches br ON br.id = b.branch_id
       LEFT JOIN spa.booking_items i ON i.booking_id = b.id
      WHERE b.customer_id = $1
      GROUP BY b.id, br.name, br.phone
      ORDER BY b.scheduled_at DESC
      LIMIT 50`,
    [customerId]
  );
  return memberJson(rows.map((row) => ({
    ...row,
    scheduled_at: new Date(row.scheduled_at).toISOString(),
  })));
});
