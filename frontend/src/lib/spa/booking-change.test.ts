import { describe, expect, it } from "vitest";
import { canChangePublicBooking } from "./booking-change";

const now = Date.parse("2026-10-08T02:00:00Z");
const open = { status: "unassigned", payment_status: "unpaid", pos_order_id: null, scheduled_at: "2026-10-09T02:00:00Z" };

describe("public booking self-service policy", () => {
  it("allows a change at the 24-hour boundary", () => {
    expect(canChangePublicBooking(open, now)).toBe(true);
  });
  it("refuses late, paid, cancelled and checked-out bookings", () => {
    expect(canChangePublicBooking({ ...open, scheduled_at: "2026-10-09T01:59:59Z" }, now)).toBe(false);
    expect(canChangePublicBooking({ ...open, payment_status: "paid" }, now)).toBe(false);
    expect(canChangePublicBooking({ ...open, status: "cancelled" }, now)).toBe(false);
    expect(canChangePublicBooking({ ...open, pos_order_id: "order" }, now)).toBe(false);
  });
});
