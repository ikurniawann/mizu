"use client";

import { useRouter } from "next/navigation";
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/format";
import { monthName } from "@/lib/hris/month-label";
import { shortDateId } from "@/lib/hris/attendance-period";
import type { PayrollRun } from "../types";

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  processing: "Processing",
  completed: "Completed",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_VARIANT: Record<string, "muted" | "warning" | "info" | "success" | "destructive"> = {
  draft: "muted",
  processing: "warning",
  completed: "info",
  paid: "success",
  cancelled: "destructive",
};

/** Status periode absensi (cut-off) bulan run: terbuka = payroll belum boleh diproses. */
function AttendancePeriodCell({ run }: { run: PayrollRun }) {
  const p = run.attendance_period;
  if (!p) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{p.label}</p>
      {p.status === "closed" ? (
        <Badge variant="muted">Closed</Badge>
      ) : (
        <Badge variant="warning" title="Absensi masih bisa berubah">
          Terbuka{p.closing_date ? ` · closing ${shortDateId(p.closing_date)}` : ""}
        </Badge>
      )}
    </div>
  );
}

/**
 * Tabel run payroll. `combined` = run gabungan sebelum payroll per entitas: tidak bisa
 * dihitung ulang, jadi draft-nya tanpa Hitung/Process (hapus lalu buat per entitas);
 * run yang sudah berjalan tetap bisa diselesaikan (Approve / Mark Paid).
 */
export function RunsTable({
  runs,
  combined = false,
  emptyText,
  onUpdateStatus,
  onDelete,
}: {
  runs: PayrollRun[];
  combined?: boolean;
  emptyText: string;
  onUpdateStatus: (runId: string, status: string) => void;
  onDelete: (runId: string) => void;
}) {
  const router = useRouter();
  const open = (id: string) => router.push(`/dashboard/hris/payroll/${id}`);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 px-3 font-medium text-muted-foreground">Periode</th>
            <th className="text-left py-3 px-3 font-medium text-muted-foreground">Status</th>
            <th className="text-left py-3 px-3 font-medium text-muted-foreground">Periode Absensi</th>
            <th className="text-right py-3 px-3 font-medium text-muted-foreground">Karyawan</th>
            <th className="text-right py-3 px-3 font-medium text-muted-foreground">Total Gross</th>
            <th className="text-right py-3 px-3 font-medium text-muted-foreground">Total Net</th>
            <th className="text-right py-3 px-3 font-medium text-muted-foreground">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-8 text-center text-muted-foreground">
                {emptyText}
              </td>
            </tr>
          ) : (
            runs.map((run) => {
              const periodOpen = run.attendance_period?.status === "open";
              const period = `${monthName(run.period_month)} ${run.period_year}`;
              return (
                <tr key={run.id} className="border-b hover:bg-surface">
                  <td className="py-3 px-3">
                    <p className="whitespace-nowrap font-medium">{period}</p>
                    {/* Nama run hanya ditampilkan bila diubah dari bawaan "Payroll <Bulan> <Tahun>". */}
                    {run.run_name !== `Payroll ${period}` && (
                      <p className="text-xs text-muted-foreground">{run.run_name}</p>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <Badge variant={STATUS_VARIANT[run.status] ?? "muted"}>{STATUS_LABELS[run.status] ?? run.status}</Badge>
                  </td>
                  <td className="py-3 px-3">
                    <AttendancePeriodCell run={run} />
                  </td>
                  <td className="text-right py-3 px-3">{run.total_employees || 0}</td>
                  <td className="text-right py-3 px-3 font-medium whitespace-nowrap">{formatRupiah(run.total_gross || 0)}</td>
                  <td className="text-right py-3 px-3 font-medium text-success whitespace-nowrap">
                    {formatRupiah(run.total_net || 0)}
                  </td>
                  <td className="text-right py-3 px-3 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => open(run.id)} aria-label="Lihat detail">
                        <DocumentTextIcon className="w-4 h-4" />
                      </Button>
                      {run.status === "draft" && !combined && (
                        <>
                          <Button size="sm" onClick={() => open(run.id)}>
                            Hitung
                          </Button>
                          <Button
                            size="sm"
                            variant="ink"
                            onClick={() => onUpdateStatus(run.id, "processing")}
                            disabled={periodOpen}
                            title={periodOpen ? "Closing periode absensi dulu (HRIS → Absensi → Periode Absensi)" : undefined}
                          >
                            Process
                          </Button>
                        </>
                      )}
                      {run.status === "processing" && (
                        <Button
                          size="sm"
                          variant="ink"
                          onClick={() => onUpdateStatus(run.id, "completed")}
                          disabled={periodOpen}
                          title={periodOpen ? "Closing periode absensi dulu sebelum menyetujui payroll" : undefined}
                        >
                          Approve
                        </Button>
                      )}
                      {run.status === "completed" && (
                        <Button size="sm" variant="ink" onClick={() => onUpdateStatus(run.id, "paid")}>
                          Mark Paid
                        </Button>
                      )}
                      {run.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onDelete(run.id)}
                          className="text-danger"
                        >
                          Hapus
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
