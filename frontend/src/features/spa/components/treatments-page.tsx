"use client";

import { useState } from "react";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format";
import { useSaveTreatment, useSaveTreatmentPrices } from "../mutations";
import { useSpaOutlets, useSpaTreatments } from "../queries";
import {
  emptyVariantRow,
  initialPriceGrid,
  initialTreatmentForm,
  toPriceInputs,
  toTreatmentInput,
  validateTreatmentForm,
  type TreatmentForm,
  type VariantRow,
} from "../treatment-form";
import type { Outlet, Treatment } from "../types";
import { Field, FormError, SPA_KICKER, TableNote, TEXTAREA } from "./shared";

/** Spa → Treatment: master treatment, varian durasi, dan harga per outlet. */
export function SpaTreatmentsPage() {
  const treatments = useSpaTreatments();
  const outlets = useSpaOutlets();
  const [editing, setEditing] = useState<Treatment | "new" | null>(null);
  const [pricing, setPricing] = useState<Treatment | null>(null);
  const rows = [...(treatments.data ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const configured = (outlets.data ?? []).filter((o) => o.configured);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={SPA_KICKER}
        title="Treatment"
        description="Treatment dan varian durasinya. Jeda (buffer) dipakai saat cek bentrok jadwal terapis. Harga per outlet menimpa harga dasar; produk POS diperbarui lewat Sinkron produk POS di Outlet Spa."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Treatment baru
          </Button>
        }
      />

      <Card className="py-0">
        {treatments.isLoading ? (
          <div className="p-4">
            <SkeletonTable columns={4} rows={5} />
          </div>
        ) : treatments.error ? (
          <TableNote tone="danger">{treatments.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada treatment. Tambahkan treatment pertama.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Treatment</TableHead>
                <TableHead>Varian</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id} className={t.is_active ? undefined : "opacity-60"}>
                  <TableCell className="max-w-[18rem] align-top whitespace-normal">
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{t.code}</span>
                      {t.category ? ` · ${t.category}` : ""}
                    </p>
                    {t.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>}
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <ul className="space-y-1">
                      {[...t.variants]
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map((v) => (
                          <li key={v.id} className={v.is_active ? "text-sm" : "text-sm text-muted-foreground line-through"}>
                            <span className="font-medium">{v.name}</span> · {v.duration_min} mnt
                            {v.buffer_min ? ` + ${v.buffer_min} jeda` : ""} · <span className="tabular-nums">{formatRupiah(v.price_idr)}</span>
                            {v.outlet_prices.length > 0 && (
                              <Badge variant="info" className="ml-2">
                                {v.outlet_prices.length} harga outlet
                              </Badge>
                            )}
                          </li>
                        ))}
                    </ul>
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant={t.is_active ? "success" : "muted"}>{t.is_active ? "Aktif" : "Nonaktif"}</Badge>
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setPricing(t)} disabled={t.variants.length === 0}>
                        <Tags /> Harga per outlet
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                        <Pencil /> Ubah
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {editing && <TreatmentDialog treatment={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {pricing && <PricesDialog treatment={pricing} outlets={configured} onClose={() => setPricing(null)} />}
    </div>
  );
}

function TreatmentDialog({ treatment, onClose }: { treatment: Treatment | null; onClose: () => void }) {
  const [form, setForm] = useState<TreatmentForm>(() => initialTreatmentForm(treatment));
  const [errors, setErrors] = useState<string[]>([]);
  const save = useSaveTreatment();
  const set = <K extends keyof TreatmentForm>(key: K, value: TreatmentForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setVariant = (key: string, patch: Partial<VariantRow>) =>
    setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));

  const submit = () => {
    const found = validateTreatmentForm(form);
    setErrors(found);
    if (found.length) return;
    save.mutate(
      { id: treatment?.id, input: toTreatmentInput(form) },
      {
        onSuccess: (saved) => {
          toast.success(treatment ? "Treatment diperbarui" : "Treatment dibuat", { description: saved.name });
          onClose();
        },
        onError: (err) => {
          setErrors([err.message]);
          toast.error("Treatment gagal disimpan", { description: err.message });
        },
      }
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xl">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{treatment ? `Ubah ${treatment.name}` : "Treatment baru"}</DialogPanelTitle>
            <DialogPanelDescription>
              Varian yang dihapus dari daftar dinonaktifkan (riwayat booking tetap utuh). Harga dalam rupiah; durasi & jeda dalam menit.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Field label="Kode">
              <Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="BAL" required />
            </Field>
            <Field label="Nama" className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Balinese Massage" required />
            </Field>
            <Field label="Urutan">
              <Input type="number" value={form.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
            </Field>
            <Field label="Kategori" className="sm:col-span-2">
              <Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Massage, Facial, Body scrub…" />
            </Field>
            <label className="flex items-center gap-3 self-end pb-2 text-sm sm:col-span-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} aria-label="Treatment aktif" />
              Aktif (tampil di booking)
            </label>
            <Field label="Deskripsi" className="sm:col-span-4">
              <textarea className={TEXTAREA} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </Field>

            <div className="space-y-2 sm:col-span-4">
              <p className="text-sm font-medium">Varian</p>
              <div className="hidden grid-cols-[minmax(0,2fr)_6rem_6rem_minmax(0,1.3fr)_4.5rem_2.5rem] gap-2 px-3 text-xs text-muted-foreground md:grid">
                <span>Nama varian</span>
                <span>Durasi</span>
                <span>Jeda</span>
                <span>Harga dasar (Rp)</span>
                <span>Aktif</span>
                <span />
              </div>
              {form.variants.map((v, index) => (
                <div
                  key={v.key}
                  className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-2 p-3 md:grid-cols-[minmax(0,2fr)_6rem_6rem_minmax(0,1.3fr)_4.5rem_2.5rem] md:items-center"
                >
                  <Input
                    className="col-span-2 md:col-span-1"
                    value={v.name}
                    onChange={(e) => setVariant(v.key, { name: e.target.value })}
                    placeholder={`Varian ${index + 1} (mis. 60 menit)`}
                    aria-label="Nama varian"
                  />
                  <Input
                    type="number"
                    min={1}
                    value={v.duration_min}
                    onChange={(e) => setVariant(v.key, { duration_min: e.target.value })}
                    aria-label="Durasi (menit)"
                  />
                  <Input
                    type="number"
                    min={0}
                    value={v.buffer_min}
                    onChange={(e) => setVariant(v.key, { buffer_min: e.target.value })}
                    aria-label="Jeda (menit)"
                  />
                  <Input
                    type="number"
                    min={0}
                    value={v.price_idr}
                    onChange={(e) => setVariant(v.key, { price_idr: e.target.value })}
                    aria-label="Harga dasar"
                    className="col-span-2 md:col-span-1"
                  />
                  <Switch checked={v.is_active} onCheckedChange={(on) => setVariant(v.key, { is_active: on })} aria-label="Varian aktif" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Hapus varian"
                    disabled={form.variants.length === 1}
                    onClick={() => setForm((f) => ({ ...f, variants: f.variants.filter((r) => r.key !== v.key) }))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, variants: [...f.variants, emptyVariantRow()] }))}
              >
                <Plus /> Tambah varian
              </Button>
            </div>
            {errors.length > 0 && (
              <div className="sm:col-span-4">
                <FormError>
                  <ul className="list-inside list-disc">
                    {errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </FormError>
              </div>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

function PricesDialog({ treatment, outlets, onClose }: { treatment: Treatment; outlets: Outlet[]; onClose: () => void }) {
  const [grid, setGrid] = useState(() => initialPriceGrid(treatment, outlets));
  const [error, setError] = useState<string | null>(null);
  const save = useSaveTreatmentPrices();
  const variants = [...treatment.variants].sort((a, b) => a.sort_order - b.sort_order);

  const submit = () => {
    let prices;
    try {
      prices = toPriceInputs(treatment, grid);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    if (prices.length === 0) {
      onClose();
      return;
    }
    setError(null);
    save.mutate(
      { id: treatment.id, prices },
      {
        onSuccess: () => {
          toast.success("Harga outlet disimpan", { description: `${treatment.name} · ${prices.length} perubahan. Jalankan Sinkron produk POS agar kasir ikut berubah.` });
          onClose();
        },
        onError: (err) => {
          setError(err.message);
          toast.error("Harga gagal disimpan", { description: err.message });
        },
      }
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xl">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Harga per outlet — {treatment.name}</DialogPanelTitle>
            <DialogPanelDescription>Kosongkan sel untuk memakai harga dasar varian.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-3">
            {outlets.length === 0 ? (
              <TableNote>Belum ada outlet spa yang dikonfigurasi.</TableNote>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Outlet</TableHead>
                      {variants.map((v) => (
                        <TableHead key={v.id} className="min-w-[9rem]">
                          {v.name}
                          <span className="block text-[11px] font-normal text-muted-foreground">Dasar {formatRupiah(v.price_idr)}</span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outlets.map((o) => (
                      <TableRow key={o.branch_id}>
                        <TableCell className="font-medium">{o.branch_name}</TableCell>
                        {variants.map((v) => (
                          <TableCell key={v.id}>
                            <Input
                              type="number"
                              min={0}
                              value={grid[v.id]?.[o.branch_id] ?? ""}
                              placeholder={String(v.price_idr)}
                              aria-label={`Harga ${v.name} di ${o.branch_name}`}
                              onChange={(e) =>
                                setGrid((g) => ({ ...g, [v.id]: { ...g[v.id], [o.branch_id]: e.target.value } }))
                              }
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <FormError>{error}</FormError>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={save.isPending || outlets.length === 0}>
              {save.isPending ? "Menyimpan…" : "Simpan harga"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
