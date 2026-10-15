"use client";

import { useState } from "react";
import { toast } from "sonner";
import { History, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { useAttendanceAdjustments } from "../queries";
import { useDeleteAttendance } from "../mutations";
import type { AttendanceAdjustment, AttendanceListRow } from "../types";

const FIELD_LABELS: Record<string, string> = {
  clock_in: "Jam masuk",
  clock_out: "Jam pulang",
  status: "Status",
  branch_id: "Toko",
  shift_id: "Shift",
  is_late: "Terlambat",
  late_minutes: "Menit terlambat",
  work_hours: "Jam kerja",
  is_overtime: "Lembur",
  overtime_hours: "Jam lembur",
  notes: "Catatan",
  date: "Tanggal",
};

const ACTION_LABELS: Record<AttendanceAdjustment["action"], string> = {
  create: "Ditambah manual",
  update: "Disesuaikan",
  delete: "Dihapus",
};

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "clock_in" || field === "clock_out") return formatTime(String(value), "—");
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  return String(value);
}

/** Baris perubahan "Jam masuk 08.30 → 08.05" untuk field yang tampil ke HR. */
function changes(a: AttendanceAdjustment): string[] {
  if (a.action !== "update") return [];
  return a.changed_fields
    .filter((f) => f !== "work_hours" && f !== "shift_id" && f !== "is_overtime" && f !== "is_late")
    .map((f) => `${FIELD_LABELS[f] ?? f}: ${show(f, a.before?.[f])} → ${show(f, a.after?.[f])}`);
}

/**
 * Badge "Manual"/"Disesuaikan" di Rekap; klik membuka riwayat penyesuaian
 * (siapa, kapan, alasan, sebelum → sesudah).
 */
export function AdjustmentBadge({ row }: { row: AttendanceListRow }) {
  const [open, setOpen] = useState(false);
  const history = useAttendanceAdjustments(row.id, open);
  if (!row.is_manual && !row.adjusted_at) return null;
  const label = row.is_manual ? "Manual" : "Disesuaikan";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100"
        title={`${label} oleh ${row.adjusted_by_name ?? "-"} · ${formatDateTime(row.adjusted_at)}`}
      >
        <History className="h-3 w-3" />
        {label}
        {(row.adjustment_count ?? 0) > 1 && <span>×{row.adjustment_count}</span>}
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <p className="mb-2 text-sm font-semibold text-gray-900">Riwayat penyesuaian</p>
        {history.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          </div>
        ) : (history.data ?? []).length === 0 ? (
          <p className="text-xs text-gray-500">Belum ada riwayat.</p>
        ) : (
          <ol className="max-h-72 space-y-3 overflow-y-auto">
            {(history.data ?? []).map((a) => (
              <li key={a.id} className="border-l-2 border-violet-200 pl-3">
                <p className="text-xs font-semibold text-gray-800">
                  {ACTION_LABELS[a.action]} · {a.actor_name ?? "-"}
                </p>
                <p className="text-[11px] text-gray-500">{formatDateTime(a.created_at)}</p>
                <p className="mt-1 text-xs text-gray-700">“{a.reason}”</p>
                {changes(a).map((c) => (
                  <p key={c} className="text-[11px] text-gray-500">
                    {c}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Hapus absensi dengan alasan wajib (tercatat di riwayat penyesuaian). */
export function DeleteAttendanceDialog({
  row,
  onOpenChange,
}: {
  row: AttendanceListRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const del = useDeleteAttendance();
  const ok = reason.trim().length >= 5;

  function confirm() {
    if (!row) return;
    del.mutate(
      { id: row.id, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success("Absensi dihapus");
          setReason("");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message || "Gagal menghapus absensi"),
      }
    );
  }

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>Hapus absensi</DialogPanelTitle>
          <DialogPanelDescription>
            {row?.employee?.full_name ?? "Karyawan"} · {formatDate(row?.date)}. Data lama tetap tersimpan di riwayat
            penyesuaian.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody>
          <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="del-reason">
            Alasan penghapusan <span className="text-red-500">*</span>
          </label>
          <Textarea
            id="del-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Mis. absensi ganda karena sistem error"
          />
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={del.isPending}>
            Batal
          </Button>
          <Button onClick={confirm} disabled={!ok || del.isPending} className="bg-red-600 text-white hover:bg-red-700">
            Hapus
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
