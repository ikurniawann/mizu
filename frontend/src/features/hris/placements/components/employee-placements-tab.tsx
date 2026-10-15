"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { IAM } from "@/lib/iam/prefixes";
import { todayWib } from "@/lib/dates";
import {
  PLACEMENT_STATUS_LABEL,
  placementRangeLabel,
  placementStatus,
  type PlacementStatus,
} from "@/lib/hris/placements";
import { useDeletePlacement, useUpdatePlacement } from "../mutations";
import { useEmployeePlacements } from "../queries";
import type { Placement } from "../types";
import { PlacementFormDialog } from "./placement-form-dialog";

/** Pengelola penempatan: pengelola data karyawan atau menu Penempatan Karyawan. */
export const PLACEMENT_MANAGERS = [...IAM.hrisKepegawaian, ...IAM.settingsUsers, ...IAM.hrisPlacements] as const;

const STATUS_CLASS: Record<PlacementStatus, string> = {
  aktif: "bg-green-100 text-green-700 hover:bg-green-100",
  akan_datang: "bg-blue-100 text-blue-700 hover:bg-blue-100",
  berakhir: "bg-gray-100 text-gray-500 hover:bg-gray-100",
};

/**
 * Tab "Penempatan" di detail karyawan: toko tempat karyawan bekerja. Satu
 * karyawan bisa di beberapa toko; penempatan utama menjadi toko bawaan saat
 * clock-in, dan biaya gajinya dibagi per toko sesuai absensi.
 */
export function EmployeePlacementsTab({ employeeId, employeeName }: { employeeId: string; employeeName?: string }) {
  const canManage = useIamAccess().hasPrefix(PLACEMENT_MANAGERS);
  const query = useEmployeePlacements(employeeId);
  const update = useUpdatePlacement();
  const remove = useDeletePlacement();
  const [editing, setEditing] = useState<Placement | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Placement | null>(null);
  const today = todayWib();
  const rows = query.data ?? [];
  const running = rows.filter((p) => placementStatus(p, today) !== "berakhir");

  function openForm(p: Placement | null) {
    setEditing(p);
    setFormOpen(true);
  }

  function patch(p: Placement, payload: { is_primary?: boolean; end_date?: string }, message: string) {
    update.mutate(
      { id: p.id, payload },
      {
        onSuccess: () => toast.success(message),
        onError: (error) => toast.error(error.message || "Gagal memperbarui penempatan"),
      }
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Penempatan Toko</h3>
          <p className="max-w-2xl text-xs text-gray-500">
            Toko tempat karyawan bekerja. Saat clock-in karyawan memilih salah satu toko aktifnya (otomatis bila
            hanya satu); biaya gaji dibagi ke toko sesuai jam/hari hadir per toko. Satu slip gaji, satu
            perhitungan PPh 21/BPJS.
          </p>
          {query.isError && <p className="mt-1 text-xs text-red-600">Gagal memuat penempatan</p>}
        </div>
        {canManage && (
          <Button size="sm" onClick={() => openForm(null)}>
            <Plus className="mr-1 h-4 w-4" /> Tambah Toko
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Karyawan ini belum punya penempatan toko. Biaya gajinya akan masuk ke kelompok <b>Tanpa toko</b> pada
          laporan biaya gaji per toko.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200/70">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
                <th className="p-3">Toko</th>
                <th className="p-3">Periode</th>
                <th className="p-3">Status</th>
                <th className="p-3">Catatan</th>
                {canManage && <th className="p-3 text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const status = placementStatus(p, today);
                return (
                  <tr key={p.id} className="border-b border-gray-50 last:border-0">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{p.branch_name}</span>
                        {p.is_primary && (
                          <Badge className="gap-1 bg-primary/10 text-brand-text hover:bg-primary/10">
                            <Star className="h-3 w-3 fill-current" /> Utama
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">{p.branch_code}</span>
                    </td>
                    <td className="p-3 whitespace-nowrap text-gray-600">{placementRangeLabel(p)}</td>
                    <td className="p-3">
                      <Badge className={STATUS_CLASS[status]}>
                        {PLACEMENT_STATUS_LABEL[status]}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-gray-500">{p.notes || "—"}</td>
                    {canManage && (
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          {!p.is_primary && status !== "berakhir" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={update.isPending}
                              title="Jadikan penempatan utama"
                              onClick={() => patch(p, { is_primary: true }, `${p.branch_name} menjadi penempatan utama`)}
                            >
                              <Star className="h-4 w-4" />
                            </Button>
                          )}
                          {status === "aktif" && !p.end_date && running.length > 1 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={update.isPending}
                              title="Akhiri penempatan hari ini"
                              onClick={() => patch(p, { end_date: today }, `Penempatan ${p.branch_name} diakhiri`)}
                            >
                              Akhiri
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" title="Ubah" onClick={() => openForm(p)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            title="Hapus"
                            onClick={() => setDeleting(p)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PlacementFormDialog
        open={formOpen}
        employeeId={employeeId}
        employeeName={employeeName}
        placement={editing}
        firstPlacement={running.length === 0}
        onOpenChange={setFormOpen}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus penempatan?"
        description={
          deleting
            ? `Penempatan di ${deleting.branch_name} dihapus. Absensi yang sudah tercatat di toko ini tidak berubah; untuk riwayat, lebih baik "Akhiri".`
            : undefined
        }
        confirmLabel="Hapus"
        variant="danger"
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Penempatan dihapus");
              setDeleting(null);
            },
            onError: (error) => toast.error(error.message || "Gagal menghapus"),
          })
        }
      />
    </div>
  );
}
