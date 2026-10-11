"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarDays, Clock3, RefreshCw, TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
import { useSpaOutlets } from "@/features/spa/queries";
import { currentMonthWib, monthRange } from "@/features/spa/time";
import { OutletSelect, SELECT } from "@/features/spa/components/shared";
import { getTrendReport, type ReportInterval, type TrendReportParams } from "../api";

const intervalLabels = { daily: "hari", monthly: "bulan", yearly: "tahun" };

function defaultRange(interval: ReportInterval) {
  const month = currentMonthWib();
  const year = Number(month.slice(0, 4));
  return interval === "daily" ? monthRange(month) : {
    from: `${interval === "yearly" ? year - 4 : year}-01-01`, to: `${year}-12-31`,
  };
}

export function SpaTrendPage() {
  const [filters, setFilters] = useState<TrendReportParams>(() => ({ ...defaultRange("daily"), interval: "daily" }));
  const outlets = useSpaOutlets();
  const invalid = !validDate(filters.from) || !validDate(filters.to) || filters.from > filters.to;
  const report = useQuery({
    queryKey: ["spa", "reports", "trend", filters],
    queryFn: ({ signal }) => getTrendReport(filters, signal),
    enabled: !invalid && outlets.isSuccess,
    retry: false,
  });
  const loading = !invalid && (outlets.isPending || outlets.isFetching || report.isPending || report.isFetching);
  const error = outlets.error ?? report.error;
  const data = !invalid && !error && !loading ? report.data : undefined;
  const total = data?.total_bookings;
  const periods = data?.periods ?? [];
  const outletName = outlets.data?.find((o) => o.branch_id === filters.branch_id)?.branch_name ?? "Semua outlet";
  const title = "Trend";
  const chartRows = periods.map((row) => ({ ...row, label: periodLabel(row.period, filters.interval) }));
  const rows = chartRows.map((row) => ({ key: row.period, label: row.label, bookings: row.bookings }));
  const retry = () => {
    if (outlets.isError) void outlets.refetch();
    else void report.refetch();
  };

  return (
    <div className="space-y-5">
      <PageHeader kicker="Spa Report" title={title} description="Lihat perkembangan jumlah booking dari hari ke hari, bulan ke bulan, atau tahun ke tahun." />
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
        <label className="flex flex-wrap items-center gap-3 text-xs font-medium">
          <span>Kelompok periode</span>
          <select className={cn(SELECT, "w-full sm:w-52")} aria-label="Kelompok periode" value={filters.interval}
            onChange={(e) => { const interval = e.target.value as ReportInterval; setFilters({ ...filters, interval, ...defaultRange(interval) }); }}>
            <option value="daily">Daily · Harian</option><option value="monthly">Monthly · Bulanan</option><option value="yearly">Yearly · Tahunan</option>
          </select>
        </label>
      </Card>
      {invalid && <p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">Tanggal wajib diisi dan tanggal awal tidak boleh setelah tanggal akhir.</p>}
      {!invalid && error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-danger-soft p-4 text-sm text-danger">
          <span>{error.message}</span><Button variant="outline" onClick={retry} disabled={outlets.isFetching || report.isFetching}>Coba lagi</Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Total booking" value={total === undefined ? "—" : formatNumber(total)} icon={<CalendarDays />} tone="ink" hint="Satu booking dihitung satu kali" />
        <StatCard label="Rata-rata per periode"
          value={data ? formatNumber(data.total_bookings / (periods.length || 1), 1) : "—"}
          icon={<TrendingUp />} tone="accent"
          hint={data ? `Booking per ${intervalLabels[filters.interval]} · termasuk periode tanpa booking` : "Menunggu data laporan"} />
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
              <div><h2 id="spa-report-chart-title" className="text-sm font-semibold">Trend booking</h2>
                <p className="mt-1 text-xs text-muted-foreground">{`Jumlah booking per ${intervalLabels[filters.interval]}`} · WIB</p>
              </div>
            </div>
            <div role="img" aria-labelledby="spa-report-chart-title" className="h-72 min-w-0 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} minTickGap={28} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={40} />
                  <Tooltip formatter={(value) => [formatNumber(Number(value)), "Jumlah booking"]} contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 12 }} />
                  <Line type="linear" dataKey="bookings" name="Jumlah booking" stroke="var(--brand-primary)" strokeWidth={2.5} dot={chartRows.length <= 31} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="overflow-hidden py-0">
            <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Rincian per periode</h2></div>
            <Table>
              <caption className="sr-only">{title}: jumlah dan persentase booking {data.from} sampai {data.to}, {outletName}, WIB</caption>
              <TableHeader><TableRow><TableHead>Periode WIB</TableHead><TableHead className="text-right">Jumlah booking</TableHead><TableHead className="text-right">Persentase</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((row) => <TableRow key={row.key}>
                <TableCell className="whitespace-nowrap">{row.label}</TableCell>
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
