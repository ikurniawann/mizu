"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { publicSpaApi, spaApi } from "./api";
import { spaKeys } from "./query-keys";
import type { AvailabilityParams, BookingListParams, CommissionReportParams } from "./types";

export const useSpaOutlets = () =>
  useQuery({ queryKey: spaKeys.outlets(), queryFn: spaApi.outlets, staleTime: 60_000 });

export const useSpaTreatments = (active?: boolean) =>
  useQuery({ queryKey: spaKeys.treatments(active), queryFn: () => spaApi.treatments(active) });

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

export const useSpaBookings = (params: BookingListParams) =>
  useQuery({
    queryKey: spaKeys.bookings(params),
    queryFn: () => spaApi.bookings(params),
    placeholderData: keepPreviousData,
  });

export const useSpaBooking = (id: string) =>
  useQuery({ queryKey: spaKeys.booking(id), queryFn: () => spaApi.booking(id), enabled: !!id });

export const useSpaAvailability = (params: AvailabilityParams | null) =>
  useQuery({
    queryKey: params ? spaKeys.availability(params) : ["spa", "availability", "idle"],
    queryFn: () => spaApi.availability(params as AvailabilityParams),
    enabled: !!params,
  });

export const useSpaBoard = (branchId: string, date: string) =>
  useQuery({
    queryKey: spaKeys.board(branchId, date),
    queryFn: () => spaApi.board(branchId, date),
    enabled: !!branchId && !!date,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

export const useCommissionRules = () =>
  useQuery({ queryKey: spaKeys.commissionRules(), queryFn: spaApi.commissionRules });

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

export const usePublicSpaOutlets = () =>
  useQuery({ queryKey: spaKeys.publicOutlets(), queryFn: publicSpaApi.outlets, staleTime: 5 * 60_000 });

export const usePublicSpaTreatments = (branchId: string) =>
  useQuery({
    queryKey: spaKeys.publicTreatments(branchId),
    queryFn: () => publicSpaApi.treatments(branchId),
    enabled: !!branchId,
    staleTime: 5 * 60_000,
  });
