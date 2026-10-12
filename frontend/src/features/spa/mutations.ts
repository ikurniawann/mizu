"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { publicSpaApi, spaApi } from "./api";
import { spaKeys } from "./query-keys";
import type {
  AssistInput,
  Booking,
  BookingCreateInput,
  BookingItemInput,
  BookingUpdateInput,
  CommissionRuleInput,
  WaitlistCreateInput,
  ItemActionInput,
  OutletInput,
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

export const useSaveOutlet = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, input }: { branchId: string; input: OutletInput }) => spaApi.saveOutlet(branchId, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaKeys.outlets() }),
  });
};

export const useSyncPos = () =>
  useMutation({ mutationFn: (branchId: string) => spaApi.syncPos(branchId) });

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
