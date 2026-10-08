"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { memberApi } from "../lib/api";
import { m } from "../lib/links";
import { EmptyState, Spinner } from "../ui";

export interface SpaMemberBooking {
  id: string;
  booking_code: string;
  scheduled_at: string;
  status: string;
  payment_status: string;
  branch_name: string;
  branch_phone: string | null;
  items: { treatment_name: string; variant_name: string; duration_min: number; price_idr: number }[];
}

const STATUS: Record<string, string> = {
  unassigned: "Menunggu terapis",
  assigned: "Terapis ditugaskan",
  in_treatment: "Sedang treatment",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  expired: "Lewat jadwal",
};

export function SpaMemberBookingsPage() {
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const bookings = useQuery({
    queryKey: ["member", "spa-bookings"],
    queryFn: () => memberApi<SpaMemberBooking[]>("/spa/bookings"),
  });
  const [now] = useState(() => Date.now());
  const rows = (bookings.data ?? []).filter((booking) => {
    const upcoming = new Date(booking.scheduled_at).getTime() >= now && !["cancelled", "expired", "completed"].includes(booking.status);
    return tab === "upcoming" ? upcoming : !upcoming;
  });

  return (
    <div className="space-y-5">
      <h1 className="nh-display text-3xl font-black">Booking treatment</h1>
      <div className="flex rounded-xl bg-nh-cream p-1" role="tablist" aria-label="Periode booking">
        {(["upcoming", "history"] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
            className={`flex-1 rounded-lg py-2 text-sm font-bold ${tab === value ? "bg-nh-ink-soft text-white" : "text-nh-muted"}`}>
            {value === "upcoming" ? "Mendatang" : "Riwayat"}
          </button>
        ))}
      </div>
      {bookings.isLoading ? <Spinner label="Memuat booking treatment…" /> : bookings.error ? (
        <div role="alert" className="nh-card space-y-3 p-4">
          <p>Booking belum bisa dimuat.</p>
          <button type="button" className="nh-btn-brand" onClick={() => void bookings.refetch()}>Coba lagi</button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={tab === "upcoming" ? "Belum ada booking mendatang" : "Belum ada riwayat booking"}
          action={tab === "upcoming" ? <Link className="nh-btn-brand mt-2" href="/booking/spa">Booking treatment</Link> : undefined} />
      ) : (
        <ul className="space-y-3">
          {rows.map((booking) => (
            <li key={booking.id} className="nh-card space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{booking.branch_name}</p>
                  <p className="text-sm text-nh-muted">{new Date(booking.scheduled_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "full", timeStyle: "short" })} WIB</p>
                </div>
                <span className="shrink-0 rounded-full bg-nh-cream px-2 py-1 text-xs font-bold">{STATUS[booking.status] ?? booking.status}</span>
              </div>
              <p className="text-sm">{booking.items.map((item) => `${item.treatment_name} ${item.variant_name}`).join(", ")}</p>
              <p className="text-xs text-nh-muted">Kode {booking.booking_code} · {booking.payment_status === "paid" ? "Lunas" : "Bayar di outlet"}</p>
              {booking.branch_phone ? <a className="text-sm font-bold underline" href={`tel:${booking.branch_phone.replace(/\s+/g, "")}`}>Hubungi outlet</a> : null}
            </li>
          ))}
        </ul>
      )}
      <Link className="block text-center text-sm font-bold underline" href={m("/")}>Kembali ke beranda</Link>
    </div>
  );
}
