"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format";
import { useSaveRoom } from "../mutations";
import { useSpaRooms } from "../queries";
import type { Room, RoomInput } from "../types";
import { Field, FormError, TableNote } from "./shared";

/** Spa → Outlet → Room: master room per outlet beserta harga (revisi R6). */
export function RoomsDialog({ branchId, branchName, onClose }: { branchId: string; branchName: string; onClose: () => void }) {
  const rooms = useSpaRooms(branchId);
  const [editing, setEditing] = useState<Room | "new" | null>(null);
  const list = rooms.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Room · {branchName}</DialogPanelTitle>
          <DialogPanelDescription>
            Room dipilih saat booking dan harganya masuk ke tagihan di kasir. Room nonaktif tidak bisa dipilih.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          {rooms.isLoading ? (
            <TableNote>Memuat room…</TableNote>
          ) : rooms.error ? (
            <TableNote tone="danger">{rooms.error.message}</TableNote>
          ) : list.length === 0 ? (
            <TableNote>Belum ada room di outlet ini.</TableNote>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead>Kapasitas</TableHead>
                  <TableHead>Harga</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.name}
                      {r.description ? <span className="block text-xs font-normal text-muted-foreground">{r.description}</span> : null}
                    </TableCell>
                    <TableCell>{r.capacity} orang</TableCell>
                    <TableCell className="tabular-nums">{r.price_idr > 0 ? formatRupiah(r.price_idr) : "Gratis"}</TableCell>
                    <TableCell>{r.is_active ? <Badge variant="success">Aktif</Badge> : <Badge variant="muted">Nonaktif</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Ubah room ${r.name}`}>
                        <Pencil /> Ubah
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {editing && <RoomForm branchId={branchId} room={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Tutup
          </Button>
          {!editing && (
            <Button type="button" onClick={() => setEditing("new")}>
              <Plus /> Tambah room
            </Button>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

function RoomForm({ branchId, room, onDone }: { branchId: string; room: Room | null; onDone: () => void }) {
  const [name, setName] = useState(room?.name ?? "");
  const [capacity, setCapacity] = useState(String(room?.capacity ?? 1));
  const [price, setPrice] = useState(String(room?.price_idr ?? 0));
  const [description, setDescription] = useState(room?.description ?? "");
  const [active, setActive] = useState(room?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveRoom();

  const submit = () => {
    const cap = Number(capacity);
    const priceIdr = Number(price);
    if (!name.trim()) return setError("Nama room wajib diisi.");
    if (!Number.isInteger(cap) || cap < 1 || cap > 10) return setError("Kapasitas 1–10 orang.");
    if (!Number.isFinite(priceIdr) || priceIdr < 0) return setError("Harga tidak valid.");
    setError(null);
    const input: RoomInput = { branch_id: branchId, name: name.trim(), capacity: cap, price_idr: priceIdr, description: description.trim(), is_active: active };
    save.mutate(
      { id: room?.id, input },
      {
        onSuccess: (saved) => {
          toast.success(room ? "Room diperbarui" : "Room ditambahkan", { description: saved.name });
          onDone();
        },
        onError: (err) => {
          setError(err.message);
          toast.error("Room gagal disimpan", { description: err.message });
        },
      },
    );
  };

  return (
    <form
      className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-sm font-semibold sm:col-span-2">{room ? `Ubah ${room.name}` : "Room baru"}</p>
      <Field label="Nama room">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mis. VIP 1" required aria-label="Nama room" />
      </Field>
      <Field label="Kapasitas (orang)">
        <Input type="number" min={1} max={10} value={capacity} onChange={(e) => setCapacity(e.target.value)} required aria-label="Kapasitas room" />
      </Field>
      <Field label="Harga room (Rp)" hint="0 = tanpa biaya tambahan">
        <Input type="number" min={0} step={1000} value={price} onChange={(e) => setPrice(e.target.value)} required aria-label="Harga room" />
      </Field>
      <Field label="Keterangan">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Mis. couple room, ada shower" aria-label="Keterangan room" />
      </Field>
      <label className="flex items-center gap-3 text-sm sm:col-span-2">
        <Switch checked={active} onCheckedChange={setActive} aria-label="Room aktif" />
        Room aktif (bisa dipilih saat booking)
      </label>
      <div className="sm:col-span-2">
        <FormError>{error}</FormError>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Batal
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Menyimpan…" : "Simpan room"}
        </Button>
      </div>
    </form>
  );
}
