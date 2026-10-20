"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { publicSpaApi, spaApi } from "./api";
import { spaKeys } from "./query-keys";
import type {
  AssistInput,
  Booking,
  BookingCreateInput,
  BookingGroupCreateInput,
  BookingItemInput,
  BookingUpdateInput,
  CommissionRuleInput,
  WaitlistCreateInput,
  ItemActionInput,
  DayOffQuota,
  OutletInput,
  PayRun,
  PaySettings,
  PayType,
  RoomInput,
  PriceInput,
  PublicBookingInput,
  TherapistCreateInput,
  TherapistUpdateInput,
  TreatmentInput,
  Treatment,
} from "./types";

/** Booking berubah → perbarui cache detail + segarkan daftar, papan, ketersediaan. */
function bookingChanged(qc: QueryClient, booking?: Booking) {
  if (booking?.id) qc.setQueryData(spaKeys.booking(booking.id), booking);
  void qc.invalidateQueries({ queryKey: spaKeys.bookingsAll() });
  void qc.invalidateQueries({ queryKey: ["spa", "reports"] });
  void qc.invalidateQueries({ queryKey: spaKeys.boardAll() });
  void qc.invalidateQueries({ queryKey: ["spa", "arrival-queue"] });
  void qc.invalidateQueries({ queryKey: ["spa", "availability"] });
  void qc.invalidateQueries({ queryKey: spaKeys.myAssignmentsAll() });
}

// ── Booking ──────────────────────────────────────────────────────────────────

/** Pindah jam booking (mis. seret di kalender Book Order); terapis tetap & dicek ulang server. */
export const useRescheduleBooking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, scheduledAt }: { bookingId: string; scheduledAt: string }) =>
      spaApi.updateBooking(bookingId, { scheduled_at: scheduledAt }),
    onSuccess: (booking) => bookingChanged(qc, booking),
  });
};

export const useAssignBooking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, therapistId }: { bookingId: string; therapistId: string | null }) => spaApi.assignBooking(bookingId, therapistId),
    onSuccess: (booking) => bookingChanged(qc, booking),
  });
};

export const useBookingAction = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: "start" | "complete") => spaApi.bookingAction(id, action),
    onSuccess: (booking) => bookingChanged(qc, booking),
  });
};

export const useCreateBooking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookingCreateInput) => spaApi.createBooking(input),
    onSuccess: (booking) => bookingChanged(qc, booking),
  });
};

export const useCreateBookingGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookingGroupCreateInput) => spaApi.createBookingGroup(input),
    onSuccess: (group) => {
      group.bookings.forEach((booking) => bookingChanged(qc, booking));
      qc.setQueryData(spaKeys.bookingGroup(group.id), group);
    },
  });
};

export const useCheckoutBookingGroup = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ratings: { booking_id: string; therapist_rating: number }[]) => spaApi.checkoutBookingGroup(id, ratings),
    onSuccess: (result) => {
      result.group.bookings.forEach((booking) => bookingChanged(qc, booking));
      qc.setQueryData(spaKeys.bookingGroup(id), result.group);
    },
  });
};

export const useUpdateBooking = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookingUpdateInput) => spaApi.updateBooking(id, input),
    onSuccess: (booking) => bookingChanged(qc, booking),
  });
};

export const useAddBookingItem = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookingItemInput) => spaApi.addItem(id, input),
    onSuccess: (booking) => bookingChanged(qc, booking),
  });
};

/** Aksi item; `bookingId` per panggilan supaya bisa dipakai di papan harian. */
export const useItemAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, itemId, input }: { bookingId: string; itemId: string; input: ItemActionInput }) =>
      spaApi.itemAction(bookingId, itemId, input),
    onSuccess: (booking) => bookingChanged(qc, booking),
  });
};

export const useCancelBooking = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => spaApi.cancelBooking(id, reason),
    onSuccess: (booking) => bookingChanged(qc, booking),
  });
};

export const useCheckoutBooking = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (therapistRating?: number) => spaApi.checkout(id, therapistRating),
    onSuccess: (result) => bookingChanged(qc, result.booking),
  });
};

// ── Outlet ───────────────────────────────────────────────────────────────────

export const useSaveRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: RoomInput }) => (id ? spaApi.updateRoom(id, input) : spaApi.createRoom(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["spa", "rooms"] });
      void qc.invalidateQueries({ queryKey: ["spa", "room-board"] });
    },
  });
};

export const useDeleteRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => spaApi.deleteRoom(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["spa", "rooms"] });
      void qc.invalidateQueries({ queryKey: ["spa", "room-board"] });
    },
  });
};

export const useSetBookingRoom = (bookingId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string | null) => spaApi.setBookingRoom(bookingId, roomId),
    onSuccess: (booking) => {
      bookingChanged(qc, booking);
      void qc.invalidateQueries({ queryKey: ["spa", "room-board"] });
    },
  });
};

export const useAutoAssignBooking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, therapistId }: { bookingId: string; therapistId: string }) =>
      spaApi.autoAssignBooking(bookingId, therapistId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["spa", "arrival-queue"] });
      void qc.invalidateQueries({ queryKey: spaKeys.boardAll() });
      void qc.invalidateQueries({ queryKey: spaKeys.bookingsAll() });
    },
  });
};

export const useSaveOutlet = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, input }: { branchId: string; input: OutletInput }) => spaApi.saveOutlet(branchId, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.outlets() }),
  });
};

// ── Treatment ────────────────────────────────────────────────────────────────

export const useSaveTreatment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: TreatmentInput }) =>
      id ? spaApi.updateTreatment(id, input) : spaApi.createTreatment(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spaKeys.treatmentsAll() });
      void qc.invalidateQueries({ queryKey: spaKeys.treatmentCategories() });
    },
  });
};

export const useSaveTreatmentCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id?: string; name: string }) =>
      id ? spaApi.updateTreatmentCategory(id, name) : spaApi.createTreatmentCategory(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spaKeys.treatmentCategories() });
      void qc.invalidateQueries({ queryKey: spaKeys.treatmentsAll() });
    },
  });
};

export const useDeleteTreatmentCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: spaApi.deleteTreatmentCategory,
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.treatmentCategories() }),
  });
};

export const useSaveTreatmentPrices = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, prices }: { id: string; prices: PriceInput[] }) => spaApi.savePrices(id, prices),
    onSuccess: async (saved) => {
      // Hasil tiap batch langsung menjadi acuan; refetch tidak boleh menimpa
      // respons tersebut dengan request daftar yang dimulai sebelum simpan.
      await qc.cancelQueries({ queryKey: spaKeys.treatmentsAll() });
      qc.setQueryData<Treatment[]>(spaKeys.treatments(), (list) => list?.map((t) => t.id === saved.id ? saved : t));
      void qc.invalidateQueries({ queryKey: spaKeys.treatmentsAll(), refetchType: "none" });
    },
  });
};

// ── Terapis ──────────────────────────────────────────────────────────────────

export const useCreateTherapist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TherapistCreateInput) => spaApi.createTherapist(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spaKeys.therapistsAll() });
      void qc.invalidateQueries({ queryKey: ["spa", "employees"] });
    },
  });
};

export const useUpdateTherapist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TherapistUpdateInput }) => spaApi.updateTherapist(id, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.therapistsAll() }),
  });
};

export const useCreateAssist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssistInput) => spaApi.createAssist(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.assistsAll() }),
  });
};

export const useDeleteAssist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => spaApi.deleteAssist(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.assistsAll() }),
  });
};

export const useCreateOutletPic = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { branch_id: string; employee_id: string }) => spaApi.createOutletPic(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.outletPicsAll() }),
  });
};

export const useDeleteOutletPic = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { branch_id: string; employee_id: string }) => spaApi.deleteOutletPic(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.outletPicsAll() }),
  });
};

// ── Komisi ───────────────────────────────────────────────────────────────────

export const useSaveCommissionRule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CommissionRuleInput }) =>
      id ? spaApi.updateCommissionRule(id, input) : spaApi.createCommissionRule(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.commissionRules() }),
  });
};

export const useDeleteCommissionRule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => spaApi.deleteCommissionRule(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.commissionRules() }),
  });
};

// ── Self-service terapis ─────────────────────────────────────────────────────

export const useMyAssignmentAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, action }: { itemId: string; action: "start" | "complete" }) =>
      spaApi.myAssignmentAction(itemId, action),
    onSuccess: () => {
      // Tugas, jadwal, komisi dan ringkasan terapis semuanya di bawah ["spa", "me"].
      void qc.invalidateQueries({ queryKey: ["spa", "me"] });
    },
  });
};

export const useMyAddItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, variantId }: { bookingId: string; variantId: string }) => spaApi.myAddItem(bookingId, variantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["spa", "me"] });
    },
  });
};

export const useSavePaySettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PaySettings) => spaApi.savePaySettings(input),
    onSuccess: (cfg) => qc.setQueryData(spaKeys.paySettings(), cfg),
  });
};

export const useSetPayType = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ therapistId, payType }: { therapistId: string; payType: PayType }) => spaApi.setPayType(therapistId, payType),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.therapistPays() }),
  });
};

export const useCreatePayRun = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ month, kind }: { month: string; kind: PayRun["kind"] }) => spaApi.createPayRun(month, kind),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.payRuns() }),
  });
};

const payRunChanged = (qc: ReturnType<typeof useQueryClient>, run: PayRun) => {
  qc.setQueryData(spaKeys.payRun(run.id), run);
  void qc.invalidateQueries({ queryKey: spaKeys.payRuns(), exact: true });
};

export const useRecalcPayRun = (id: string) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => spaApi.recalcPayRun(id), onSuccess: (run) => payRunChanged(qc, run) });
};

export const usePayRunAction = (id: string) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (action: "approve" | "pay" | "reopen") => spaApi.payRunAction(id, action), onSuccess: (run) => payRunChanged(qc, run) });
};

export const useUpdatePayLine = (runId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, input }: { lineId: string; input: { bonus_idr: number; deduction_idr: number; note: string } }) => spaApi.updatePayLine(lineId, input),
    onSuccess: (run) => {
      if (run.id === runId) payRunChanged(qc, run);
    },
  });
};

export const useDeletePayRun = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => spaApi.deletePayRun(id), onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.payRuns() }) });
};

export const useBookMyDayOff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => spaApi.bookMyDayOff(date),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["spa", "me"] });
      void qc.invalidateQueries({ queryKey: ["spa", "day-offs"] });
    },
  });
};

export const useCancelMyDayOff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => spaApi.cancelMyDayOff(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["spa", "me"] });
      void qc.invalidateQueries({ queryKey: ["spa", "day-offs"] });
    },
  });
};

export const useSaveDayOffQuota = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, input }: { branchId: string; input: Omit<DayOffQuota, "branch_id"> }) => spaApi.saveDayOffQuota(branchId, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["spa", "day-offs"] }),
  });
};

export const useCancelDayOff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => spaApi.cancelDayOff(id, reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["spa", "day-offs"] }),
  });
};

// ── Publik ───────────────────────────────────────────────────────────────────

export const useCreatePublicBooking = () =>
  useMutation({ mutationFn: (input: PublicBookingInput) => publicSpaApi.createBooking(input) });

/** Daftar tunggu: FO menutup/membuka entri atau mencatat tamu baru. */
export const useSetWaitlistStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "booked" | "cancelled" }) =>
      spaApi.setWaitlistStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: spaKeys.waitlistAll() }),
  });
};

export const useCreateWaitlist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WaitlistCreateInput) => spaApi.createWaitlist(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: spaKeys.waitlistAll() }),
  });
};

/** DP: FO menandai DP diterima manual / membebaskan; pengaturan nominal & batas waktu. */
export const useBookingDeposit = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, note }: { action: "paid" | "waive"; note?: string }) => spaApi.bookingDeposit(id, action, note),
    onSuccess: (booking) => bookingChanged(qc, booking),
  });
};

export const useSetCustomerBan = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ banned, reason }: { banned: boolean; reason?: string }) => spaApi.setCustomerBan(id, banned, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spa", "customer-directory"] }),
  });
};

export const useSaveDepositSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { amount_idr: number; hold_minutes: number }) => spaApi.saveDepositSettings(input),
    onSuccess: (cfg) => qc.setQueryData(spaKeys.depositSettings(), cfg),
  });
};
