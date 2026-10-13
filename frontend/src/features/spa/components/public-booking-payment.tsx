"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CreditCard, FlaskConical, Hourglass, Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { publicSpaApi } from "../api";
import type { PublicBookingResult } from "../types";

const SIM_METHODS = ["Virtual Account BCA", "QRIS", "GoPay", "Kartu kredit"] as const;

/**
 * Bagian pembayaran di halaman status booking: status lunas, tombol bayar
 * online (invoice Xendit), dan halaman bayar simulasi saat XENDIT_MOCK=1.
 */
export function PublicBookingPayment({
  booking,
  token,
  notice,
}: {
  booking: PublicBookingResult;
  token: string;
  /** ?bayar= di URL: "simulasi" membuka simulasi, "gagal" = link belum terbuat. */
  notice?: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice === "gagal" ? "Link pembayaran belum berhasil dibuat. Coba lagi, atau bayar di outlet." : null);
  const [simMethod, setSimMethod] = useState<(typeof SIM_METHODS)[number]>("QRIS");

  const upcoming = booking.status === "unassigned" || booking.status === "assigned";
  const total = formatRupiah(booking.total_idr);
  const deposit = booking.deposit;

  const payDeposit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = deposit?.deposit_invoice_url ? { invoice_url: deposit.deposit_invoice_url } : await publicSpaApi.payDeposit(token);
      window.location.assign(res.invoice_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pembayaran DP belum bisa dibuka.");
      setBusy(false);
    }
  };
  const simulateDeposit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await publicSpaApi.mockPayDeposit(token);
      qc.setQueryData(["spa", "public", "booking", token], res);
      router.replace(`/booking/spa/status/${token}`, { scroll: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulasi DP gagal.");
    } finally {
      setBusy(false);
    }
  };

  // DP menunggu: halaman bayar simulasi (mode demo) atau tombol ke Xendit.
  if (upcoming && deposit?.deposit_status === "pending") {
    const dp = formatRupiah(deposit.deposit_idr);
    const deadline = deposit.deposit_hold_until ? formatDateTime(deposit.deposit_hold_until) : null;
    // Mode demo: link DP menunjuk kembali ke halaman ini dengan ?bayar=dp-simulasi.
    if (notice === "dp-simulasi" && deposit.deposit_invoice_url?.includes("bayar=dp-simulasi")) {
      return (
        <section className="overflow-hidden rounded-card bg-card shadow-float ring-2 ring-accent-strong">
          <div className="flex items-center justify-between gap-3 bg-ink px-5 py-4 text-on-ink">
            <div>
              <p className="text-xs font-semibold tracking-wider text-accent uppercase">Pembayaran DP</p>
              <p className="font-display text-lg font-semibold">Xendit · Mizu {booking.booking_code}</p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
              <FlaskConical className="size-3.5 text-accent" /> Mode demo
            </span>
          </div>
          <div className="space-y-4 p-5">
            <p className="flex items-baseline justify-between">
              <span className="text-body">DP booking</span>
              <span className="font-display text-2xl font-bold tabular-nums">{dp}</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {SIM_METHODS.map((m) => (
                <button key={m} type="button" aria-pressed={simMethod === m} onClick={() => setSimMethod(m)}
                  className={cn("h-11 rounded-xl text-sm font-semibold shadow-card transition", simMethod === m ? "bg-ink text-on-ink" : "bg-background hover:bg-surface")}>
                  {m}
                </button>
              ))}
            </div>
            {error && <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
            <Button size="lg" className="w-full" disabled={busy} onClick={() => void simulateDeposit()}>
              {busy ? <Loader2 className="animate-spin" /> : <CreditCard />} Bayar DP {dp} dengan {simMethod}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Simulasi: tidak ada uang yang ditarik.</p>
          </div>
        </section>
      );
    }
    return (
      <section className="space-y-4 rounded-card bg-card p-6 shadow-card ring-2 ring-accent-strong">
        <div className="flex items-start gap-3">
          <Hourglass className="mt-0.5 size-5 shrink-0 text-forest dark:text-accent" />
          <div className="space-y-1">
            <p className="font-display text-xl font-semibold">Bayar DP {dp} untuk mengunci jadwal</p>
            <p className="text-sm text-body">
              {deadline ? `Jadwal ditahan sampai ${deadline} WIB. ` : ""}Lewat batas itu booking dibatalkan otomatis dan jamnya dilepas. Sisa{" "}
              <span className="font-semibold">{formatRupiah(deposit.remaining_idr - deposit.deposit_idr < 0 ? 0 : booking.total_idr - deposit.deposit_idr)}</span> dibayar di outlet setelah treatment.
            </p>
          </div>
        </div>
        {(error || notice === "dp-gagal") && (
          <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error ?? "Link DP belum berhasil dibuat. Coba lagi."}</p>
        )}
        <Button size="lg" className="w-full sm:w-auto" disabled={busy} onClick={() => void payDeposit()}>
          {busy ? <Loader2 className="animate-spin" /> : <CreditCard />} Bayar DP {dp}
        </Button>
      </section>
    );
  }
  if (deposit?.deposit_status === "paid" && booking.payment_status !== "paid") {
    return (
      <div className="flex items-center gap-3 rounded-card bg-success-soft p-5">
        <BadgeCheck className="size-6 shrink-0 text-success" />
        <div>
          <p className="font-semibold">DP {formatRupiah(deposit.deposit_idr)} diterima · jadwal terkunci</p>
          <p className="text-sm text-body">Sisa {formatRupiah(deposit.remaining_idr)} dibayar di outlet setelah treatment.</p>
        </div>
      </div>
    );
  }

  if (booking.payment_status === "paid") {
    return (
      <div className="flex items-center gap-3 rounded-card bg-success-soft p-5">
        <BadgeCheck className="size-6 shrink-0 text-success" />
        <div>
          <p className="font-semibold">Lunas · {total}</p>
          <p className="text-sm text-body">{booking.paid_online ? "Dibayar online. Tidak perlu bayar lagi di outlet." : "Dibayar di outlet."}</p>
        </div>
      </div>
    );
  }
  if (!upcoming || booking.payment_status !== "unpaid") return null;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await publicSpaApi.pay(token);
      window.location.assign(res.invoice_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pembayaran online belum bisa dibuka.");
      setBusy(false);
    }
  };

  const simulate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await publicSpaApi.mockPay(token);
      qc.setQueryData(["spa", "public", "booking", token], res);
      router.replace(`/booking/spa/status/${token}`, { scroll: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulasi gagal.");
    } finally {
      setBusy(false);
    }
  };

  // Halaman bayar simulasi: pengganti halaman Xendit saat mode demo.
  if (notice === "simulasi" && booking.mock_payment && booking.invoice_url) {
    return (
      <section className="overflow-hidden rounded-card bg-card shadow-float ring-2 ring-accent-strong">
        <div className="flex items-center justify-between gap-3 bg-ink px-5 py-4 text-on-ink">
          <div>
            <p className="text-xs font-semibold tracking-wider text-accent uppercase">Pembayaran</p>
            <p className="font-display text-lg font-semibold">Xendit · Mizu {booking.booking_code}</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
            <FlaskConical className="size-3.5 text-accent" /> Mode demo
          </span>
        </div>
        <div className="space-y-4 p-5">
          <p className="flex items-baseline justify-between">
            <span className="text-body">Total tagihan</span>
            <span className="font-display text-2xl font-bold tabular-nums">{total}</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SIM_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={simMethod === m}
                onClick={() => setSimMethod(m)}
                className={cn(
                  "h-11 rounded-xl text-sm font-semibold shadow-card transition",
                  simMethod === m ? "bg-ink text-on-ink" : "bg-background hover:bg-surface"
                )}
              >
                {m}
              </button>
            ))}
          </div>
          {error && <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
          <Button size="lg" className="w-full" disabled={busy} onClick={() => void simulate()}>
            {busy ? <Loader2 className="animate-spin" /> : <CreditCard />} Bayar {total} dengan {simMethod}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Simulasi: tidak ada uang yang ditarik. Dengan key Xendit asli, tombol bayar membuka halaman pembayaran Xendit.
          </p>
        </div>
      </section>
    );
  }

  if (!booking.online_payment) {
    return (
      <div className="flex items-center gap-3 rounded-card bg-surface p-5">
        <Wallet className="size-5 shrink-0 text-forest dark:text-accent" />
        <p className="text-sm text-body">Bayar {total} di outlet setelah treatment.</p>
      </div>
    );
  }

  const continuing = booking.payment_method === "online" && !!booking.invoice_url;
  return (
    <section className="space-y-4 rounded-card bg-card p-6 shadow-card">
      <div className="flex items-start gap-3">
        <CreditCard className="mt-0.5 size-5 shrink-0 text-forest dark:text-accent" />
        <div className="space-y-1">
          <p className="font-display text-xl font-semibold">
            {booking.payment_method === "online" ? "Selesaikan pembayaran" : "Mau bayar sekarang?"}
          </p>
          <p className="text-sm text-body">
            {booking.payment_method === "online"
              ? `Booking tercatat. Bayar ${total} lewat VA, e-wallet, QRIS atau kartu. Belum sempat? Kamu tetap bisa bayar di outlet.`
              : `Booking ini dibayar di outlet. Bisa juga bayar ${total} online sekarang supaya check-in lebih cepat.`}
          </p>
        </div>
      </div>
      {error && <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
      <Button
        size="lg"
        variant={booking.payment_method === "online" ? "default" : "outline"}
        className="w-full sm:w-auto"
        disabled={busy}
        onClick={() => (continuing && booking.invoice_url ? window.location.assign(booking.invoice_url) : void pay())}
      >
        {busy ? <Loader2 className="animate-spin" /> : <CreditCard />}
        {continuing ? "Lanjutkan pembayaran" : `Bayar online ${total}`}
      </Button>
    </section>
  );
}
