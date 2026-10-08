"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { todayWib } from "@/lib/dates";
import { formatDate, formatRupiah, formatTime } from "@/lib/format";
import { useSpaBookings, useSpaOutlets } from "../queries";
import { BOOKING_STATUS, BOOKING_STATUSES, BOOKING_TYPE_LABEL, PAYMENT_STATUS, PAYMENT_STATUSES, sourceLabel } from "../rules";
import { addDaysToDate } from "../time";
import type { BookingStatus, PaymentStatus } from "../types";
import { BookingCreateDialog } from "./booking-create-dialog";
import {
  BookingStatusBadge,
  OutletSelect,
  Pager,
  PaymentStatusBadge,
  SELECT,
  SPA_KICKER,
  TableNote,
} from "./shared";

const LIMIT = 20;

/** Spa → Booking: daftar booking per outlet & periode, filter status layanan/pembayaran. */
export function SpaBookingsPage() {
  const [today] = useState(() => todayWib());
  const [branchId, setBranchId] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => addDaysToDate(today, 7));
  const [status, setStatus] = useState<BookingStatus | "">("");
  const [payment, setPayment] = useState<PaymentStatus | "">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const search = useDebouncedValue(q.trim(), 350);

  const outlets = useSpaOutlets();
  const params = {
    branch_id: branchId || undefined,
    from: from || undefined,
    to: to || undefined,
    status,
    payment_status: payment,
    q: search.length >= 2 ? search : undefined,
    page,
    limit: LIMIT,
  };
  const bookings = useSpaBookings(params);
  const rows = bookings.data?.data ?? [];
  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };
  const rangeInvalid = !!from && !!to && from > to;

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={SPA_KICKER}
        title="Booking"
        description="Booking treatment semua outlet. Status layanan dan status pembayaran ditampilkan terpisah — selesai belum tentu lunas."
        actions={
          <Button onClick={() => setCreating(true)} disabled={outlets.isLoading}>
            <Plus /> Booking baru
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_9.5rem_9.5rem_minmax(0,1fr)_minmax(0,1fr)]">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Cari kode, nama, atau HP"
          aria-label="Cari booking"
        />
        <OutletSelect outlets={outlets.data ?? []} value={branchId} onChange={reset(setBranchId)} className={SELECT} allLabel="Semua outlet" />
        <Input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} aria-label="Dari tanggal" />
        <Input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} aria-label="Sampai tanggal" />
        <select className={SELECT} value={status} onChange={(e) => reset(setStatus)(e.target.value as BookingStatus | "")} aria-label="Status layanan">
          <option value="">Semua status layanan</option>
          {BOOKING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {BOOKING_STATUS[s].label}
            </option>
          ))}
        </select>
        <select className={SELECT} value={payment} onChange={(e) => reset(setPayment)(e.target.value as PaymentStatus | "")} aria-label="Status pembayaran">
          <option value="">Semua pembayaran</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PAYMENT_STATUS[s].label}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        Periode jadwal {from ? formatDate(from) : "—"} s.d. {to ? formatDate(to) : "—"} (WIB)
        {branchId ? ` · ${outlets.data?.find((o) => o.branch_id === branchId)?.branch_name ?? ""}` : " · semua outlet"}
      </p>

      <Card className="py-0">
        {rangeInvalid ? (
          <TableNote tone="danger">Tanggal awal harus sebelum tanggal akhir.</TableNote>
        ) : bookings.isLoading ? (
          <div className="p-4">
            <SkeletonTable columns={6} rows={6} />
          </div>
        ) : bookings.error ? (
          <TableNote tone="danger">{bookings.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Tidak ada booking pada filter ini.</TableNote>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead className="hidden md:table-cell">Outlet</TableHead>
                  <TableHead className="hidden lg:table-cell">Terapis</TableHead>
                  <TableHead>Layanan</TableHead>
                  <TableHead>Pembayaran</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id} className={bookings.isPlaceholderData ? "opacity-60" : undefined}>
                    <TableCell>
                      <Link href={`/dashboard/spa/bookings/${b.id}`} className="font-mono font-medium text-brand-text hover:underline">
                        {b.booking_code}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(b.scheduled_at)} · {formatTime(b.scheduled_at)} · {BOOKING_TYPE_LABEL[b.booking_type] ?? b.booking_type}
                        {b.source === "public" ? ` · ${sourceLabel(b.source)}` : ""}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{b.customer_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{b.customer_phone}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{b.branch_name}</TableCell>
                    <TableCell className="hidden max-w-[14rem] whitespace-normal lg:table-cell">
                      <p className="text-sm">{b.therapist_names.length ? b.therapist_names.join(", ") : "—"}</p>
                      <p className="text-xs text-muted-foreground">{b.item_count} treatment</p>
                    </TableCell>
                    <TableCell>
                      <BookingStatusBadge status={b.status} />
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={b.payment_status} />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatRupiah(b.total_idr)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager pagination={bookings.data?.pagination} onPage={setPage} disabled={bookings.isFetching} />
          </>
        )}
      </Card>

      {creating && (
        <BookingCreateDialog outlets={outlets.data ?? []} defaultBranchId={branchId} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
