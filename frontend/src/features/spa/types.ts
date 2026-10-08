/**
 * Tipe modul Spa (Mizu) — cermin persis kontrak API EPIC-052
 * (docs/epics/EPIC-052-mizu-spa-booking-terapis.md, bagian "API").
 * Waktu = ISO UTC; tanggal = "YYYY-MM-DD" (WIB); uang = angka rupiah.
 */

export type ItemStatus = "unassigned" | "assigned" | "in_treatment" | "completed" | "cancelled";
export type BookingStatus = "unassigned" | "assigned" | "in_treatment" | "completed" | "cancelled" | "expired";
export type PaymentStatus = "unpaid" | "paid" | "void";
export type BookingType = "walk_in" | "reservation";
export type GenderPref = "any" | "male" | "female";
export type TherapistGender = "male" | "female";
export type CommissionType = "percent" | "fixed";
export type ItemAction = "assign" | "unassign" | "start" | "complete" | "cancel" | "reschedule";

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

// ── Referensi ────────────────────────────────────────────────────────────────

export interface WarehouseOption {
  id: string;
  name: string;
  code: string;
}

export interface Outlet {
  branch_id: string;
  branch_name: string;
  company_id: string;
  configured: boolean;
  warehouse_id: string | null;
  warehouse_name: string | null;
  open_time: string;
  close_time: string;
  slot_minutes: number;
  public_booking: boolean;
  is_active: boolean;
  warehouses: WarehouseOption[];
}

export interface OutletPrice {
  branch_id: string;
  price_idr: number;
}

export interface Variant {
  id: string;
  name: string;
  duration_min: number;
  buffer_min: number;
  price_idr: number;
  is_active: boolean;
  sort_order: number;
  outlet_prices: OutletPrice[];
}

export interface Treatment {
  id: string;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  variants: Variant[];
}

export interface Therapist {
  id: string;
  employee_id: string;
  full_name: string;
  nip: string | null;
  phone: string | null;
  photo_url: string | null;
  home_branch_id: string;
  home_branch_name: string | null;
  gender: TherapistGender | null;
  is_active: boolean;
}

export interface SpaCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

// ── Outlet ───────────────────────────────────────────────────────────────────

export interface OutletInput {
  warehouse_id: string | null;
  open_time: string;
  close_time: string;
  slot_minutes: number;
  public_booking: boolean;
  is_active: boolean;
}

// ── Treatment ────────────────────────────────────────────────────────────────

export interface VariantInput {
  id?: string;
  name: string;
  duration_min: number;
  buffer_min: number;
  price_idr: number;
  is_active: boolean;
  sort_order: number;
}

export interface TreatmentInput {
  code: string;
  name: string;
  category: string;
  description: string;
  is_active: boolean;
  sort_order: number;
  variants: VariantInput[];
}

export interface PriceInput {
  variant_id: string;
  branch_id: string;
  price_idr: number | null;
}

// ── Terapis ──────────────────────────────────────────────────────────────────

export interface EmployeeCandidate {
  id: string;
  full_name: string;
  nip: string | null;
  position_title: string | null;
  is_therapist: boolean;
}

export interface TherapistCreateInput {
  employee_id: string;
  home_branch_id: string;
  gender: TherapistGender | null;
  is_active: boolean;
}

export interface TherapistUpdateInput {
  home_branch_id?: string;
  gender?: TherapistGender | null;
  is_active?: boolean;
}

export interface Assist {
  id: string;
  therapist_id: string;
  therapist_name: string;
  branch_id: string;
  branch_name: string;
  start_date: string;
  end_date: string;
  note: string | null;
}

export interface AssistInput {
  therapist_id: string;
  branch_id: string;
  start_date: string;
  end_date: string;
  note: string;
}

export interface OutletPic {
  branch_id: string;
  branch_name: string;
  employee_id: string;
  full_name: string;
}

// ── Booking ──────────────────────────────────────────────────────────────────

export interface BookingSummary {
  id: string;
  booking_code: string;
  branch_id: string;
  branch_name: string;
  booking_type: BookingType;
  source: string;
  customer_name: string;
  customer_phone: string | null;
  scheduled_at: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
  item_count: number;
  total_idr: number;
  therapist_names: string[];
  pos_order_id: string | null;
  created_at: string;
}

export interface BookingItem {
  id: string;
  variant_id: string;
  treatment_name: string;
  variant_name: string;
  duration_min: number;
  buffer_min: number;
  price_idr: number;
  therapist_id: string | null;
  therapist_name: string | null;
  starts_at: string;
  ends_at: string;
  status: ItemStatus;
  started_at: string | null;
  completed_at: string | null;
  commission_idr: number | null;
}

export interface BookingEvent {
  id: string;
  item_id: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

export interface Booking extends BookingSummary {
  company_id: string;
  warehouse_id: string | null;
  customer_id: string | null;
  therapist_gender_pref: GenderPref;
  notes: string | null;
  checked_out_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  pos_order_number: string | null;
  items: BookingItem[];
  events: BookingEvent[];
}

export interface BookingListParams {
  branch_id?: string;
  from?: string;
  to?: string;
  status?: BookingStatus | "";
  payment_status?: PaymentStatus | "";
  q?: string;
  page?: number;
  limit?: number;
}

export interface BookingItemInput {
  variant_id: string;
  starts_at?: string;
  therapist_id?: string;
}

export interface BookingCreateInput {
  branch_id: string;
  booking_type: BookingType;
  customer_id?: string;
  customer_name: string;
  customer_phone: string;
  therapist_gender_pref: GenderPref;
  notes?: string;
  scheduled_at: string;
  items: BookingItemInput[];
}

export interface BookingUpdateInput {
  customer_name?: string;
  customer_phone?: string;
  notes?: string;
  therapist_gender_pref?: GenderPref;
}

export type ItemActionInput =
  | { action: "assign"; therapist_id: string }
  | { action: "unassign" | "start" | "complete" | "cancel" }
  | { action: "reschedule"; starts_at: string };

export interface CheckoutResult {
  booking: Booking;
  order_id: string;
  order_number: string;
}

export interface Shift {
  name: string;
  start_time: string;
  end_time: string;
}

export interface AvailabilityConflict {
  item_id: string;
  booking_code: string;
  starts_at: string;
  ends_at: string;
}

export interface TherapistAvailability {
  therapist: Therapist;
  available: boolean;
  conflicts: AvailabilityConflict[];
  on_leave: boolean;
  shift: Shift | null;
  day_off: boolean;
  assisting: boolean;
}

export interface AvailabilityParams {
  branch_id: string;
  starts_at: string;
  ends_at: string;
  exclude_item_id?: string;
}

export interface BoardItem extends BookingItem {
  booking_id: string;
  booking_code: string;
  customer_name: string;
  booking_status: BookingStatus;
}

export interface BoardTherapist {
  therapist: Therapist;
  shift: Shift | null;
  on_leave: boolean;
  items: BoardItem[];
}

export interface Board {
  date: string;
  branch_id: string;
  therapists: BoardTherapist[];
  unassigned: BoardItem[];
}

// ── Komisi ───────────────────────────────────────────────────────────────────

export interface CommissionRule {
  id: string;
  treatment_id: string | null;
  treatment_name: string | null;
  variant_id: string | null;
  variant_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  commission_type: CommissionType;
  value: number;
  is_active: boolean;
}

export interface CommissionRuleInput {
  treatment_id: string | null;
  variant_id: string | null;
  branch_id: string | null;
  commission_type: CommissionType;
  value: number;
  is_active: boolean;
}

export interface CommissionLine {
  item_id: string;
  booking_id: string;
  booking_code: string;
  branch_name: string;
  completed_at: string;
  treatment_name: string;
  variant_name: string;
  price_idr: number;
  commission_type: CommissionType | null;
  commission_value: number | null;
  commission_idr: number;
}

export interface TherapistCommission {
  therapist_id: string;
  full_name: string;
  nip: string | null;
  treatment_count: number;
  revenue_idr: number;
  commission_idr: number;
  lines: CommissionLine[];
}

export interface CommissionReport {
  from: string;
  to: string;
  total_idr: number;
  therapists: TherapistCommission[];
}

export interface CommissionReportParams {
  from: string;
  to: string;
  branch_id?: string;
  therapist_id?: string;
}

// ── Self-service terapis ─────────────────────────────────────────────────────

export interface MeResponse {
  therapist: Therapist | null;
}

// ── Publik ───────────────────────────────────────────────────────────────────

export interface PublicOutlet {
  branch_id: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  open_time: string;
  close_time: string;
  slot_minutes: number;
}

export interface PublicVariant {
  id: string;
  name: string;
  duration_min: number;
  price_idr: number;
}

export interface PublicTreatment {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  variants: PublicVariant[];
}

export interface PublicBookingInput {
  branch_id: string;
  scheduled_at: string;
  customer_name: string;
  customer_phone: string;
  therapist_gender_pref: GenderPref;
  notes: string;
  variant_ids: string[];
}

export interface PublicBookingResult {
  booking_code: string;
  scheduled_at: string;
  branch_name: string;
  items: { treatment_name: string; variant_name: string; duration_min: number; price_idr: number }[];
  total_idr: number;
}
