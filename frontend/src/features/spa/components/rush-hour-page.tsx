"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarDays, Clock3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { percentage, periodLabel, validDate } from "@/lib/booking-report";
import { cn } from "@/lib/utils";
import { useSpaOutlets } from "../queries";
import { currentMonthWib, monthRange } from "../time";
import { OutletSelect, SELECT } from "./shared";
import { getRushHourReport, type RushHourReportParams } from "../rush-hour-api";

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const hourRange = (hour: number) => `${hourLabel(hour)}–${String(hour).padStart(2, "0")}:59`;

export function SpaRushHourPage() {
  const [filters, setFilters] = useState<RushHourReportParams>(() => monthRange(currentMonthWib()));
  const outlets = useSpaOutlets();
  const invalid = !validDate(filters.from) || !validDate(filters.to) || filters.from > filters.to;
  const report = useQuery({
    queryKey: ["spa", "reports", "rush-hour", filters],
    queryFn: ({ signal }) => getRushHourReport(filters, signal),
    enabled: !invalid && outlets.isSuccess,
    retry: false,
  });
  const loading = !invalid && (outlets.isPending || outlets.isFetching || report.isPending || report.isFetching);
  const error = outlets.error ?? report.error;
  const data = !invalid && !error && !loading ? report.data : undefined;
  const total = data?.total_bookings;
  const hourly = data?.hourly ?? [];
  const peaks = data?.peak_hours ?? [];
  const outletName = outlets.data?.find((o) => o.branch_id === filters.branch_id)?.branch_name ?? "Semua outlet";
  const title = "Rush Hour";
  const rows = hourly.map((row) => ({ key: String(row.hour), label: hourRange(row.hour), bookings: row.bookings, peak: peaks.includes(row.hour) }));
  const retry = () => {
    if (outlets.isError) void outlets.refetch();
    else void report.refetch();
  };

  return (
    <div className="space-y-5">
      <PageHeader kicker="Spa Report" title={title} description="Kenali jam booking paling ramai untuk membantu perencanaan operasional outlet." />
      <Card className="gap-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.3fr_auto] xl:items-end">
          <label className="space-y-2 text-xs font-medium">
            <span>Tanggal awal</span>
            <Input type="date" aria-label="Tanggal awal" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </label>
          <label className="space-y-2 text-xs font-medium">
            <span>Tanggal akhir</span>
            <Input type="date" aria-label="Tanggal akhir" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </label>
          <label className="space-y-2 text-xs font-medium">
            <span>Outlet</span>
            <OutletSelect outlets={outlets.data ?? []} value={filters.branch_id ?? ""} onChange={(branch_id) => setFilters({ ...filters, branch_id: branch_id || undefined })}
              className={cn(SELECT, "w-full")} allLabel="Semua outlet" onlyConfigured={false} />
          </label>
          <Button variant="outline" onClick={() => void report.refetch()} disabled={invalid || loading || !outlets.isSuccess}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} /> Perbarui
          </Button>
        </div>
      </Card>
      {invalid && <p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">Tanggal wajib diisi dan tanggal awal tidak boleh setelah tanggal akhir.</p>}
      {!invalid && error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-danger-soft p-4 text-sm text-danger">
          <span>{error.message}</span><Button variant="outline" onClick={retry} disabled={outlets.isFetching || report.isFetching}>Coba lagi</Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Total booking" value={total === undefined ? "—" : formatNumber(total)} icon={<CalendarDays />} tone="ink" hint="Satu booking dihitung satu kali" />
        <StatCard label="Jam tersibuk" value={peaks.length ? hourLabel(peaks[0]) : "—"}
          icon={<Clock3 />} tone="accent"
          hint={data ? peaks.length ? `${formatNumber(data.peak_bookings)} booking${peaks.length > 1 ? ` · Jam lain: ${peaks.slice(1).map(hourLabel).join(", ")}` : " · WIB"}` : "Belum ada jam tersibuk" : "Menunggu data laporan"} />
      </div>
      {!invalid && !error && loading && <div aria-label="Memuat laporan" aria-busy="true" className="space-y-4"><Skeleton className="h-72 w-full rounded-xl" /><SkeletonTable columns={3} rows={6} /></div>}
      {data && (
        <>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />
            {periodLabel(data.from, "daily")} – {periodLabel(data.to, "daily")} · {outletName} · WIB (Asia/Jakarta)
          </p>
          {data.total_bookings === 0 && <p role="status" className="rounded-xl bg-surface-2 p-4 text-sm text-muted-foreground">Belum ada booking pada periode ini.</p>}
          <Card className="gap-5 p-5">
            <div className="flex items-start gap-3"><BarChart3 className="mt-0.5 size-5 text-brand-text" />
              <div><h2 id="spa-report-chart-title" className="text-sm font-semibold">Distribusi booking per jam</h2>
                <p className="mt-1 text-xs text-muted-foreground">Jumlah booking berdasarkan jam mulai · jam tersibuk ditandai · WIB</p>
              </div>
            </div>
            <div role="img" aria-labelledby="spa-report-chart-title" className="overflow-x-auto pb-2">
              <div className="grid min-w-[800px] grid-cols-24 gap-2">
                {hourly.map((row) => <div key={row.hour} className="flex flex-col items-center gap-2">
                  <span className="text-[10px] text-muted-foreground tabular-nums">{formatNumber(row.bookings)}</span>
                  <div className="flex h-48 w-full items-end rounded-sm bg-surface-2">
                    <div title={`${hourRange(row.hour)} WIB: ${formatNumber(row.bookings)} booking`} className={cn("w-full rounded-t-sm", peaks.includes(row.hour) ? "bg-accent" : "bg-accent/35")}
                      style={{ height: `${row.bookings / Math.max(1, ...hourly.map((h) => h.bookings)) * 100}%` }} />
                  </div><span className="text-[10px] text-muted-foreground tabular-nums">{String(row.hour).padStart(2, "0")}:00</span>
                </div>)}
              </div>
            </div>
          </Card>
          <Card className="overflow-hidden py-0">
            <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Rincian per jam</h2></div>
            <Table>
              <caption className="sr-only">{title}: jumlah dan persentase booking {data.from} sampai {data.to}, {outletName}, WIB</caption>
              <TableHeader><TableRow><TableHead>Jam WIB</TableHead><TableHead className="text-right">Jumlah booking</TableHead><TableHead className="text-right">Persentase</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((row) => <TableRow key={row.key} className={cn(row.peak && "bg-accent/5 font-semibold")}>
                <TableCell className="whitespace-nowrap">{row.label}{row.peak && <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-brand-text">Tersibuk</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.bookings)}</TableCell><TableCell className="text-right tabular-nums">{percentage(row.bookings, data.total_bookings)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </Card>
        </>
      )}
      <p className="text-xs text-muted-foreground">Berdasarkan jadwal mulai booking dalam WIB. Booking dibatalkan atau kedaluwarsa tidak dihitung.</p>
    </div>
  );
}
