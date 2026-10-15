"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { formatRupiah } from "@/lib/format";
import { useMyAddItem } from "../mutations";
import { useMyCatalog } from "../queries";
import { Field, FormError, SELECT } from "./shared";

/**
 * Terapis menambah treatment ke booking-nya sendiri saat tamu minta tambahan
 * di tengah atau setelah treatment (revisi R4). Treatment baru mengikuti
 * terapis yang sama dan dijadwalkan setelah treatment terakhir.
 */
export function MyAddTreatmentDialog({
  bookingId,
  branchId,
  customerName,
  onClose,
}: {
  bookingId: string;
  branchId: string;
  customerName: string;
  onClose: () => void;
}) {
  const [variantId, setVariantId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const catalog = useMyCatalog(branchId);
  const add = useMyAddItem();

  const submit = () => {
    if (!variantId) return setError("Pilih layanan.");
    setError(null);
    add.mutate(
      { bookingId, variantId },
      {
        onSuccess: () => {
          toast.success("Layanan ditambahkan", { description: customerName });
          onClose();
        },
        onError: (err) => {
          setError(err.message);
          toast.error("Layanan gagal ditambahkan", { description: err.message });
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Tambah layanan</DialogPanelTitle>
            <DialogPanelDescription>
              Untuk {customerName}. Layanan baru dikerjakan kamu juga, setelah layanan yang sedang berjalan, dan masuk ke tagihan di kasir.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            <Field label="Layanan">
              <select className={SELECT} value={variantId} onChange={(e) => setVariantId(e.target.value)} required aria-label="Layanan tambahan">
                <option value="">{catalog.isLoading ? "Memuat…" : "Pilih layanan…"}</option>
                {(catalog.data ?? []).flatMap((t) =>
                  t.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {t.name} · {v.name} · {formatRupiah(v.price_idr)}
                    </option>
                  )),
                )}
              </select>
            </Field>
            {catalog.error && <FormError>{catalog.error.message}</FormError>}
            <FormError>{error}</FormError>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={add.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? "Menyimpan…" : "Tambah"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
