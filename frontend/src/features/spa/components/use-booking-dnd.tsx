"use client";

import { useMemo, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { availabilityWarning, isDraggable, shiftMismatch } from "../calendar";
import { useAssignBooking } from "../mutations";
import { wibClockOf } from "../time";
import type { BoardItem, BoardTherapist } from "../types";

export const BOOKING_DRAG_TYPE = "application/x-mizu-item";

export function useBookingDnd(unassigned: BoardItem[], therapists: BoardTherapist[]) {
  const action = useAssignBooking();
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pending, setPending] = useState<{ item: BoardItem; row: BoardTherapist; warning: string } | null>(null);
  const byId = useMemo(
    () => new Map([...unassigned, ...therapists.flatMap((row) => row.items)].map((item) => [item.id, item])),
    [unassigned, therapists]
  );

  const assign = (item: BoardItem, row: BoardTherapist) =>
    action.mutate(
      { bookingId: item.booking_id, therapistId: row.therapist.id },
      {
        onSuccess: () => toast.success("Terapis ditugaskan", {
          description: `${item.customer_name} · ${wibClockOf(item.starts_at)} → ${row.therapist.full_name}`,
        }),
        onError: (err) => toast.error("Gagal menugaskan", { description: err.message }),
      }
    );

  const onDrop = (event: DragEvent, row: BoardTherapist | null) => {
    event.preventDefault();
    setDropTarget(null);
    const item = byId.get(event.dataTransfer.getData(BOOKING_DRAG_TYPE));
    if (!item || item.therapist_id === (row?.therapist.id ?? null)) return;
    if (!isDraggable(item)) {
      toast.error("Booking ini sudah mulai dikerjakan, tidak bisa dipindah.");
      return;
    }
    if (!row) {
      if (item.status !== "assigned") return;
      action.mutate(
        { bookingId: item.booking_id, therapistId: null },
        {
          onSuccess: () => toast.success("Terapis dilepas", {
            description: `${item.customer_name} · ${wibClockOf(item.starts_at)} → Belum ditugaskan`,
          }),
          onError: (err) => toast.error("Gagal melepas terapis", { description: err.message }),
        }
      );
      return;
    }
    const mismatch = shiftMismatch(item, row.shift);
    if (mismatch) {
      toast.error("Penugasan ditolak", { description: mismatch });
      return;
    }
    if (item.therapist_gender_pref !== "any" && item.therapist_gender_pref !== row.therapist.gender) {
      toast.error("Penugasan ditolak", {
        description: `Preferensi booking memerlukan terapis ${item.therapist_gender_pref === "female" ? "perempuan" : "laki-laki"}.`,
      });
      return;
    }
    const warning = availabilityWarning(item, row);
    if (warning) setPending({ item, row, warning });
    else assign(item, row);
  };

  const onDragOver = (event: DragEvent, target: string) => {
    if (!event.dataTransfer.types.includes(BOOKING_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(target);
  };

  const onDragLeave = (event: DragEvent, target: string) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDropTarget((current) => current === target ? null : current);
  };

  const confirmation = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && setPending(null)}
      title={`Tugaskan ke ${pending?.row.therapist.full_name ?? ""}?`}
      description={`${pending?.warning ?? ""} Tetap tugaskan ${pending?.item.customer_name ?? ""}?`}
      confirmLabel="Tetap tugaskan"
      onConfirm={() => {
        if (pending) assign(pending.item, pending.row);
        setPending(null);
      }}
    />
  );

  return { dropTarget, onDrop, onDragOver, onDragLeave, confirmation };
}
