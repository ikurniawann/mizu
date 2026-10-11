"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, RefreshCw, Target, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SELECT } from "@/features/gym/shared";
import { currentMonthWib } from "@/features/spa/time";
import { periodLabel } from "@/lib/booking-report";
import { formatNumber, formatRupiah, formatRupiahCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { salesTargetApi, type SalesTargetPermissions } from "../sales-target-api";
import { SalesTargetSettings } from "./sales-target-settings";

const monthLabel = (month: string) => periodLabel(`${month}-01`, "monthly");
const achievement = (sales: number, target: number | null) => target ? `${formatNumber(sales / target * 100, 1)}%` : "—";

export function SalesVsTargetPage({ permissions }: { permissions: SalesTargetPermissions }) {
  const [tab, setTab] = useState("sales");
  const [year, setYear] = useState(currentMonthWib().slice(0, 4));
  const [branch, setBranch] = useState("");
  const valid = /^\d{4}$/.test(year) && Number(year) >= 2000 && Number(year) <= 2100;
  const filters = { year: Number(year), branch_id: branch || undefined };
  const report = useQuery({ queryKey: ["report", "sales-vs-target", filters], queryFn: () => salesTargetApi.report(filters), enabled: valid && tab === "sales", retry: false });
  const outlets = report.data?.outlets ?? [];
  const error = report.error;
  const loading = valid && (report.isPending || report.isFetching);
  const data = valid && !error && !loading ? report.data : undefined;
  const months = data?.months ?? [];
  const withTargets = months.filter((m) => m.target !== null);
  const totalSales = months.reduce((sum, m) => sum + m.sales, 0);
  const totalTarget = withTargets.reduce((sum, m) => sum + (m.target ?? 0), 0);
  const targetedSales = withTargets.reduce((sum, m) => sum + m.sales, 0);
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader kicker="Report" title="Sales vs Target" description="Pantau capaian penjualan outlet dan kelola target sales setiap bulan." />
      <Tabs className="min-w-0" value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList variant="line"><TabsTrigger value="sales"><TrendingUp />Sales vs Target</TabsTrigger><TabsTrigger value="settings"><Target />Setting Target</TabsTrigger></TabsList>
        <TabsContent value="sales" className="space-y-5">
        <Card className="my-3 gap-4 p-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(120px,180px)_1fr_auto] sm:items-end">
            <label className="space-y-2 text-xs font-medium"><span>Tahun</span><Input type="number" min={2000} max={2100} aria-label="Tahun" value={year} onChange={(e) => setYear(e.target.value)} /></label>
            <label className="space-y-2 text-xs font-medium"><span>Outlet</span>
              <select aria-label="Outlet" className={cn(SELECT, "w-full")} value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">Semua outlet</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <Button variant="outline" disabled={!valid || loading} onClick={() => { void report.refetch(); }}><RefreshCw className={cn("size-4", loading && "animate-spin")} />Perbarui</Button>
          </div>
        </Card>
        {!valid && <p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">Tahun harus antara 2000 dan 2100.</p>}
        {valid && error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-danger-soft p-4 text-sm text-danger"><span>{error.message}</span><Button variant="outline" onClick={() => { void report.refetch(); }}>Coba lagi</Button></div>}
        {loading && <div aria-label="Memuat laporan" aria-busy="true"><SkeletonTable columns={6} rows={6} /></div>}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total sales" value={data ? formatRupiah(totalSales) : "—"} icon={<TrendingUp />} tone="ink" hint={`Penjualan lunas tahun ${year}`} />
            <StatCard label="Total target" value={data && withTargets.length ? formatRupiah(totalTarget) : "—"} icon={<Target />} tone="accent" hint={data ? `${withTargets.length} dari 12 bulan memiliki target` : "Menunggu data laporan"} />
            <StatCard label="Capaian bulan bertarget" value={data ? achievement(targetedSales, totalTarget || null) : "—"} icon={<BarChart3 />} tone="accent" hint="Sales pada bulan yang memiliki target ÷ total target" />
          </div>
          {data && <>
            {!withTargets.length && <p role="status" className="rounded-xl bg-surface-2 p-4 text-sm text-muted-foreground">Target belum diatur untuk tahun dan outlet ini. Tambahkan melalui tab Setting Target.</p>}
            <Card className="gap-5 p-5">
              <div><h2 id="sales-target-chart-title" className="text-sm font-semibold">Sales dan target per bulan</h2><p className="mt-1 text-xs text-muted-foreground">{year} · {branch ? outlets.find((o) => o.id === branch)?.name : "Semua outlet"} · Rupiah</p></div>
              <div role="img" aria-labelledby="sales-target-chart-title" className="h-72 min-w-0 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={months.map((m) => ({ ...m, label: new Intl.DateTimeFormat("id-ID", { month: "short", timeZone: "Asia/Jakarta" }).format(new Date(`${m.month}-01T12:00:00+07:00`)) }))} margin={{ top: 10, right: 12, bottom: 10, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" /><XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis tickFormatter={formatRupiahCompact} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={78} />
                    <Tooltip formatter={(value) => formatRupiah(Number(value))} contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 12 }} /><Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="sales" name="Sales" fill="var(--brand-primary)" radius={[4, 4, 0, 0]} /><Bar dataKey="target" name="Target" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="overflow-hidden py-0">
              <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Rincian sales vs target</h2></div>
              <Table aria-label="Sales vs Target bulanan">
                <TableHeader><TableRow><TableHead>Bulan</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Target</TableHead><TableHead className="text-right">Selisih</TableHead><TableHead className="text-right">Capaian</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>{months.map((m) => <TableRow key={m.month}>
                  <TableCell className="whitespace-nowrap font-medium">{monthLabel(m.month)}</TableCell><TableCell className="text-right tabular-nums">{formatRupiah(m.sales)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.target === null ? "—" : formatRupiah(m.target)}</TableCell><TableCell className="text-right tabular-nums">{m.target === null ? "—" : formatRupiah(m.sales - m.target)}</TableCell><TableCell className="text-right tabular-nums">{achievement(m.sales, m.target)}</TableCell>
                  <TableCell><span className={cn("whitespace-nowrap text-xs", m.target !== null && m.sales >= m.target ? "text-brand-text" : "text-muted-foreground")}>{m.target === null ? "Belum diatur" : m.sales >= m.target ? "Tercapai" : "Belum tercapai"}</span>
                    {m.target_count > 0 && m.target_count < data.outlet_count && <p className="mt-1 whitespace-nowrap text-[10px] text-muted-foreground">Target {m.target_count}/{data.outlet_count} outlet</p>}
                  </TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </Card>
          </>}
        </TabsContent>
        <TabsContent value="settings" keepMounted className="min-w-0 space-y-4">
          <SalesTargetSettings permissions={permissions} />
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">Sales dihitung dari total tagihan POS yang lunas, termasuk pajak dan biaya layanan, berdasarkan tanggal transaksi dalam WIB. Transaksi batal, void, dan merged dikecualikan. Target Semua outlet merupakan jumlah target yang telah diatur; cakupan outlet ditampilkan pada rincian.</p>
    </div>
  );
}
