"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, Cog6ToothIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { usePayrollRuns } from "../queries";
import { useUpdatePayrollStatus, useDeletePayrollRun } from "../mutations";
import { EntityTabs, useEntityParam } from "./entity-tabs";
import { NewRunForm } from "./new-run-form";
import { RunsTable, STATUS_LABELS } from "./runs-table";

export function PayrollPage() {
  const router = useRouter();
  const payrollQuery = usePayrollRuns();
  const payrollRuns = payrollQuery.data ?? [];
  const { entity, setEntity, entities, loading: entitiesLoading, error: entitiesError } = useEntityParam();
  const entityName = entities.find((e) => e.id === entity)?.name ?? "";
  const runs = payrollRuns.filter((r) => r.company_id === entity);
  // Run gabungan (sebelum payroll per entitas) tidak milik satu entitas: bukan tab, tapi kartu terpisah.
  const combinedRuns = payrollRuns.filter((r) => !r.company_id);
  const [showCombined, setShowCombined] = useState(false);

  const updateStatusMutation = useUpdatePayrollStatus();
  const deleteMutation = useDeletePayrollRun();

  async function handleUpdateStatus(runId: string, newStatus: string) {
    try {
      await updateStatusMutation.mutateAsync({ runId, status: newStatus });
      toast.success(`Status diubah ke ${STATUS_LABELS[newStatus]}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal update status");
    }
  }

  async function handleDelete(runId: string) {
    if (!confirm("Apakah Anda yakin ingin menghapus payroll run ini? Data detail payroll juga akan terhapus.")) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(runId);
      toast.success("Payroll run berhasil dihapus");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus payroll");
    }
  }

  if (payrollQuery.isLoading || entitiesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        kicker="HRIS · Penggajian"
        title="Payroll & Benefits"
        description="Proses gaji per entitas: pilih entitas, buat payroll periode, lalu hitung di halaman detail."
        actions={
          <Button variant="outline" onClick={() => router.push("/dashboard/hris/payroll/settings")}>
            <Cog6ToothIcon className="w-4 h-4 mr-2" />
            Pengaturan
          </Button>
        }
      />

      {entitiesError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-danger">
            Gagal memuat entitas — muat ulang halaman.
          </CardContent>
        </Card>
      ) : entities.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Belum ada entitas aktif. Tambahkan perusahaan di pengaturan struktur bisnis.
          </CardContent>
        </Card>
      ) : (
        <>
          <EntityTabs value={entity} entities={entities} onChange={setEntity} />

          <NewRunForm companyId={entity} companyName={entityName} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard label="Total payroll run" value={runs.length} />
            <StatCard label="Dalam draft" value={runs.filter((r) => r.status === "draft").length} />
            <StatCard label="Completed" value={runs.filter((r) => r.status === "completed").length} />
            <StatCard label="Paid" value={runs.filter((r) => r.status === "paid").length} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Riwayat Payroll — {entityName}</CardTitle>
            </CardHeader>
            <CardContent>
              <RunsTable
                runs={runs}
                emptyText={`Belum ada payroll untuk ${entityName}. Pilih bulan & tahun di atas lalu klik "Buat Payroll ${entityName}".`}
                onUpdateStatus={handleUpdateStatus}
                onDelete={handleDelete}
              />
            </CardContent>
          </Card>

          {combinedRuns.length > 0 && (
            <Card variant="soft">
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <CardTitle>Run gabungan — sebelum payroll per entitas</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Dibuat sebelum payroll per entitas dan tidak bisa dipastikan milik satu entitas, jadi tidak masuk
                    tab mana pun. Run yang sudah dibayar tetap sah; run draft tidak bisa dihitung ulang — hapus lalu
                    buat per entitas.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCombined((v) => !v)}
                  aria-expanded={showCombined}
                >
                  {showCombined ? "Sembunyikan" : `Tampilkan (${combinedRuns.length})`}
                  <ChevronDownIcon className={`ml-1.5 h-4 w-4 transition-transform ${showCombined ? "rotate-180" : ""}`} />
                </Button>
              </CardHeader>
              {showCombined && (
                <CardContent>
                  <RunsTable
                    runs={combinedRuns}
                    combined
                    emptyText="Tidak ada run gabungan."
                    onUpdateStatus={handleUpdateStatus}
                    onDelete={handleDelete}
                  />
                </CardContent>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
