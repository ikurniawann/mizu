"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, RefreshCw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/format";
import { validDate } from "@/lib/booking-report";
import { useSpaOutlets } from "@/features/spa/queries";
import { currentMonthWib, monthRange } from "@/features/spa/time";
import { OutletSelect, SELECT } from "@/features/spa/components/shared";
import { getRatingReport } from "../api";

const score = (value: number, count: number) => count ? `${formatNumber(value, 2)} / 5` : "—";

export function SpaRatingPage() {
  const [filters, setFilters] = useState<{ from: string; to: string; branch_id?: string }>(() => monthRange(currentMonthWib()));
  const outlets = useSpaOutlets();
  const invalid = !validDate(filters.from) || !validDate(filters.to) || filters.from > filters.to;
  const report = useQuery({
    queryKey: ["spa", "reports", "rating", filters],
    queryFn: ({ signal }) => getRatingReport(filters, signal),
    enabled: !invalid && outlets.isSuccess,
    retry: false,
  });
  const loading = !invalid && (outlets.isPending || outlets.isFetching || report.isPending || report.isFetching);
  const error = outlets.error ?? report.error;
  const data = !invalid && !loading && !error ? report.data : undefined;
  const retry = () => { if (outlets.isError) void outlets.refetch(); else void report.refetch(); };

  return <div className="space-y-5">
    <PageHeader kicker="Spa Report" title="Rating" description="Rating kepuasan booking dan rata-rata terapis berdasarkan tanggal jadwal treatment." />
    <Card className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.3fr_auto] xl:items-end">
      <label className="space-y-2 text-xs font-medium"><span>Tanggal awal</span><Input type="date" aria-label="Tanggal awal" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
      <label className="space-y-2 text-xs font-medium"><span>Tanggal akhir</span><Input type="date" aria-label="Tanggal akhir" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
      <label className="space-y-2 text-xs font-medium"><span>Outlet</span><OutletSelect outlets={outlets.data ?? []} value={filters.branch_id ?? ""} onChange={(branch_id) => setFilters({ ...filters, branch_id: branch_id || undefined })} className={SELECT} allLabel="Semua outlet" onlyConfigured={false} /></label>
      <Button variant="outline" onClick={() => void report.refetch()} disabled={invalid || loading || !outlets.isSuccess}><RefreshCw className="size-4" /> Perbarui</Button>
    </Card>
    {invalid && <p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">Tanggal wajib diisi dan tanggal awal tidak boleh setelah tanggal akhir.</p>}
    {!invalid && error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-danger-soft p-4 text-sm text-danger"><span>{error.message}</span><Button variant="outline" onClick={retry}>Coba lagi</Button></div>}
    <div className="grid gap-4 sm:grid-cols-2">
      <StatCard label="Booking dengan rating" value={data ? formatNumber(data.total_ratings) : "—"} icon={<CalendarDays />} tone="ink" hint="Satu rating per booking" />
      <StatCard label="Rata-rata rating" value={data ? score(data.average_rating, data.total_ratings) : "—"} icon={<Star />} tone="accent" hint="Skala 1–5 bintang" />
    </div>
    {!invalid && !error && loading && <div aria-busy="true" aria-label="Memuat laporan"><SkeletonTable columns={4} rows={6} /></div>}
    {data && <>
      <p className="text-xs text-muted-foreground">{formatDate(data.from)} – {formatDate(data.to)} · {outlets.data?.find((o) => o.branch_id === filters.branch_id)?.branch_name ?? "Semua outlet"} · WIB</p>
      {data.total_ratings === 0 && <p role="status" className="rounded-xl bg-surface-2 p-4 text-sm text-muted-foreground">Belum ada booking dengan rating pada periode ini.</p>}
      <Card className="overflow-hidden py-0"><div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Rating per booking</h2></div>
        <Table><TableHeader><TableRow><TableHead>Booking</TableHead><TableHead>Tanggal WIB</TableHead><TableHead>Pelanggan</TableHead><TableHead>Outlet</TableHead><TableHead>Terapis</TableHead><TableHead className="text-right">Rating</TableHead></TableRow></TableHeader>
          <TableBody>{data.bookings.map((b) => <TableRow key={b.id}><TableCell className="font-mono">{b.booking_code}</TableCell><TableCell>{formatDate(b.scheduled_at)}</TableCell><TableCell>{b.customer_name}</TableCell><TableCell>{b.branch_name}</TableCell><TableCell>{b.therapist_name}</TableCell><TableCell className="text-right tabular-nums">{b.rating} / 5</TableCell></TableRow>)}</TableBody>
        </Table>
      </Card>
      <Card className="overflow-hidden py-0"><div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Rata-rata per terapis</h2></div>
        <Table><TableHeader><TableRow><TableHead>Terapis</TableHead><TableHead className="text-right">Booking dinilai</TableHead><TableHead className="text-right">Rata-rata</TableHead></TableRow></TableHeader>
          <TableBody>{data.therapists.map((t) => <TableRow key={t.therapist_id}><TableCell>{t.therapist_name}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(t.total_ratings)}</TableCell><TableCell className="text-right tabular-nums">{score(t.average_rating, t.total_ratings)}</TableCell></TableRow>)}</TableBody>
        </Table>
      </Card>
    </>}
  </div>;
}
