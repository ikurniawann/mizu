"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import {
  designSummary,
  draftFromDesign,
  draftToDesign,
  isDraftComplete,
  missingSections,
  type CaseDesign,
  type CaseDraft,
  type ExperienceCatalog,
} from "../../experience";
import { useSetItemDesign } from "../../mutations";
import { useExperienceCatalog } from "../../queries";
import { CaseConfigurator } from "./case-configurator";
import { CaseDesignCard } from "./case-design-card";

export interface DesignableItem {
  id: string;
  treatment_name: string;
  design?: CaseDesign | null;
}

/**
 * Dialog "Desain" di Book Order / detail booking: lihat desain custom case, atau
 * isi/ubah (crew mengisi untuk booking dari kasir, telepon, atau WhatsApp).
 */
export function CaseDesignDialog({
  bookingId,
  item,
  customerName,
  editable,
  onClose,
}: {
  bookingId: string;
  item: DesignableItem;
  customerName?: string;
  /** false = hanya lihat (booking lunas/batal). */
  editable: boolean;
  onClose: () => void;
}) {
  const catalog = useExperienceCatalog();
  const [editing, setEditing] = useState(editable && !item.design);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size={editing ? "xl" : "md"}>
        <DialogPanelHeader>
          <DialogPanelTitle>Desain custom case</DialogPanelTitle>
          <DialogPanelDescription>
            {item.treatment_name}
            {customerName ? ` · ${customerName}` : ""}
            {editing ? " · pilihan tersimpan setelah ditekan Simpan desain." : ""}
          </DialogPanelDescription>
        </DialogPanelHeader>
        {catalog.isLoading ? (
          <DialogPanelBody className="flex justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </DialogPanelBody>
        ) : catalog.error || !catalog.data ? (
          <DialogPanelBody>
            <p className="text-sm text-danger">{catalog.error?.message ?? "Katalog desain tidak tersedia."}</p>
          </DialogPanelBody>
        ) : editing ? (
          <DesignEditor catalog={catalog.data} bookingId={bookingId} item={item} onCancel={() => (item.design ? setEditing(false) : onClose())} onSaved={onClose} />
        ) : (
          <>
            <DialogPanelBody>
              {item.design ? (
                <div className="space-y-3">
                  <CaseDesignCard design={item.design} size="lg" />
                  <p className="rounded-xl bg-surface px-3 py-2 text-xs text-body">
                    <span className="font-semibold text-foreground">Catatan cetak:</span> {designSummary(item.design)}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Belum ada desain untuk layanan ini.</p>
              )}
            </DialogPanelBody>
            <DialogFooter className="flex-row justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Tutup
              </Button>
              {editable ? (
                <Button onClick={() => setEditing(true)}>
                  <Pencil /> {item.design ? "Ubah desain" : "Isi desain"}
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogPanel>
    </Dialog>
  );
}

function DesignEditor({
  catalog,
  bookingId,
  item,
  onCancel,
  onSaved,
}: {
  catalog: ExperienceCatalog;
  bookingId: string;
  item: DesignableItem;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<CaseDraft>(() => draftFromDesign(item.design, catalog));
  const save = useSetItemDesign();
  const complete = isDraftComplete(draft, catalog);
  const submit = () =>
    save.mutate(
      { bookingId, itemId: item.id, design: draftToDesign(draft) },
      {
        onSuccess: () => {
          toast.success("Desain disimpan", { description: item.treatment_name });
          onSaved();
        },
        onError: (err) => toast.error("Desain ditolak", { description: err.message }),
      }
    );
  const clear = () =>
    save.mutate(
      { bookingId, itemId: item.id, design: null },
      {
        onSuccess: () => {
          toast.success("Desain dihapus");
          onSaved();
        },
        onError: (err) => toast.error("Gagal menghapus desain", { description: err.message }),
      }
    );
  return (
    <>
      <DialogPanelBody>
        <CaseConfigurator catalog={catalog} value={draft} onChange={setDraft} compact />
      </DialogPanelBody>
      <DialogFooter className="flex-row flex-wrap justify-end gap-2">
        {item.design ? (
          <Button variant="ghost" className="mr-auto" disabled={save.isPending} onClick={clear} aria-label="Hapus desain">
            Hapus
          </Button>
        ) : null}
        <Button variant="outline" disabled={save.isPending} onClick={onCancel}>
          Batal
        </Button>
        <Button disabled={!complete || save.isPending} onClick={submit} title={complete ? undefined : `Lengkapi: ${missingSections(draft, catalog).join(", ")}`}>
          {save.isPending ? <Loader2 className="animate-spin" /> : null}
          Simpan desain
        </Button>
      </DialogFooter>
    </>
  );
}
