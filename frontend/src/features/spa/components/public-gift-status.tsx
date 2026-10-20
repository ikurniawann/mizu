"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, CreditCard, FlaskConical, Gift, Hourglass, Loader2, MapPin, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container, Kicker } from "@/features/site/components/site-section";
import { formatDateLong, formatRupiah } from "@/lib/format";
import { publicSpaApi } from "../api";
import { wibClockOf, wibDateOf } from "../time";
import { SummaryRow } from "./public-booking-wizard";

/**
 * Status gift voucher yang dibeli lewat chat WhatsApp (/booking/spa/gift/<token>):
 * link bayar selagi menunggu, kode gift voucher setelah lunas, dan halaman bayar
 * simulasi saat XENDIT_MOCK=1 (link berakhiran ?bayar=simulasi).
 */
export function PublicGiftStatus({ token, simulate }: { token: string; simulate: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const gift = useQuery({
    queryKey: ["spa", "public", "gift", token],
    queryFn: () => publicSpaApi.giftOrder(token),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 15_000 : false),
  });

  if (gift.isLoading) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Memuat gift voucher" />
      </div>
    );
  }
  if (gift.error || !gift.data) {
    return (
      <Container className="flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-4 py-16 text-center">
        <h1 className="font-display text-3xl font-bold">Gift voucher tidak ditemukan</h1>
        <p className="text-body">Periksa lagi tautannya, atau tanyakan ke admin Mizu lewat WhatsApp.</p>
      </Container>
    );
  }

  const g = gift.data;
  const paid = g.status === "paid";
  const expired = g.status === "expired";
  const nominal = formatRupiah(g.nominal_idr);
  const simulate_ = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await publicSpaApi.mockPayGift(token);
      qc.setQueryData(["spa", "public", "gift", token], res);
      router.replace(`/booking/spa/gift/${token}`, { scroll: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulasi pembayaran gagal.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(g.code ?? "");
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="bg-background pb-20">
      <section className="bg-ink text-on-ink">
        <Container className="flex flex-col items-center gap-4 py-14 text-center md:py-20">
          <span className={expired ? "flex size-16 items-center justify-center rounded-full bg-white/15" : "flex size-16 items-center justify-center rounded-full bg-accent text-ink"}>
            {expired ? <X className="size-8" /> : paid ? <Check className="size-8" /> : <Gift className="size-8" />}
          </span>
          <Kicker onInk>{paid ? "Gift voucher aktif" : expired ? "Link kedaluwarsa" : "Menunggu pembayaran"}</Kicker>
          <h1 className="font-display text-4xl font-bold tracking-tight text-balance md:text-5xl">
            {paid ? `Gift voucher ${nominal}` : expired ? "Pembayaran tidak selesai" : `Bayar gift voucher ${nominal}`}
          </h1>
          <p className="max-w-lg text-on-ink-muted">
            {paid
              ? `Berlaku di ${g.branch_name}. Tunjukkan kode ini ke kasir saat membayar treatment.`
              : expired
                ? "Link pembayaran sudah lewat batas waktu. Ketik gift voucher di chat WhatsApp Mizu untuk membuat yang baru."
                : `Setelah pembayaran diterima, kode gift voucher muncul di sini dan dikirim ke WhatsApp kamu.`}
          </p>
          {paid && g.code && (
            <button
              type="button"
              onClick={() => void copy()}
              className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-dashed border-accent/60 bg-white/5 px-6 py-4 font-mono text-3xl font-bold tracking-widest transition select-all hover:bg-white/10"
            >
              {g.code}
              <span className="flex items-center gap-1 font-sans text-xs font-semibold tracking-normal text-accent">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Tersalin" : "Salin"}
              </span>
            </button>
          )}
        </Container>
      </section>

      <Container className="mt-8 max-w-2xl space-y-4">
        {g.status === "pending" && (
          <section className="space-y-4 rounded-card bg-card p-6 shadow-card ring-2 ring-accent-strong">
            {simulate && g.mock ? (
              <>
                <p className="flex items-center justify-between gap-3">
                  <span className="font-display text-xl font-semibold">Pembayaran gift voucher</span>
                  <span className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-semibold">
                    <FlaskConical className="size-3.5" /> Mode demo
                  </span>
                </p>
                {error && <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
                <Button size="lg" className="w-full" disabled={busy} onClick={() => void simulate_()}>
                  {busy ? <Loader2 className="animate-spin" /> : <CreditCard />} Bayar {nominal} (simulasi)
                </Button>
                <p className="text-center text-xs text-muted-foreground">Simulasi: tidak ada uang yang ditarik.</p>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <Hourglass className="mt-0.5 size-5 shrink-0 text-forest dark:text-accent" />
                  <p className="text-sm text-body">
                    {g.pay_until ? `Link berlaku sampai pukul ${wibClockOf(g.pay_until)} WIB. ` : ""}Bayar lewat VA, QRIS, e-wallet, atau kartu.
                  </p>
                </div>
                {g.pay_url && (
                  <Button asChild size="lg" className="w-full sm:w-auto">
                    <a href={g.pay_url}>
                      <CreditCard /> Bayar {nominal}
                    </a>
                  </Button>
                )}
              </>
            )}
          </section>
        )}
        <div className="space-y-4 rounded-card bg-card p-6 shadow-card">
          <SummaryRow icon={MapPin} label="Berlaku di">
            {g.branch_name}
          </SummaryRow>
          <SummaryRow icon={Gift} label="Nominal">
            {nominal}
          </SummaryRow>
          <SummaryRow icon={UserRound} label="Untuk">
            {g.recipient_name ?? <span className="font-normal text-body">{g.buyer_name}</span>}
          </SummaryRow>
          {paid && (
            <SummaryRow icon={Hourglass} label="Masa berlaku">
              {g.card_expires_at ? `Sampai ${formatDateLong(wibDateOf(g.card_expires_at))}` : "Tanpa batas waktu"}
            </SummaryRow>
          )}
        </div>
      </Container>
    </div>
  );
}
