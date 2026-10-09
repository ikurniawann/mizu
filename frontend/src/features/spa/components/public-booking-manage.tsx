"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addDaysToDate, wibDateOf } from "../time";
import { publicSpaApi } from "../api";
import { usePublicSpaSlots } from "../queries";
import type { PublicBookingResult } from "../types";

const INPUT =
  "h-12 w-full rounded-xl border border-border bg-background px-4 text-base font-normal text-foreground outline-none transition focus-visible:border-accent-strong focus-visible:ring-2 focus-visible:ring-accent/30";

export function PublicBookingManage({ booking }: { booking: PublicBookingResult }) {
  const queryClient = useQueryClient();
  const [now] = useState(() => Date.now());
  const [action, setAction] = useState<"cancel" | "reschedule" | null>(null);
  const [phase, setPhase] = useState<"idle" | "code" | "verified">("idle");
  const [phoneHint, setPhoneHint] = useState("");
  const [code, setCode] = useState("");
  const [grant, setGrant] = useState("");
  const [date, setDate] = useState(() => addDaysToDate(wibDateOf(new Date()), 2));
  const [selectedAt, setSelectedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const canManage = booking.can_manage;
  const slots = usePublicSpaSlots(
    action === "reschedule" && phase === "verified" ? booking.branch_id : "",
    date,
    booking.items.map((item) => item.variant_id),
    booking.therapist_gender_pref,
  );
  const futureSlots = (slots.data ?? []).filter((slot) => new Date(slot.starts_at).getTime() - now >= 24 * 60 * 60 * 1000);

  const requestCode = async (nextAction: "cancel" | "reschedule") => {
    setAction(nextAction);
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      const result = await publicSpaApi.changeCode(booking.access_token);
      setPhoneHint(result.phone_hint);
      setPhase("code");
    } catch (err) { setError(err instanceof Error ? err.message : "Kode belum bisa dikirim."); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setError("");
    setBusy(true);
    try {
      const result = await publicSpaApi.verifyCode(booking.access_token, code);
      setGrant(result.grant);
      setPhase("verified");
    } catch (err) { setError(err instanceof Error ? err.message : "Kode salah."); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!action || !grant || (action === "reschedule" && !selectedAt)) return;
    setError("");
    setBusy(true);
    try {
      await publicSpaApi.changeBooking(booking.access_token, grant, action, selectedAt || undefined);
      setSuccess(action === "cancel" ? "Booking dibatalkan." : "Jadwal booking berhasil diubah. Terapis akan ditentukan kembali oleh outlet.");
      setPhase("idle");
      setAction(null);
      setGrant("");
      await queryClient.invalidateQueries({ queryKey: ["spa", "public", "booking", booking.access_token] });
    } catch (err) { setError(err instanceof Error ? err.message : "Perubahan belum tersimpan."); }
    finally { setBusy(false); }
  };

  if (!canManage) {
    return (
      <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-body">
        Perubahan mandiri tersedia sampai 24 jam sebelum kunjungan untuk booking yang belum dibayar. Hubungi outlet jika perlu bantuan.
      </p>
    );
  }
  return (
    <section className="space-y-4 rounded-card bg-card p-6 shadow-card">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-semibold">Ubah atau batalkan booking</h2>
        <p className="text-sm text-body">Demi keamanan, kami kirim kode verifikasi ke WhatsApp nomor yang dipakai saat booking.</p>
      </div>
      {success && <p role="status" className="rounded-2xl bg-success-soft px-4 py-3 text-sm">{success}</p>}
      {error && <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
      {phase === "idle" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button size="lg" variant="outline" disabled={busy} onClick={() => void requestCode("reschedule")}>
            {busy && action === "reschedule" ? <Loader2 className="animate-spin" /> : <CalendarClock />} Ubah jadwal
          </Button>
          <Button size="lg" variant="ghost" className="text-danger hover:bg-danger-soft" disabled={busy} onClick={() => void requestCode("cancel")}>
            {busy && action === "cancel" ? <Loader2 className="animate-spin" /> : <X />} Batalkan booking
          </Button>
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
          <button type="button" className="text-sm font-semibold text-body hover:underline" onClick={() => { setPhase("idle"); setAction(null); }}>
            Kembali
          </button>
        </div>
      )}
      {phase === "verified" && action === "cancel" && (
        <div className="space-y-3">
          <p className="text-sm">Pembatalan akan melepas jam booking ini. Tindakan ini tidak dapat dibatalkan.</p>
          <Button size="lg" className="w-full bg-danger text-white hover:bg-danger/90" disabled={busy} onClick={() => void apply()}>
            {busy ? "Menyimpan…" : "Ya, batalkan booking"}
          </Button>
        </div>
      )}
      {phase === "verified" && action === "reschedule" && (
        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm font-semibold">
            Tanggal baru
            <input
              type="date"
              className={INPUT}
              value={date}
              min={addDaysToDate(wibDateOf(new Date()), 1)}
              max={addDaysToDate(wibDateOf(new Date()), 30)}
              onChange={(e) => { setDate(e.target.value); setSelectedAt(""); }}
            />
          </label>
          {slots.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-body"><Loader2 className="size-4 animate-spin" /> Memuat jam…</p>
          ) : slots.error ? (
            <p className="text-sm text-danger">Jam belum bisa dimuat.</p>
          ) : futureSlots.length === 0 ? (
            <p className="text-sm text-body">Tidak ada jam tersedia pada tanggal ini.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {futureSlots.map((slot) => (
                <button
                  key={slot.starts_at}
                  type="button"
                  aria-pressed={selectedAt === slot.starts_at}
                  onClick={() => setSelectedAt(slot.starts_at)}
                  className={cn(
                    "h-11 rounded-xl text-sm font-semibold tabular-nums shadow-card transition",
                    selectedAt === slot.starts_at ? "bg-ink text-on-ink" : "bg-background hover:bg-surface"
                  )}
                >
                  {formatTime(slot.starts_at)}
                </button>
              ))}
            </div>
          )}
          <Button size="lg" className="w-full" disabled={busy || !selectedAt} onClick={() => void apply()}>
            {busy ? "Menyimpan…" : "Simpan jadwal baru"}
          </Button>
        </div>
      )}
    </section>
  );
}
