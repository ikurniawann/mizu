/**
 * Klien HTTP modul Spa. Semua rute `/api/spa/**` diteruskan ke backend Go
 * (lihat src/lib/backend-routes.ts); amplop `{success, data, error}` dibuka
 * di sini supaya hook cukup menerima data.
 */
import type {
  Assist,
  AssistInput,
  AvailabilityParams,
  Board,
  BoardItem,
  Booking,
  BookingCreateInput,
  BookingItemInput,
  BookingListParams,
  BookingSummary,
  BookingUpdateInput,
  CheckoutResult,
  CommissionReport,
  CommissionReportParams,
  CommissionRule,
  CommissionRuleInput,
  EmployeeCandidate,
  ItemActionInput,
  MeResponse,
  Outlet,
  OutletInput,
  OutletPic,
  Paginated,
  PriceInput,
  PublicBookingInput,
  PublicBookingResult,
  PublicOutlet,
  PublicTreatment,
  SpaCustomer,
  Therapist,
  TherapistAvailability,
  TherapistCreateInput,
  TherapistUpdateInput,
  Treatment,
  TreatmentInput,
} from "./types";
import { normalizeMyCommissions } from "./rules";

type QueryValue = string | number | boolean | null | undefined;

/** Susun query string; nilai kosong/null/undefined dibuang. */
export function withQuery(base: string, params?: Record<string, QueryValue>): string {
  if (!params) return base;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `${base}?${query}` : base;
}

/** Pesan galat dari amplop: `error` string atau `{message}`. */
export function envelopeError(json: unknown, status: number): string {
  const raw = json && typeof json === "object" && "error" in json ? (json as { error?: unknown }).error : null;
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object" && "message" in raw) {
    const message = (raw as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return status === 403 ? "Anda tidak memiliki akses" : `Permintaan gagal (${status})`;
}

async function request(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.success !== true) throw new Error(envelopeError(json, res.status));
  return json;
}

/** GET/... → `data` dari amplop. */
export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const json = await request(url, init);
  return json.data as T;
}

/** Untuk daftar berhalaman: data + pagination. */
export async function callPage<T>(url: string): Promise<Paginated<T>> {
  const json = await request(url);
  const data = (json.data ?? []) as T[];
  const pagination = (json.pagination as Paginated<T>["pagination"] | undefined) ?? {
    page: 1,
    limit: data.length,
    total: data.length,
    totalPages: 1,
  };
  return { data, pagination };
}

export const send = <T>(url: string, body: unknown, method = "POST") =>
  call<T>(url, { method, body: JSON.stringify(body) });
export const remove = <T>(url: string) => call<T>(url, { method: "DELETE" });

const BASE = "/api/spa";
const PUBLIC_BASE = "/api/public/spa";
const enc = encodeURIComponent;

export const spaApi = {
  // Referensi
  outlets: () => call<Outlet[]>(`${BASE}/outlets`),
  treatments: (active?: boolean) =>
    call<Treatment[]>(withQuery(`${BASE}/treatments`, { active: active ? "true" : undefined })),
  therapists: (params: { branch_id?: string; active?: boolean } = {}) =>
    call<Therapist[]>(
      withQuery(`${BASE}/therapists`, { branch_id: params.branch_id, active: params.active ? "true" : undefined })
    ),
  customers: (q: string) => call<SpaCustomer[]>(withQuery(`${BASE}/customers`, { q })),

  // Outlet
  saveOutlet: (branchId: string, input: OutletInput) => send<Outlet>(`${BASE}/outlets/${enc(branchId)}`, input, "PUT"),
  syncPos: (branchId: string) => send<{ synced: number }>(`${BASE}/outlets/${enc(branchId)}/sync-pos`, {}),

  // Treatment
  createTreatment: (input: TreatmentInput) => send<Treatment>(`${BASE}/treatments`, input),
  updateTreatment: (id: string, input: Partial<TreatmentInput>) =>
    send<Treatment>(`${BASE}/treatments/${enc(id)}`, input, "PATCH"),
  savePrices: (id: string, prices: PriceInput[]) =>
    send<Treatment>(`${BASE}/treatments/${enc(id)}/prices`, { prices }, "PUT"),

  // Terapis
  employees: (q: string) => call<EmployeeCandidate[]>(withQuery(`${BASE}/employees`, { q })),
  createTherapist: (input: TherapistCreateInput) => send<Therapist>(`${BASE}/therapists`, input),
  updateTherapist: (id: string, input: TherapistUpdateInput) =>
    send<Therapist>(`${BASE}/therapists/${enc(id)}`, input, "PATCH"),
  assists: (params: { branch_id?: string; from?: string; to?: string } = {}) =>
    call<Assist[]>(withQuery(`${BASE}/assists`, params)),
  createAssist: (input: AssistInput) => send<Assist>(`${BASE}/assists`, input),
  deleteAssist: (id: string) => remove<{ id: string }>(`${BASE}/assists/${enc(id)}`),
  outletPics: (branchId?: string) => call<OutletPic[]>(withQuery(`${BASE}/outlet-pics`, { branch_id: branchId })),
  createOutletPic: (input: { branch_id: string; employee_id: string }) => send<unknown>(`${BASE}/outlet-pics`, input),
  deleteOutletPic: (input: { branch_id: string; employee_id: string }) =>
    remove<unknown>(withQuery(`${BASE}/outlet-pics`, input)),

  // Booking
  bookings: (params: BookingListParams) =>
    callPage<BookingSummary>(withQuery(`${BASE}/bookings`, params as Record<string, QueryValue>)),
  booking: (id: string) => call<Booking>(`${BASE}/bookings/${enc(id)}`),
  createBooking: (input: BookingCreateInput) => send<Booking>(`${BASE}/bookings`, input),
  updateBooking: (id: string, input: BookingUpdateInput) =>
    send<Booking>(`${BASE}/bookings/${enc(id)}`, input, "PATCH"),
  addItem: (id: string, input: BookingItemInput) => send<Booking>(`${BASE}/bookings/${enc(id)}/items`, input),
  itemAction: (id: string, itemId: string, input: ItemActionInput) =>
    send<Booking>(`${BASE}/bookings/${enc(id)}/items/${enc(itemId)}`, input, "PATCH"),
  cancelBooking: (id: string, reason: string) => send<Booking>(`${BASE}/bookings/${enc(id)}/cancel`, { reason }),
  checkout: (id: string) => send<CheckoutResult>(`${BASE}/bookings/${enc(id)}/checkout`, {}),
  availability: (params: AvailabilityParams) =>
    call<TherapistAvailability[]>(
      withQuery(`${BASE}/availability`, params as unknown as Record<string, QueryValue>)
    ),
  board: (branchId: string, date: string) => call<Board>(withQuery(`${BASE}/board`, { branch_id: branchId, date })),

  // Komisi
  commissionRules: () => call<CommissionRule[]>(`${BASE}/commission-rules`),
  createCommissionRule: (input: CommissionRuleInput) => send<CommissionRule>(`${BASE}/commission-rules`, input),
  updateCommissionRule: (id: string, input: Partial<CommissionRuleInput>) =>
    send<CommissionRule>(`${BASE}/commission-rules/${enc(id)}`, input, "PATCH"),
  deleteCommissionRule: (id: string) => remove<unknown>(`${BASE}/commission-rules/${enc(id)}`),
  commissions: (params: CommissionReportParams) =>
    call<CommissionReport>(withQuery(`${BASE}/commissions`, params as unknown as Record<string, QueryValue>)),

  // Self-service terapis
  me: () => call<MeResponse>(`${BASE}/me`),
  myAssignments: (date: string) => call<BoardItem[]>(withQuery(`${BASE}/me/assignments`, { date })),
  myAssignmentAction: (itemId: string, action: "start" | "complete") =>
    send<BoardItem>(`${BASE}/me/assignments/${enc(itemId)}`, { action }, "PATCH"),
  myCommissions: async (month: string) =>
    normalizeMyCommissions(await call<unknown>(withQuery(`${BASE}/me/commissions`, { month }))),
};

export const publicSpaApi = {
  outlets: () => call<PublicOutlet[]>(`${PUBLIC_BASE}/outlets`),
  treatments: (branchId: string) => call<PublicTreatment[]>(`${PUBLIC_BASE}/outlets/${enc(branchId)}/treatments`),
  createBooking: (input: PublicBookingInput) => send<PublicBookingResult>(`${PUBLIC_BASE}/bookings`, input),
};
