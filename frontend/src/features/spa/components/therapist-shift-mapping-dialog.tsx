"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogFooter, DialogPanel, DialogPanelBody, DialogPanelDescription, DialogPanelHeader, DialogPanelTitle } from "@/components/ui/dialog";
import { currentShiftPattern, SHIFT_DAY_NAMES, shiftPatternPayload } from "@/lib/hris/employee-profile-shifts";
import { isoDayOfWeek } from "@/lib/hris/shifts";
import { formatDate } from "@/lib/format";
import { saveEmployeeShiftPattern, type EmployeeShiftScheduleRow, type ShiftOption } from "@/features/users/api";
import { addDaysToDate } from "../time";
import type { Therapist } from "../types";
import { SELECT } from "./shared";

type Entry = { therapist: Therapist; history: EmployeeShiftScheduleRow[] };

/** Klik sel sudah menentukan terapis; tombol mapping memungkinkan pilihan massal. */
export function TherapistShiftMappingDialog({ entries, shifts, initialDate, singleTherapist, outletName, onClose, onSaved }: {
  entries: Entry[];
  shifts: ShiftOption[];
  initialDate: string;
  singleTherapist: boolean;
  outletName: string;
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const queryClient = useQueryClient();
  const allowedShifts = shifts.filter((shift) => shift.is_active);
  const [day, setDay] = useState(isoDayOfWeek(initialDate));
  const [effectiveFrom, setEffectiveFrom] = useState(initialDate);
  const [shiftId, setShiftId] = useState(() => {
    const current = singleTherapist ? currentShiftPattern(entries[0]?.history ?? [], initialDate)[isoDayOfWeek(initialDate)] : "";
    return allowedShifts.some((shift) => shift.id === current) ? current : allowedShifts[0]?.id ?? "";
  });
  const [bulkSelected, setBulkSelected] = useState<string[]>([]);
  const selected = singleTherapist ? entries.map((entry) => entry.therapist.id) : bulkSelected;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstDate = effectiveFrom ? addDaysToDate(effectiveFrom, (day - isoDayOfWeek(effectiveFrom) + 7) % 7) : "";
  const hasDay = (history: EmployeeShiftScheduleRow[]) => history.some((row) => row.day_of_week === day && row.effective_from <= effectiveFrom && (!row.effective_to || row.effective_to >= effectiveFrom));
  const changed = entries.filter(({ therapist, history }) => selected.includes(therapist.id) && (!hasDay(history) || currentShiftPattern(history, effectiveFrom)[day] !== shiftId));
  const futureCount = changed.filter(({ history }) => history.some((row) => row.effective_from > effectiveFrom)).length;
  const shiftLabel = (id: string) => {
    const shift = shifts.find((option) => option.id === id);
    return shift ? `${shift.name} · ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}` : "Belum diatur";
  };
  const currentSingle = entries[0] && hasDay(entries[0].history)
    ? shiftLabel(currentShiftPattern(entries[0].history, effectiveFrom)[day])
    : "Belum diatur";

  async function save() {
    if (!allowedShifts.some((shift) => shift.id === shiftId) || !effectiveFrom || !changed.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      const results = await Promise.allSettled(changed.map(({ therapist, history }) => {
        const pattern = currentShiftPattern(history, effectiveFrom);
        pattern[day] = shiftId;
        return saveEmployeeShiftPattern(therapist.employee_id, { effective_from: effectiveFrom, days: shiftPatternPayload(pattern) });
      }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users", "shift-schedule"] }),
        queryClient.invalidateQueries({ queryKey: ["spa", "day-offs"] }),
        queryClient.invalidateQueries({ queryKey: ["spa", "availability"] }),
      ]);
      const failed = results.flatMap((result, index) => result.status === "rejected" ? [changed[index].therapist.full_name] : []);
      if (failed.length) {
        setError(`${results.length - failed.length} dari ${results.length} perubahan tersimpan. Gagal menyimpan: ${failed.join(", ")}. Coba simpan kembali.`);
      } else {
        toast.success(`Jadwal ${changed.length} terapis disimpan`);
        onSaved(firstDate);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan jadwal. Coba kembali.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogPanel size={singleTherapist ? "md" : "lg"} showCloseButton={!saving}>
        <DialogPanelHeader>
          <DialogPanelTitle>{singleTherapist ? `Atur shift — ${entries[0]?.therapist.full_name}` : "Atur mapping shift"}</DialogPanelTitle>
          <DialogPanelDescription>{outletName} · {singleTherapist ? "Atur pola mingguan terapis ini." : "Atur pola mingguan untuk terapis yang dipilih."}</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-5">
          <fieldset disabled={saving} className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5 text-sm font-medium">Hari<select className={SELECT} value={day} onChange={(event) => setDay(Number(event.target.value))}>{SHIFT_DAY_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
              <label className="space-y-1.5 text-sm font-medium">Shift<select className={SELECT} value={shiftId} onChange={(event) => setShiftId(event.target.value)}>{allowedShifts.map((shift) => <option key={shift.id} value={shift.id}>{shiftLabel(shift.id)}</option>)}</select></label>
              <label className="space-y-1.5 text-sm font-medium">Berlaku mulai<Input type="date" required value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-3 text-sm">
              <p className="font-medium">Setiap {SHIFT_DAY_NAMES[day - 1]} · {shiftLabel(shiftId)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{firstDate ? `Pertama berlaku ${formatDate(firstDate)}, lalu berulang setiap minggu.` : "Isi tanggal mulai berlaku."} Hari lain mengikuti pola yang berlaku pada tanggal mulai. Libur diajukan melalui Jadwal Libur.</p>
              {singleTherapist && <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-xs"><span>Saat ini: <strong>{currentSingle}</strong></span><span>Menjadi: <strong className="text-brand-text">{shiftLabel(shiftId)}</strong></span></div>}
            </div>
            {!singleTherapist && <div className="overflow-hidden rounded-xl border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-surface-2 px-4 py-3">
                <p className="text-sm font-semibold">Terapis yang akan diubah <span className="font-normal text-muted-foreground">({selected.length} dipilih)</span></p>
                <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setBulkSelected(selected.length === entries.length ? [] : entries.map((entry) => entry.therapist.id))}>{selected.length === entries.length ? "Batalkan pilihan" : "Pilih semua"}</Button>
              </div>
              <div className="max-h-72 divide-y overflow-y-auto">
                {entries.map(({ therapist, history }) => {
                  const pattern = currentShiftPattern(history, effectiveFrom);
                  const willChange = changed.some((entry) => entry.therapist.id === therapist.id);
                  return <label key={therapist.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <Checkbox disabled={saving} checked={selected.includes(therapist.id)} onCheckedChange={(checked) => setBulkSelected((ids) => checked ? [...ids, therapist.id] : ids.filter((id) => id !== therapist.id))} aria-label={`Pilih ${therapist.full_name}`} />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{therapist.full_name}</span><span className="mt-1 block text-xs text-muted-foreground">Saat ini: {hasDay(history) ? shiftLabel(pattern[day]) : "Belum diatur"}</span>{willChange && <span className="mt-1 block text-xs font-medium text-brand-text">Menjadi: {shiftLabel(shiftId)}</span>}</span>
                  </label>;
                })}
              </div>
            </div>}
          </fieldset>
          {futureCount > 0 && <p className="rounded-lg bg-warning-soft p-3 text-xs text-warning">{futureCount} terapis memiliki pola yang dijadwalkan di masa depan. Menyimpan akan mengganti pola mereka mulai {formatDate(effectiveFrom)}, termasuk pola setelah tanggal tersebut.</p>}
          {!allowedShifts.length && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">Belum ada shift aktif. Aktifkan shift di HRIS terlebih dahulu.</p>}
          {error && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
        </DialogPanelBody>
        <DialogFooter className="sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground" aria-live="polite">{changed.length ? singleTherapist ? "Jadwal terapis akan diperbarui" : `${changed.length} terapis akan diperbarui` : selected.length ? "Belum ada perubahan pada jadwal" : "Pilih terapis untuk mengatur jadwal"}</p>
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={onClose}>Batal</Button><Button onClick={() => void save()} disabled={saving || !allowedShifts.length || !effectiveFrom || !changed.length}>{saving ? "Menyimpan…" : singleTherapist ? "Simpan shift" : "Simpan mapping"}</Button></div>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
