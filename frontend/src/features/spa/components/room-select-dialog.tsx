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
import { useSetBookingRoom } from "../mutations";
import { useSpaRooms } from "../queries";
import { ROOM_CATEGORY_LABEL } from "../rooms";
import type { Booking } from "../types";
import { Field, FormError, SELECT } from "./shared";

/** Pilih / ganti / lepas room sebuah booking (revisi R6). */
export function RoomSelectDialog({
  booking,
  onClose,
}: {
  booking: Pick<Booking, "id" | "branch_id" | "room_id" | "room_name" | "room_price_idr" | "total_idr" | "status">;
  onClose: () => void;
}) {
  const [roomId, setRoomId] = useState(booking.room_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const rooms = useSpaRooms(booking.branch_id, true);
  const setRoom = useSetBookingRoom(booking.id);
  const selected = rooms.data?.find((room) => room.id === roomId);
  const unchanged = roomId === (booking.room_id ?? "");
  const price = unchanged ? booking.room_price_idr : selected?.price_idr ?? 0;
  const total = booking.total_idr - booking.room_price_idr + price;
  const running = booking.status === "in_treatment";
  const invalid = unchanged || rooms.isLoading || !!rooms.error || (!!roomId && !selected) || (running && !roomId);

  const submit = () => {
    if (invalid || setRoom.isPending) return;
    setError(null);
    setRoom.mutate(roomId || null, {
      onSuccess: (b) => {
        toast.success(b.room_name ? `Room ${b.room_name} dipakai` : "Room dilepas");
        onClose();
      },
      onError: (err) => {
        setError(err.message);
        toast.error("Room gagal diubah", { description: err.message });
      },
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !setRoom.isPending && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Room booking</DialogPanelTitle>
            <DialogPanelDescription>Biaya room mengikuti tarif penuh room tujuan dan dihitung otomatis. Room tujuan harus tersedia selama jadwal booking.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            <p className="text-sm">Room asal: <strong>{booking.room_name ?? "Tanpa room"}</strong> · {formatRupiah(booking.room_price_idr)}</p>
            <Field label="Room tujuan">
              <select className={SELECT} value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={rooms.isLoading || setRoom.isPending} aria-label="Room tujuan">
                {!running && <option value="">{rooms.isLoading ? "Memuat…" : "Tanpa room"}</option>}
                {running && !roomId && <option value="" disabled>Pilih room tujuan</option>}
                {booking.room_id && !rooms.data?.some((room) => room.id === booking.room_id) && <option value={booking.room_id} disabled>{booking.room_name ?? "Room asal"}</option>}
                {(rooms.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {ROOM_CATEGORY_LABEL[r.category]} · {r.capacity} orang · {formatRupiah(r.price_idr)}
                  </option>
                ))}
              </select>
            </Field>
            <dl className="space-y-2 rounded-xl bg-surface p-3 text-sm">
              <div data-testid="room-transfer-price" className="flex justify-between gap-3"><dt>Biaya room baru</dt><dd className="font-medium tabular-nums">{formatRupiah(price)}</dd></div>
              <div data-testid="room-transfer-total" className="flex justify-between gap-3"><dt>Total booking baru</dt><dd className="font-medium tabular-nums">{formatRupiah(total)}</dd></div>
            </dl>
            <FormError>{error || rooms.error?.message}</FormError>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={setRoom.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={invalid || setRoom.isPending}>
              {setRoom.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
