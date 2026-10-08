"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Plus, Receipt, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatRupiah, formatTime } from "@/lib/format";
import { useCancelBooking, useCheckoutBooking, useItemAction, useUpdateBooking } from "../mutations";
import { useSpaBooking } from "../queries";
import {
  allowedItemActions,
  anyStatusLabel,
  BOOKING_TYPE_LABEL,
  bookingTotal,
  canAddItem,
  canCancelBooking,
  checkoutState,
  eventLabel,
  GENDER_PREF_LABEL,
  isBookingClosed,
  isValidPhone,
  sortByStart,
  sourceLabel,
} from "../rules";
import type { Booking, BookingItem, GenderPref, ItemAction } from "../types";
import { AddItemDialog, AssignTherapistDialog, RescheduleDialog } from "./item-dialogs";
import {
  BookingStatusBadge,
  Field,
  FormError,
  InfoRow,
  ItemStatusBadge,
  PaymentStatusBadge,
  SELECT,
  SPA_KICKER,
  TableNote,
  TEXTAREA,
  TimeRange,
} from "./shared";

type SimpleAction = Extract<ItemAction, "unassign" | "start" | "complete" | "cancel">;

const SIMPLE_ACTION: Record<SimpleAction, { label: string; done: string; confirm?: string }> = {
  start: { label: "Mulai", done: "Treatment dimulai" },
  complete: { label: "Selesai", done: "Treatment selesai" },
  unassign: { label: "Lepas terapis", done: "Terapis dilepas" },
  cancel: {
    label: "Batalkan",
    done: "Item dibatalkan",
    confirm: "Item yang dibatalkan tidak dihitung di total dan tidak dapat diaktifkan lagi.",
  },
};

/** Spa → Booking → detail: item & terapis, aksi layanan, checkout ke POS, riwayat. */
export function SpaBookingDetailPage({ id }: { id: string }) {
  const booking = useSpaBooking(id);

  if (booking.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader kicker={SPA_KICKER} title="Memuat booking…" />
        <Card className="p-4">
          <SkeletonTable columns={5} rows={4} />
        </Card>
      </div>
    );
  }
  if (booking.error || !booking.data) {
    return (
      <div className="space-y-4">
        <PageHeader kicker={SPA_KICKER} title="Booking" actions={<BackLink />} />
        <Card className="py-0">
          <TableNote tone="danger">{booking.error?.message ?? "Booking tidak ditemukan."}</TableNote>
        </Card>
      </div>
    );
  }
  return <BookingDetail booking={booking.data} />;
}

function BackLink() {
  return (
    <Button variant="outline" asChild>
      <Link href="/dashboard/spa/bookings">
        <ArrowLeft /> Daftar booking
      </Link>
    </Button>
  );
}

type Dialogs =
  | { kind: "assign"; item: BookingItem }
  | { kind: "reschedule"; item: BookingItem }
  | { kind: "confirm-item"; item: BookingItem; action: SimpleAction }
  | { kind: "add" }
  | { kind: "edit" }
  | { kind: "cancel" }
  | null;

function BookingDetail({ booking }: { booking: Booking }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const itemAction = useItemAction();
  const checkout = useCheckoutBooking(booking.id);
  const close = () => setDialog(null);

  const items = sortByStart(booking.items);
  const total = bookingTotal(booking.items);
  const co = checkoutState(booking);
  const closed = isBookingClosed(booking);
  const lastEnd = items.filter((i) => i.status !== "cancelled").at(-1)?.ends_at ?? booking.scheduled_at;

  const runSimple = (item: BookingItem, action: SimpleAction) =>
    itemAction.mutate(
      { bookingId: booking.id, itemId: item.id, input: { action } },
      {
        onSuccess: () => {
          toast.success(SIMPLE_ACTION[action].done, { description: `${item.treatment_name} — ${item.variant_name}` });
          close();
        },
        onError: (err) => toast.error(`${SIMPLE_ACTION[action].label} gagal`, { description: err.message }),
      }
    );

  const doCheckout = () =>
    checkout.mutate(undefined, {
      onSuccess: (result) => {
        toast.success("Tagihan POS siap", { description: `Order ${result.order_number} — lanjutkan pembayaran di kasir.` });
        router.push(`/dashboard/pos/cashier-new?orderId=${encodeURIComponent(result.order_id)}&pay=1`);
      },
      onError: (err) => toast.error("Checkout gagal", { description: err.message }),
    });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={`${SPA_KICKER} · Booking`}
        title={<span className="font-mono">{booking.booking_code}</span>}
        description={`${booking.branch_name} · ${formatDate(booking.scheduled_at)} ${formatTime(booking.scheduled_at)} WIB · ${
          BOOKING_TYPE_LABEL[booking.booking_type] ?? booking.booking_type
        } · ${sourceLabel(booking.source)}`}
        actions={
          <>
            <BackLink />
            {canCancelBooking(booking) && (
              <Button variant="destructive" onClick={() => setDialog({ kind: "cancel" })}>
                <XCircle /> Batalkan booking
              </Button>
            )}
            {booking.payment_status !== "paid" && (
              <Button
                onClick={doCheckout}
                disabled={!co.allowed || checkout.isPending}
                title={co.reason ?? undefined}
              >
                <Receipt /> {checkout.isPending ? "Memproses…" : booking.pos_order_id ? "Buka tagihan POS" : "Checkout ke POS"}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">Status layanan</span>
          <BookingStatusBadge status={booking.status} />
        </span>
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">Pembayaran</span>
          <PaymentStatusBadge status={booking.payment_status} />
        </span>
        {!co.allowed && co.reason && !closed && booking.payment_status === "unpaid" && (
          <span className="text-xs text-warning">Checkout belum bisa: {co.reason}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Pelanggan</CardTitle>
            {!closed && (
              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "edit" })}>
                <Pencil /> Ubah
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <InfoRow label="Nama">{booking.customer_name}</InfoRow>
              <InfoRow label="Nomor HP">
                <span className="font-mono">{booking.customer_phone || "-"}</span>
              </InfoRow>
              <InfoRow label="Preferensi terapis">{GENDER_PREF_LABEL[booking.therapist_gender_pref] ?? "-"}</InfoRow>
              <InfoRow label="Dibuat">{formatDateTime(booking.created_at)}</InfoRow>
              <div className="col-span-2">
                <InfoRow label="Catatan">
                  <span className="whitespace-pre-wrap font-normal">{booking.notes || "-"}</span>
                </InfoRow>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tagihan</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <InfoRow label="Total treatment">
                <span className="text-lg tabular-nums">{formatRupiah(total)}</span>
              </InfoRow>
              <InfoRow label="Order POS">{booking.pos_order_number ? <span className="font-mono">{booking.pos_order_number}</span> : "Belum checkout"}</InfoRow>
              <InfoRow label="Checkout">{formatDateTime(booking.checked_out_at)}</InfoRow>
              <InfoRow label="Lunas">{formatDateTime(booking.paid_at)}</InfoRow>
              {booking.cancelled_at && (
                <div className="col-span-2">
                  <InfoRow label={`Dibatalkan ${formatDateTime(booking.cancelled_at)}`}>
                    <span className="font-normal">{booking.cancel_reason || "-"}</span>
                  </InfoRow>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card className="py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <h2 className="text-base font-semibold">Treatment & terapis</h2>
          {canAddItem(booking) && (
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "add" })}>
              <Plus /> Tambah treatment
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <TableNote>Belum ada treatment.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Treatment</TableHead>
                <TableHead>Jadwal</TableHead>
                <TableHead>Terapis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right md:table-cell">Harga</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const actions = allowedItemActions(item, booking);
                const muted = item.status === "cancelled";
                return (
                  <TableRow key={item.id} className={muted ? "opacity-60" : undefined}>
                    <TableCell className="max-w-[16rem] whitespace-normal">
                      <p className="font-medium">{item.treatment_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.variant_name} · {item.duration_min} mnt{item.buffer_min ? ` + ${item.buffer_min} jeda` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <TimeRange start={item.starts_at} end={item.ends_at} className="font-medium" />
                      <p className="text-xs text-muted-foreground">{formatDate(item.starts_at)}</p>
                      {(item.started_at || item.completed_at) && (
                        <p className="text-xs text-muted-foreground">
                          {item.started_at ? `Mulai ${formatTime(item.started_at)}` : ""}
                          {item.completed_at ? ` · Selesai ${formatTime(item.completed_at)}` : ""}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{item.therapist_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <ItemStatusBadge status={item.status} />
                      {item.status === "completed" && item.commission_idr != null && (
                        <p className="mt-1 text-xs text-muted-foreground">Komisi {formatRupiah(item.commission_idr)}</p>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatRupiah(item.price_idr)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {actions.includes("assign") && (
                          <Button size="sm" onClick={() => setDialog({ kind: "assign", item })}>
                            Tugaskan
                          </Button>
                        )}
                        {actions.includes("start") && (
                          <Button size="sm" variant="soft" disabled={itemAction.isPending} onClick={() => runSimple(item, "start")}>
                            Mulai
                          </Button>
                        )}
                        {actions.includes("complete") && (
                          <Button
                            size="sm"
                            variant={item.status === "in_treatment" ? "default" : "ghost"}
                            disabled={itemAction.isPending}
                            title={item.status === "assigned" ? "Override staf: tandai selesai tanpa dimulai" : undefined}
                            onClick={() => runSimple(item, "complete")}
                          >
                            Selesai
                          </Button>
                        )}
                        {actions.includes("unassign") && (
                          <Button size="sm" variant="ghost" disabled={itemAction.isPending} onClick={() => runSimple(item, "unassign")}>
                            Lepas
                          </Button>
                        )}
                        {actions.includes("reschedule") && (
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "reschedule", item })}>
                            Jadwal
                          </Button>
                        )}
                        {actions.includes("cancel") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            disabled={itemAction.isPending}
                            onClick={() => setDialog({ kind: "confirm-item", item, action: "cancel" })}
                          >
                            Batalkan
                          </Button>
                        )}
                        {actions.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat</CardTitle>
        </CardHeader>
        <CardContent>
          {booking.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada riwayat.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {[...booking.events]
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .map((ev) => {
                  const item = ev.item_id ? booking.items.find((i) => i.id === ev.item_id) : undefined;
                  return (
                    <li key={ev.id} className="relative">
                      <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-forest" aria-hidden />
                      <p className="text-sm font-medium">
                        {eventLabel(ev.action)}
                        {item ? <span className="font-normal text-muted-foreground"> · {item.treatment_name}</span> : null}
                      </p>
                      {(ev.from_status || ev.to_status) && (
                        <p className="text-xs text-muted-foreground">
                          {anyStatusLabel(ev.from_status)} → {anyStatusLabel(ev.to_status)}
                        </p>
                      )}
                      {ev.note && <p className="text-sm whitespace-pre-wrap">{ev.note}</p>}
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(ev.created_at)}
                        {ev.actor_name ? ` · ${ev.actor_name}` : ""}
                      </p>
                    </li>
                  );
                })}
            </ol>
          )}
        </CardContent>
      </Card>

      {dialog?.kind === "assign" && (
        <AssignTherapistDialog
          bookingId={booking.id}
          branchId={booking.branch_id}
          item={dialog.item}
          genderPref={booking.therapist_gender_pref}
          onClose={close}
        />
      )}
      {dialog?.kind === "reschedule" && <RescheduleDialog bookingId={booking.id} item={dialog.item} onClose={close} />}
      {dialog?.kind === "add" && (
        <AddItemDialog bookingId={booking.id} branchId={booking.branch_id} defaultStart={lastEnd} onClose={close} />
      )}
      {dialog?.kind === "confirm-item" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          title={`Batalkan ${dialog.item.treatment_name}?`}
          description={SIMPLE_ACTION[dialog.action].confirm}
          confirmLabel="Batalkan item"
          cancelLabel="Kembali"
          loading={itemAction.isPending}
          onConfirm={() => runSimple(dialog.item, dialog.action)}
        />
      )}
      {dialog?.kind === "edit" && <EditBookingDialog booking={booking} onClose={close} />}
      {dialog?.kind === "cancel" && <CancelBookingDialog booking={booking} onClose={close} />}
    </div>
  );
}

function EditBookingDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [name, setName] = useState(booking.customer_name);
  const [phone, setPhone] = useState(booking.customer_phone ?? "");
  const [pref, setPref] = useState<GenderPref>(booking.therapist_gender_pref ?? "any");
  const [notes, setNotes] = useState(booking.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateBooking(booking.id);

  const submit = () => {
    if (!name.trim()) return setError("Nama pelanggan wajib diisi.");
    if (!isValidPhone(phone)) return setError("Nomor HP tidak valid (8–15 digit).");
    setError(null);
    update.mutate(
      { customer_name: name.trim(), customer_phone: phone.replace(/[\s-]/g, ""), therapist_gender_pref: pref, notes: notes.trim() },
      {
        onSuccess: () => {
          toast.success("Booking diperbarui");
          onClose();
        },
        onError: (err) => {
          setError(err.message);
          toast.error("Booking gagal diperbarui", { description: err.message });
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
            <DialogPanelTitle>Ubah data booking</DialogPanelTitle>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nama pelanggan">
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Nomor HP">
              <Input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} required />
            </Field>
            <Field label="Preferensi terapis" className="sm:col-span-2">
              <select className={SELECT} value={pref} onChange={(e) => setPref(e.target.value as GenderPref)}>
                {(Object.keys(GENDER_PREF_LABEL) as GenderPref[]).map((g) => (
                  <option key={g} value={g}>
                    {GENDER_PREF_LABEL[g]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Catatan" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <FormError>{error}</FormError>
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

function CancelBookingDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cancel = useCancelBooking(booking.id);

  const submit = () => {
    if (reason.trim().length < 3) return setError("Tuliskan alasan pembatalan.");
    setError(null);
    cancel.mutate(reason.trim(), {
      onSuccess: () => {
        toast.success("Booking dibatalkan", { description: booking.booking_code });
        onClose();
      },
      onError: (err) => {
        setError(err.message);
        toast.error("Booking gagal dibatalkan", { description: err.message });
      },
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Batalkan {booking.booking_code}?</DialogPanelTitle>
            <DialogPanelDescription>Semua item yang belum dimulai ikut dibatalkan. Tindakan ini tidak dapat diurungkan.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-3">
            <Field label="Alasan">
              <textarea className={TEXTAREA} value={reason} onChange={(e) => setReason(e.target.value)} required />
            </Field>
            <FormError>{error}</FormError>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={cancel.isPending}>
              Kembali
            </Button>
            <Button type="submit" variant="destructive" disabled={cancel.isPending}>
              {cancel.isPending ? "Membatalkan…" : "Batalkan booking"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
