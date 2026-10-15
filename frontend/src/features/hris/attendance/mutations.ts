"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  adjustAttendance,
  closeAttendancePeriod,
  createManualAttendance,
  deleteAttendance,
  reopenAttendancePeriod,
  saveAttendanceSettings,
  updateAttendancePeriodClosing,
} from "./api";
import { attendanceQueryKeys } from "./query-keys";
import type { AttendanceAdjustPayload } from "./types";

function useInvalidateAttendance() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: attendanceQueryKeys.all });
    qc.invalidateQueries({ queryKey: attendanceQueryKeys.periodsAll() });
    qc.invalidateQueries({ queryKey: ["hris", "payroll"] });
  };
}

/** HRD menambah absensi yang hilang (wajib alasan). */
export function useCreateManualAttendance() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: (payload: AttendanceAdjustPayload) => createManualAttendance(payload),
    onSuccess: invalidate,
  });
}

/** HRD mengoreksi jam/status/toko/terlambat/lembur sebuah absensi (wajib alasan). */
export function useAdjustAttendance() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: AttendanceAdjustPayload }) => adjustAttendance(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteAttendance() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => deleteAttendance(id, reason),
    onSuccess: invalidate,
  });
}

export function useCloseAttendancePeriod() {
  const invalidate = useInvalidateAttendance();
  return useMutation({ mutationFn: (id: string) => closeAttendancePeriod(id), onSuccess: invalidate });
}

export function useReopenAttendancePeriod() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: ({ id, reason, closingDate }: { id: string; reason: string; closingDate?: string }) =>
      reopenAttendancePeriod(id, reason, closingDate),
    onSuccess: invalidate,
  });
}

export function useUpdateAttendancePeriodClosing() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: ({ id, closingDate, reason }: { id: string; closingDate: string; reason?: string }) =>
      updateAttendancePeriodClosing(id, closingDate, reason),
    onSuccess: invalidate,
  });
}

export function useSaveAttendanceSettings() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: ({ cutoffDay, offsetDays }: { cutoffDay: number; offsetDays: number }) =>
      saveAttendanceSettings(cutoffDay, offsetDays),
    onSuccess: invalidate,
  });
}
