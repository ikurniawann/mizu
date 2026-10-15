"use client";

import { useState } from "react";
import { CalendarClock, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { shortDateId } from "@/lib/hris/attendance-period";
import { ClosePeriodDialog, ClosingDateDialog, ReopenPeriodDialog } from "./attendance-period-dialogs";
import type { AttendancePeriod } from "../types";

/**
 * Status periode absensi di atas Rekap: terbuka (dengan hitung mundur closing
 * otomatis + tombol "Closing sekarang") atau sudah di-closing (siapa/kapan +
 * "Buka ulang" untuk super admin / HR manager).
 */
export function AttendancePeriodBanner({
  period,
  canManage,
  canReopen,
  offsetDays,
}: {
  period: AttendancePeriod;
  canManage: boolean;
  canReopen: boolean;
  offsetDays?: number;
}) {
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [editingDate, setEditingDate] = useState(false);

  if (period.status === "closed") {
    const by = period.close_mode === "auto" ? "Sistem (otomatis)" : period.closed_by_name ?? "-";
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
        <Lock className="hidden h-5 w-5 shrink-0 text-slate-500 sm:block" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">
            Periode {period.name} ({period.label}) sudah di-closing
          </p>
          <p className="text-xs text-slate-600">
            Oleh {by} pada {formatDateTime(period.closed_at)}. Absensi periode ini terkunci dan tidak bisa diubah.
            {period.reopen_count > 0 && ` Pernah dibuka ulang ${period.reopen_count}×.`}
          </p>
        </div>
        {canReopen && (
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setReopening(true)}>
            <LockOpen className="h-4 w-4" />
            Buka ulang
          </Button>
        )}
        {reopening && (
          <ReopenPeriodDialog period={period} open={reopening} onOpenChange={setReopening} offsetDays={offsetDays} />
        )}
      </div>
    );
  }

  const days = period.days_until_closing;
  const countdown = days <= 0 ? "hari ini terakhir" : `${days} hari lagi`;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center">
      <CalendarClock className="hidden h-5 w-5 shrink-0 text-emerald-600 sm:block" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-emerald-900">
          Terbuka — closing otomatis {shortDateId(period.closing_date)} ({countdown})
        </p>
        <p className="text-xs text-emerald-800">
          Periode {period.name}: {period.label}.{" "}
          {period.has_ended
            ? "Periode sudah berakhir; HRD masih bisa menyesuaikan absensi sampai closing."
            : `Periode masih berjalan sampai ${shortDateId(period.end_date)}; HRD bisa menambah/mengoreksi absensi bila sistem error.`}
          {period.reopen_count > 0 && period.reopen_reason && ` Dibuka ulang oleh ${period.reopened_by_name ?? "-"}: “${period.reopen_reason}”.`}
        </p>
      </div>
      {canManage && (
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditingDate(true)}>
            Ubah tanggal closing
          </Button>
          <Button
            size="sm"
            className="gap-2 bg-pink-600 text-white hover:bg-pink-700"
            disabled={!period.has_ended}
            title={period.has_ended ? undefined : "Closing baru bisa dilakukan setelah periode berakhir"}
            onClick={() => setClosing(true)}
          >
            <Lock className="h-4 w-4" />
            Closing sekarang
          </Button>
        </div>
      )}
      {closing && <ClosePeriodDialog period={period} open={closing} onOpenChange={setClosing} />}
      {editingDate && (
        <ClosingDateDialog key={period.id} period={period} open={editingDate} onOpenChange={setEditingDate} />
      )}
    </div>
  );
}
