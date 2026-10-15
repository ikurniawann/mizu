"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupiah } from "@/lib/format";
import { monthName } from "@/lib/hris/month-label";
import { ALLOCATION_BASIS_LABEL, NO_STORE_LABEL, formatQty, formatRatio } from "@/lib/payroll/store-allocation";
import { downloadStoreCosts } from "../api";
import { usePayrollRuns, useStoreCosts } from "../queries";
import type { StoreCostStore } from "../types";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  processing: "Diproses",
  completed: "Disetujui",
  paid: "Dibayar",
  cancelled: "Dibatalkan",
};

const storeKey = (s: { branch_id: string | null }) => s.branch_id ?? "none";

/**
 * HRIS → Penggajian → Biaya Gaji per Toko: biaya tenaga kerja satu run payroll
 * per toko (gaji kotor + beban BPJS/Tapera perusahaan) dari alokasi slip per
 * toko, dengan rincian karyawan per toko dan ekspor CSV/Excel.
 */
export function StoreCostReportPage() {
  const router = useRouter();
  const params = useSearchParams();
  const runs = usePayrollRuns();
  const runList = runs.data ?? [];
  const runId = params.get("run") || runList[0]?.id || "";
  const report = useStoreCosts(runId);
  const data = report.data;
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);

  const employeesByStore = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["employees"]>();
    for (const e of data?.employees ?? []) {
      const key = storeKey(e);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return map;
  }, [data]);

  async function handleExport(format: "csv" | "xlsx") {
    if (!data) return;
    setExporting(format);
    try {
      const blob = await downloadStoreCosts(data.run.id, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `biaya-gaji-per-toko-${data.run.period_year}-${String(data.run.period_month).padStart(2, "0")}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export gagal");
    } finally {
      setExporting(null);
    }
  }

  const share = (s: StoreCostStore) =>
    data && data.totals.labor_cost > 0 ? formatRatio(s.labor_cost / data.totals.labor_cost) : "—";

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        kicker="HRIS · Penggajian"
        title="Biaya Gaji per Toko"
        description="Biaya tenaga kerja per toko dari slip gaji yang dibagi sesuai jam/hari hadir karyawan di tiap toko."
        actions={
          <>
            <Select value={runId} onValueChange={(v) => router.replace(`/dashboard/hris/payroll/store-costs?run=${v}`)}>
              <SelectTrigger className="w-60">
                <SelectValue placeholder={runs.isLoading ? "Memuat run…" : "Pilih periode payroll"} />
              </SelectTrigger>
              <SelectContent>
                {runList.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {monthName(r.period_month)} {r.period_year} · {STATUS_LABEL[r.status] ?? r.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!data || exporting !== null} onClick={() => handleExport("xlsx")}>
              <Download className="mr-1.5 h-4 w-4" /> {exporting === "xlsx" ? "Mengekspor…" : "Excel"}
            </Button>
            <Button variant="ghost" disabled={!data || exporting !== null} onClick={() => handleExport("csv")}>
              {exporting === "csv" ? "…" : "CSV"}
            </Button>
          </>
        }
      />

      {!runId && !runs.isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-gray-500">Belum ada run payroll.</CardContent>
        </Card>
      ) : report.isLoading || runs.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : report.isError || !data ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-red-500">
            {report.error?.message || "Gagal memuat laporan"}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total biaya tenaga kerja" value={formatRupiah(data.totals.labor_cost)} tone="accent" />
            <StatCard label="Gaji kotor" value={formatRupiah(data.totals.gross_amount)} />
            <StatCard
              label="Beban perusahaan (BPJS/Tapera)"
              value={formatRupiah(data.totals.employer_contribution_amount)}
            />
            <StatCard label="Gaji bersih dibayar" value={formatRupiah(data.totals.net_amount)} tone="success" hint={`${data.totals.employee_count} karyawan`} />
          </div>

          {data.unallocated_slips > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {data.unallocated_slips} slip pada run ini dihitung sebelum alokasi per toko tersedia dan tidak masuk
              laporan ini{data.run.status === "draft" ? " — hitung ulang run untuk membaginya." : "."}
            </p>
          )}

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
                      <th className="p-3">Toko</th>
                      <th className="p-3 text-right">Karyawan</th>
                      <th className="p-3 text-right">Gaji Kotor</th>
                      <th className="p-3 text-right">Potongan</th>
                      <th className="p-3 text-right">BPJS TK Perusahaan</th>
                      <th className="p-3 text-right">BPJS Kes Perusahaan</th>
                      <th className="p-3 text-right">Total Biaya Tenaga Kerja</th>
                      <th className="p-3 text-right">Porsi</th>
                      <th className="p-3 text-right">Gaji Bersih</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stores.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-10 text-center text-gray-400">
                          Run ini belum dihitung atau belum punya alokasi toko.
                        </td>
                      </tr>
                    )}
                    {data.stores.map((s) => {
                      const key = storeKey(s);
                      const expanded = open === key;
                      const staff = employeesByStore.get(key) ?? [];
                      return (
                        <Fragment key={key}>
                          <tr
                            className={`cursor-pointer border-b border-gray-50 hover:bg-gray-50 ${s.branch_id ? "" : "bg-amber-50/60"}`}
                            onClick={() => setOpen(expanded ? null : key)}
                          >
                            <td className="p-3">
                              <div className="flex items-center gap-1.5 font-medium text-gray-900">
                                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                {s.branch_name || NO_STORE_LABEL}
                              </div>
                              <p className="pl-5 text-xs text-gray-400">
                                {formatQty(s.days)} hari · {formatQty(s.hours)} jam
                              </p>
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {s.employee_count}
                              <span className="block text-xs text-gray-400">{formatQty(s.fte)} FTE</span>
                            </td>
                            <td className="p-3 text-right tabular-nums">{formatRupiah(s.gross_amount)}</td>
                            <td className="p-3 text-right tabular-nums text-red-600">{formatRupiah(s.deductions_amount)}</td>
                            <td className="p-3 text-right tabular-nums">{formatRupiah(s.employer_bpjs_tk_amount)}</td>
                            <td className="p-3 text-right tabular-nums">{formatRupiah(s.employer_bpjs_kes_amount)}</td>
                            <td className="p-3 text-right font-semibold tabular-nums">{formatRupiah(s.labor_cost)}</td>
                            <td className="p-3 text-right tabular-nums text-gray-500">{share(s)}</td>
                            <td className="p-3 text-right tabular-nums text-green-700">{formatRupiah(s.net_amount)}</td>
                          </tr>
                          {expanded && (
                            <tr className="border-b border-gray-100 bg-gray-50/60">
                              <td colSpan={9} className="px-6 py-3">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-gray-500">
                                      <th className="py-1.5">Karyawan</th>
                                      <th className="py-1.5">Dasar alokasi</th>
                                      <th className="py-1.5 text-right">Hari</th>
                                      <th className="py-1.5 text-right">Jam</th>
                                      <th className="py-1.5 text-right">Porsi</th>
                                      <th className="py-1.5 text-right">Gaji kotor</th>
                                      <th className="py-1.5 text-right">Beban perusahaan</th>
                                      <th className="py-1.5 text-right">Total biaya</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {staff.map((e) => (
                                      <tr key={e.employee_id} className="border-t border-gray-200/60">
                                        <td className="py-1.5">
                                          <span className="font-medium text-gray-800">{e.full_name}</span>
                                          <span className="ml-1 text-gray-400">{e.nip}</span>
                                          {e.ratio < 1 && (
                                            <Badge variant="outline" className="ml-2 text-[10px]">
                                              multi-toko
                                            </Badge>
                                          )}
                                        </td>
                                        <td className="py-1.5 text-gray-500">{ALLOCATION_BASIS_LABEL[e.basis] ?? e.basis}</td>
                                        <td className="py-1.5 text-right tabular-nums">{formatQty(e.days)}</td>
                                        <td className="py-1.5 text-right tabular-nums">{formatQty(e.hours)}</td>
                                        <td className="py-1.5 text-right tabular-nums">{formatRatio(e.ratio)}</td>
                                        <td className="py-1.5 text-right tabular-nums">{formatRupiah(e.gross_amount)}</td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {formatRupiah(e.employer_contribution_amount)}
                                        </td>
                                        <td className="py-1.5 text-right font-medium tabular-nums">{formatRupiah(e.labor_cost)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  {data.stores.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                        <td className="p-3">Total</td>
                        <td className="p-3 text-right tabular-nums">{data.totals.employee_count}</td>
                        <td className="p-3 text-right tabular-nums">{formatRupiah(data.totals.gross_amount)}</td>
                        <td className="p-3 text-right tabular-nums text-red-600">{formatRupiah(data.totals.deductions_amount)}</td>
                        <td className="p-3 text-right tabular-nums">{formatRupiah(data.totals.employer_bpjs_tk_amount)}</td>
                        <td className="p-3 text-right tabular-nums">{formatRupiah(data.totals.employer_bpjs_kes_amount)}</td>
                        <td className="p-3 text-right tabular-nums">{formatRupiah(data.totals.labor_cost)}</td>
                        <td className="p-3 text-right tabular-nums">100,0%</td>
                        <td className="p-3 text-right tabular-nums text-green-700">{formatRupiah(data.totals.net_amount)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-gray-500">
            {data.run.run_name} · status {STATUS_LABEL[data.run.status] ?? data.run.status}. Klik baris toko untuk
            melihat karyawannya. Karyawan multi-toko muncul di setiap toko sesuai porsinya; satu slip, satu
            perhitungan PPh 21/BPJS. Beban Tapera perusahaan termasuk dalam beban perusahaan.
          </p>
        </>
      )}
    </div>
  );
}
