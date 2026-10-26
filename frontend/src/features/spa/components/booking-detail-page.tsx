"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, DoorOpen, Pencil, PlayCircle, Plus, Receipt, Star, XCircle } from "lucide-react";
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
import { useAssignBooking, useBookingAction, useCancelBooking, useCheckoutBooking, useItemAction, useUpdateBooking, useBookingDeposit } from "../mutations";
import { useSpaBooking } from "../queries";
import { anyStatusLabel, BOOKING_TYPE_LABEL, bookingTotal, canAddItem, canCancelBooking, canRescheduleBooking, checkoutState, eventLabel, GENDER_PREF_LABEL, isBookingClosed, isValidPhone, sourceLabel } from "../rules";
import type { Booking, BookingItem, GenderPref } from "../types";
import { isoToWibLocalInput, wibLocalInputToIso } from "../time";
import { AddItemDialog, AssignTherapistDialog } from "./item-dialogs";
import { RoomSelectDialog } from "./room-select-dialog";
import { BookingGroupDialog } from "./booking-group-dialog";
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

const REMOVE_DESCRIPTION = "Treatment ini tidak lagi dihitung dalam total, durasi, dan jadwal booking.";

/** Shared booking detail: Book Order is operational; Booking History is read-only. */
export function SpaBookingDetailPage({ id, readOnly = false, embedded = false, onOpenBooking }: { id: string; readOnly?: boolean; embedded?: boolean; onOpenBooking?: (id: string) => void }) {
  const booking = useSpaBooking(id);
  const kicker = readOnly ? "Laporan · Booking History" : `${SPA_KICKER} · Booking`;

  if (booking.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader kicker={kicker} title="Memuat booking…" />
        <Card className="p-4">
          <SkeletonTable columns={5} rows={4} />
        </Card>
      </div>
    );
  }
  if (booking.error || !booking.data) {
    return (
      <div className="space-y-4">
        <PageHeader kicker={kicker} title="Booking" actions={!embedded && <BackLink readOnly={readOnly} />} />
        <Card className="py-0">
          <TableNote tone="danger">{booking.error?.message ?? "Booking tidak ditemukan."}</TableNote>
        </Card>
      </div>
    );
  }
  return <BookingDetail booking={booking.data} readOnly={readOnly} embedded={embedded} onOpenBooking={onOpenBooking} />;
}

export function BookingDetailDialog({ id, readOnly = false, onClose, onOpenBooking }: { id: string; readOnly?: boolean; onClose: () => void; onOpenBooking?: (id: string) => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="2xl">
        <DialogPanelHeader>
          <DialogPanelTitle>Detail booking</DialogPanelTitle>
          <DialogPanelDescription>Informasi pelanggan, treatment, pembayaran, dan riwayat booking.</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody>
          <SpaBookingDetailPage id={id} readOnly={readOnly} embedded onOpenBooking={onOpenBooking} />
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

function BackLink({ readOnly }: { readOnly: boolean }) {
  return (
    <Button variant="outline" asChild>
      <Link href={readOnly ? "/dashboard/spa/bookings" : "/dashboard/spa/book-order"}>
        <ArrowLeft /> {readOnly ? "Booking History" : "Book Order"}
      </Link>
    </Button>
  );
}

type Dialogs =
  | { kind: "assign" }
  | { kind: "schedule" }
  | { kind: "confirm-item"; item: BookingItem }
  | { kind: "add" }
  | { kind: "edit" }
  | { kind: "survey" }
  | { kind: "cancel" }
  | null;

function BookingDetail({ booking, readOnly, embedded, onOpenBooking }: { booking: Booking; readOnly: boolean; embedded: boolean; onOpenBooking?: (id: string) => void }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const itemAction = useItemAction();
  const bookingAction = useBookingAction(booking.id);
  const assignment = useAssignBooking();
  const checkout = useCheckoutBooking(booking.id);
  const depositAction = useBookingDeposit(booking.id);
  const close = () => setDialog(null);

  const items = booking.items;
  const total = bookingTotal(booking.items);
  const [roomDialog, setRoomDialog] = useState(false);
  const co = checkoutState(booking);
  const closed = isBookingClosed(booking);
  const canChangeRoom = !readOnly && booking.can_change_room === true && !booking.checked_out_at && ["unassigned", "assigned", "in_treatment"].includes(booking.status);
  const activeItems = items.filter((i) => i.status !== "cancelled");
  const depositPending = booking.deposit?.deposit_status === "pending";
  const canAssign = !closed && activeItems.length > 0 && activeItems.every((i) => i.status === "assigned" || i.status === "unassigned");
  const canRemoveItems = !readOnly && canAddItem(booking) && activeItems.length > 1;
  const assignmentWindow = activeItems[0] && {
    ...activeItems[0], starts_at: booking.scheduled_at, ends_at: booking.ends_at,
    therapist_id: booking.therapist_id,
  };

  const runRemoveItem = (item: BookingItem) =>
    itemAction.mutate(
      { bookingId: booking.id, itemId: item.id, input: { action: "cancel" } },
      {
        onSuccess: () => {
          toast.success("Treatment dihapus dari booking", { description: `${item.treatment_name} — ${item.variant_name}` });
          close();
        },
        onError: (err) => toast.error("Hapus treatment gagal", { description: err.message }),
      }
    );

  const runBookingAction = (action: "start" | "complete") =>
    bookingAction.mutate(action, {
      onSuccess: () => toast.success(action === "start" ? "Booking dimulai" : "Booking selesai"),
      onError: (err) => toast.error("Gagal mengubah status booking", { description: err.message }),
    });

  const doCheckout = (rating?: number) =>
    checkout.mutate(rating, {
      onSuccess: (result) => {
        toast.success("Tagihan POS siap", { description: `Order ${result.order_number} — lanjutkan pembayaran di kasir.` });
        close();
        router.push(`/dashboard/pos/cashier-new?orderId=${encodeURIComponent(result.order_id)}&spa=1`);
      },
      onError: (err) => toast.error("Checkout gagal", { description: err.message }),
    });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={readOnly ? "Laporan · Booking History" : `${SPA_KICKER} · Booking`}
        title={<span className="font-mono">{booking.booking_code}</span>}
        description={`${booking.branch_name} · ${formatDate(booking.scheduled_at)} ${formatTime(booking.scheduled_at)}–${formatTime(booking.ends_at)} WIB · ${
          BOOKING_TYPE_LABEL[booking.booking_type] ?? booking.booking_type
        } · ${sourceLabel(booking.source)}`}
        actions={
          <>
            {!embedded && <BackLink readOnly={readOnly} />}
            {booking.group_id && <Button variant={booking.status === "completed" && booking.payment_status === "unpaid" && !readOnly ? "default" : "outline"} onClick={() => setGroupOpen(true)}>
              {booking.status === "completed" && booking.payment_status === "unpaid" && !readOnly ? <><Receipt /> Checkout grup ke POS</> : "Lihat booking bersama"}
            </Button>}
            {!readOnly && canRescheduleBooking(booking) && (
              <Button variant="outline" onClick={() => setDialog({ kind: "schedule" })}>Ubah jadwal</Button>
            )}
            {!readOnly && canCancelBooking(booking) && (
              <Button variant="destructive" onClick={() => setDialog({ kind: "cancel" })}>
                <XCircle /> Batalkan booking
              </Button>
            )}
            {!readOnly && booking.status === "assigned" && activeItems.some((item) => item.status === "assigned") && (
              <Button disabled={bookingAction.isPending || depositPending} title={depositPending ? "Mulai treatment setelah DP diterima atau dibebaskan." : undefined} onClick={() => runBookingAction("start")}>
                <PlayCircle /> Mulai
              </Button>
            )}
            {!readOnly && booking.status === "in_treatment" && (
              <Button disabled={bookingAction.isPending} onClick={() => runBookingAction("complete")}>
                <CheckCircle2 /> Selesai
              </Button>
            )}
            {!readOnly && !booking.group_id && booking.payment_status !== "paid" && (
              <Button
                onClick={() => booking.therapist_rating == null ? setDialog({ kind: "survey" }) : doCheckout()}
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
          <span className="text-muted-foreground">Jadwal booking</span>
          <span className="font-medium">{formatDate(booking.scheduled_at)} <TimeRange start={booking.scheduled_at} end={booking.ends_at} /> WIB</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">Status layanan</span>
          <BookingStatusBadge status={booking.status} />
        </span>
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">Pembayaran</span>
          <PaymentStatusBadge status={booking.payment_status} />
        </span>
        {!readOnly && !booking.group_id && !co.allowed && co.reason && !closed && booking.payment_status === "unpaid" && (
          <span className="text-xs text-warning">Checkout belum bisa: {co.reason}</span>
        )}
      </div>
      {groupOpen && booking.group_id && <BookingGroupDialog id={booking.group_id} onClose={() => setGroupOpen(false)} readOnly={readOnly} onOpenBooking={onOpenBooking ? (id) => { setGroupOpen(false); onOpenBooking(id); } : undefined} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Pelanggan</CardTitle>
            {!readOnly && !closed && (
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
              <InfoRow label="Room">
                <span className="flex flex-wrap items-center gap-2">
                  {booking.room_name ? (
                    <span className="inline-flex items-center gap-1">
                      <DoorOpen className="size-4 text-muted-foreground" /> {booking.room_name}
                      <span className="text-sm font-normal text-muted-foreground">
                        {booking.room_price_idr > 0 ? `· ${formatRupiah(booking.room_price_idr)}` : "· gratis"}
                      </span>
                    </span>
                  ) : (
                    <span className="font-normal text-muted-foreground">Tanpa room</span>
                  )}
                  {canChangeRoom && (
                    <Button size="sm" variant="ghost" onClick={() => setRoomDialog(true)}>
                      {booking.room_name ? "Ganti room" : "Pilih room"}
                    </Button>
                  )}
                </span>
              </InfoRow>
              {booking.room_price_idr > 0 && (
                <InfoRow label="Total tagihan">
                  <span className="text-lg tabular-nums">{formatRupiah(total + booking.room_price_idr)}</span>
                </InfoRow>
              )}
              <InfoRow label="Order POS">{booking.pos_order_number ? <span className="font-mono">{booking.pos_order_number}</span> : "Belum checkout"}</InfoRow>
              <InfoRow label="Checkout">{formatDateTime(booking.checked_out_at)}</InfoRow>
              <InfoRow label="Lunas">{formatDateTime(booking.paid_at)}</InfoRow>
              {booking.deposit && booking.deposit.deposit_status !== "none" && (
                <div className="col-span-2">
                  <InfoRow label={`DP online ${formatRupiah(booking.deposit.deposit_idr)}`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <DepositBadge status={booking.deposit.deposit_status} />
                      <span className="text-sm font-normal text-muted-foreground">
                        {booking.deposit.deposit_status === "pending" && booking.deposit.deposit_hold_until
                          ? `menunggu sampai ${formatDateTime(booking.deposit.deposit_hold_until)}`
                          : booking.deposit.deposit_status === "paid"
                            ? `diterima ${formatDateTime(booking.deposit.deposit_paid_at)} · sisa di outlet ${formatRupiah(booking.deposit.remaining_idr)}`
                            : booking.deposit.deposit_status === "waived"
                              ? "dibebaskan"
                              : "tidak dibayar — booking dibatalkan"}
                      </span>
                      {!readOnly && !closed && booking.deposit.deposit_status === "pending" && (
                        <span className="flex gap-1">
                          <Button size="sm" variant="outline" disabled={depositAction.isPending} onClick={() => depositAction.mutate({ action: "paid", note: "Diterima manual oleh FO" })}>
                            Tandai DP diterima
                          </Button>
                          <Button size="sm" variant="ghost" disabled={depositAction.isPending} onClick={() => depositAction.mutate({ action: "waive", note: "Dibebaskan oleh FO" })}>
                            Bebaskan DP
                          </Button>
                        </span>
                      )}
                    </span>
                  </InfoRow>
                </div>
              )}
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-sm font-medium">Terapis booking</p>
            <p className="text-sm text-muted-foreground">{booking.therapist_name
              ? `${booking.therapist_name} · Menangani seluruh treatment`
              : closed && booking.therapist_names.length > 0
                ? `Riwayat terapis: ${booking.therapist_names.join(", ")}`
                : "Belum ditugaskan"}</p>
            {booking.therapist_rating != null && (
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <Star className="size-4 fill-current text-amber-500" aria-hidden />
                Rating kepuasan {booking.therapist_rating}/5
              </p>
            )}
          </div>
          {!readOnly && canAssign && <div className="flex gap-2">
            <Button size="sm" onClick={() => setDialog({ kind: "assign" })}>{booking.therapist_id ? "Ganti terapis" : "Tugaskan terapis"}</Button>
            {booking.therapist_id && <Button size="sm" variant="outline" disabled={assignment.isPending} onClick={() => assignment.mutate(
              { bookingId: booking.id, therapistId: null },
              { onSuccess: () => toast.success("Terapis booking dilepas"), onError: (err) => toast.error("Gagal melepas terapis", { description: err.message }) }
            )}>Lepas terapis</Button>}
          </div>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <h2 className="text-base font-semibold">Treatment</h2>
          {!readOnly && canAddItem(booking) && (
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
                <TableHead>Durasi</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right md:table-cell">Harga</TableHead>
                {canRemoveItems && <TableHead className="text-right">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const muted = item.status === "cancelled";
                return (
                  <TableRow key={item.id} className={muted ? "opacity-60" : undefined}>
                    <TableCell className="max-w-[16rem] whitespace-normal">
                      <p className="font-medium">{item.treatment_name}</p>
                      <p className="text-xs text-muted-foreground">{item.variant_name}</p>
                      {closed && !booking.therapist_id && item.therapist_name && <p className="text-xs text-muted-foreground">Dikerjakan oleh {item.therapist_name}</p>}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">{item.duration_min} menit</span>
                    </TableCell>
                    <TableCell>
                      <ItemStatusBadge status={item.status} />
                      {item.status === "completed" && item.commission_idr != null && (
                        <p className="mt-1 text-xs text-muted-foreground">Komisi {formatRupiah(item.commission_idr)}</p>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatRupiah(item.price_idr)}</TableCell>
                    {canRemoveItems && <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {(item.status === "assigned" || item.status === "unassigned") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            disabled={itemAction.isPending}
                            onClick={() => setDialog({ kind: "confirm-item", item })}
                          >
                            Hapus
                          </Button>
                        )}
                        {(item.status !== "assigned" && item.status !== "unassigned") && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>}
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
                      {ev.action !== "room" && (ev.from_status || ev.to_status) && (
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

      {!readOnly && dialog?.kind === "assign" && assignmentWindow && (
        <AssignTherapistDialog
          bookingId={booking.id}
          branchId={booking.branch_id}
          item={assignmentWindow}
          genderPref={booking.therapist_gender_pref}
          onClose={close}
        />
      )}
      {!readOnly && dialog?.kind === "schedule" && <ScheduleBookingDialog booking={booking} onClose={close} />}
      {!readOnly && dialog?.kind === "add" && (
        <AddItemDialog bookingId={booking.id} branchId={booking.branch_id} onClose={close} />
      )}
      {canChangeRoom && roomDialog && (
        <RoomSelectDialog booking={booking} onClose={() => setRoomDialog(false)} />
      )}
      {!readOnly && dialog?.kind === "confirm-item" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          title={`Hapus ${dialog.item.treatment_name} dari booking?`}
          description={REMOVE_DESCRIPTION}
          confirmLabel="Hapus treatment"
          cancelLabel="Kembali"
          loading={itemAction.isPending}
          onConfirm={() => runRemoveItem(dialog.item)}
        />
      )}
      {!readOnly && dialog?.kind === "edit" && <EditBookingDialog booking={booking} onClose={close} />}
      {!readOnly && dialog?.kind === "survey" && <TherapistSurveyDialog
        therapistName={booking.therapist_name ?? "Terapis booking"}
        pending={checkout.isPending}
        onSubmit={doCheckout}
        onClose={close}
      />}
      {!readOnly && dialog?.kind === "cancel" && <CancelBookingDialog booking={booking} onClose={close} />}
    </div>
  );
}

function TherapistSurveyDialog({ therapistName, pending, onSubmit, onClose }: {
  therapistName: string;
  pending: boolean;
  onSubmit: (rating: number) => void;
  onClose: () => void;
}) {
  const [rating, setRating] = useState(0);
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>Survei kepuasan terapis</DialogPanelTitle>
          <DialogPanelDescription>Berikan rating untuk terapis booking sebelum membuka tagihan POS.</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <p className="text-sm font-medium">{therapistName}</p>
          <div role="group" aria-label="Rating kepuasan terapis" className="flex gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button key={value} type="button" aria-label={`${value} bintang`} aria-pressed={rating === value}
                onClick={() => setRating(value)} disabled={pending}
                className="rounded-md p-1 text-amber-500 transition-colors hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:opacity-50">
                <Star className={`size-8 ${value <= rating ? "fill-current" : ""}`} aria-hidden />
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {rating ? `${rating} dari 5 bintang` : "Pilih 1 sampai 5 bintang."}
          </p>
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Kembali</Button>
          <Button onClick={() => onSubmit(rating)} disabled={pending || rating === 0}>
            {pending ? "Memproses…" : "Lanjut ke POS"}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

function ScheduleBookingDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [value, setValue] = useState(() => isoToWibLocalInput(booking.scheduled_at));
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateBooking(booking.id);

  const submit = () => {
    const scheduledAt = wibLocalInputToIso(value);
    if (!scheduledAt) return setError("Isi waktu mulai yang valid.");
    setError(null);
    update.mutate({ scheduled_at: scheduledAt }, {
      onSuccess: () => { toast.success("Jadwal booking diubah"); onClose(); },
      onError: (err) => setError(err.message),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelForm onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <DialogPanelHeader>
            <DialogPanelTitle>Ubah jadwal booking</DialogPanelTitle>
            <DialogPanelDescription>Jam akhir mengikuti total durasi treatment. Bentrok terapis akan diperiksa kembali.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-3">
            <Field label="Mulai booking (WIB)">
              <Input type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} required />
            </Field>
            <FormError>{error}</FormError>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>Batal</Button>
            <Button type="submit" disabled={update.isPending}>{update.isPending ? "Menyimpan…" : "Simpan"}</Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
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

const DEPOSIT_LABEL: Record<string, string> = { pending: "Menunggu DP", paid: "DP diterima", waived: "DP dibebaskan", expired: "DP tidak dibayar" };
const DEPOSIT_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  waived: "bg-slate-100 text-slate-600 border-slate-200",
  expired: "bg-red-50 text-red-700 border-red-200",
};

function DepositBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${DEPOSIT_STYLE[status] ?? DEPOSIT_STYLE.waived}`}>
      {DEPOSIT_LABEL[status] ?? status}
    </span>
  );
}
