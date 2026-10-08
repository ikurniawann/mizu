"use client";

import { useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSaveOutlet, useSyncPos } from "../mutations";
import { useSpaOutlets } from "../queries";
import { parseClock, shortClock } from "../time";
import type { Outlet } from "../types";
import { Field, FormError, SELECT, SPA_KICKER, TableNote } from "./shared";

/** Spa → Outlet Spa: jadikan cabang outlet spa, atur stall POS, jam buka, slot, dan booking publik. */
export function SpaOutletsPage() {
  const outlets = useSpaOutlets();
  const sync = useSyncPos();
  const [editing, setEditing] = useState<Outlet | null>(null);
  const rows = [...(outlets.data ?? [])].sort(
    (a, b) => Number(b.configured) - Number(a.configured) || a.branch_name.localeCompare(b.branch_name)
  );

  const runSync = (o: Outlet) =>
    sync.mutate(o.branch_id, {
      onSuccess: (res) =>
        toast.success("Produk POS disinkronkan", { description: `${o.branch_name}: ${res.synced} produk dibuat/diperbarui.` }),
      onError: (err) => toast.error("Sinkron produk POS gagal", { description: err.message }),
    });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={SPA_KICKER}
        title="Outlet Spa"
        description="Setiap cabang aktif dapat dijadikan outlet spa. Stall POS menentukan gudang/kasir tempat produk treatment dijual; Sinkron produk POS membuat atau memperbarui produk untuk semua varian aktif."
      />
      <Card className="py-0">
        {outlets.isLoading ? (
          <div className="p-4">
            <SkeletonTable columns={5} rows={4} />
          </div>
        ) : outlets.error ? (
          <TableNote tone="danger">{outlets.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Tidak ada cabang aktif.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cabang</TableHead>
                <TableHead>Stall POS</TableHead>
                <TableHead className="hidden md:table-cell">Jam buka</TableHead>
                <TableHead className="hidden md:table-cell">Booking publik</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.branch_id}>
                  <TableCell className="font-medium">{o.branch_name}</TableCell>
                  <TableCell>{o.configured ? (o.warehouse_name ?? <span className="text-warning">Belum dipilih</span>) : "-"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {o.configured ? (
                      <>
                        <span className="tabular-nums">
                          {shortClock(o.open_time)}–{shortClock(o.close_time)}
                        </span>
                        <span className="block text-xs text-muted-foreground">slot {o.slot_minutes} mnt</span>
                      </>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {o.configured ? <Badge variant={o.public_booking ? "info" : "muted"}>{o.public_booking ? "Dibuka" : "Ditutup"}</Badge> : "-"}
                  </TableCell>
                  <TableCell>
                    {!o.configured ? (
                      <Badge variant="outline">Belum jadi outlet spa</Badge>
                    ) : o.is_active ? (
                      <Badge variant="success">Aktif</Badge>
                    ) : (
                      <Badge variant="muted">Nonaktif</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant={o.configured ? "ghost" : "outline"} onClick={() => setEditing(o)}>
                        <Settings2 /> {o.configured ? "Atur" : "Jadikan outlet spa"}
                      </Button>
                      {o.configured && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={sync.isPending || !o.warehouse_id}
                          title={o.warehouse_id ? undefined : "Pilih stall POS dulu"}
                          onClick={() => runSync(o)}
                        >
                          <RefreshCw className={sync.isPending && sync.variables === o.branch_id ? "animate-spin" : undefined} /> Sinkron
                          produk POS
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing && <OutletDialog outlet={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OutletDialog({ outlet, onClose }: { outlet: Outlet; onClose: () => void }) {
  const [warehouseId, setWarehouseId] = useState(outlet.warehouse_id ?? outlet.warehouses[0]?.id ?? "");
  const [open, setOpen] = useState(shortClock(outlet.open_time) || "10:00");
  const [close, setClose] = useState(shortClock(outlet.close_time) || "22:00");
  const [slot, setSlot] = useState(String(outlet.slot_minutes || 30));
  const [publicBooking, setPublicBooking] = useState(outlet.configured ? outlet.public_booking : false);
  const [active, setActive] = useState(outlet.configured ? outlet.is_active : true);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveOutlet();

  const submit = () => {
    const slotMinutes = Number(slot);
    if (!warehouseId) return setError("Pilih stall POS (gudang) untuk outlet ini.");
    if (parseClock(open) === null || parseClock(close) === null) return setError("Jam buka/tutup tidak valid.");
    if (open === close) return setError("Jam buka dan tutup tidak boleh sama.");
    if (!Number.isInteger(slotMinutes) || slotMinutes < 5 || slotMinutes > 240) return setError("Slot harus 5–240 menit.");
    setError(null);
    save.mutate(
      {
        branchId: outlet.branch_id,
        input: { warehouse_id: warehouseId, open_time: open, close_time: close, slot_minutes: slotMinutes, public_booking: publicBooking, is_active: active },
      },
      {
        onSuccess: () => {
          toast.success("Outlet spa disimpan", { description: outlet.branch_name });
          onClose();
        },
        onError: (err) => {
          setError(err.message);
          toast.error("Outlet gagal disimpan", { description: err.message });
        },
      }
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{outlet.branch_name}</DialogPanelTitle>
            <DialogPanelDescription>Jam dalam WIB. Jam tutup lebih awal dari jam buka berarti tutup lewat tengah malam.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Stall POS (gudang)" className="sm:col-span-2">
              <select className={SELECT} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                <option value="">{outlet.warehouses.length ? "Pilih stall…" : "Cabang ini belum punya gudang"}</option>
                {outlet.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.code ? ` (${w.code})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Jam buka">
              <Input type="time" value={open} onChange={(e) => setOpen(e.target.value)} required />
            </Field>
            <Field label="Jam tutup">
              <Input type="time" value={close} onChange={(e) => setClose(e.target.value)} required />
            </Field>
            <Field label="Panjang slot (menit)" hint="Interval pilihan jam di booking publik.">
              <Input type="number" min={5} max={240} step={5} value={slot} onChange={(e) => setSlot(e.target.value)} required />
            </Field>
            <div className="space-y-3 self-end pb-1">
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={publicBooking} onCheckedChange={setPublicBooking} aria-label="Booking publik" />
                Terima booking online
              </label>
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={active} onCheckedChange={setActive} aria-label="Outlet aktif" />
                Outlet aktif
              </label>
            </div>
            <div className="sm:col-span-2">
              <FormError>{error}</FormError>
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
