"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Download, Receipt, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { commissionReportCsv, downloadCsv } from "../csv";
import { useCommissionReport, useSpaOutlets } from "../queries";
import { commissionValueLabel } from "../rules";
import { currentMonthWib, monthRange } from "../time";
import type { Outlet } from "../types";
import { PayrollTab } from "./payroll-tab";
import { OutletSelect, SELECT, SPA_KICKER, TableNote } from "./shared";

/** Laporan komisi dan payroll terapis. */
export function SpaCommissionsPage() {
  const outlets = useSpaOutlets();
  return (
    <div className="space-y-4">
      <PageHeader
        kicker={SPA_KICKER}
        title="Laporan Komisi"
        description="Komisi dibekukan saat item treatment selesai, dan baru diakui di laporan bila booking-nya sudah lunas."
      />
      <Tabs defaultValue="report" className="w-full flex-col">
        <TabsList>
          <TabsTrigger value="report">Laporan</TabsTrigger>
          <TabsTrigger value="payroll">Payroll Terapis</TabsTrigger>
        </TabsList>
        <TabsContent value="report" className="mt-4">
          <ReportTab outlets={outlets.data ?? []} />
        </TabsContent>
        <TabsContent value="payroll" className="mt-4">
          <PayrollTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Laporan ──────────────────────────────────────────────────────────────────

function ReportTab({ outlets }: { outlets: Outlet[] }) {
  const [initial] = useState(() => monthRange(currentMonthWib()));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [branchId, setBranchId] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const invalid = !from || !to || from > to;
  const report = useCommissionReport({ from: invalid ? "" : from, to: invalid ? "" : to, branch_id: branchId || undefined });
  const rows = report.data?.therapists ?? [];
  const treatments = rows.reduce((sum, t) => sum + t.treatment_count, 0);
  const revenue = rows.reduce((sum, t) => sum + t.revenue_idr, 0);
  const outletName = outlets.find((o) => o.branch_id === branchId)?.branch_name;

  const exportCsv = () => {
    if (!report.data) return;
    const suffix = outletName ? `-${outletName.replace(/[^\w-]+/g, "_")}` : "";
    downloadCsv(`komisi-terapis-${from}_${to}${suffix}.csv`, commissionReportCsv(report.data));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_10rem_minmax(0,16rem)_1fr] sm:items-center">
        <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="Dari tanggal" />
        <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Sampai tanggal" />
        <OutletSelect outlets={outlets} value={branchId} onChange={setBranchId} className={SELECT} allLabel="Semua outlet" />
        <div className="flex sm:justify-end">
          <Button variant="outline" onClick={exportCsv} disabled={!report.data || rows.length === 0}>
            <Download /> Ekspor CSV
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Item selesai {formatDate(from)} – {formatDate(to)} (WIB) · {outletName ?? "semua outlet"} · hanya booking lunas
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Total komisi" value={formatRupiah(report.data?.total_idr ?? 0)} icon={<Wallet />} tone="ink" />
        <StatCard label="Treatment selesai & lunas" value={formatNumber(treatments)} icon={<Receipt />} />
        <StatCard label="Omzet treatment" value={formatRupiah(revenue)} hint={`${formatNumber(rows.length)} terapis`} icon={<Users />} />
      </div>

      <Card className="py-0">
        {invalid ? (
          <TableNote tone="danger">Periode tidak valid — tanggal awal harus sebelum tanggal akhir.</TableNote>
        ) : report.isLoading ? (
          <div className="p-4">
            <SkeletonTable columns={5} rows={5} />
          </div>
        ) : report.error ? (
          <TableNote tone="danger">{report.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada komisi pada periode ini.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Terapis</TableHead>
                <TableHead className="text-right">Treatment</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Omzet</TableHead>
                <TableHead className="text-right">Komisi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const expanded = !!open[t.therapist_id];
                return (
                  <Fragment key={t.therapist_id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setOpen((o) => ({ ...o, [t.therapist_id]: !expanded }))}
                      aria-expanded={expanded}
                    >
                      <TableCell>
                        <span className="flex items-center gap-2">
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          <span>
                            <span className="font-medium">{t.full_name}</span>
                            <span className="block text-xs text-muted-foreground">{t.nip ?? "-"}</span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(t.treatment_count)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatRupiah(t.revenue_idr)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(t.commission_idr)}</TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="bg-surface-2 hover:bg-surface-2">
                        <TableCell colSpan={4} className="p-0">
                          <div className="overflow-x-auto px-4 py-3">
                            <table className="w-full text-xs">
                              <thead className="text-muted-foreground">
                                <tr className="text-left">
                                  <th className="py-1 pr-3 font-medium">Selesai</th>
                                  <th className="py-1 pr-3 font-medium">Booking</th>
                                  <th className="py-1 pr-3 font-medium">Outlet</th>
                                  <th className="py-1 pr-3 font-medium">Treatment</th>
                                  <th className="py-1 pr-3 text-right font-medium">Harga</th>
                                  <th className="py-1 pr-3 text-right font-medium">Aturan</th>
                                  <th className="py-1 text-right font-medium">Komisi</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.lines.map((l) => (
                                  <tr key={l.item_id} className="border-t border-border">
                                    <td className="py-1.5 pr-3 whitespace-nowrap">{formatDateTime(l.completed_at)}</td>
                                    <td className="py-1.5 pr-3 font-mono">{l.booking_code}</td>
                                    <td className="py-1.5 pr-3">{l.branch_name}</td>
                                    <td className="py-1.5 pr-3">
                                      {l.treatment_name} — {l.variant_name}
                                    </td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatRupiah(l.price_idr)}</td>
                                    <td className="py-1.5 pr-3 text-right">{commissionValueLabel(l.commission_type, l.commission_value)}</td>
                                    <td className="py-1.5 text-right font-medium tabular-nums">{formatRupiah(l.commission_idr)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
