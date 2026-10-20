"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogPanel, DialogPanelBody, DialogPanelDescription, DialogPanelHeader, DialogPanelTitle } from "@/components/ui/dialog";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { useCheckoutBookingGroup } from "../mutations";
import { useSpaBookingGroup } from "../queries";
import { bookingTotal } from "../rules";
import { BookingStatusBadge, PaymentStatusBadge } from "./shared";

export function BookingGroupDialog({ id, onClose, onOpenBooking, readOnly = false }: {
  id: string;
  onClose: () => void;
  onOpenBooking?: (id: string) => void;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const query = useSpaBookingGroup(id);
  const checkout = useCheckoutBookingGroup(id);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const group = query.data;
  const active = group?.bookings.filter((b) => b.status !== "cancelled") ?? [];
  const allDone = active.length > 0 && active.every((b) => b.status === "completed" && b.therapist_id && b.payment_status === "unpaid");
  const allRated = active.every((b) => (b.therapist_rating ?? ratings[b.id] ?? 0) >= 1);
  const orderId = active.find((b) => b.pos_order_id)?.pos_order_id;
  const needsPayment = active.some((b) => b.payment_status === "unpaid");

  const pay = () => checkout.mutate(active.filter((b) => b.therapist_rating == null).map((b) => ({ booking_id: b.id, therapist_rating: ratings[b.id] })), {
    onSuccess: (result) => {
      toast.success("Tagihan POS siap", { description: `Order ${result.order_number} untuk ${active.length} orang.` });
      onClose();
      router.push(`/dashboard/pos/cashier-new?orderId=${encodeURIComponent(result.order_id)}&spa=1`);
    },
    onError: (err) => toast.error("Checkout bersama gagal", { description: err.message }),
  });

  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogPanel size="lg">
      <DialogPanelHeader><DialogPanelTitle>Booking bersama</DialogPanelTitle><DialogPanelDescription>Satu pembayar dan satu tagihan POS; jadwal, terapis, dan status tetap per orang.</DialogPanelDescription></DialogPanelHeader>
      <DialogPanelBody className="space-y-4">
        {query.isLoading && <p className="text-sm text-muted-foreground">Memuat booking bersama…</p>}
        {query.error && <p className="text-sm text-danger">{query.error.message}</p>}
        {group && <>
          <div className="rounded-2xl bg-surface-2 p-3 text-sm"><p className="font-semibold">Pembayar: {group.payer_name}</p><p className="text-muted-foreground">{group.payer_phone || "Tanpa nomor HP"} · {group.bookings.length} orang</p></div>
          <div className="space-y-3">{group.bookings.map((booking) => <div key={booking.id} className="rounded-2xl border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{booking.customer_name}</p><button type="button" className="font-mono text-xs text-brand-text hover:underline" onClick={() => onOpenBooking?.(booking.id)} disabled={!onOpenBooking}>{booking.booking_code}</button></div><div className="flex gap-2"><BookingStatusBadge status={booking.status} /><PaymentStatusBadge status={booking.payment_status} /></div></div>
            <p className="mt-2 text-xs text-muted-foreground">{formatDateTime(booking.scheduled_at)} · {booking.therapist_name ?? "Belum ditugaskan"} · {formatRupiah(bookingTotal(booking.items))}</p>
            {booking.status !== "cancelled" && booking.status === "completed" && booking.payment_status === "unpaid" && booking.therapist_id && !readOnly && booking.therapist_rating == null && !orderId && <div className="mt-3"><p className="mb-1 text-xs font-medium">Rating untuk {booking.therapist_name}</p><div className="flex gap-1" role="group" aria-label={`Rating terapis ${booking.customer_name}`}>{[1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" aria-label={`${rating} bintang`} aria-pressed={ratings[booking.id] === rating} onClick={() => setRatings((value) => ({ ...value, [booking.id]: rating }))}><Star className={ratings[booking.id] >= rating ? "size-7 fill-warning text-warning" : "size-7 text-muted-foreground"} /></button>)}</div></div>}
            {booking.therapist_rating != null && <p className="mt-2 text-xs">Rating terapis: {booking.therapist_rating}/5</p>}
          </div>)}</div>
          <p className="text-right text-sm font-semibold">Total grup: {formatRupiah(active.reduce((sum, b) => sum + bookingTotal(b.items), 0))}</p>
          {!readOnly && needsPayment && !allDone && <p className="text-xs text-warning">Checkout tersedia setelah semua booking aktif selesai dan memiliki terapis.</p>}
          {!readOnly && needsPayment && allDone && !allRated && <p className="text-xs text-warning">Isi rating terapis untuk setiap orang sebelum checkout.</p>}
        </>}
      </DialogPanelBody>
      <DialogFooter><Button variant="outline" onClick={onClose}>Tutup</Button>{!readOnly && group && needsPayment && <Button disabled={!allDone || !allRated || checkout.isPending} onClick={pay}><Receipt /> {checkout.isPending ? "Memproses…" : orderId ? "Buka tagihan POS" : "Checkout bersama ke POS"}</Button>}</DialogFooter>
    </DialogPanel>
  </Dialog>;
}
