"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Copy, Loader2, Phone, XCircle } from "lucide-react";
import { formatDateLong, formatRupiah, formatTime } from "@/lib/format";
import { publicSpaApi } from "../api";
import { PublicBookingManage } from "./public-booking-manage";

const LABEL: Record<string, string> = {
  unassigned: "Menunggu terapis",
  assigned: "Terapis ditugaskan",
  in_treatment: "Sedang treatment",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  expired: "Lewat jadwal",
};

export function PublicSpaBookingStatus({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const booking = useQuery({
    queryKey: ["spa", "public", "booking", token],
    queryFn: () => publicSpaApi.booking(token),
    refetchInterval: 60_000,
  });

  if (booking.isLoading) return <div className="flex min-h-dvh items-center justify-center"><Loader2 className="size-6 animate-spin" aria-label="Memuat booking" /></div>;
  if (booking.error || !booking.data) return (
    <div className="mx-auto max-w-lg space-y-4 px-5 py-12 text-center">
      <h1 className="text-2xl font-bold">Booking tidak ditemukan</h1>
      <p className="text-sm text-muted-foreground">Periksa tautan booking Anda atau hubungi outlet.</p>
      <Link href="/booking/spa" className="font-semibold underline">Buat booking baru</Link>
    </div>
  );

  const result = booking.data;
  const inactive = result.status === "cancelled" || result.status === "expired";
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center bg-card px-5 py-12 text-center text-foreground">
      <Link href="/" className="text-lg font-bold tracking-tight">Mizu</Link>
      {inactive ? <XCircle className="mt-8 size-16 text-danger" aria-hidden="true" /> : <CheckCircle2 className="mt-8 size-16 text-success" aria-hidden="true" />}
      <h1 className="mt-4 text-2xl font-bold">{result.status === "cancelled" ? "Booking dibatalkan" : result.status === "expired" ? "Jadwal booking sudah lewat" : "Permintaan booking diterima"}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Status: {LABEL[result.status] ?? result.status}. Simpan tautan ini untuk melihat perkembangan booking.</p>
      <p className="mt-6 rounded-2xl border-2 border-dashed border-border px-6 py-4 font-mono text-3xl font-bold tracking-widest select-all">
        {result.booking_code}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">Tunjukkan kode ini ke resepsionis saat tiba.</p>
      <div className="mt-6 w-full rounded-2xl bg-surface-2 p-4 text-left text-sm">
        <p className="font-semibold">{result.branch_name}</p>
        <p className="text-muted-foreground">{formatDateLong(result.scheduled_at)} · {formatTime(result.scheduled_at)} WIB</p>
        <ul className="mt-2 space-y-1">
          {result.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>{item.treatment_name} — {item.variant_name} ({item.duration_min} mnt)</span>
              <span className="tabular-nums">{formatRupiah(item.price_idr)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex justify-between border-t border-border pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{formatRupiah(result.total_idr)}</span></p>
        <p className="mt-1 text-xs text-muted-foreground">{result.status === "cancelled" ? "Booking dibatalkan; tidak ada pembayaran untuk kunjungan ini" : result.payment_status === "paid" ? "Sudah dibayar" : "Pembayaran di outlet setelah treatment"}</p>
      </div>
      <button type="button" onClick={() => void copyLink()} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent-strong font-semibold text-accent-foreground">
        <Copy className="size-4" /> {copied ? "Tautan disalin" : "Salin tautan booking"}
      </button>
      {result.branch_phone ? (
        <a className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border font-semibold" href={`tel:${result.branch_phone.replace(/\s+/g, "")}`}>
          <Phone className="size-4" /> Ubah jadwal? Hubungi outlet
        </a>
      ) : null}
      <PublicBookingManage booking={result} />
      <Link href="/" className="mt-8 text-sm font-semibold underline">Kembali ke beranda</Link>
    </main>
  );
}
