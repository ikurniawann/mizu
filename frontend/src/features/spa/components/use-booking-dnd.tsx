"use client";

import { useMemo, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { availabilityWarning, clockOf, isDraggable, minuteOfDay, PX_PER_MIN, shiftMismatch, snapStartMinute, type DayRange } from "../calendar";
import { useAssignBooking, useRescheduleBooking } from "../mutations";
import { wibClockOf, wibToIso } from "../time";
import type { BoardItem, BoardTherapist } from "../types";

export const BOOKING_DRAG_TYPE = "application/x-mizu-item";
/** Jarak (px) titik pegang dari atas blok, agar posisi jatuh = posisi atas blok. */
export const BOOKING_GRAB_TYPE = "application/x-mizu-grab";

/** Kolom bersumbu jam (kalender): seret naik/turun di kolom yang sama = ubah jam. */
export interface DropTimeline {
  date: string;
  range: DayRange;
}

export function useBookingDnd(unassigned: BoardItem[], therapists: BoardTherapist[]) {
  const action = useAssignBooking();
  const reschedule = useRescheduleBooking();
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pending, setPending] = useState<{ item: BoardItem; row: BoardTherapist; warning: string } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ item: BoardItem; date: string; minute: number } | null>(null);
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

  const move = (item: BoardItem, date: string, minute: number) =>
    reschedule.mutate(
      { bookingId: item.booking_id, scheduledAt: wibToIso(date, clockOf(minute)) },
      {
        onSuccess: () => toast.success("Jadwal dipindah", {
          description: `${item.customer_name} · ${wibClockOf(item.starts_at)} → ${clockOf(minute)}`,
        }),
        onError: (err) => toast.error("Gagal memindah jadwal", { description: err.message }),
      }
    );

  const onDrop = (event: DragEvent, row: BoardTherapist | null, timeline?: DropTimeline) => {
    event.preventDefault();
    setDropTarget(null);
    const item = byId.get(event.dataTransfer.getData(BOOKING_DRAG_TYPE));
    if (!item) return;
    const sameColumn = item.therapist_id === (row?.therapist.id ?? null);
    if (sameColumn && !timeline) return;
    if (!isDraggable(item)) {
      toast.error("Booking ini sudah mulai dikerjakan, tidak bisa dipindah.");
      return;
    }
    if (sameColumn && timeline) {
      // Naik/turun di kolom yang sama: pindah jam, terapis tetap.
      const grab = Number(event.dataTransfer.getData(BOOKING_GRAB_TYPE)) || 0;
      const top = event.clientY - event.currentTarget.getBoundingClientRect().top - grab;
      const minute = snapStartMinute(top, timeline.range, PX_PER_MIN);
      if (minute !== minuteOfDay(item.starts_at)) setPendingMove({ item, date: timeline.date, minute });
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
    <>
    <ConfirmDialog
      open={pendingMove !== null}
      onOpenChange={(open) => !open && setPendingMove(null)}
      title={`Pindahkan jadwal ${pendingMove?.item.customer_name ?? ""}?`}
      description={
        pendingMove
          ? `${wibClockOf(pendingMove.item.starts_at)} → ${clockOf(pendingMove.minute)} WIB, ${pendingMove.item.therapist_name ? `tetap dengan ${pendingMove.item.therapist_name}` : "belum ada terapis"}. Sistem mengecek shift & bentrok terapis.`
          : ""
      }
      confirmLabel="Pindahkan"
      variant="default"
      onConfirm={() => {
        if (pendingMove) move(pendingMove.item, pendingMove.date, pendingMove.minute);
        setPendingMove(null);
      }}
    />
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
    </>
  );

  return { dropTarget, onDrop, onDragOver, onDragLeave, confirmation };
}
