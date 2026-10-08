import { describe, expect, it } from "vitest";
import {
  allowedItemActions,
  anyStatusLabel,
  bookingStatusBadge,
  bookingTotal,
  canAddItem,
  canCancelBooking,
  checkoutState,
  commissionValueLabel,
  computeCommission,
  eventLabel,
  isValidPhone,
  itemStatusBadge,
  normalizeMyCommissions,
  paymentStatusBadge,
  ruleScope,
  ruleSpecificity,
  sortByStart,
  sumCommission,
  activeVariantOptions,
  variantPrice,
} from "./rules";
import type { BookingItem, BookingStatus, ItemStatus, PaymentStatus } from "./types";

const item = (status: ItemStatus, price_idr = 100000): Pick<BookingItem, "status" | "price_idr"> => ({ status, price_idr });
const booking = (status: BookingStatus, payment_status: PaymentStatus = "unpaid", items = [item("assigned")]) => ({
  status,
  payment_status,
  items,
});

describe("badge status", () => {
  it("memetakan status layanan dan pembayaran secara terpisah", () => {
    expect(itemStatusBadge("in_treatment")).toEqual({ label: "Sedang treatment", variant: "accent" });
    expect(bookingStatusBadge("expired")).toEqual({ label: "Kedaluwarsa", variant: "destructive" });
    expect(bookingStatusBadge("completed").label).toBe("Selesai");
    expect(paymentStatusBadge("paid")).toEqual({ label: "Lunas", variant: "success" });
    expect(paymentStatusBadge("unpaid").label).toBe("Belum bayar");
  });
  it("status tak dikenal tidak membuat UI rusak", () => {
    expect(bookingStatusBadge("aneh")).toEqual({ label: "aneh", variant: "outline" });
    expect(itemStatusBadge(null).label).toBe("-");
  });
  it("label event", () => {
    expect(eventLabel("assign")).toBe("Terapis ditugaskan");
    expect(eventLabel("custom_thing")).toBe("custom thing");
    expect(anyStatusLabel("assigned")).toBe("Ditugaskan");
    expect(anyStatusLabel("expired")).toBe("Kedaluwarsa");
    expect(anyStatusLabel("paid")).toBe("Lunas");
    expect(anyStatusLabel(null)).toBe("—");
  });
});

describe("bookingTotal", () => {
  it("menjumlahkan item aktif saja", () => {
    expect(bookingTotal([item("assigned", 150000), item("completed", 200000), item("cancelled", 999999)])).toBe(350000);
    expect(bookingTotal([])).toBe(0);
  });
});

describe("allowedItemActions", () => {
  const open = { status: "assigned" as const, payment_status: "unpaid" as const };
  it("mengikuti mesin status item", () => {
    expect(allowedItemActions({ status: "unassigned" }, open)).toEqual(["assign", "reschedule", "cancel"]);
    expect(allowedItemActions({ status: "assigned" }, open)).toEqual(["start", "complete", "unassign", "reschedule", "cancel"]);
    expect(allowedItemActions({ status: "in_treatment" }, open)).toEqual(["complete"]);
    expect(allowedItemActions({ status: "completed" }, open)).toEqual([]);
    expect(allowedItemActions({ status: "cancelled" }, open)).toEqual([]);
  });
  it("booking batal/kedaluwarsa tidak menawarkan aksi", () => {
    expect(allowedItemActions({ status: "assigned" }, { status: "cancelled", payment_status: "unpaid" })).toEqual([]);
    expect(allowedItemActions({ status: "unassigned" }, { status: "expired", payment_status: "unpaid" })).toEqual([]);
  });
  it("booking lunas tidak menawarkan batal item", () => {
    expect(allowedItemActions({ status: "assigned" }, { status: "assigned", payment_status: "paid" })).not.toContain("cancel");
  });
});

describe("aksi booking", () => {
  it("batal booking", () => {
    expect(canCancelBooking(booking("assigned"))).toBe(true);
    expect(canCancelBooking(booking("assigned", "paid"))).toBe(false);
    expect(canCancelBooking(booking("in_treatment", "unpaid", [item("in_treatment")]))).toBe(false);
    expect(canCancelBooking(booking("completed", "unpaid", [item("completed")]))).toBe(false);
    expect(canCancelBooking(booking("cancelled"))).toBe(false);
  });
  it("tambah item", () => {
    expect(canAddItem({ status: "unassigned", payment_status: "unpaid" })).toBe(true);
    expect(canAddItem({ status: "assigned", payment_status: "paid" })).toBe(false);
    expect(canAddItem({ status: "expired", payment_status: "unpaid" })).toBe(false);
  });
  it("checkout", () => {
    expect(checkoutState(booking("assigned"))).toEqual({ allowed: true, reason: null });
    expect(checkoutState(booking("completed", "unpaid", [item("completed"), item("cancelled")])).allowed).toBe(true);
    expect(checkoutState(booking("unassigned", "unpaid", [item("unassigned")])).allowed).toBe(false);
    expect(checkoutState(booking("cancelled")).reason).toBe("Booking dibatalkan.");
    expect(checkoutState(booking("expired")).allowed).toBe(false);
    expect(checkoutState(booking("assigned", "paid")).allowed).toBe(false);
    expect(checkoutState(booking("assigned", "unpaid", [item("cancelled")])).allowed).toBe(false);
  });
});

describe("komisi", () => {
  it("scope & spesifisitas aturan", () => {
    const r = (treatment_id: string | null, variant_id: string | null, branch_id: string | null) => ({
      treatment_id,
      variant_id,
      branch_id,
    });
    expect(ruleScope(r(null, null, null))).toBe("default");
    expect(ruleScope(r("t", null, null))).toBe("treatment");
    expect(ruleScope(r("t", "v", null))).toBe("variant");
    const order = [
      r("t", "v", "b"),
      r("t", "v", null),
      r("t", null, "b"),
      r("t", null, null),
      r(null, null, "b"),
      r(null, null, null),
    ].map(ruleSpecificity);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("nilai & perhitungan", () => {
    expect(commissionValueLabel("percent", 12.5)).toBe("12,5%");
    expect(commissionValueLabel("fixed", 25000)).toBe("Rp25.000");
    expect(commissionValueLabel(null, null)).toBe("-");
    expect(computeCommission("percent", 10, 250000)).toBe(25000);
    expect(computeCommission("fixed", 30000, 250000)).toBe(30000);
  });
  it("normalisasi respons komisi saya", () => {
    const line = { item_id: "i", commission_idr: 1000 } as never;
    expect(normalizeMyCommissions([line])).toEqual([line]);
    expect(normalizeMyCommissions({ lines: [line] })).toEqual([line]);
    expect(normalizeMyCommissions({ therapists: [{ lines: [line, line] }] })).toHaveLength(2);
    expect(normalizeMyCommissions(null)).toEqual([]);
    expect(sumCommission([{ commission_idr: 1000 }, { commission_idr: 2500 }])).toBe(3500);
  });
});

describe("lain-lain", () => {
  it("urut berdasarkan jam mulai", () => {
    const rows = [{ starts_at: "2026-10-08T05:00:00Z" }, { starts_at: "2026-10-08T03:00:00Z" }];
    expect(sortByStart(rows).map((r) => r.starts_at)).toEqual(["2026-10-08T03:00:00Z", "2026-10-08T05:00:00Z"]);
  });
  it("validasi nomor HP", () => {
    expect(isValidPhone("0812-3456-7890")).toBe(true);
    expect(isValidPhone("+6281234567")).toBe(true);
    expect(isValidPhone("123")).toBe(false);
    expect(isValidPhone("08abc")).toBe(false);
  });
});

describe("treatment", () => {
  const variant = { price_idr: 200000, outlet_prices: [{ branch_id: "b2", price_idr: 250000 }] };
  it("harga outlet menimpa harga dasar", () => {
    expect(variantPrice(variant, "b2")).toBe(250000);
    expect(variantPrice(variant, "b1")).toBe(200000);
    expect(variantPrice(variant, null)).toBe(200000);
  });
  it("opsi varian hanya yang aktif", () => {
    const v = (id: string, is_active: boolean) => ({ id, name: id, duration_min: 60, buffer_min: 0, price_idr: 1, is_active, sort_order: 0, outlet_prices: [] });
    const t = (id: string, is_active: boolean, variants: ReturnType<typeof v>[]) => ({
      id, code: id, name: id, category: null, description: null, is_active, sort_order: 0, variants,
    });
    const opts = activeVariantOptions([t("A", true, [v("a1", true), v("a2", false)]), t("B", false, [v("b1", true)])]);
    expect(opts.map((o) => o.variant.id)).toEqual(["a1"]);
    expect(opts[0].label).toBe("A — a1 (60 mnt)");
  });
});
