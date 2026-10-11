"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogFooter, DialogPanel, DialogPanelBody, DialogPanelDescription, DialogPanelForm, DialogPanelHeader, DialogPanelTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeleteTreatmentCategory, useSaveTreatmentCategory } from "../mutations";
import { useSpaTreatmentCategories } from "../queries";
import type { TreatmentCategory } from "../types";
import { Field, FormError, SPA_KICKER, TableNote } from "./shared";

export function SpaTreatmentCategoriesPage() {
  const categories = useSpaTreatmentCategories();
  const remove = useDeleteTreatmentCategory();
  const [editing, setEditing] = useState<TreatmentCategory | "new" | null>(null);
  const [deleting, setDeleting] = useState<TreatmentCategory | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader kicker={SPA_KICKER} title="Kategori Treatment"
        description="Kelola kategori untuk mengelompokkan treatment. Mengubah nama kategori juga memperbarui treatment yang sudah memakai kategori tersebut."
        actions={<Button onClick={() => setEditing("new")}><Plus /> Kategori baru</Button>} />
      <Card className="py-0">
        {categories.isLoading ? <div className="p-4"><SkeletonTable columns={3} rows={5} /></div>
          : categories.error ? <TableNote tone="danger">{categories.error.message}</TableNote>
          : !categories.data?.length ? <TableNote>Belum ada kategori. Tambahkan kategori pertama.</TableNote>
          : <Table>
            <TableHeader><TableRow>
              <TableHead>Kategori</TableHead>
              <TableHead>Jumlah treatment</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow></TableHeader>
            <TableBody>{categories.data.map((category) => <TableRow key={category.id}>
              <TableCell className="font-medium">{category.name}</TableCell>
              <TableCell>{category.treatment_count}</TableCell>
              <TableCell className="text-right">
                <div className="flex flex-wrap justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(category)}><Pencil /> Ubah</Button>
                  <Button size="sm" variant="ghost" disabled={category.treatment_count > 0}
                    title={category.treatment_count > 0 ? "Kategori masih dipakai oleh treatment" : undefined}
                    onClick={() => setDeleting(category)}><Trash2 /> Hapus</Button>
                </div>
              </TableCell>
            </TableRow>)}</TableBody>
          </Table>}
      </Card>
      {editing && <CategoryDialog category={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && <Dialog open onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogPanel size="sm">
          <DialogPanelHeader>
            <DialogPanelTitle>Hapus kategori {deleting.name}?</DialogPanelTitle>
            <DialogPanelDescription>Kategori yang dihapus tidak dapat dipulihkan.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody><FormError>{remove.error?.message}</FormError></DialogPanelBody>
          <DialogFooter>
            <Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(null)}>Batal</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(deleting.id, {
              onSuccess: () => { toast.success("Kategori dihapus"); setDeleting(null); },
            })}>{remove.isPending ? "Menghapus…" : "Hapus"}</Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>}
    </div>
  );
}

function CategoryDialog({ category, onClose }: { category: TreatmentCategory | null; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useSaveTreatmentCategory();
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 60) {
      setError("Nama kategori wajib diisi, maksimal 60 karakter.");
      return;
    }
    setError(null);
    save.mutate({ id: category?.id, name: trimmed }, {
      onSuccess: () => { toast.success(category ? "Kategori diperbarui" : "Kategori dibuat"); onClose(); },
      onError: (err) => setError(err.message),
    });
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogPanel size="sm"><DialogPanelForm onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <DialogPanelHeader>
        <DialogPanelTitle>{category ? "Ubah kategori" : "Kategori baru"}</DialogPanelTitle>
      </DialogPanelHeader>
      <DialogPanelBody className="space-y-3">
        <Field label="Nama kategori"><Input autoFocus maxLength={60} value={name} onChange={(event) => setName(event.target.value)} required /></Field>
        <FormError>{error}</FormError>
      </DialogPanelBody>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Batal</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Menyimpan…" : "Simpan"}</Button>
      </DialogFooter>
    </DialogPanelForm></DialogPanel>
  </Dialog>;
}
