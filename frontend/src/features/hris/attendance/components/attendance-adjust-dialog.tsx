"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { useStoreBranches } from "@/features/hris/placements/queries";
import { formatDate } from "@/lib/format";
import { wibDateKey } from "@/lib/hris/attendance-calendar";
import { wibClockInput } from "@/lib/hris/attendance-period";
import { useActiveEmployees } from "../queries";
import { useAdjustAttendance, useCreateManualAttendance } from "../mutations";
import type { AttendanceAdjustPayload, AttendanceListRow, AttendancePeriod, AttendanceRowStatus } from "../types";

export const STATUS_OPTIONS: { value: AttendanceRowStatus; label: string }[] = [
  { value: "present", label: "Hadir" },
  { value: "late", label: "Terlambat" },
  { value: "half-day", label: "Setengah hari" },
  { value: "remote", label: "Remote / dinas luar" },
  { value: "absent", label: "Tidak hadir" },
];

const AUTO_STORE = "auto";
const NO_STORE = "none";

interface FormState {
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  status: AttendanceRowStatus;
  store: string;
  autoLate: boolean;
  lateMinutes: string;
  overtime: string;
  notes: string;
  reason: string;
}

function initialState(row: AttendanceListRow | null, period: AttendancePeriod, today: string): FormState {
  if (row) {
    return {
      employeeId: row.employee_id,
      date: wibDateKey(row.date),
      clockIn: wibClockInput(row.clock_in),
      clockOut: wibClockInput(row.clock_out),
      status: (STATUS_OPTIONS.some((s) => s.value === row.status) ? row.status : "present") as AttendanceRowStatus,
      store: row.branch_id ?? NO_STORE,
      autoLate: true,
      lateMinutes: String(row.late_minutes ?? 0),
      overtime: row.overtime_hours != null ? String(Number(row.overtime_hours)) : "0",
      notes: row.notes ?? "",
      reason: "",
    };
  }
  const date = today < period.end_date ? (today < period.start_date ? period.start_date : today) : period.end_date;
  return {
    employeeId: "",
    date,
    clockIn: "",
    clockOut: "",
    status: "present",
    store: AUTO_STORE,
    autoLate: true,
    lateMinutes: "0",
    overtime: "0",
    notes: "",
    reason: "",
  };
}

/**
 * Tambah / ubah absensi oleh HRD sebelum periode di-closing. Jam diisi "HH:MM"
 * WIB pada tanggal absensi (jam pulang lebih kecil dari jam masuk = keesokan
 * hari, shift malam). Keterlambatan dihitung otomatis dari shift seperti
 * clock-in, kecuali HR mengisinya manual. Alasan penyesuaian wajib.
 */
export function AttendanceAdjustDialog({
  open,
  onOpenChange,
  row,
  period,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = tambah absensi baru */
  row: AttendanceListRow | null;
  period: AttendancePeriod;
  today: string;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(row, period, today));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const branches = useStoreBranches().data ?? [];
  const employees = useActiveEmployees().data;
  const create = useCreateManualAttendance();
  const adjust = useAdjustAttendance();
  const pending = create.isPending || adjust.isPending;
  const isCreate = row === null;
  const maxDate = today < period.end_date ? today : period.end_date;

  const employeeOptions = useMemo(
    () =>
      (employees ?? []).map((emp) => ({
        value: emp.id,
        label: emp.nip ? `${emp.full_name} (${emp.nip})` : emp.full_name,
      })),
    [employees]
  );

  const needsClockIn = form.status !== "absent";
  const reasonOk = form.reason.trim().length >= 5;
  const valid =
    reasonOk &&
    (!isCreate || (form.employeeId && form.date >= period.start_date && form.date <= maxDate)) &&
    (!needsClockIn || form.clockIn !== "" || !isCreate) &&
    (form.clockOut === "" || form.clockIn !== "") &&
    (form.autoLate || Number(form.lateMinutes) >= 0);

  function payload(): AttendanceAdjustPayload {
    const body: AttendanceAdjustPayload = { reason: form.reason.trim() };
    const original = row ? initialState(row, period, today) : null;
    const changed = <K extends keyof FormState>(k: K) => !original || original[k] !== form[k];
    if (isCreate) {
      body.employee_id = form.employeeId;
      body.date = form.date;
    }
    if (changed("clockIn")) body.clock_in = form.clockIn || null;
    if (changed("clockOut")) body.clock_out = form.clockOut || null;
    if (changed("status")) body.status = form.status;
    if (changed("store") && form.store !== AUTO_STORE) body.branch_id = form.store === NO_STORE ? null : form.store;
    if (!form.autoLate) body.late_minutes = Math.max(0, Math.round(Number(form.lateMinutes) || 0));
    if (changed("overtime")) body.overtime_hours = Math.max(0, Number(form.overtime) || 0);
    if (changed("notes")) body.notes = form.notes.trim() || null;
    return body;
  }

  function submit() {
    const body = payload();
    const done = {
      onSuccess: () => {
        toast.success(isCreate ? "Absensi manual ditambahkan" : "Absensi disesuaikan");
        onOpenChange(false);
      },
      onError: (err: Error) => toast.error(err.message || "Gagal menyimpan absensi"),
    };
    if (isCreate) create.mutate(body, done);
    else if (row) adjust.mutate({ id: row.id, payload: body }, done);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>{isCreate ? "Tambah absensi manual" : "Sesuaikan absensi"}</DialogPanelTitle>
          <DialogPanelDescription>
            {isCreate
              ? `Untuk absensi yang tidak tercatat karena sistem/mesin error. Periode ${period.label}.`
              : `${row?.employee?.full_name ?? "Karyawan"} · ${formatDate(row?.date)}. Perubahan dicatat beserta alasannya.`}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {isCreate && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Karyawan *</label>
                <Combobox
                  options={employeeOptions}
                  value={form.employeeId}
                  onChange={(v) => set("employeeId", v)}
                  placeholder="Pilih karyawan"
                  searchPlaceholder="Cari nama/NIP…"
                  emptyMessage="Karyawan tidak ditemukan"
                  className="!w-full h-9 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="adj-date">
                  Tanggal *
                </label>
                <Input
                  id="adj-date"
                  type="date"
                  min={period.start_date}
                  max={maxDate}
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
              <Select value={form.status} onValueChange={(v) => set("status", v as AttendanceRowStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="adj-in">
                Jam masuk{needsClockIn && isCreate ? " *" : ""}
              </label>
              <Input id="adj-in" type="time" value={form.clockIn} onChange={(e) => set("clockIn", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="adj-out">
                Jam pulang
              </label>
              <Input id="adj-out" type="time" value={form.clockOut} onChange={(e) => set("clockOut", e.target.value)} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">Toko</label>
              <Select value={form.store} onValueChange={(v) => set("store", v ?? AUTO_STORE)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isCreate && <SelectItem value={AUTO_STORE}>Otomatis</SelectItem>}
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                  {row?.branch && !branches.some((b) => b.id === row.branch_id) && (
                    <SelectItem value={row.branch.id}>{row.branch.name}</SelectItem>
                  )}
                  <SelectItem value={NO_STORE}>Tanpa toko</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="-mt-2 text-xs text-gray-500">
            Jam WIB. Jam pulang lebih kecil dari jam masuk dianggap keesokan harinya (shift malam). Jam kerja dihitung
            otomatis (dikurangi istirahat).
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <Checkbox checked={form.autoLate} onCheckedChange={(v) => set("autoLate", v === true)} />
                Keterlambatan otomatis dari shift
              </label>
              {!form.autoLate && (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={1440}
                    value={form.lateMinutes}
                    onChange={(e) => set("lateMinutes", e.target.value)}
                    className="w-28"
                    aria-label="Menit terlambat"
                  />
                  <span className="text-sm text-gray-500">menit (0 = tidak terlambat)</span>
                </div>
              )}
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="adj-ot">
                Lembur realisasi (jam)
              </label>
              <Input
                id="adj-ot"
                type="number"
                min={0}
                max={24}
                step={0.5}
                value={form.overtime}
                onChange={(e) => set("overtime", e.target.value)}
                className="w-28"
              />
              <p className="mt-1 text-xs text-gray-500">Membatasi jam lembur yang disetujui saat payroll.</p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="adj-notes">
              Catatan absensi
            </label>
            <Input id="adj-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="adj-reason">
              Alasan penyesuaian <span className="text-red-500">*</span>
            </label>
            <Textarea
              id="adj-reason"
              rows={2}
              value={form.reason}
              onChange={(e) => set("reason", e.target.value)}
              placeholder="Mis. mesin absensi toko PVJ error, dikonfirmasi store manager"
            />
            {!reasonOk && form.reason.length > 0 && (
              <p className="mt-1 text-xs text-red-600">Minimal 5 karakter.</p>
            )}
          </div>
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Batal
          </Button>
          <Button onClick={submit} disabled={!valid || pending} className="gap-2 bg-pink-600 text-white hover:bg-pink-700">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isCreate ? "Tambah absensi" : "Simpan penyesuaian"}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
