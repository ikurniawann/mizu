"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { formatDate, formatRupiah } from "@/lib/format";
import { useAddBookingItem, useAssignBooking } from "../mutations";
import { useSpaAvailability, useSpaTreatments } from "../queries";
import { activeVariantOptions, genderLabel, variantPrice } from "../rules";
import type { BoardItem, GenderPref, TherapistAvailability } from "../types";
import { Field, FormError, SELECT, TableNote, TimeRange } from "./shared";

type AssignableItem = Pick<
  BoardItem,
  "id" | "treatment_name" | "variant_name" | "starts_at" | "ends_at" | "therapist_id"
>;

function availabilityRank(a: TherapistAvailability): number {
  if (a.available) return 0;
  if (a.conflicts.length === 0 && !a.on_leave && !a.day_off) return 1;
  return 2;
}

/** Status ringkas ketersediaan satu terapis. */
function AvailabilityBadges({ row }: { row: TherapistAvailability }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {row.available ? <Badge variant="success">Tersedia</Badge> : <Badge variant="destructive">Tidak tersedia</Badge>}
      {row.on_leave && <Badge variant="warning">Cuti</Badge>}
      {row.day_off && <Badge variant="muted">Libur</Badge>}
      {row.assisting && <Badge variant="info">Perbantuan</Badge>}
      {row.shift ? (
        <span className="text-xs text-muted-foreground">
          Shift {row.shift.name} · {row.shift.start_time.slice(0, 5)}–{row.shift.end_time.slice(0, 5)}
        </span>
      ) : (
        !row.day_off && <span className="text-xs text-muted-foreground">Tanpa jadwal shift</span>
      )}
    </div>
  );
}

/**
 * Pilih satu terapis untuk seluruh booking dengan cek ketersediaan
 * (GET /api/spa/availability). Penugasan yang bentrok tetap ditolak server.
 */
export function AssignTherapistDialog({
  bookingId,
  branchId,
  item,
  genderPref,
  onClose,
}: {
  bookingId: string;
  branchId: string;
  item: AssignableItem;
  genderPref?: GenderPref;
  onClose: () => void;
}) {
  const availability = useSpaAvailability({
    branch_id: branchId,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    booking_id: bookingId,
  });
  const action = useAssignBooking();
  const rows = useMemo(
    () =>
      [...(availability.data ?? [])].sort(
        (a, b) => availabilityRank(a) - availabilityRank(b) || a.therapist.full_name.localeCompare(b.therapist.full_name)
      ),
    [availability.data]
  );

  const assign = (therapistId: string, name: string) =>
    action.mutate(
      { bookingId, therapistId },
      {
        onSuccess: () => {
          toast.success("Terapis ditugaskan", { description: `${name} · ${item.treatment_name}` });
          onClose();
        },
        onError: (err) => toast.error("Penugasan ditolak", { description: err.message }),
      }
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Tugaskan terapis</DialogPanelTitle>
          <DialogPanelDescription>
            Seluruh treatment dalam booking · {formatDate(item.starts_at)}{" "}
            <TimeRange start={item.starts_at} end={item.ends_at} />
            . Terapis yang bentrok jadwal tidak dapat dipilih.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-2">
          {availability.isLoading ? (
            <TableNote>Memeriksa ketersediaan terapis…</TableNote>
          ) : availability.error ? (
            <TableNote tone="danger">{availability.error.message}</TableNote>
          ) : rows.length === 0 ? (
            <TableNote>Tidak ada terapis aktif untuk outlet ini pada tanggal tersebut.</TableNote>
          ) : (
            rows.map((row) => {
              const t = row.therapist;
              const matchesPref = genderPref && genderPref !== "any" && t.gender === genderPref;
              const current = item.therapist_id === t.id;
              return (
                <div
                  key={t.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border p-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">
                      {t.full_name}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {genderLabel(t.gender)}
                        {t.home_branch_name ? ` · ${t.home_branch_name}` : ""}
                      </span>
                      {matchesPref && (
                        <Badge variant="accent" className="ml-2">
                          Sesuai preferensi
                        </Badge>
                      )}
                    </p>
                    <AvailabilityBadges row={row} />
                    {row.conflicts.length > 0 && (
                      <ul className="space-y-0.5 text-xs text-danger">
                        {row.conflicts.map((c) => (
                          <li key={c.item_id}>
                            Bentrok dengan {c.booking_code} · <TimeRange start={c.starts_at} end={c.ends_at} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={row.available ? "default" : "outline"}
                    disabled={!row.available || action.isPending || current}
                    onClick={() => assign(t.id, t.full_name)}
                  >
                    {current ? "Saat ini" : "Tugaskan"}
                  </Button>
                </div>
              );
            })
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

/** Tambah treatment ke booking yang sudah ada. */
export function AddItemDialog({
  bookingId,
  branchId,
  onClose,
}: {
  bookingId: string;
  branchId: string;
  onClose: () => void;
}) {
  const [variantId, setVariantId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const treatments = useSpaTreatments(true);
  const options = useMemo(() => activeVariantOptions(treatments.data ?? []), [treatments.data]);
  const add = useAddBookingItem(bookingId);

  const submit = () => {
    if (!variantId) return setError("Pilih treatment.");
    setError(null);
    add.mutate(
      { variant_id: variantId },
      {
        onSuccess: () => {
          toast.success("Treatment ditambahkan");
          onClose();
        },
        onError: (err) => {
          setError(err.message);
          toast.error("Treatment gagal ditambahkan", { description: err.message });
        },
      }
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
            <DialogPanelTitle>Tambah treatment</DialogPanelTitle>
            <DialogPanelDescription>Treatment mengikuti terapis booking. Ketersediaan terapis diperiksa kembali untuk jadwal yang bertambah.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            <Field label="Treatment">
              <select className={SELECT} value={variantId} onChange={(e) => setVariantId(e.target.value)} required>
                <option value="">{treatments.isLoading ? "Memuat…" : "Pilih treatment…"}</option>
                {options.map((o) => (
                  <option key={o.variant.id} value={o.variant.id}>
                    {o.label} · {formatRupiah(variantPrice(o.variant, branchId))}
                  </option>
                ))}
              </select>
            </Field>
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
