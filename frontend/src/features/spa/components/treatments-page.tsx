"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OutletPricesEditor } from "./outlet-prices-editor";
import { formatRupiah } from "@/lib/format";
import { useSaveTreatment } from "../mutations";
import { useSpaOutlets, useSpaTreatmentCategories, useSpaTreatments } from "../queries";
import {
  emptyVariantRow,
  initialTreatmentForm,
  MAX_PRICE_IDR,
  toTreatmentInput,
  validateTreatmentForm,
  type TreatmentForm,
  type VariantRow,
} from "../treatment-form";
import type { Treatment, TreatmentCategory } from "../types";
import { Field, FormError, SELECT, SPA_KICKER, TableNote, TEXTAREA } from "./shared";

/** Spa → Treatment: master treatment, varian durasi, dan harga per outlet. */
export function SpaTreatmentsPage() {
  const treatments = useSpaTreatments();
  const categories = useSpaTreatmentCategories();
  const outlets = useSpaOutlets();
  const [editing, setEditing] = useState<Treatment | "new" | null>(null);
  const [tab, setTab] = useState("list");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const rows = [...(treatments.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, "id"));

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={SPA_KICKER}
        title="Treatment"
        description="Treatment dan varian durasinya. Harga per outlet menimpa harga dasar; produk POS diperbarui lewat Sinkron produk POS di Outlet Spa."
        actions={
          tab === "list" ? <Button onClick={() => setEditing("new")}><Plus /> Treatment baru</Button> : undefined
        }
      />

      {treatments.error && <FormError>{treatments.error.message}</FormError>}
      {categories.error && <FormError>{categories.error.message}</FormError>}
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList variant="line" aria-label="Pengelolaan treatment">
          <TabsTrigger value="list">Daftar Treatment</TabsTrigger>
          <TabsTrigger value="prices">Harga Outlet</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <Card className="py-0">
            {treatments.isLoading ? (
              <div className="p-4">
                <SkeletonTable columns={4} rows={5} />
              </div>
            ) : !treatments.data && treatments.error ? (
              <TableNote tone="danger">Daftar treatment belum dapat dimuat.</TableNote>
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
                                {" · "}<span className="tabular-nums">{formatRupiah(v.price_idr)}</span>
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
                        <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                          <Pencil /> Ubah
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

        </TabsContent>
        <TabsContent value="prices" keepMounted>
          <OutletPricesEditor
            treatments={rows}
            outlets={outlets.data}
            loading={treatments.isLoading || outlets.isLoading}
            ready={!!treatments.data && !!outlets.data}
            outletError={outlets.error?.message}
            search={search}
            onSearchChange={setSearch}
            category={category}
            onCategoryChange={setCategory}
          />
        </TabsContent>
      </Tabs>
      {editing && <TreatmentDialog treatment={editing === "new" ? null : editing} categories={categories.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TreatmentDialog({ treatment, categories, onClose }: { treatment: Treatment | null; categories: TreatmentCategory[]; onClose: () => void }) {
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
              Varian yang dihapus dari daftar dinonaktifkan (riwayat booking tetap utuh). Harga dalam rupiah; durasi dalam menit.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Field label="Kode">
              <Input maxLength={20} value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="BAL" required />
            </Field>
            <Field label="Nama" className="sm:col-span-2">
              <Input maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Balinese Massage" required />
            </Field>
            <Field label="Urutan">
              <Input type="number" min={0} max={9999} step={1} value={form.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
            </Field>
            <Field label="Kategori" className="sm:col-span-2">
              <select className={SELECT} value={form.category} onChange={(e) => set("category", e.target.value)}>
                <option value="">Tanpa kategori</option>
                {categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-3 self-end pb-2 text-sm sm:col-span-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} aria-label="Treatment aktif" />
              Aktif (tampil di booking)
            </label>
            <Field label="Deskripsi" className="sm:col-span-4">
              <textarea maxLength={2000} className={TEXTAREA} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </Field>

            <div className="space-y-2 sm:col-span-4">
              <p className="text-sm font-medium">Varian</p>
              <div className="hidden grid-cols-[minmax(0,2fr)_6rem_minmax(0,1.3fr)_4.5rem_2.5rem] gap-2 px-3 text-xs text-muted-foreground md:grid">
                <span>Nama varian</span>
                <span>Durasi</span>
                <span>Harga dasar (Rp)</span>
                <span>Aktif</span>
                <span />
              </div>
              {form.variants.map((v, index) => (
                <div
                  key={v.key}
                  className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-2 p-3 md:grid-cols-[minmax(0,2fr)_6rem_minmax(0,1.3fr)_4.5rem_2.5rem] md:items-center"
                >
                  <Input
                    className="col-span-2 md:col-span-1"
                    maxLength={60}
                    value={v.name}
                    onChange={(e) => setVariant(v.key, { name: e.target.value })}
                    placeholder={`Varian ${index + 1} (mis. 60 menit)`}
                    aria-label="Nama varian"
                  />
                  <Input
                    type="number"
                    min={5}
                    max={600}
                    step={1}
                    value={v.duration_min}
                    onChange={(e) => setVariant(v.key, { duration_min: e.target.value })}
                    aria-label="Durasi (menit)"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={MAX_PRICE_IDR}
                    step={1}
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
                disabled={form.variants.length >= 20}
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
