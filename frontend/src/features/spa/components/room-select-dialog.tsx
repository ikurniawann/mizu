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
import { Field, FormError, SELECT } from "./shared";

/** Pilih / ganti / lepas room sebuah booking (revisi R6). */
export function RoomSelectDialog({
  bookingId,
  branchId,
  currentRoomId,
  onClose,
}: {
  bookingId: string;
  branchId: string;
  currentRoomId: string | null;
  onClose: () => void;
}) {
  const [roomId, setRoomId] = useState(currentRoomId ?? "");
  const [error, setError] = useState<string | null>(null);
  const rooms = useSpaRooms(branchId, true);
  const setRoom = useSetBookingRoom(bookingId);

  const submit = () => {
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Room booking</DialogPanelTitle>
            <DialogPanelDescription>Room ditahan selama jadwal booking; harganya masuk ke tagihan kasir. Room yang sedang dipakai booking lain pada jam yang sama akan ditolak.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            <Field label="Room">
              <select className={SELECT} value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="Room">
                <option value="">{rooms.isLoading ? "Memuat…" : "Tanpa room"}</option>
                {(rooms.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.capacity} orang{r.price_idr > 0 ? ` · ${formatRupiah(r.price_idr)}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <FormError>{error}</FormError>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={setRoom.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={setRoom.isPending}>
              {setRoom.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
