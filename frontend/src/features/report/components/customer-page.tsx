"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Users, ShoppingBag, Wallet } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber, formatRupiah } from "@/lib/format";
import { periodLabel, validDate } from "@/lib/booking-report";
import { useSpaOutlets } from "@/features/spa/queries";
import { currentMonthWib, monthRange } from "@/features/spa/time";
import { OutletSelect, SELECT } from "@/features/spa/components/shared";
import { getCustomerReport, type ReportInterval, type TrendReportParams } from "../api";

function defaultRange(interval: ReportInterval) {
  const year = Number(currentMonthWib().slice(0, 4));
  return interval === "daily" ? monthRange(currentMonthWib()) : {
    from: `${interval === "yearly" ? year - 4 : year}-01-01`, to: `${year}-12-31`,
  };
}

export function SpaCustomerReportPage() {
  const [filters, setFilters] = useState<TrendReportParams>(() => ({ ...defaultRange("daily"), interval: "daily" }));
  const outlets = useSpaOutlets();
  const invalid = !validDate(filters.from) || !validDate(filters.to) || filters.from > filters.to;
  const report = useQuery({
    queryKey: ["spa", "reports", "customer", filters],
    queryFn: ({ signal }) => getCustomerReport(filters, signal),
    enabled: !invalid && outlets.isSuccess,
    retry: false,
  });
  const loading = !invalid && (outlets.isPending || outlets.isFetching || report.isPending || report.isFetching);
  const error = outlets.error ?? report.error;
  const data = !invalid && !loading && !error ? report.data : undefined;
  const outletName = outlets.data?.find((o) => o.branch_id === filters.branch_id)?.branch_name ?? "Semua outlet";
  const retry = () => { if (outlets.isError) void outlets.refetch(); else void report.refetch(); };

  return <div className="space-y-5">
    <PageHeader kicker="Spa Report" title="Customer" description="Pelanggan, treatment, dan penjualan berdasarkan transaksi POS lunas." />
    <Card className="gap-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.3fr_auto] xl:items-end">
        <label className="space-y-2 text-xs font-medium"><span>Tanggal awal</span><Input type="date" aria-label="Tanggal awal" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label className="space-y-2 text-xs font-medium"><span>Tanggal akhir</span><Input type="date" aria-label="Tanggal akhir" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <label className="space-y-2 text-xs font-medium"><span>Outlet</span><OutletSelect outlets={outlets.data ?? []} value={filters.branch_id ?? ""} onChange={(branch_id) => setFilters({ ...filters, branch_id: branch_id || undefined })} className={SELECT} allLabel="Semua outlet" onlyConfigured={false} /></label>
        <Button variant="outline" onClick={() => void report.refetch()} disabled={invalid || loading || !outlets.isSuccess}><RefreshCw className="size-4" /> Perbarui</Button>
      </div>
      <label className="flex flex-wrap items-center gap-3 text-xs font-medium"><span>Kelompok periode</span>
        <select className={SELECT} aria-label="Kelompok periode" value={filters.interval} onChange={(e) => { const interval = e.target.value as ReportInterval; setFilters({ ...filters, interval, ...defaultRange(interval) }); }}>
          <option value="daily">Daily · Harian</option><option value="monthly">Monthly · Bulanan</option><option value="yearly">Yearly · Tahunan</option>
        </select>
      </label>
    </Card>
    {invalid && <p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">Tanggal wajib diisi dan tanggal awal tidak boleh setelah tanggal akhir.</p>}
    {!invalid && error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-danger-soft p-4 text-sm text-danger"><span>{error.message}</span><Button variant="outline" onClick={retry}>Coba lagi</Button></div>}
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Jumlah customer" value={data ? formatNumber(data.total_customers) : "—"} icon={<Users />} tone="ink" hint="Pelanggan unik dalam periode" />
      <StatCard label="Transaksi customer" value={data ? formatNumber(data.total_transactions) : "—"} icon={<ShoppingBag />} tone="accent" hint="Order POS lunas dengan customer" />
      <StatCard label="Sales customer" value={data ? formatRupiah(data.total_sales) : "—"} icon={<Wallet />} tone="ink" hint="Nilai order POS lunas" />
    </div>
    {!invalid && !error && loading && <div aria-busy="true" aria-label="Memuat laporan"><SkeletonTable columns={3} rows={6} /></div>}
    {data && <>
      <p className="text-xs text-muted-foreground">{periodLabel(data.from, "daily")} – {periodLabel(data.to, "daily")} · {outletName} · WIB</p>
      {data.total_customers === 0 && <p role="status" className="rounded-xl bg-surface-2 p-4 text-sm text-muted-foreground">Belum ada transaksi POS lunas dengan customer pada periode ini.</p>}
      <Card className="gap-4 p-5"><h2 id="customer-trend-title" className="text-sm font-semibold">Trend jumlah customer</h2>
        <p className="text-xs text-muted-foreground">Customer unik per periode. Customer yang kembali dapat muncul di beberapa periode.</p>
        <div role="img" aria-labelledby="customer-trend-title" className="h-64 min-w-0 w-full"><ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.periods.map((p) => ({ ...p, label: periodLabel(p.period, filters.interval) }))} margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} minTickGap={28} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={40} />
            <Tooltip formatter={(value) => [formatNumber(Number(value)), "Customer"]} contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 12 }} />
            <Line type="linear" dataKey="customers" stroke="var(--brand-primary)" strokeWidth={2.5} dot={data.periods.length <= 31} />
          </LineChart>
        </ResponsiveContainer></div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="overflow-hidden py-0"><div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Top 10 Treatment</h2></div>
          <Table><TableHeader><TableRow><TableHead>Treatment</TableHead><TableHead className="text-right">Terjual</TableHead></TableRow></TableHeader><TableBody>
            {data.top_treatments.map((row) => <TableRow key={row.treatment_id}><TableCell>{row.treatment_name}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(row.quantity)}</TableCell></TableRow>)}
          </TableBody></Table>
        </Card>
        <Card className="overflow-hidden py-0"><div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Top 10 Customer</h2></div>
          <Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Transaksi</TableHead></TableRow></TableHeader><TableBody>
            {data.top_customers.map((row) => <TableRow key={row.customer_id}><TableCell>{row.customer_name}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(row.transactions)}</TableCell></TableRow>)}
          </TableBody></Table>
        </Card>
        <Card className="overflow-hidden py-0"><div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Top 10 Sales Customer</h2></div>
          <Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Sales</TableHead></TableRow></TableHeader><TableBody>
            {data.top_sales_customers.map((row) => <TableRow key={row.customer_id}><TableCell>{row.customer_name}</TableCell><TableCell className="text-right tabular-nums">{formatRupiah(row.sales)}</TableCell></TableRow>)}
          </TableBody></Table>
        </Card>
      </div>
    </>}
    <p className="text-xs text-muted-foreground">Berdasarkan waktu order POS dalam WIB. Order dibatalkan, void, atau digabung tidak dihitung. Treatment berasal dari produk POS yang terhubung ke Spa.</p>
  </div>;
}
