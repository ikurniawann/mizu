"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatTime } from "@/lib/format";
import { addDaysToDate, wibDateOf } from "../time";
import { publicSpaApi } from "../api";
import { usePublicSpaSlots } from "../queries";
import type { PublicBookingResult } from "../types";

const INPUT = "h-11 w-full rounded-xl border border-border bg-card px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-forest";
const BUTTON = "h-11 rounded-xl bg-accent-strong px-4 font-semibold text-accent-foreground disabled:opacity-50";

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

  if (!canManage) return <p className="mt-6 text-sm text-muted-foreground">Perubahan mandiri tersedia sampai 24 jam sebelum kunjungan untuk booking yang belum dibayar. Hubungi outlet jika perlu bantuan.</p>;
  return (
    <section className="mt-8 w-full space-y-3 border-t border-border pt-6 text-left">
      <h2 className="text-lg font-bold">Ubah booking</h2>
      <p className="text-sm text-muted-foreground">Verifikasi nomor HP melalui kode WhatsApp sebelum mengubah atau membatalkan booking.</p>
      {success && <p role="status" className="rounded-xl bg-success/10 p-3 text-sm">{success}</p>}
      {error && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {phase === "idle" && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void requestCode("reschedule")}>Ubah jadwal</button>
          <button type="button" className="h-11 rounded-xl border border-danger px-4 font-semibold text-danger disabled:opacity-50" disabled={busy} onClick={() => void requestCode("cancel")}>Batalkan booking</button>
        </div>
      )}
      {phase === "code" && (
        <div className="space-y-3">
          <p className="text-sm">Kode dikirim ke nomor yang berakhir {phoneHint}. Berlaku 5 menit.</p>
          <label className="block text-sm font-medium">Kode 6 digit
            <input className={`${INPUT} mt-1`} value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </label>
          <button type="button" className={`${BUTTON} w-full`} disabled={busy || code.length !== 6} onClick={() => void verify()}>{busy ? "Memeriksa…" : "Verifikasi kode"}</button>
          <button type="button" className="text-sm underline" onClick={() => { setPhase("idle"); setAction(null); }}>Kembali</button>
        </div>
      )}
      {phase === "verified" && action === "cancel" && (
        <div className="space-y-3">
          <p className="text-sm">Pembatalan akan melepas jam booking ini. Tindakan ini tidak dapat dibatalkan.</p>
          <button type="button" className="h-11 w-full rounded-xl bg-danger px-4 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void apply()}>{busy ? "Menyimpan…" : "Ya, batalkan booking"}</button>
        </div>
      )}
      {phase === "verified" && action === "reschedule" && (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Tanggal baru
            <input type="date" className={`${INPUT} mt-1`} value={date} min={addDaysToDate(wibDateOf(new Date()), 1)} max={addDaysToDate(wibDateOf(new Date()), 30)} onChange={(e) => { setDate(e.target.value); setSelectedAt(""); }} />
          </label>
          {slots.isLoading ? <p className="text-sm">Memuat jam…</p> : slots.error ? <p className="text-sm text-danger">Jam belum bisa dimuat.</p> : futureSlots.length === 0 ? <p className="text-sm">Tidak ada jam tersedia pada tanggal ini.</p> : (
            <div className="grid grid-cols-4 gap-2">
              {futureSlots.map((slot) => <button key={slot.starts_at} type="button" aria-pressed={selectedAt === slot.starts_at} onClick={() => setSelectedAt(slot.starts_at)} className={`h-10 rounded-xl border text-sm ${selectedAt === slot.starts_at ? "border-foreground bg-foreground text-card" : "border-border"}`}>{formatTime(slot.starts_at)}</button>)}
            </div>
          )}
          <button type="button" className={`${BUTTON} w-full`} disabled={busy || !selectedAt} onClick={() => void apply()}>{busy ? "Menyimpan…" : "Simpan jadwal baru"}</button>
        </div>
      )}
    </section>
  );
}
