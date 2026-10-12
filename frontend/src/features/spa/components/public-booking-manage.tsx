"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publicSpaApi } from "../api";
import type { PublicBookingResult } from "../types";

const INPUT =
  "h-12 w-full rounded-xl border border-border bg-background px-4 text-base font-normal text-foreground outline-none transition focus-visible:border-accent-strong focus-visible:ring-2 focus-visible:ring-accent/30";

/**
 * Ubah atau batalkan booking dari halaman status. Ubah jadwal (sampai 1 jam
 * sebelum kunjungan) lewat /booking/spa/ubah dengan kode booking + nomor WA;
 * batal (sampai 24 jam sebelum, belum dibayar) memakai kode WhatsApp.
 */
export function PublicBookingManage({ booking }: { booking: PublicBookingResult }) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "code" | "verified">("idle");
  const [phoneHint, setPhoneHint] = useState("");
  const [code, setCode] = useState("");
  const [grant, setGrant] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const canReschedule = !!booking.can_reschedule;
  const canCancel = booking.can_manage;

  const requestCode = async () => {
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      const result = await publicSpaApi.changeCode(booking.access_token);
      setPhoneHint(result.phone_hint);
      setPhase("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kode belum bisa dikirim.");
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setError("");
    setBusy(true);
    try {
      const result = await publicSpaApi.verifyCode(booking.access_token, code);
      setGrant(result.grant);
      setPhase("verified");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kode salah.");
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!grant) return;
    setError("");
    setBusy(true);
    try {
      await publicSpaApi.changeBooking(booking.access_token, grant, "cancel");
      setSuccess("Booking dibatalkan.");
      setPhase("idle");
      setGrant("");
      await queryClient.invalidateQueries({ queryKey: ["spa", "public", "booking", booking.access_token] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pembatalan belum tersimpan.");
    } finally {
      setBusy(false);
    }
  };

  if (!canReschedule && !canCancel) {
    return (
      <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-body">
        Jadwal bisa diubah sendiri sampai 1 jam sebelum kunjungan (sebelum tagihan dibuka di kasir). Hubungi outlet jika perlu bantuan.
      </p>
    );
  }
  return (
    <section className="space-y-4 rounded-card bg-card p-6 shadow-card">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-semibold">Ubah atau batalkan booking</h2>
        <p className="text-sm text-body">
          Ubah jadwal sampai 1 jam sebelum kunjungan.
          {canCancel ? " Pembatalan sampai 24 jam sebelum kunjungan, dengan kode verifikasi WhatsApp." : " Pembatalan sudah lewat batas 24 jam; hubungi outlet bila perlu."}
        </p>
      </div>
      {success && <p role="status" className="rounded-2xl bg-success-soft px-4 py-3 text-sm">{success}</p>}
      {error && <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
      {phase === "idle" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {canReschedule && (
            <Button asChild size="lg" variant="outline">
              <Link href={`/booking/spa/ubah?kode=${encodeURIComponent(booking.booking_code)}`}>
                <CalendarClock /> Ubah jadwal
              </Link>
            </Button>
          )}
          {canCancel && (
            <Button size="lg" variant="ghost" className="text-danger hover:bg-danger-soft" disabled={busy} onClick={() => void requestCode()}>
              {busy ? <Loader2 className="animate-spin" /> : <X />} Batalkan booking
            </Button>
          )}
        </div>
      )}
      {phase === "code" && (
        <div className="space-y-3">
          <p className="text-sm">Kode dikirim ke nomor yang berakhir <strong>{phoneHint}</strong>. Berlaku 5 menit.</p>
          <label className="block space-y-1.5 text-sm font-semibold">
            Kode 6 digit
            <input
              className={INPUT}
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <Button size="lg" className="w-full" disabled={busy || code.length !== 6} onClick={() => void verify()}>
            {busy ? "Memeriksa…" : "Verifikasi kode"}
          </Button>
          <button type="button" className="text-sm font-semibold text-body hover:underline" onClick={() => setPhase("idle")}>
            Kembali
          </button>
        </div>
      )}
      {phase === "verified" && (
        <div className="space-y-3">
          <p className="text-sm">Pembatalan akan melepas jam booking ini. Tindakan ini tidak dapat dibatalkan.</p>
          <Button size="lg" className="w-full bg-danger text-white hover:bg-danger/90" disabled={busy} onClick={() => void cancel()}>
            {busy ? "Menyimpan…" : "Ya, batalkan booking"}
          </Button>
        </div>
      )}
    </section>
  );
}
