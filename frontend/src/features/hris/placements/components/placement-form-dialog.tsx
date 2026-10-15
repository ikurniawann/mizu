"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayWib } from "@/lib/dates";
import { useCreatePlacement, useUpdatePlacement } from "../mutations";
import { useStoreBranches } from "../queries";
import type { Placement } from "../types";

interface PlacementFormDialogProps {
  open: boolean;
  employeeId: string;
  employeeName?: string;
  /** null = tambah penempatan baru */
  placement: Placement | null;
  /** Karyawan belum punya penempatan: penempatan baru otomatis utama. */
  firstPlacement?: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlacementFormDialog(props: PlacementFormDialogProps) {
  const { open, placement, employeeName, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {placement ? "Ubah Penempatan" : "Tambah Penempatan"}
            {employeeName ? <span className="block text-sm font-normal text-gray-500">{employeeName}</span> : null}
          </DialogTitle>
        </DialogHeader>
        {open && <PlacementFormBody key={placement?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function PlacementFormBody({ employeeId, placement, firstPlacement, onOpenChange }: PlacementFormDialogProps) {
  const branches = useStoreBranches();
  const create = useCreatePlacement(employeeId);
  const update = useUpdatePlacement();
  const [form, setForm] = useState(() => ({
    branch_id: placement?.branch_id ?? "",
    is_primary: placement?.is_primary ?? Boolean(firstPlacement),
    start_date: placement?.start_date ?? todayWib(),
    end_date: placement?.end_date ?? "",
    notes: placement?.notes ?? "",
  }));
  const saving = create.isPending || update.isPending;

  function handleSave() {
    if (!form.branch_id) {
      toast.error("Pilih toko");
      return;
    }
    if (form.end_date && form.end_date < form.start_date) {
      toast.error("Tanggal selesai tidak boleh sebelum tanggal mulai");
      return;
    }
    const payload = {
      branch_id: form.branch_id,
      is_primary: form.is_primary,
      start_date: form.start_date,
      end_date: form.end_date || null,
      notes: form.notes.trim() || null,
    };
    const done = {
      onSuccess: () => {
        toast.success(placement ? "Penempatan diperbarui" : "Penempatan ditambahkan");
        onOpenChange(false);
      },
      onError: (error: Error) => toast.error(error.message || "Gagal menyimpan penempatan"),
    };
    if (placement) update.mutate({ id: placement.id, payload }, done);
    else create.mutate(payload, done);
  }

  return (
    <>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Toko</label>
          <Select value={form.branch_id} onValueChange={(v) => setForm((f) => ({ ...f, branch_id: v }))}>
            <SelectTrigger>
              <SelectValue placeholder={branches.isLoading ? "Memuat toko…" : "Pilih toko"} />
            </SelectTrigger>
            <SelectContent>
              {(branches.data ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name} <span className="text-xs text-gray-400">({b.code})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Mulai</label>
            <Input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Selesai (opsional)</label>
            <Input
              type="date"
              value={form.end_date}
              min={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
            />
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.is_primary}
            onChange={(e) => setForm((f) => ({ ...f, is_primary: e.target.checked }))}
          />
          <span>
            Penempatan utama
            <span className="block text-xs text-gray-400">
              Dipakai sebagai toko bawaan saat clock-in dan untuk absensi tanpa toko. Penempatan utama
              lain pada rentang yang sama otomatis dilepas.
            </span>
          </span>
        </label>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Catatan (opsional)</label>
          <Input
            placeholder="cth. Perbantuan akhir pekan"
            value={form.notes}
            maxLength={500}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Batal
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
        </Button>
      </DialogFooter>
    </>
  );
}
