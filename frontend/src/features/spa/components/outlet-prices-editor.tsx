"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { useSaveTreatmentPrices } from "../mutations";
import { spaKeys } from "../query-keys";
import { buildPriceBatches, parseOutletPrice, type CommissionGrid, type PriceGrid } from "../treatment-form";
import type { Outlet, Treatment, Variant } from "../types";
import { Field, FormError, OutletSelect, SELECT, TableNote } from "./shared";

function priceState(variant: Variant | undefined, branchId: string, draft?: string) {
  const stored = variant?.outlet_prices.find((p) => p.branch_id === branchId)?.price_idr ?? null;
  const raw = draft ?? (stored === null ? "" : String(stored));
  try {
    const value = parseOutletPrice(raw);
    return { raw, value, changed: value !== stored || !variant, error: null };
  } catch (error) {
    return { raw, value: null, changed: true, error: (error as Error).message };
  }
}

const outletLink = <a className="font-medium text-brand-text underline" href="/dashboard/spa/outlets" target="_blank" rel="noopener noreferrer">Buka Outlet Spa</a>;

/** Tetap terpasang saat tab berubah agar draft dan proses simpan bertahan. */
export function OutletPricesEditor({ treatments, outlets, loading, ready, outletError, search, onSearchChange, category, onCategoryChange }: {
  treatments: Treatment[];
  outlets: Outlet[] | undefined;
  loading: boolean;
  ready: boolean;
  outletError?: string;
  search: string;
  onSearchChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
}) {
  const [branchId, setBranchId] = useState("");
  const [drafts, setDrafts] = useState<PriceGrid>({});
  const [commissionDrafts, setCommissionDrafts] = useState<CommissionGrid>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const save = useSaveTreatmentPrices();
  const qc = useQueryClient();
  const configured = (outlets ?? []).filter((o) => o.configured);
  const selected = configured.find((o) => o.branch_id === branchId) ?? configured[0];
  const selectedId = selected?.branch_id ?? "";
  const allVariants = treatments.flatMap((t) => t.variants);
  const changed = allVariants.flatMap((variant) => {
    const branches = new Set([...Object.keys(drafts[variant.id] ?? {}), ...Object.keys(commissionDrafts[variant.id] ?? {})]);
    return [...branches].filter((id) => {
      const commission = commissionDrafts[variant.id]?.[id];
      const stored = variant.outlet_commissions?.find((c) => c.branch_id === id);
      return (drafts[variant.id]?.[id] !== undefined && priceState(variant, id, drafts[variant.id][id]).changed)
        || (commission !== undefined && (commission !== String(stored?.commission_value ?? "") || stored?.commission_type !== "fixed"));
    });
  });
  const changedOutlets = new Set(changed).size;
  let custom = 0;
  let invalid = 0;
  for (const variant of allVariants) {
    const state = priceState(variant, selectedId, drafts[variant.id]?.[selectedId]);
    if (state.error) invalid++;
    else if (state.value !== null) custom++;
  }
  const categories = [...new Set(treatments.map((t) => t.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "id"));
  const query = search.trim().toLocaleLowerCase("id");
  const groups = treatments.flatMap((treatment) => {
    if (category && treatment.category !== category) return [];
    const matches = [treatment.name, treatment.code, treatment.category ?? ""].some((value) => value.toLocaleLowerCase("id").includes(query));
    const variants = [...treatment.variants].sort((a, b) => a.sort_order - b.sort_order)
      .filter((v) => matches || v.name.toLocaleLowerCase("id").includes(query));
    return variants.length ? [{ treatment, variants }] : [];
  });

  useEffect(() => {
    if (!changed.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed.length]);

  const submit = async () => {
    if (savingRef.current || !ready) return;
    let batches;
    try {
      // Menyusun semua batch juga memvalidasi draft di outlet/filter lain.
      batches = buildPriceBatches(treatments, drafts, commissionDrafts);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    if (!batches.length) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    let savedCount = 0;
    try {
      for (const batch of batches) {
        await save.mutateAsync(batch);
        savedCount += batch.prices.length;
        setDrafts((current) => {
          const next = { ...current };
          for (const price of batch.prices) {
            const branches = { ...next[price.variant_id] };
            delete branches[price.branch_id];
            if (Object.keys(branches).length) next[price.variant_id] = branches;
            else delete next[price.variant_id];
          }
          return next;
        });
        setCommissionDrafts((current) => {
          const next = { ...current };
          for (const price of batch.prices) {
            const branches = { ...next[price.variant_id] };
            delete branches[price.branch_id];
            if (Object.keys(branches).length) next[price.variant_id] = branches;
            else delete next[price.variant_id];
          }
          return next;
        });
      }
      toast.success("Harga dan komisi outlet disimpan", { description: `${savedCount} perubahan tersimpan. Produk POS diperbarui otomatis.` });
    } catch (err) {
      const message = `${savedCount} perubahan sudah tersimpan. Perubahan lainnya belum tersimpan: ${(err as Error).message}`;
      setError(message);
      toast.error("Harga gagal disimpan", { description: message });
    } finally {
      savingRef.current = false;
      setSaving(false);
      void qc.invalidateQueries({ queryKey: spaKeys.treatmentsAll() });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Harga dan komisi ditetapkan untuk setiap varian treatment di masing-masing outlet. Komisi wajib diisi saat menyimpan perubahan. Produk kasir diperbarui otomatis saat perubahan disimpan. {outletLink}
      </p>
      <FormError>{outletError}</FormError>
      {loading ? <Card className="p-4"><SkeletonTable columns={4} rows={5} /></Card>
        : !ready ? <Card><TableNote tone="danger">Katalog harga belum dapat dimuat.</TableNote></Card>
        : !selected ? <Card><TableNote>Belum ada outlet spa yang dikonfigurasi. {outletLink}</TableNote></Card>
        : allVariants.length === 0 ? <Card><TableNote>Belum ada treatment atau varian. Tambahkan master melalui tab Daftar Treatment.</TableNote></Card>
        : <>
          <Card className="gap-4 p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Outlet">
                <OutletSelect outlets={configured} value={selectedId} onChange={setBranchId} className={SELECT} />
              </Field>
              <Field label="Cari treatment">
                <Input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Nama, kode, kategori, atau varian" />
              </Field>
              <Field label="Kategori">
                <select className={SELECT} value={category} onChange={(e) => onCategoryChange(e.target.value)}>
                  <option value="">Semua kategori</option>
                  {categories.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-2 text-xs" aria-live="polite">
              <Badge variant="muted">{allVariants.length} varian</Badge>
              <Badge variant="info">{custom} harga khusus</Badge>
              <Badge variant="muted">{allVariants.length - custom - invalid} mengikuti harga dasar</Badge>
              {invalid > 0 && <Badge variant="destructive">{invalid} harga tidak valid</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">Kosongkan harga untuk mengikuti harga dasar. Isi nominal komisi dalam rupiah di setiap outlet; nilai 0 diperbolehkan. Semua perubahan disimpan sekaligus, termasuk dari outlet lain.</p>
          </Card>
          <Card className="py-0">
            {groups.length === 0 ? <TableNote>Tidak ada treatment yang cocok dengan pencarian atau kategori.</TableNote> :
              <Table className="table-fixed">
                <TableHeader><TableRow>
                  <TableHead>Varian</TableHead>
                  <TableHead className="hidden md:table-cell">Harga dasar</TableHead>
                  <TableHead>Harga berlaku (Rp)</TableHead>
                  <TableHead>Komisi terapis (Rp)</TableHead>
                </TableRow></TableHeader>
                {groups.map(({ treatment, variants }) => (
                  <TableBody key={treatment.id}>
                    <TableRow className="bg-surface-2">
                      <TableHead colSpan={3} scope="rowgroup" className="py-3 break-words whitespace-normal normal-case">
                        <span className="text-sm font-semibold text-foreground">{treatment.name}</span>
                        {!treatment.is_active && <Badge variant="muted" className="ml-2">Nonaktif</Badge>}
                        <span className="mt-1 block text-xs font-normal">{treatment.code}{treatment.category ? ` · ${treatment.category}` : ""} · {variants.length} varian</span>
                      </TableHead>
                      <TableCell className="hidden md:table-cell" aria-hidden="true" />
                    </TableRow>
                    {variants.map((variant) => <PriceRow key={variant.id} treatment={treatment} variant={variant} outlet={selected}
                      draft={drafts[variant.id]?.[selectedId]} saving={saving}
                      commissionDraft={commissionDrafts[variant.id]?.[selectedId]}
                      onCommissionChange={(raw) => setCommissionDrafts((current) => ({ ...current, [variant.id]: { ...current[variant.id], [selectedId]: raw } }))}
                      onChange={(raw) => setDrafts((current) => ({ ...current, [variant.id]: { ...current[variant.id], [selectedId]: raw } }))} />)}
                  </TableBody>
                ))}
              </Table>}
          </Card>
        </>}
      <FormError>{error}</FormError>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
        <div aria-live="polite">
          <p className="text-sm font-medium">{changed.length ? `${changed.length} perubahan di ${changedOutlets} outlet belum disimpan` : "Tidak ada perubahan yang belum disimpan"}</p>
          <p className="mt-1 text-xs text-muted-foreground">Penyimpanan dilakukan per treatment dan batch; sebagian perubahan dapat berhasil lebih dahulu.</p>
        </div>
        <Button onClick={() => void submit()} disabled={!ready || !changed.length || saving}>{saving ? "Menyimpan…" : "Simpan perubahan"}</Button>
      </div>
    </div>
  );
}

function PriceRow({ treatment, variant, outlet, draft, commissionDraft, saving, onChange, onCommissionChange }: {
  treatment: Treatment; variant: Variant; outlet: Outlet; draft?: string;
  commissionDraft?: string;
  saving: boolean; onChange: (value: string) => void;
  onCommissionChange: (value: string) => void;
}) {
  const state = priceState(variant, outlet.branch_id, draft);
  const rawDisplay = state.raw || String(variant.price_idr);
  const displayedPrice = /^\d+$/.test(rawDisplay) ? formatNumber(rawDisplay) : rawDisplay;
  const errorId = `price-error-${variant.id}-${outlet.branch_id}`;
  const storedCommission = variant.outlet_commissions?.find((c) => c.branch_id === outlet.branch_id);
  const commissionValue = commissionDraft ?? (storedCommission ? String(storedCommission.commission_value) : "");
  const label = `${treatment.name}, ${variant.name}, ${outlet.branch_name}`;
  return (
    <TableRow>
      <TableCell className="align-top break-words whitespace-normal">
        <p className="font-medium">{variant.name}</p>
        <p className="text-xs text-muted-foreground">{variant.duration_min} menit</p>
        {!variant.is_active && <Badge variant="muted" className="mt-1">Nonaktif</Badge>}
        <p className="mt-2 text-xs text-muted-foreground md:hidden">Dasar {formatNumber(variant.price_idr)}</p>
      </TableCell>
      <TableCell className="hidden align-top tabular-nums md:table-cell">{formatNumber(variant.price_idr)}</TableCell>
      <TableCell className="space-y-2 align-top whitespace-normal">
        <Input type="text" inputMode="numeric" className="tabular-nums" value={displayedPrice} disabled={saving}
          aria-label={`Harga ${treatment.name}, ${variant.name}, ${outlet.branch_name}`} aria-invalid={!!state.error}
          aria-describedby={state.error ? errorId : undefined} onChange={(e) => onChange(e.target.value.replaceAll(".", ""))} />
        {state.changed && <Badge variant="warning">Diubah</Badge>}
        {state.error && <p id={errorId} className="text-xs text-danger">{state.error}</p>}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <Input type="number" min={0} max={999999999999} step={1}
          value={commissionValue} disabled={saving} required aria-label={`Komisi nominal ${label}`}
          onChange={(e) => onCommissionChange(e.target.value)} className="tabular-nums" />
        {commissionValue === "" ? <p className="mt-1 text-xs text-danger">Wajib diisi</p> : null}
      </TableCell>
    </TableRow>
  );
}
