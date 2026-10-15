"use client";

import { useRouter } from "next/navigation";
import { Cog6ToothIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { formatRupiah } from "@/lib/format";
import { monthName } from "@/lib/hris/month-label";
import { shortDateId } from "@/lib/hris/attendance-period";
import type { PayrollRun } from "../types";
import { usePayrollRuns } from "../queries";
import { useUpdatePayrollStatus, useDeletePayrollRun } from "../mutations";
import { EntityTabs, useEntityParam } from "./entity-tabs";
import { NewRunForm } from "./new-run-form";

const LEGACY = "legacy";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  processing: "Processing",
  completed: "Completed",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  processing: "bg-yellow-100 text-yellow-700",
  completed: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

/** Status periode absensi (cut-off) bulan run: terbuka = payroll belum boleh diproses. */
function AttendancePeriodCell({ run }: { run: PayrollRun }) {
  const p = run.attendance_period;
  if (!p) return <span className="text-xs text-gray-400">—</span>;
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-gray-600">{p.label}</p>
      {p.status === "closed" ? (
        <Badge className="bg-slate-100 text-slate-700">🔒 Closed</Badge>
      ) : (
        <Badge className="bg-amber-100 text-amber-800" title="Absensi masih bisa berubah">
          Terbuka{p.closing_date ? ` · closing ${shortDateId(p.closing_date)}` : ""}
        </Badge>
      )}
    </div>
  );
}

export function PayrollPage() {
  const router = useRouter();
  const payrollQuery = usePayrollRuns();
  const payrollRuns = payrollQuery.data ?? [];
  const extra = payrollRuns.some((r) => !r.company_id) ? [{ value: LEGACY, label: "Run lama" }] : [];
  const { entity, setEntity, entities, loading: entitiesLoading, error: entitiesError } = useEntityParam(extra);
  const isLegacy = entity === LEGACY;
  const entityName = entities.find((e) => e.id === entity)?.name ?? "";
  const runs = payrollRuns.filter((r) => (isLegacy ? !r.company_id : r.company_id === entity));

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
      ) : entities.length === 0 && !isLegacy ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Belum ada entitas aktif. Tambahkan perusahaan di pengaturan struktur bisnis.
          </CardContent>
        </Card>
      ) : (
        <>
          <EntityTabs value={entity} entities={entities} extra={extra} onChange={setEntity} />

          {isLegacy ? (
            <Card variant="soft">
              <CardContent className="py-4 text-sm text-muted-foreground">
                Run lama dibuat sebelum payroll per entitas. Run yang sudah dibayar tetap sah; run draft tidak bisa
                dihitung ulang — hapus lalu buat per entitas.
              </CardContent>
            </Card>
          ) : (
            <NewRunForm companyId={entity} companyName={entityName} />
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard label="Total payroll run" value={runs.length} />
            <StatCard label="Dalam draft" value={runs.filter((r) => r.status === "draft").length} />
            <StatCard label="Completed" value={runs.filter((r) => r.status === "completed").length} />
            <StatCard label="Paid" value={runs.filter((r) => r.status === "paid").length} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Riwayat Payroll — {isLegacy ? "Run lama" : entityName}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Periode</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Nama</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Status</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Periode Absensi</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Karyawan</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Total Gross</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Total Net</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-gray-500">
                          Belum ada payroll untuk entitas ini. Pilih bulan & tahun di atas lalu klik &quot;Buat Payroll&quot;.
                        </td>
                      </tr>
                    ) : (
                      runs.map((run) => (
                        <tr key={run.id} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4">
                            {monthName(run.period_month)} {run.period_year}
                          </td>
                          <td className="py-3 px-4">{run.run_name}</td>
                          <td className="py-3 px-4">
                            <Badge className={STATUS_COLORS[run.status]}>{STATUS_LABELS[run.status]}</Badge>
                          </td>
                          <td className="py-3 px-4">
                            <AttendancePeriodCell run={run} />
                          </td>
                          <td className="text-right py-3 px-4">{run.total_employees || 0}</td>
                          <td className="text-right py-3 px-4 font-medium">{formatRupiah(run.total_gross || 0)}</td>
                          <td className="text-right py-3 px-4 font-medium text-green-600">
                            {formatRupiah(run.total_net || 0)}
                          </td>
                          <td className="text-right py-3 px-4">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => router.push(`/dashboard/hris/payroll/${run.id}`)}
                              >
                                <DocumentTextIcon className="w-4 h-4" />
                              </Button>
                              {run.status === "draft" && run.company_id && (
                                <>
                                  <Button size="sm" onClick={() => router.push(`/dashboard/hris/payroll/${run.id}`)}>
                                    Hitung
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ink"
                                    onClick={() => handleUpdateStatus(run.id, "processing")}
                                    disabled={run.attendance_period?.status === "open"}
                                    title={
                                      run.attendance_period?.status === "open"
                                        ? "Closing periode absensi dulu (HRIS → Absensi → Periode Absensi)"
                                        : undefined
                                    }
                                  >
                                    Process
                                  </Button>
                                </>
                              )}
                              {run.status === "processing" && (
                                <Button
                                  size="sm"
                                  variant="ink"
                                  onClick={() => handleUpdateStatus(run.id, "completed")}
                                  disabled={run.attendance_period?.status === "open"}
                                  title={
                                    run.attendance_period?.status === "open"
                                      ? "Closing periode absensi dulu sebelum menyetujui payroll"
                                      : undefined
                                  }
                                >
                                  Approve
                                </Button>
                              )}
                              {run.status === "completed" && (
                                <Button size="sm" variant="ink" onClick={() => handleUpdateStatus(run.id, "paid")}>
                                  Mark Paid
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDelete(run.id)}
                                className="text-red-600 hover:text-red-700 hover:border-red-300"
                              >
                                Hapus
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
