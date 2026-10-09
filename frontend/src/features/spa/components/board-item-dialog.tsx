"use client";

import Link from "next/link";
import { toast } from "sonner";
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
import { formatDateLong, formatRupiah, formatTime } from "@/lib/format";
import { useItemAction } from "../mutations";
import { isBookingClosed } from "../rules";
import { wibDateOf } from "../time";
import type { BoardItem } from "../types";
import { InfoRow, ItemStatusBadge, TimeRange } from "./shared";

export type BoardItemFollowUp = "assign" | "reschedule";

/**
 * Detail satu treatment dari papan Book Order (kalender/daftar) beserta aksi
 * cepatnya. Penugasan & ubah jadwal dibuka di dialog masing-masing oleh induk.
 */
export function BoardItemDialog({
  item,
  onClose,
  onFollowUp,
}: {
  item: BoardItem;
  onClose: () => void;
  onFollowUp: (kind: BoardItemFollowUp) => void;
}) {
  const action = useItemAction();
  const open = !isBookingClosed({ status: item.booking_status });
  const notStarted = item.status === "unassigned" || item.status === "assigned";

  const run = (kind: "start" | "complete" | "unassign") =>
    action.mutate(
      { bookingId: item.booking_id, itemId: item.id, input: { action: kind } },
      {
        onSuccess: () => {
          toast.success(
            kind === "start" ? "Treatment dimulai" : kind === "complete" ? "Treatment selesai" : "Terapis dilepas",
            { description: `${item.customer_name} · ${item.treatment_name}` }
          );
          onClose();
        },
        onError: (err) => toast.error("Aksi gagal", { description: err.message }),
      }
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>{item.customer_name}</DialogPanelTitle>
          <DialogPanelDescription>
            {item.treatment_name} — {item.variant_name}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-1">
          <InfoRow label="Waktu">
            <span>{formatDateLong(wibDateOf(item.starts_at))} · </span>
            <TimeRange start={item.starts_at} end={item.ends_at} />
            {item.buffer_min > 0 && <span className="text-muted-foreground"> (+{item.buffer_min} mnt jeda)</span>}
          </InfoRow>
          <InfoRow label="Terapis">{item.therapist_name ?? <span className="text-warning">Belum ditugaskan</span>}</InfoRow>
          <InfoRow label="Status">
            <ItemStatusBadge status={item.status} />
            {item.started_at && <span className="ml-2 text-xs text-muted-foreground">mulai {formatTime(item.started_at)}</span>}
            {item.completed_at && <span className="ml-2 text-xs text-muted-foreground">selesai {formatTime(item.completed_at)}</span>}
          </InfoRow>
          <InfoRow label="Harga">{formatRupiah(item.price_idr)}</InfoRow>
          <InfoRow label="Booking">
            <Link href={`/dashboard/spa/bookings/${item.booking_id}`} className="font-mono text-brand-text hover:underline">
              {item.booking_code}
            </Link>
          </InfoRow>
        </DialogPanelBody>
        <DialogFooter className="flex-wrap gap-2">
          {open && notStarted && (
            <Button variant="outline" disabled={action.isPending} onClick={() => onFollowUp("reschedule")}>
              Ubah jam
            </Button>
          )}
          {open && item.status === "assigned" && (
            <Button variant="ghost" disabled={action.isPending} onClick={() => run("unassign")}>
              Lepas terapis
            </Button>
          )}
          {open && notStarted && (
            <Button variant={item.status === "unassigned" ? "default" : "outline"} disabled={action.isPending} onClick={() => onFollowUp("assign")}>
              {item.status === "unassigned" ? "Tugaskan terapis" : "Ganti terapis"}
            </Button>
          )}
          {open && item.status === "assigned" && (
            <Button variant="soft" disabled={action.isPending} onClick={() => run("start")}>
              Mulai
            </Button>
          )}
          {open && (item.status === "assigned" || item.status === "in_treatment") && (
            <Button disabled={action.isPending} onClick={() => run("complete")}>
              Selesai
            </Button>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
