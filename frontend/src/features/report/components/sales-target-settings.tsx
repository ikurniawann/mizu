"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentMonthWib } from "@/features/spa/time";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { salesTargetApi, type MonthlySalesTarget, type SalesTargetPermissions, type SalesTargetYears, type TargetCellChange } from "../sales-target-api";

const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const number = (amount: number) => formatNumber(amount, 2);
const sticky = "sticky left-0 z-10 border-r border-border bg-card";
const cellKey = (branch: string, month: number) => `${branch}/${month}`;

export function SalesTargetSettings({ permissions }: { permissions: SalesTargetPermissions }) {
  const client = useQueryClient();
  const [editor, setEditor] = useState<{ year: number; creating: boolean } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const summary = useQuery({ queryKey: ["report", "sales-target-years"], queryFn: salesTargetApi.years, retry: false });
  const refresh = async () => {
    await Promise.all(["sales-target-years", "sales-targets", "sales-vs-target"].map((key) => client.invalidateQueries({ queryKey: ["report", key] })));
  };
  const remove = useMutation({ mutationFn: salesTargetApi.deleteYear, onSuccess: async () => { await refresh(); setDeleting(null); } });
  const openYear = (year: number) => setEditor({ year, creating: false });

  if (editor && summary.data) return <YearEditor key={`${editor.year}/${editor.creating}`} initialYear={editor.year} creating={editor.creating} summary={summary.data} permissions={permissions} onClose={() => setEditor(null)} onSaved={async () => { await refresh(); setEditor(null); }} />;

  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-sm font-semibold">Target sales per tahun</h2><p className="mt-1 text-xs text-muted-foreground">Akumulasi target seluruh outlet yang dapat Anda akses. Klik tahun untuk melihat atau mengisi target per outlet.</p></div>
      <div className="flex gap-2">
        <Button variant="outline" aria-label="Perbarui target tahunan" disabled={summary.isFetching} onClick={() => void summary.refetch()}><RefreshCw className={cn("size-4", summary.isFetching && "animate-spin")} /></Button>
        {permissions.create && <Button disabled={!summary.data?.outlets.length || summary.isFetching} onClick={() => {
          const current = Number(currentMonthWib().slice(0, 4));
          setEditor({ year: summary.data?.years.some((row) => row.year === current) ? Math.min(current + 1, 2100) : current, creating: true });
        }}><Plus className="size-4" />Tambah target tahun</Button>}
      </div>
    </div>
    {summary.error && <p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">{summary.error.message}</p>}
    {summary.isPending && <SkeletonTable columns={6} rows={3} />}
    {summary.data && <Card className="min-w-0 gap-0 overflow-hidden py-0">
      <div className="border-b border-border px-5 py-3 text-xs text-muted-foreground">Seluruh nilai dalam rupiah · {summary.data.outlets.length} outlet</div>
      <Table aria-label="Target sales per tahun" className="min-w-[1500px]">
        <TableHeader><TableRow><TableHead className={sticky}>Tahun</TableHead>{months.map((month) => <TableHead key={month} className="text-right">{month}</TableHead>)}<TableHead className="bg-surface-2 text-right">Total tahun</TableHead>{(permissions.update || permissions.delete) && <TableHead className="text-right">Aksi</TableHead>}</TableRow></TableHeader>
        <TableBody>{summary.data.years.length ? summary.data.years.map((row) => <TableRow key={row.year} className="cursor-pointer" onClick={() => openYear(row.year)}>
          <TableCell className={sticky}><button type="button" className="font-semibold text-brand-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-primary" aria-label={`Lihat target tahun ${row.year}`} onClick={(e) => { e.stopPropagation(); openYear(row.year); }}>{row.year}</button></TableCell>
          {row.months.map((amount, i) => <TableCell key={i} className="text-right tabular-nums">{amount ? number(amount) : "—"}</TableCell>)}
          <TableCell className="bg-surface-2 text-right font-semibold tabular-nums">{number(row.total)}</TableCell>
          {(permissions.update || permissions.delete) && <TableCell className="text-right"><div className="flex justify-end gap-1">
            {permissions.update && <Button variant="ghost" size="icon-sm" aria-label={`Ubah target tahun ${row.year}`} onClick={(e) => { e.stopPropagation(); openYear(row.year); }}><Pencil className="size-4" /></Button>}
            {permissions.delete && <Button variant="ghost" size="icon-sm" aria-label={`Hapus target tahun ${row.year}`} onClick={(e) => { e.stopPropagation(); remove.reset(); setDeleting(row.year); }}><Trash2 className="size-4 text-danger" /></Button>}
          </div></TableCell>}
        </TableRow>) : <TableRow><TableCell colSpan={permissions.update || permissions.delete ? 15 : 14} className="py-10 text-center text-muted-foreground">Belum ada target tahunan.</TableCell></TableRow>}</TableBody>
      </Table>
    </Card>}
    <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open && !remove.isPending) setDeleting(null); }}><DialogContent showCloseButton={false}>
      <DialogHeader><DialogTitle>Hapus target tahun {deleting}?</DialogTitle><DialogDescription>Seluruh target Januari–Desember {deleting} untuk outlet yang dapat Anda akses akan dihapus. Penjualan POS tetap tersimpan.</DialogDescription></DialogHeader>
      {remove.error && <p role="alert" className="text-sm text-danger">{remove.error.message}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(null)}>Batal</Button><Button variant="destructive" disabled={remove.isPending} onClick={() => { if (deleting !== null) remove.mutate(deleting); }}>{remove.isPending ? "Menghapus…" : "Hapus target tahun"}</Button></div>
    </DialogContent></Dialog>
  </div>;
}

function YearEditor({ initialYear, creating, summary, permissions, onClose, onSaved }: {
  initialYear: number; creating: boolean; summary: SalesTargetYears; permissions: SalesTargetPermissions; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [year, setYear] = useState(String(initialYear));
  const [busy, setBusy] = useState(false);
  const valid = /^\d{4}$/.test(year) && Number(year) >= 2000 && Number(year) <= 2100;
  const duplicate = creating && summary.years.some((row) => row.year === Number(year));
  const targets = useQuery({ queryKey: ["report", "sales-targets", { year: Number(year) }], queryFn: () => salesTargetApi.targets({ year: Number(year) }), enabled: valid && !duplicate, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-sm font-semibold">{creating ? "Tambah target tahunan" : `Target outlet tahun ${year}`}</h2><p className="mt-1 text-xs text-muted-foreground">Isi target tiap outlet dan bulan seperti spreadsheet. Total dihitung otomatis.</p></div>
      <Button variant="outline" disabled={busy} onClick={onClose}><ArrowLeft className="size-4" />Kembali ke daftar tahun</Button>
    </div>
    <label className="block max-w-48 space-y-2 text-xs font-medium"><span>Tahun target</span><Input aria-label="Tahun target" type="number" min={2000} max={2100} value={year} disabled={!creating || busy} onChange={(e) => setYear(e.target.value)} /></label>
    {!valid && <p role="alert" className="text-sm text-danger">Tahun harus antara 2000 dan 2100.</p>}
    {duplicate && <p role="alert" className="text-sm text-danger">Target tahun {year} sudah ada. Buka tahun tersebut dari daftar untuk mengubahnya.</p>}
    {valid && !duplicate && <>
      {targets.error && <div role="alert" className="flex items-center gap-3 text-sm text-danger">{targets.error.message}<Button variant="outline" onClick={() => void targets.refetch()}>Coba lagi</Button></div>}
      {(targets.isPending || targets.isFetching) && <SkeletonTable columns={6} rows={4} />}
      {targets.data && !targets.error && !targets.isFetching && <TargetGrid key={year} year={Number(year)} outlets={summary.outlets} targets={targets.data} permissions={permissions} onSaved={onSaved} onBusy={setBusy} onClose={onClose} />}
    </>}
  </div>;
}

function TargetGrid({ year, outlets, targets, permissions, onSaved, onBusy, onClose }: {
  year: number; outlets: SalesTargetYears["outlets"]; targets: MonthlySalesTarget[]; permissions: SalesTargetPermissions; onSaved: () => Promise<void>; onBusy: (busy: boolean) => void; onClose: () => void;
}) {
  const [original] = useState(() => Object.fromEntries(targets.map((row) => [cellKey(row.branch_id, Number(row.month.slice(5))), row.amount])) as Record<string, number>);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(original).map(([key, amount]) => [key, String(amount)])));
  const [validation, setValidation] = useState("");
  const changes: TargetCellChange[] = [];
  const totals = Array<number>(12).fill(0);
  const rowTotals = outlets.map((outlet) => months.reduce((sum, _, i) => {
    const key = cellKey(outlet.id, i + 1);
    const raw = values[key] ?? "";
    const amount = raw === "" ? null : Number(raw);
    const previous = original[key] ?? null;
    if (amount !== previous) changes.push({ branch_id: outlet.id, month: i + 1, amount, previous });
    const cents = Number.isFinite(amount) ? Math.round((amount ?? 0) * 100) : 0;
    totals[i] += cents;
    return sum + cents;
  }, 0));
  const save = useMutation({ mutationFn: () => salesTargetApi.saveYear(year, changes), onMutate: () => onBusy(true), onSuccess: onSaved, onSettled: () => onBusy(false) });
  const writable = permissions.create || permissions.update || permissions.delete;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setValidation("");
    if (!changes.length || save.isPending) return;
    if (changes.some((cell) => cell.amount === null ? !permissions.delete : cell.previous === null ? !permissions.create : !permissions.update)) {
      setValidation("Anda tidak memiliki akses untuk salah satu perubahan. Mengosongkan target memerlukan akses hapus.");
      return;
    }
    save.mutate();
  };
  return <form aria-label="Form target tahunan" className="min-w-0 space-y-4" onSubmit={submit}>
    <Card className="min-w-0 gap-0 overflow-hidden py-0">
      <div className="border-b border-border px-5 py-3 text-xs text-muted-foreground">Dalam rupiah · Tab: sel berikutnya · Enter: outlet berikutnya · Kosongkan sel untuk menghapus target.</div>
      <Table aria-label={`Target outlet tahun ${year}`} className="min-w-[1750px] table-fixed">
        <TableHeader><TableRow><TableHead className={cn(sticky, "w-48")}>Outlet</TableHead>{months.map((month) => <TableHead key={month} className="w-32 border-r border-border text-right">{month}</TableHead>)}<TableHead className="w-40 bg-surface-2 text-right">Total tahun</TableHead></TableRow></TableHeader>
        <TableBody>{outlets.map((outlet, row) => <TableRow key={outlet.id}>
          <TableCell className={cn(sticky, "overflow-hidden text-ellipsis font-medium")} title={outlet.name}>{outlet.name}</TableCell>
          {months.map((month, i) => {
            const key = cellKey(outlet.id, i + 1);
            const editable = original[key] == null ? permissions.create : permissions.update || permissions.delete;
            return <TableCell key={month} className="border-r border-border p-0"><input aria-label={`${outlet.name} ${month}`} data-cell={`${row}/${i}`} type="number" inputMode="decimal" min="0.01" max="100000000000" step="0.01" placeholder="—" disabled={!editable || save.isPending} value={values[key] ?? ""}
              className={cn("h-12 w-full min-w-0 bg-transparent px-3 text-right text-sm tabular-nums outline-none focus:bg-brand-soft focus:ring-2 focus:ring-inset focus:ring-brand-primary disabled:text-muted-foreground [&::-webkit-inner-spin-button]:appearance-none [appearance:textfield]", (values[key] ?? "") !== (original[key] == null ? "" : String(original[key])) && "bg-brand-soft/50")}
              onChange={(e) => { setValues({ ...values, [key]: e.target.value }); setValidation(""); save.reset(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.form?.querySelector<HTMLInputElement>(`[data-cell="${row + (e.shiftKey ? -1 : 1)}/${i}"]`)?.focus(); } }} /></TableCell>;
          })}
          <TableCell className="bg-surface-2 text-right font-medium tabular-nums">{number(rowTotals[row] / 100)}</TableCell>
        </TableRow>)}</TableBody>
        <TableFooter><TableRow><TableCell className={cn(sticky, "bg-surface-2 font-semibold")}>Total semua outlet</TableCell>{totals.map((amount, i) => <TableCell key={i} className="text-right tabular-nums">{number(amount / 100)}</TableCell>)}<TableCell className="text-right font-semibold tabular-nums">{number(totals.reduce((sum, amount) => sum + amount, 0) / 100)}</TableCell></TableRow></TableFooter>
      </Table>
    </Card>
    {(validation || save.error) && <p role="alert" className="text-sm text-danger">{validation || save.error?.message}</p>}
    <div className="flex flex-wrap items-center gap-3">
      {writable && <Button type="submit" disabled={!changes.length || save.isPending}><Save className="size-4" />{save.isPending ? "Menyimpan…" : "Simpan target tahun"}</Button>}
      <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{writable ? "Batal" : "Tutup"}</Button>
      {changes.length > 0 && <span className="text-xs text-muted-foreground">{changes.length} sel berubah · Disimpan sekaligus</span>}
    </div>
  </form>;
}
