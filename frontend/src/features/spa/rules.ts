/**
 * Aturan tampilan & aksi modul Spa (murni, tanpa React) — mengikuti mesin
 * status EPIC-052. Server tetap penentu akhir; di sini hanya menyembunyikan
 * aksi yang pasti ditolak supaya UI tidak menawarkan hal yang tidak diizinkan.
 */
import type {
  Booking,
  BookingItem,
  BookingStatus,
  CommissionLine,
  CommissionRule,
  CommissionType,
  GenderPref,
  ItemAction,
  ItemStatus,
  PaymentStatus,
  TherapistGender,
  Treatment,
  Variant,
} from "./types";

export type BadgeVariant = "success" | "warning" | "info" | "destructive" | "muted" | "secondary" | "accent" | "outline";

export interface StatusBadge {
  label: string;
  variant: BadgeVariant;
}

export const ITEM_STATUS: Record<ItemStatus, StatusBadge> = {
  unassigned: { label: "Belum ditugaskan", variant: "warning" },
  assigned: { label: "Ditugaskan", variant: "info" },
  in_treatment: { label: "Sedang treatment", variant: "accent" },
  completed: { label: "Selesai", variant: "success" },
  cancelled: { label: "Dibatalkan", variant: "muted" },
};

export const BOOKING_STATUS: Record<BookingStatus, StatusBadge> = {
  unassigned: { label: "Belum ditugaskan", variant: "warning" },
  assigned: { label: "Ditugaskan", variant: "info" },
  in_treatment: { label: "Sedang treatment", variant: "accent" },
  completed: { label: "Selesai", variant: "success" },
  cancelled: { label: "Dibatalkan", variant: "muted" },
  expired: { label: "Kedaluwarsa", variant: "destructive" },
};

export const PAYMENT_STATUS: Record<PaymentStatus, StatusBadge> = {
  unpaid: { label: "Belum bayar", variant: "warning" },
  paid: { label: "Lunas", variant: "success" },
  void: { label: "Void", variant: "destructive" },
};

export const BOOKING_STATUSES = Object.keys(BOOKING_STATUS) as BookingStatus[];
export const PAYMENT_STATUSES = Object.keys(PAYMENT_STATUS) as PaymentStatus[];

const FALLBACK: StatusBadge = { label: "-", variant: "outline" };

export function itemStatusBadge(status: string | null | undefined): StatusBadge {
  return (status && ITEM_STATUS[status as ItemStatus]) || { ...FALLBACK, label: status || "-" };
}

export function bookingStatusBadge(status: string | null | undefined): StatusBadge {
  return (status && BOOKING_STATUS[status as BookingStatus]) || { ...FALLBACK, label: status || "-" };
}

export function paymentStatusBadge(status: string | null | undefined): StatusBadge {
  return (status && PAYMENT_STATUS[status as PaymentStatus]) || { ...FALLBACK, label: status || "-" };
}

export const GENDER_PREF_LABEL: Record<GenderPref, string> = {
  any: "Bebas",
  male: "Terapis pria",
  female: "Terapis wanita",
};

export const GENDER_LABEL: Record<TherapistGender, string> = {
  male: "Pria",
  female: "Wanita",
};

export function genderLabel(gender: TherapistGender | null | undefined): string {
  return gender ? GENDER_LABEL[gender] : "-";
}

export const BOOKING_TYPE_LABEL: Record<string, string> = {
  walk_in: "Walk-in",
  reservation: "Reservasi",
};

export const SOURCE_LABEL: Record<string, string> = {
  public: "Booking online",
  front_office: "Front office",
};

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "-";
  return SOURCE_LABEL[source] ?? source;
}

const EVENT_LABEL: Record<string, string> = {
  create: "Booking dibuat",
  created: "Booking dibuat",
  add_item: "Item ditambahkan",
  item_added: "Item ditambahkan",
  assign: "Terapis ditugaskan",
  unassign: "Terapis dilepas",
  start: "Treatment dimulai",
  complete: "Treatment selesai",
  cancel: "Dibatalkan",
  cancel_item: "Item dibatalkan",
  reschedule: "Jadwal diubah",
  update: "Data booking diubah",
  checkout: "Checkout ke POS",
  paid: "Pembayaran lunas",
  void: "Pembayaran di-void",
  expire: "Kedaluwarsa",
  expired: "Kedaluwarsa",
};

export function eventLabel(action: string): string {
  return EVENT_LABEL[action] ?? action.replace(/_/g, " ");
}

/** Status item yang masih "hidup" (dihitung di total & checkout). */
export function isActiveItem(item: Pick<BookingItem, "status">): boolean {
  return item.status !== "cancelled";
}

/** Total booking = harga item yang tidak dibatalkan. */
export function bookingTotal(items: Pick<BookingItem, "status" | "price_idr">[]): number {
  return items.filter(isActiveItem).reduce((sum, item) => sum + (Number(item.price_idr) || 0), 0);
}

/** Booking final: tidak ada aksi layanan lagi. */
export function isBookingClosed(booking: Pick<Booking, "status">): boolean {
  return booking.status === "cancelled" || booking.status === "expired";
}

/**
 * Aksi item yang diizinkan (mesin status EPIC-052):
 * unassigned → assign/cancel/reschedule; assigned → unassign/start/complete(override)/cancel/reschedule;
 * in_treatment → complete; completed/cancelled → tidak ada. Booking batal/kedaluwarsa → tidak ada.
 * Item tidak dapat dibatalkan setelah booking lunas.
 */
export function allowedItemActions(
  item: Pick<BookingItem, "status">,
  booking: Pick<Booking, "status" | "payment_status">
): ItemAction[] {
  if (isBookingClosed(booking)) return [];
  const paid = booking.payment_status !== "unpaid";
  switch (item.status) {
    case "unassigned":
      return paid ? ["assign", "reschedule"] : ["assign", "reschedule", "cancel"];
    case "assigned":
      return paid
        ? ["start", "complete", "unassign", "reschedule"]
        : ["start", "complete", "unassign", "reschedule", "cancel"];
    case "in_treatment":
      return ["complete"];
    default:
      return [];
  }
}

/** Tambah item hanya pada booking yang belum batal/kedaluwarsa dan belum dibayar. */
export function canAddItem(booking: Pick<Booking, "status" | "payment_status">): boolean {
  return !isBookingClosed(booking) && booking.payment_status === "unpaid";
}

type BookingWithItemStatus = Pick<Booking, "status" | "payment_status"> & { items: Pick<BookingItem, "status">[] };

/** Batal booking: belum lunas, tidak ada item yang sudah dimulai/selesai. */
export function canCancelBooking(booking: BookingWithItemStatus): boolean {
  if (isBookingClosed(booking) || booking.payment_status === "paid") return false;
  return !booking.items.some((i) => i.status === "in_treatment" || i.status === "completed");
}

export interface CheckoutState {
  allowed: boolean;
  /** Alasan bila tidak diizinkan (untuk tooltip/teks bantuan). */
  reason: string | null;
}

/** Syarat checkout: tidak batal/kedaluwarsa, belum dibayar, ada item aktif, semua item aktif sudah ditugaskan. */
export function checkoutState(booking: BookingWithItemStatus): CheckoutState {
  if (booking.status === "cancelled") return { allowed: false, reason: "Booking dibatalkan." };
  if (booking.status === "expired") return { allowed: false, reason: "Booking kedaluwarsa." };
  if (booking.payment_status === "paid") return { allowed: false, reason: "Booking sudah lunas." };
  if (booking.payment_status === "void") return { allowed: false, reason: "Pembayaran booking di-void." };
  const active = booking.items.filter(isActiveItem);
  if (active.length === 0) return { allowed: false, reason: "Belum ada item treatment aktif." };
  if (active.some((i) => i.status === "unassigned"))
    return { allowed: false, reason: "Masih ada item yang belum ditugaskan terapis." };
  return { allowed: true, reason: null };
}

/** Urutkan item papan/jadwal menurut jam mulai. */
export function sortByStart<T extends { starts_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
}

// ── Komisi ───────────────────────────────────────────────────────────────────

export type RuleScope = "default" | "treatment" | "variant";

export function ruleScope(rule: Pick<CommissionRule, "treatment_id" | "variant_id">): RuleScope {
  if (rule.variant_id) return "variant";
  if (rule.treatment_id) return "treatment";
  return "default";
}

export const RULE_SCOPE_LABEL: Record<RuleScope, string> = {
  default: "Default",
  treatment: "Treatment",
  variant: "Varian",
};

/** Peringkat spesifisitas (0 = paling spesifik) sesuai urutan resolusi EPIC-052. */
export function ruleSpecificity(rule: Pick<CommissionRule, "treatment_id" | "variant_id" | "branch_id">): number {
  const scope = ruleScope(rule);
  const base = scope === "variant" ? 0 : scope === "treatment" ? 2 : 4;
  return base + (rule.branch_id ? 0 : 1);
}

export const COMMISSION_RESOLUTION_TEXT =
  "Aturan paling spesifik menang: varian + outlet → varian → treatment + outlet → treatment → default + outlet → default. Persentase = harga × nilai ÷ 100; nominal tetap = nilai.";

/** "10%" atau "Rp25.000" (tanpa import formatter supaya tetap murni). */
export function commissionValueLabel(type: CommissionType | null | undefined, value: number | null | undefined): string {
  if (!type || value === null || value === undefined) return "-";
  if (type === "percent") return `${Number(value).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
  return `Rp${Math.round(Number(value)).toLocaleString("id-ID")}`;
}

/** Perkiraan komisi untuk satu harga. */
export function computeCommission(type: CommissionType, value: number, price: number): number {
  return type === "percent" ? Math.round((price * value) / 100) : Math.round(value);
}

/**
 * `GET /api/spa/me/commissions` mengembalikan "baris komisi seperti laporan".
 * Terima larik baris, objek `{lines}`, atau laporan `{therapists:[{lines}]}`.
 */
export function normalizeMyCommissions(data: unknown): CommissionLine[] {
  if (Array.isArray(data)) return data as CommissionLine[];
  if (data && typeof data === "object") {
    const obj = data as { lines?: unknown; therapists?: unknown };
    if (Array.isArray(obj.lines)) return obj.lines as CommissionLine[];
    if (Array.isArray(obj.therapists)) {
      return (obj.therapists as { lines?: CommissionLine[] }[]).flatMap((t) => t.lines ?? []);
    }
  }
  return [];
}

export function sumCommission(lines: Pick<CommissionLine, "commission_idr">[]): number {
  return lines.reduce((sum, line) => sum + (Number(line.commission_idr) || 0), 0);
}

/** Nomor HP Indonesia minimal: 8–15 digit, boleh diawali +. */
export function isValidPhone(phone: string): boolean {
  return /^\+?\d{8,15}$/.test(phone.replace(/[\s-]/g, ""));
}

// ── Treatment ────────────────────────────────────────────────────────────────

/** Harga varian di outlet: override outlet bila ada, selain itu harga dasar. */
export function variantPrice(
  variant: Pick<Variant, "price_idr" | "outlet_prices">,
  branchId: string | null | undefined
): number {
  const override = branchId ? variant.outlet_prices?.find((p) => p.branch_id === branchId) : undefined;
  return Number(override?.price_idr ?? variant.price_idr) || 0;
}

export interface VariantOption {
  treatment: Treatment;
  variant: Variant;
  label: string;
}

/** Varian aktif dari treatment aktif, siap untuk <select>. */
export function activeVariantOptions(treatments: Treatment[]): VariantOption[] {
  return treatments
    .filter((t) => t.is_active)
    .flatMap((t) =>
      t.variants
        .filter((v) => v.is_active)
        .map((variant) => ({ treatment: t, variant, label: `${t.name} — ${variant.name} (${variant.duration_min} mnt)` }))
    );
}

/** Label status apa pun (item, booking, atau pembayaran) untuk riwayat. */
export function anyStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return (
    ITEM_STATUS[status as ItemStatus]?.label ??
    BOOKING_STATUS[status as BookingStatus]?.label ??
    PAYMENT_STATUS[status as PaymentStatus]?.label ??
    status
  );
}
