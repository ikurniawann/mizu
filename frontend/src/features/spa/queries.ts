"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { publicSpaApi, spaApi } from "./api";
import { spaKeys } from "./query-keys";
import type { AvailabilityParams, BookingListParams, BookingSummary, CommissionReportParams, Paginated, WaitlistListParams } from "./types";

export const useSpaOutlets = () =>
  useQuery({ queryKey: spaKeys.outlets(), queryFn: spaApi.outlets, staleTime: 60_000 });

export const useSpaTreatments = (active?: boolean) =>
  useQuery({ queryKey: spaKeys.treatments(active), queryFn: () => spaApi.treatments(active) });

export const useSpaTreatmentCategories = () =>
  useQuery({ queryKey: spaKeys.treatmentCategories(), queryFn: spaApi.treatmentCategories });

export const useSpaTherapists = (params: { branch_id?: string; active?: boolean } = {}) =>
  useQuery({ queryKey: spaKeys.therapists(params), queryFn: () => spaApi.therapists(params) });

export const useSpaCustomers = (q: string) =>
  useQuery({
    queryKey: spaKeys.customers(q),
    queryFn: () => spaApi.customers(q),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });

export const useSpaEmployees = (q: string) =>
  useQuery({
    queryKey: spaKeys.employees(q),
    queryFn: () => spaApi.employees(q),
    enabled: q.trim().length >= 2,
  });

export const useSpaAssists = (params: { branch_id?: string; from?: string; to?: string } = {}) =>
  useQuery({ queryKey: spaKeys.assists(params), queryFn: () => spaApi.assists(params) });

export const useSpaOutletPics = (branchId?: string) =>
  useQuery({ queryKey: spaKeys.outletPics(branchId), queryFn: () => spaApi.outletPics(branchId) });

export const useDepositSettings = () =>
  useQuery({ queryKey: spaKeys.depositSettings(), queryFn: () => spaApi.depositSettings() });

export const useSpaWaitlist = (params: WaitlistListParams) =>
  useQuery({ queryKey: spaKeys.waitlist(params), queryFn: () => spaApi.waitlist(params) });

export const useSpaBookings = (params: BookingListParams) =>
  useQuery({
    queryKey: spaKeys.bookings(params),
    queryFn: () => spaApi.bookings(params),
    placeholderData: keepPreviousData,
  });

/** Total booking (bukan treatment) dalam cakupan akses pengguna, termasuk booking online. */
export const useSpaUnassignedCount = (enabled = true) => {
  const queryClient = useQueryClient();
  const params = { status: "unassigned", page: 1, limit: 1 } as const;
  const queryKey = spaKeys.bookings(params);
  return useQuery({
    queryKey,
    queryFn: async () => {
      const result = await spaApi.bookings(params);
      const previous = queryClient.getQueryData<Paginated<BookingSummary>>(queryKey);
      // Badge berubah → segarkan kartu tanpa menunggu interval polling papan.
      if (previous?.pagination.total !== result.pagination.total) {
        void queryClient.invalidateQueries({ queryKey: spaKeys.boardAll() });
      }
      return result;
    },
    select: (result) => result.pagination.total,
    enabled,
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: "always",
    retry: false,
  });
};

export const useSpaBooking = (id: string) =>
  useQuery({ queryKey: spaKeys.booking(id), queryFn: () => spaApi.booking(id), enabled: !!id });

export const useSpaBookingGroup = (id: string) =>
  useQuery({ queryKey: spaKeys.bookingGroup(id), queryFn: () => spaApi.bookingGroup(id), enabled: !!id });

export const useSpaAvailability = (params: AvailabilityParams | null) =>
  useQuery({
    queryKey: params ? spaKeys.availability(params) : ["spa", "availability", "idle"],
    queryFn: () => spaApi.availability(params as AvailabilityParams),
    enabled: !!params,
  });

export const useSpaRooms = (branchId: string, activeOnly = false) =>
  useQuery({ queryKey: spaKeys.rooms(branchId, activeOnly), queryFn: () => spaApi.rooms(branchId, activeOnly), enabled: !!branchId, staleTime: 60_000 });

export const useArrivalQueue = (branchId: string, date: string) =>
  useQuery({ queryKey: spaKeys.arrivalQueue(branchId, date), queryFn: () => spaApi.arrivalQueue(branchId, date), enabled: !!branchId && !!date, refetchInterval: 30_000 });

export const useRoomBoard = (branchId: string) =>
  useQuery({ queryKey: spaKeys.roomBoard(branchId), queryFn: () => spaApi.roomBoard(branchId), enabled: !!branchId, refetchInterval: 15_000 });

export const useSpaBoard = (branchId: string, date: string) =>
  useQuery({
    queryKey: spaKeys.board(branchId, date),
    queryFn: () => spaApi.board(branchId, date),
    enabled: !!branchId && !!date,
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: "always",
    placeholderData: keepPreviousData,
  });

export const useCommissionReport = (params: CommissionReportParams) =>
  useQuery({
    queryKey: spaKeys.commissions(params),
    queryFn: () => spaApi.commissions(params),
    enabled: !!params.from && !!params.to,
  });

export const useSpaMe = () => useQuery({ queryKey: spaKeys.me(), queryFn: spaApi.me });

export const useMyAssignments = (date: string, enabled = true) =>
  useQuery({
    queryKey: spaKeys.myAssignments(date),
    queryFn: () => spaApi.myAssignments(date),
    enabled: enabled && !!date,
    refetchInterval: 60_000,
  });

export const useMyCommissions = (month: string, enabled = true) =>
  useQuery({
    queryKey: spaKeys.myCommissions(month),
    queryFn: () => spaApi.myCommissions(month),
    enabled: enabled && !!month,
  });

/** Jadwal terapis beberapa hari ke depan (booking yang ditugaskan ke dirinya). */
export const useMyCatalog = (branchId: string, enabled = true) =>
  useQuery({ queryKey: spaKeys.myCatalog(branchId), queryFn: () => spaApi.myCatalog(branchId), enabled: enabled && !!branchId });

export const usePaySettings = () => useQuery({ queryKey: spaKeys.paySettings(), queryFn: spaApi.paySettings });
export const useTherapistPays = () => useQuery({ queryKey: spaKeys.therapistPays(), queryFn: spaApi.therapistPays });
export const usePayRuns = () => useQuery({ queryKey: spaKeys.payRuns(), queryFn: spaApi.payRuns });
export const usePayRun = (id: string) => useQuery({ queryKey: spaKeys.payRun(id), queryFn: () => spaApi.payRun(id), enabled: !!id });
export const useMyPay = () => useQuery({ queryKey: spaKeys.myPay(), queryFn: spaApi.myPay });

export const useMyDayOffs = (month: string) =>
  useQuery({ queryKey: spaKeys.myDayOffs(month), queryFn: () => spaApi.myDayOffs(month), enabled: !!month });

export const useOutletDayOffs = (branchId: string, month: string) =>
  useQuery({ queryKey: spaKeys.outletDayOffs(branchId, month), queryFn: () => spaApi.outletDayOffs(branchId, month), enabled: !!branchId && !!month });

export const useMySchedule = (from: string, days: number, enabled = true) =>
  useQuery({
    queryKey: spaKeys.mySchedule(from, days),
    queryFn: () => spaApi.mySchedule(from, days),
    enabled: enabled && !!from,
    refetchInterval: 60_000,
  });

/** Komisi bulan ini: cair, menunggu pembayaran, perkiraan dari jadwal. */
export const useMySummary = (month: string, enabled = true) =>
  useQuery({
    queryKey: spaKeys.mySummary(month),
    queryFn: () => spaApi.mySummary(month),
    enabled: enabled && !!month,
    refetchInterval: 60_000,
  });

export const usePublicSpaOutlets = () =>
  useQuery({ queryKey: spaKeys.publicOutlets(), queryFn: publicSpaApi.outlets, staleTime: 5 * 60_000 });

export const usePublicSpaTreatments = (branchId: string) =>
  useQuery({
    queryKey: spaKeys.publicTreatments(branchId),
    queryFn: () => publicSpaApi.treatments(branchId),
    enabled: !!branchId,
    staleTime: 5 * 60_000,
  });

export const usePublicSpaSlots = (branchId: string, date: string, variantIds: string[], pref: string) =>
  useQuery({
    queryKey: spaKeys.publicSlots(branchId, date, variantIds, pref),
    queryFn: () => publicSpaApi.slots(branchId, date, variantIds, pref),
    enabled: !!branchId && !!date && variantIds.length > 0,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

/** Terapis yang masih kosong untuk jam terpilih (dipakai langkah Jadwal booking publik). */
export const usePublicSpaRooms = (branchId: string, startsAt: string | null, variantIds: string[]) =>
  useQuery({
    queryKey: spaKeys.publicRooms(branchId, startsAt ?? "", variantIds),
    queryFn: () => publicSpaApi.rooms(branchId, startsAt ?? "", variantIds),
    enabled: !!branchId && !!startsAt && variantIds.length > 0,
    staleTime: 15_000,
  });

export const usePublicSpaTherapists = (branchId: string, startsAt: string | null, variantIds: string[], pref: string) =>
  useQuery({
    queryKey: spaKeys.publicTherapists(branchId, startsAt ?? "", variantIds, pref),
    queryFn: () => publicSpaApi.therapists(branchId, startsAt ?? "", variantIds, pref),
    enabled: !!branchId && !!startsAt && variantIds.length > 0,
    staleTime: 15_000,
  });
