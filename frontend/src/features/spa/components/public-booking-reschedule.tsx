"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, CalendarDays, Check, Clock, Loader2, MapPin, Search, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container, Kicker } from "@/features/site/components/site-section";
import { SITE_PHOTOS } from "@/features/site/lib/photos";
import { formatDateLong } from "@/lib/format";
import { cn } from "@/lib/utils";
import { publicSpaApi } from "../api";
import { dateStrip, endClock, groupSlots } from "../public-booking";
import { usePublicSpaSlots } from "../queries";
import { wibClockOf, wibDateOf } from "../time";
import type { PublicBookingResult } from "../types";
import { SummaryRow } from "./public-booking-wizard";

const INPUT =
  "h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:border-accent-strong focus-visible:ring-2 focus-visible:ring-accent/30";
/** Jam baru minimal 1 jam dari sekarang (aturan server sama). */
const LEAD_MS = 60 * 60 * 1000;
const STRIP_DAYS = 14;

interface Session {
  token: string;
  grant: string;
}

/**
 * Ubah jadwal booking (/booking/spa/ubah): tamu memasukkan kode booking +
 * nomor WhatsApp yang dipakai saat booking, lalu memilih jam baru. Bisa
 * sampai 1 jam sebelum jadwal; crew experience (terapis) ditentukan ulang oleh toko.
 */
export function PublicBookingReschedule({ initialCode = "" }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [done, setDone] = useState<PublicBookingResult | null>(null);

  const find = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const found = await publicSpaApi.findBooking(code.trim(), phone.trim());
      setSession({ token: found.access_token, grant: found.grant });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking belum bisa dicari.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-background pb-20">
      <section className="relative isolate overflow-hidden bg-ink text-on-ink">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={SITE_PHOTOS.accessories} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover object-[center_50%]" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-ink via-ink/85 to-berry/40" />
        <Container className="space-y-4 py-12 md:py-16">
          <Kicker onInk>Booking Paddy Experience</Kicker>
          <h1 className="font-display text-4xl font-bold tracking-tight text-balance md:text-5xl">Ubah jadwal booking</h1>
          <p className="max-w-xl text-on-ink-muted md:text-lg">
            Berhalangan datang? Pindahkan jadwal sendiri sampai <strong className="text-on-ink">1 jam sebelum</strong> jadwalmu,
            cukup dengan kode booking dan nomor WhatsApp yang dipakai saat booking.
          </p>
        </Container>
      </section>

      <Container className="mt-8 max-w-2xl space-y-4">
        {done ? (
          <Done booking={done} token={session?.token ?? ""} />
        ) : session ? (
          <Reschedule
            session={session}
            onDone={setDone}
            onExpired={(msg) => {
              setSession(null);
              setError(msg);
            }}
          />
        ) : (
          <form onSubmit={find} className="space-y-5 rounded-card bg-card p-6 shadow-card">
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Kode booking</span>
              <input
                className={cn(INPUT, "font-mono uppercase tracking-wider")}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="PD-261012-AB12"
                autoComplete="off"
                required
              />
              <span className="block text-xs text-muted-foreground">Ada di halaman status booking, gambar QR, atau pesan konfirmasi.</span>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Nomor WhatsApp saat booking</span>
              <input
                className={INPUT}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="0812-3456-7890"
                required
              />
            </label>
            {error && (
              <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Search />} Cari booking
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Lupa kode booking? Hubungi Paddy Store. Pembatalan tetap paling lambat 24 jam sebelum jadwal.
            </p>
          </form>
        )}
      </Container>
    </div>
  );
}

function Reschedule({
  session,
  onDone,
  onExpired,
}: {
  session: Session;
  onDone: (b: PublicBookingResult) => void;
  onExpired: (msg: string) => void;
}) {
  const booking = useQuery({
    queryKey: ["spa", "public", "booking", session.token],
    queryFn: () => publicSpaApi.booking(session.token),
  });
  const [now] = useState(() => new Date());
  const today = wibDateOf(now);
  const [date, setDate] = useState(today);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const b = booking.data;
  const slots = usePublicSpaSlots(
    b?.can_reschedule ? b.branch_id : "",
    date,
    (b?.items ?? []).map((i) => i.variant_id),
    b?.therapist_gender_pref ?? "any"
  );

  if (booking.isLoading || !b) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const duration = b.items.reduce((n, i) => n + i.duration_min, 0);
  const current = b.scheduled_at;
  const options = (slots.data ?? [])
    .filter((s) => new Date(s.starts_at).getTime() - now.getTime() >= LEAD_MS && s.starts_at !== current)
    .map((s) => ({ iso: s.starts_at, time: wibClockOf(s.starts_at) }));
  const groups = groupSlots(options);

  const save = async () => {
    if (!slotIso) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await publicSpaApi.changeBooking(session.token, session.grant, "reschedule", slotIso));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Jadwal belum tersimpan.";
      if (/kedaluwarsa|minta kode/i.test(msg)) onExpired("Sesi ubah jadwal sudah habis (15 menit). Cari booking lagi.");
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-card bg-card p-6 shadow-card">
        <p className="font-mono text-sm font-semibold tracking-wider text-body">{b.booking_code}</p>
        <SummaryRow icon={MapPin} label="Toko">
          {b.branch_name}
        </SummaryRow>
        <SummaryRow icon={CalendarDays} label="Jadwal sekarang">
          {formatDateLong(wibDateOf(current))} · {wibClockOf(current)}–{endClock(wibClockOf(current), duration)} WIB
        </SummaryRow>
        <SummaryRow icon={Sparkles} label="Layanan">
          {b.items.map((i) => `${i.treatment_name} (${i.duration_min} menit)`).join(", ")}
        </SummaryRow>
        {b.therapist_name ? (
          <SummaryRow icon={UserRound} label="Crew experience">
            {b.therapist_name}
            <span className="block text-xs font-normal text-muted-foreground">Setelah jadwal diubah, crew experience ditentukan ulang oleh toko.</span>
          </SummaryRow>
        ) : null}
      </div>

      {!b.can_reschedule ? (
        <div className="space-y-3 rounded-card bg-surface p-6">
          <p className="font-semibold">Jadwal booking ini tidak bisa diubah sendiri lagi.</p>
          <p className="text-sm text-body">
            {b.status === "cancelled"
              ? "Booking ini sudah dibatalkan."
              : b.status === "expired" || b.status === "completed" || b.status === "in_treatment"
                ? "Booking ini sudah lewat atau sedang berjalan."
                : "Perubahan mandiri paling lambat 1 jam sebelum jadwal, dan belum dibuka di kasir. Silakan hubungi Paddy Store."}
          </p>
          <Button asChild variant="outline">
            <Link href={`/booking/spa/status/${session.token}`}>Lihat status booking</Link>
          </Button>
        </div>
      ) : (
        <section className="space-y-5 rounded-card bg-card p-6 shadow-card">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-semibold">Pilih jadwal baru</h2>
            <p className="text-sm text-body">Jam yang tampil masih ada crew experience kosong. Semua jam dalam WIB.</p>
          </div>
          <div className="-mx-2 flex snap-x gap-2 overflow-x-auto px-2 pt-1 pb-2 [scrollbar-width:none]">
            {dateStrip(today, STRIP_DAYS).map((d) => {
              const on = d.date === date;
              return (
                <button
                  key={d.date}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setDate(d.date);
                    setSlotIso(null);
                  }}
                  className={cn(
                    "flex w-16 shrink-0 snap-start flex-col items-center rounded-2xl py-2.5 shadow-card transition",
                    on ? "bg-ink text-on-ink" : "bg-background hover:bg-surface"
                  )}
                >
                  <span className={cn("text-[11px] font-semibold uppercase", on ? "text-sunny" : "text-muted-foreground")}>
                    {d.label === "Hari ini" ? "Hari ini" : d.weekday}
                  </span>
                  <span className="font-display text-2xl leading-tight font-bold">{d.day}</span>
                  <span className={cn("text-[11px]", on ? "text-on-ink-muted" : "text-muted-foreground")}>{d.month}</span>
                </button>
              );
            })}
          </div>
          {slots.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-body">Tidak ada jam kosong pada tanggal ini. Coba tanggal lain.</p>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="space-y-2">
                <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{g.label}</p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {g.slots.map((s) => (
                    <button
                      key={s.iso}
                      type="button"
                      aria-pressed={slotIso === s.iso}
                      onClick={() => setSlotIso(s.iso)}
                      className={cn(
                        "h-11 rounded-xl text-sm font-semibold tabular-nums shadow-card transition",
                        slotIso === s.iso ? "bg-ink text-on-ink" : "bg-background hover:bg-surface"
                      )}
                    >
                      {s.time}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
          {slotIso && (
            <p className="flex items-center gap-2 rounded-2xl bg-accent-soft px-4 py-3 text-sm">
              <Clock className="size-4 shrink-0" />
              Jadwal baru: <strong>{formatDateLong(wibDateOf(slotIso))}</strong> · {wibClockOf(slotIso)}–
              {endClock(wibClockOf(slotIso), duration)} WIB
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}
          <Button size="lg" className="w-full" disabled={!slotIso || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : <CalendarClock />} Simpan jadwal baru
          </Button>
        </section>
      )}
    </div>
  );
}

function Done({ booking, token }: { booking: PublicBookingResult; token: string }) {
  const at = booking.scheduled_at;
  const duration = booking.items.reduce((n, i) => n + i.duration_min, 0);
  return (
    <section className="space-y-5 rounded-card bg-card p-6 text-center shadow-card">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Check className="size-7" />
      </span>
      <div className="space-y-1">
        <h2 className="font-display text-2xl font-semibold">Jadwal berhasil diubah</h2>
        <p className="text-body">
          {booking.branch_name} · {formatDateLong(wibDateOf(at))}, {wibClockOf(at)}–{endClock(wibClockOf(at), duration)} WIB
        </p>
        <p className="text-sm text-muted-foreground">
          Kode booking tetap <span className="font-mono font-semibold">{booking.booking_code}</span>. Crew experience ditentukan ulang oleh toko.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild size="lg">
          <Link href={`/booking/spa/status/${token}`}>
            Lihat status & QR <ArrowRight />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/">Kembali ke beranda</Link>
        </Button>
      </div>
    </section>
  );
}
