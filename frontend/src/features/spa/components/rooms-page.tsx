"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, DoorOpen, Pencil, Plus, Trash2, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Switch } from "@/components/ui/switch";
import { formatRupiah } from "@/lib/format";
import { useDeleteRoom, useSaveRoom } from "../mutations";
import { useSpaOutlets, useSpaRooms } from "../queries";
import type { Room, RoomInput } from "../types";
import { Field, FormError, OutletSelect, SELECT, SPA_KICKER, TableNote } from "./shared";

/** Spa → Room Spa: master room per outlet beserta harga. */
export function SpaRoomsPage() {
  const outlets = useSpaOutlets();
  const configured = (outlets.data ?? []).filter((outlet) => outlet.configured);
  const [picked, setPicked] = useState("");
  const branchId = configured.some((outlet) => outlet.branch_id === picked) ? picked : (configured[0]?.branch_id ?? "");
  const selectedOutlet = configured.find((outlet) => outlet.branch_id === branchId);
  const rooms = useSpaRooms(branchId);
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState<Room | "new" | null>(null);
  const [deleting, setDeleting] = useState<Room | null>(null);
  const remove = useDeleteRoom();
  const list = rooms.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader kicker={SPA_KICKER} title="Room Spa" description="Kelola room per outlet. Room aktif dapat dipilih saat booking; harga room masuk ke tagihan kasir." />
      {outlets.isLoading ? <TableNote>Memuat outlet…</TableNote> : outlets.error ? <TableNote tone="danger">{outlets.error.message}</TableNote> : configured.length === 0 ? (
        <TableNote>Belum ada outlet spa. Atur dahulu di menu Outlet Spa.</TableNote>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="block w-full max-w-xs space-y-1 text-sm font-medium">
              <span>Filter outlet</span>
              <OutletSelect outlets={configured} value={branchId} onChange={(id) => { setPicked(id); setExpanded(true); setEditing(null); setDeleting(null); }} className={SELECT} onlyConfigured ariaLabel="Filter outlet" />
            </label>
            <Button type="button" onClick={() => setEditing("new")} disabled={!!editing}><Plus /> Tambah room</Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Struktur Room Spa</CardTitle>
              <CardDescription>Outlet berisi room yang dapat dipilih saat booking.</CardDescription>
            </CardHeader>
          {rooms.isLoading ? (
            <TableNote>Memuat room…</TableNote>
          ) : rooms.error ? (
            <TableNote tone="danger">{rooms.error.message}</TableNote>
          ) : (
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 text-left font-semibold">Nama</th>
                    <th className="px-4 py-3 text-left font-semibold">Level</th>
                    <th className="px-4 py-3 text-left font-semibold">Kapasitas</th>
                    <th className="px-4 py-3 text-left font-semibold">Harga</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200/50 bg-gray-50/40 hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setExpanded((value) => !value)} aria-label={`${expanded ? "Tutup" : "Buka"} room ${selectedOutlet?.branch_name}`} aria-expanded={expanded} className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800">
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Warehouse className="h-3.5 w-3.5" /></span>
                        <span className="min-w-0 pl-2">
                          <span className="block truncate font-medium text-gray-900">{selectedOutlet?.branch_name}</span>
                          <span className="block text-xs text-gray-400">{list.length} room</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline" className="border-0 bg-amber-50 text-amber-700">Outlet</Badge></td>
                    <td className="px-4 py-3 text-gray-400">—</td>
                    <td className="px-4 py-3 text-gray-400">—</td>
                    <td className="px-4 py-3">{selectedOutlet?.is_active ? <Badge variant="success">Aktif</Badge> : <Badge variant="muted">Nonaktif</Badge>}</td>
                    <td />
                  </tr>
                  {expanded && (list.length === 0 ? (
                    <tr><td colSpan={6} className="px-14 py-8 text-sm text-gray-500">Belum ada room di outlet ini.</td></tr>
                  ) : list.map((room, index) => (
                    <tr key={room.id} className="border-b border-gray-200/50 transition-colors hover:bg-gray-50/80">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <span className="relative flex w-5 shrink-0 items-center justify-center text-[13px] text-gray-400" aria-hidden>
                            <span className="absolute bottom-1/2 left-1/2 top-0 w-px bg-gray-200/90" />
                            {index < list.length - 1 && <span className="absolute bottom-0 left-1/2 top-1/2 w-px bg-gray-200/90" />}
                            <span className="relative z-1 font-mono">{index === list.length - 1 ? "└" : "├"}</span>
                          </span>
                          <span className="mr-1 inline-block h-6 w-6 shrink-0" />
                          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><DoorOpen className="h-3.5 w-3.5" /></span>
                          <span className="min-w-0 pl-2">
                            <span className="block truncate font-medium text-gray-900">{room.name}</span>
                            {room.description && <span className="block truncate text-xs text-gray-400">{room.description}</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><Badge variant="outline" className="border-0 bg-blue-50 text-blue-700">Room</Badge></td>
                      <td className="px-4 py-3">{room.capacity} orang</td>
                      <td className="px-4 py-3 tabular-nums">{room.price_idr > 0 ? formatRupiah(room.price_idr) : "Gratis"}</td>
                      <td className="px-4 py-3">{room.is_active ? <Badge variant="success">Aktif</Badge> : <Badge variant="muted">Nonaktif</Badge>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(room)} aria-label={`Ubah room ${room.name}`}><Pencil /> Ubah</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(room)} aria-label={`Hapus room ${room.name}`}><Trash2 /> Hapus</Button>
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
          </Card>
          {editing && <RoomForm key={editing === "new" ? `new-${branchId}` : editing.id} branchId={branchId} outletName={selectedOutlet?.branch_name ?? ""} room={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </>
      )}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogPanel size="sm">
          <DialogPanelHeader>
            <DialogPanelTitle>Hapus room?</DialogPanelTitle>
            <DialogPanelDescription>Room {deleting?.name} akan dihapus permanen jika belum pernah dipakai booking.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={remove.isPending}>Batal</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id, {
              onSuccess: () => { toast.success("Room dihapus"); setDeleting(null); },
              onError: (error) => toast.error("Room gagal dihapus", { description: error.message }),
            })}>Hapus room</Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}

function RoomForm({ branchId, outletName, room, onDone }: { branchId: string; outletName: string; room: Room | null; onDone: () => void }) {
  const [name, setName] = useState(room?.name ?? "");
  const [capacity, setCapacity] = useState(String(room?.capacity ?? 1));
  const [price, setPrice] = useState<number>(room?.price_idr ?? 0);
  const [description, setDescription] = useState(room?.description ?? "");
  const [active, setActive] = useState(room?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveRoom();

  const submit = () => {
    const cap = Number(capacity);
    const priceIdr = price;
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
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onDone()}>
      <DialogPanel size="md">
        <DialogPanelForm onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <DialogPanelHeader>
            <DialogPanelTitle>{room ? `Ubah room ${room.name}` : "Tambah room"}</DialogPanelTitle>
            <DialogPanelDescription>Outlet: {outletName}</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nama room">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Mis. VIP 1" required aria-label="Nama room" />
            </Field>
            <Field label="Kapasitas (orang)">
              <Input type="number" min={1} max={10} value={capacity} onChange={(event) => setCapacity(event.target.value)} required aria-label="Kapasitas room" />
            </Field>
            <Field label="Harga room" hint="0 = tanpa biaya tambahan">
              <NumericInput prefix="Rp" value={price} onValueChange={setPrice} inputMode="numeric" aria-label="Harga room" />
            </Field>
            <Field label="Keterangan">
              <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Mis. couple room, ada shower" aria-label="Keterangan room" />
            </Field>
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <Switch checked={active} onCheckedChange={setActive} aria-label="Room aktif" />
              Room aktif (bisa dipilih saat booking)
            </label>
            <div className="sm:col-span-2"><FormError>{error}</FormError></div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>Batal</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? "Menyimpan…" : "Simpan room"}</Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
