"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format";
import { commissionChanges, useCommissionSettings, useSaveCommissionSettings, useMyCommissionRates, type CommissionDrafts } from "../commission-settings";
import { FormError, TableNote } from "./shared";

export function CommissionSettingsPage({ canUpdate }: { canUpdate: boolean }) {
  const query = useCommissionSettings();
  const save = useSaveCommissionSettings();
  const [drafts, setDrafts] = useState<CommissionDrafts>({});
  const [search, setSearch] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [error, setError] = useState("");
  const rows = query.data ?? [];
  const valuesOf = (row: typeof rows[number]) => drafts[row.variant_id] ?? row.values.map((v) => v == null ? "" : String(v));
  const changed = Object.keys(drafts).filter((id) => {
    const row = rows.find((r) => r.variant_id === id);
    return !row || drafts[id].some((v, i) => v !== (row.values[i] == null ? "" : String(row.values[i])));
  });
  const shown = rows.filter((r) => `${r.treatment_name} ${r.variant_name} ${r.duration_min}`.toLowerCase().includes(search.toLowerCase()) && (!incomplete || valuesOf(r).some((v) => v === "")));
  return <div className="space-y-4">
    <PageHeader kicker="Spa" title="Pengaturan Komisi" description="Nominal per varian treatment dan level terapis. Tarif yang sama berlaku di semua outlet, terlepas dari harga jual treatment." />
    <div className="flex flex-wrap items-center gap-4">
      <Input className="max-w-md" aria-label="Cari treatment atau varian" placeholder="Cari treatment, varian, atau durasi…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={incomplete} onChange={(e) => setIncomplete(e.target.checked)} />Tarif belum lengkap</label>
    </div>
    <p className="text-sm text-muted-foreground">Isi ketiga level untuk setiap varian yang diubah. Kosong berarti belum diatur; Rp 0 berarti tidak mendapat komisi. Tarif dikunci saat treatment selesai.</p>
    <Card className="overflow-x-auto py-0">
      {query.isLoading ? <TableNote>Memuat tarif komisi…</TableNote> : query.error ? <TableNote tone="danger">{query.error.message}</TableNote> : !shown.length ? <TableNote>Tidak ada varian yang sesuai.</TableNote> : <Table>
        <TableHeader><TableRow><TableHead>Treatment / varian</TableHead>{[0, 1, 2].map((level) => <TableHead key={level}>Level {level} (Rp)</TableHead>)}</TableRow></TableHeader>
        <TableBody>{shown.map((row) => <TableRow key={row.variant_id}>
          <TableCell><p className="font-medium">{row.treatment_name}</p><p className="text-xs text-muted-foreground">{row.variant_name} · {row.duration_min} menit{!row.is_active && " · Nonaktif"}</p></TableCell>
          {valuesOf(row).map((value, level) => <TableCell key={level}><Input type="number" min={0} max={999999999999} step={1} className="min-w-28 tabular-nums" placeholder="Belum diatur" aria-label={`${row.treatment_name}, ${row.variant_name}, Level ${level}`} value={value} disabled={!canUpdate || save.isPending} onChange={(e) => {
            const next = [...valuesOf(row)] as [string, string, string]; next[level] = e.target.value;
            setDrafts((old) => ({ ...old, [row.variant_id]: next }));
          }} /></TableCell>)}
        </TableRow>)}</TableBody>
      </Table>}
    </Card>
    <FormError>{error || save.error?.message}</FormError>
    {canUpdate && <div className="flex flex-wrap items-center gap-4"><Button disabled={save.isPending || !changed.length || query.isLoading || !!query.error} onClick={() => {
      setError("");
      try {
        const changes = commissionChanges(rows, drafts);
        if (changes.length > 500) throw new Error("Maksimal 500 varian per penyimpanan.");
        save.mutate(changes, { onSuccess: () => { setDrafts({}); toast.success("Tarif komisi disimpan untuk semua outlet"); } });
      } catch (err) { setError((err as Error).message); }
    }}>{save.isPending ? "Menyimpan…" : "Simpan komisi"}</Button><span className="text-sm text-muted-foreground">{changed.length} varian diubah, termasuk yang tersembunyi oleh filter</span></div>}
  </div>;
}

export function MyCommissionRates() {
  const query = useMyCommissionRates();
  return <details className="rounded-xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">Tarif komisi saya{query.data && ` · Level ${query.data.level}`}</summary>
    <div className="mt-3 space-y-2">{query.isLoading ? <p className="text-sm">Memuat tarif…</p> : query.error ? <FormError>{query.error.message}</FormError> : <>
      <p className="text-xs text-muted-foreground">Berlaku sama di semua outlet. Komisi mengikuti level saat treatment selesai.</p>
      {query.data?.rates.map((r) => <div className="flex justify-between gap-3 border-t border-border py-2 text-sm" key={r.variant_id}><span>{r.treatment_name} — {r.variant_name}</span><span className="shrink-0 tabular-nums">{r.value == null ? "Belum diatur" : formatRupiah(r.value)}</span></div>)}
    </>}</div>
  </details>;
}
