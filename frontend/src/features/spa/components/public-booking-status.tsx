"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, Copy, Link2, Loader2, MapPin, MessageCircle, Phone, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container, Kicker } from "@/features/site/components/site-section";
import { formatDateLong, formatRupiah } from "@/lib/format";
import { publicSpaApi } from "../api";
import { whatsappHref } from "../public-booking";
import { wibClockOf, wibDateOf } from "../time";
import { PublicBookingManage } from "./public-booking-manage";
import { SummaryRow } from "./public-booking-wizard";

const LABEL: Record<string, string> = {
  unassigned: "Menunggu terapis",
  assigned: "Terapis ditugaskan",
  in_treatment: "Sedang treatment",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  expired: "Lewat jadwal",
};

/** Halaman status booking publik (/booking/spa/status/<token>) — juga layar "booking diterima". */
export function PublicSpaBookingStatus({ token }: { token: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const booking = useQuery({
    queryKey: ["spa", "public", "booking", token],
    queryFn: () => publicSpaApi.booking(token),
    refetchInterval: 60_000,
  });

  if (booking.isLoading) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Memuat booking" />
      </div>
    );
  }
  if (booking.error || !booking.data) {
    return (
      <Container className="flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-4 py-16 text-center">
        <h1 className="font-display text-3xl font-bold">Booking tidak ditemukan</h1>
        <p className="text-body">Periksa lagi tautan booking kamu, atau hubungi outlet.</p>
        <Button asChild size="lg">
          <Link href="/booking/spa">Buat booking baru</Link>
        </Button>
      </Container>
    );
  }

  const result = booking.data;
  const cancelled = result.status === "cancelled";
  const inactive = cancelled || result.status === "expired";
  const when = `${formatDateLong(wibDateOf(result.scheduled_at))} pukul ${wibClockOf(result.scheduled_at)} WIB`;
  const wa = whatsappHref(result.branch_phone, `Halo Mizu, saya booking dengan kode ${result.booking_code} untuk ${when}.`);
  const copy = async (what: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(what === "code" ? result.booking_code : window.location.href);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="bg-background pb-20">
      <section className="relative isolate overflow-hidden bg-ink text-on-ink">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mizu-wallpaper.webp" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-ink/70" />
        <Container className="flex flex-col items-center gap-4 py-14 text-center md:py-20">
          <span className={inactive ? "flex size-16 items-center justify-center rounded-full bg-white/15 text-on-ink" : "flex size-16 items-center justify-center rounded-full bg-accent text-ink"}>
            {inactive ? <X className="size-8" /> : <Check className="size-8" />}
          </span>
          <Kicker onInk>{LABEL[result.status] ?? result.status}</Kicker>
          <h1 className="font-display text-4xl font-bold tracking-tight text-balance md:text-5xl">
            {cancelled ? "Booking dibatalkan" : result.status === "expired" ? "Jadwal booking sudah lewat" : `Sampai jumpa di ${result.branch_name}!`}
          </h1>
          <p className="max-w-lg text-on-ink-muted">
            {inactive
              ? "Booking ini tidak aktif lagi. Kamu bisa membuat booking baru kapan saja."
              : "Tunjukkan kode booking ini ke resepsionis saat tiba. Simpan tautan halaman ini untuk melihat atau mengubah booking."}
          </p>
          <button
            type="button"
            onClick={() => void copy("code")}
            className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-dashed border-accent/60 bg-white/5 px-6 py-4 font-mono text-3xl font-bold tracking-widest backdrop-blur transition select-all hover:bg-white/10"
          >
            {result.booking_code}
            <span className="flex items-center gap-1 font-sans text-xs font-semibold tracking-normal text-accent">
              {copied === "code" ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied === "code" ? "Tersalin" : "Salin"}
            </span>
          </button>
        </Container>
      </section>

      <Container className="mt-8 max-w-2xl space-y-4">
        <div className="space-y-4 rounded-card bg-card p-6 shadow-card">
          <SummaryRow icon={MapPin} label="Outlet">
            {result.branch_name}
          </SummaryRow>
          <SummaryRow icon={CalendarDays} label="Jadwal">
            <span className={cancelled ? "line-through" : undefined}>{when}</span>
          </SummaryRow>
          <SummaryRow icon={Sparkles} label="Treatment">
            <ul className="space-y-1.5">
              {result.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    {item.treatment_name}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {item.variant_name} · {item.duration_min} menit
                    </span>
                  </span>
                  <span className="tabular-nums">{formatRupiah(item.price_idr)}</span>
                </li>
              ))}
            </ul>
          </SummaryRow>
          <div className="flex items-end justify-between border-t border-dashed border-border pt-4">
            <span className="text-body">
              Total
              <span className="block text-xs text-muted-foreground">
                {cancelled ? "Tidak ada pembayaran untuk booking ini" : result.payment_status === "paid" ? "Sudah dibayar" : "Bayar di outlet setelah treatment"}
              </span>
            </span>
            <span className="font-display text-2xl font-bold tabular-nums">{formatRupiah(result.total_idr)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" className="flex-1" onClick={() => void copy("link")}>
            {copied === "link" ? <Check /> : <Link2 />}
            {copied === "link" ? "Tautan disalin" : "Salin tautan booking"}
          </Button>
          {wa ? (
            <Button asChild size="lg" variant="outline" className="flex-1">
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle /> Chat outlet
              </a>
            </Button>
          ) : result.branch_phone ? (
            <Button asChild size="lg" variant="outline" className="flex-1">
              <a href={`tel:${result.branch_phone.replace(/\s+/g, "")}`}>
                <Phone /> Telepon outlet
              </a>
            </Button>
          ) : null}
        </div>

        {!inactive && <PublicBookingManage booking={result} />}

        <div className="flex flex-col items-center gap-2 pt-4 text-sm sm:flex-row sm:justify-center sm:gap-6">
          <Link href="/booking/spa" className="font-semibold text-forest hover:underline dark:text-accent">
            Booking lagi
          </Link>
          <Link href="/" className="text-body hover:text-foreground hover:underline">
            Kembali ke beranda
          </Link>
        </div>
      </Container>
    </div>
  );
}
