"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check, CheckCircle2, Clock, Loader2, MapPin, Phone } from "lucide-react";
import { formatDateLong, formatRupiah, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCreatePublicBooking } from "../mutations";
import { usePublicSpaOutlets, usePublicSpaTreatments } from "../queries";
import { GENDER_PREF_LABEL, isValidPhone } from "../rules";
import { addDaysToDate, generateSlots, shortClock, wibDateOf } from "../time";
import type { GenderPref, PublicBookingResult, PublicOutlet, PublicVariant } from "../types";

const BRAND = "Mizu";
const MAX_DAYS_AHEAD = 30;
const STEPS = ["outlet", "treatment", "waktu", "kontak"] as const;
type Step = (typeof STEPS)[number];
const STEP_LABEL: Record<Step, string> = {
  outlet: "Outlet",
  treatment: "Treatment",
  waktu: "Waktu",
  kontak: "Data diri",
};

const INPUT =
  "h-12 w-full rounded-xl border border-border bg-card px-4 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-forest focus-visible:ring-2 focus-visible:ring-forest/20";
const CTA =
  "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent-strong text-[15px] font-semibold text-accent-foreground transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50";

interface Picked {
  variant: PublicVariant;
  treatmentName: string;
}

/** Booking spa publik tanpa login: outlet → treatment → tanggal & jam (WIB) → data diri → kode booking. */
export function PublicSpaBookingWizard() {
  const [step, setStep] = useState<Step>("outlet");
  const [outlet, setOutlet] = useState<PublicOutlet | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [today, setToday] = useState(() => wibDateOf(new Date()));
  const [now, setNow] = useState(() => new Date());
  const [date, setDate] = useState(today);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pref, setPref] = useState<GenderPref>("any");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicBookingResult | null>(null);

  const outlets = usePublicSpaOutlets();
  const treatments = usePublicSpaTreatments(outlet?.branch_id ?? "");
  const create = useCreatePublicBooking();

  // Slot "masa depan" dihitung terhadap jam sekarang; segarkan tiap menit.
  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setNow(d);
      setToday(wibDateOf(d));
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const totalDuration = picked.reduce((sum, p) => sum + p.variant.duration_min, 0);
  const totalPrice = picked.reduce((sum, p) => sum + p.variant.price_idr, 0);
  const slots = useMemo(
    () =>
      outlet
        ? generateSlots({
            date,
            open_time: outlet.open_time,
            close_time: outlet.close_time,
            slot_minutes: outlet.slot_minutes,
            duration_min: totalDuration,
            now,
          })
        : [],
    [outlet, date, totalDuration, now]
  );
  const slotStillValid = !!slotIso && slots.some((s) => s.iso === slotIso);
  const stepIndex = STEPS.indexOf(step);

  const back = () => {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1]);
  };

  const toggleVariant = (variant: PublicVariant, treatmentName: string) =>
    setPicked((rows) =>
      rows.some((r) => r.variant.id === variant.id)
        ? rows.filter((r) => r.variant.id !== variant.id)
        : [...rows, { variant, treatmentName }]
    );

  const submit = () => {
    if (!outlet || !slotIso || picked.length === 0) return;
    if (!slotStillValid) {
      setFormError("Jam yang dipilih sudah lewat. Silakan pilih jam lain.");
      setStep("waktu");
      return;
    }
    if (name.trim().length < 2) return setFormError("Isi nama Anda.");
    if (!isValidPhone(phone)) return setFormError("Nomor HP/WhatsApp tidak valid.");
    setFormError(null);
    create.mutate(
      {
        branch_id: outlet.branch_id,
        scheduled_at: slotIso,
        customer_name: name.trim(),
        customer_phone: phone.replace(/[\s-]/g, ""),
        therapist_gender_pref: pref,
        notes: notes.trim(),
        variant_ids: picked.map((p) => p.variant.id),
      },
      {
        onSuccess: (res) => setResult(res),
        onError: (err) => setFormError(err.message),
      }
    );
  };

  if (result) return <SuccessScreen result={result} outlet={outlet} />;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-card text-foreground md:max-w-2xl">
      <header className="sticky top-0 z-20 bg-card/95 px-5 pt-4 pb-3 backdrop-blur">
        <div className="flex h-9 items-center gap-2">
          {stepIndex > 0 && (
            <button
              type="button"
              aria-label="Kembali"
              onClick={back}
              className="-ml-2 flex size-9 items-center justify-center rounded-full hover:bg-surface"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          <p className="text-lg font-bold tracking-tight">{BRAND}</p>
          <span className="ml-auto text-xs text-muted-foreground">
            Langkah {stepIndex + 1}/{STEPS.length} · {STEP_LABEL[step]}
          </span>
        </div>
        <div className="mt-3 flex gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className={cn("h-[3px] flex-1 rounded-full", i <= stepIndex ? "bg-foreground" : "bg-border")} />
          ))}
        </div>
      </header>

      <main className="flex-1 space-y-4 px-5 pt-2 pb-32">
        {step === "outlet" && (
          <section className="space-y-3">
            <h1 className="text-2xl font-bold">Booking spa {BRAND}</h1>
            <p className="text-sm text-muted-foreground">Pilih outlet yang ingin Anda kunjungi.</p>
            {outlets.isLoading ? (
              <Spinner />
            ) : outlets.error ? (
              <ErrorNote>{outlets.error.message}</ErrorNote>
            ) : (outlets.data ?? []).length === 0 ? (
              <ErrorNote>Booking online sedang tidak tersedia.</ErrorNote>
            ) : (
              (outlets.data ?? []).map((o) => (
                <button
                  key={o.branch_id}
                  type="button"
                  onClick={() => {
                    if (outlet?.branch_id !== o.branch_id) {
                      setPicked([]);
                      setSlotIso(null);
                    }
                    setOutlet(o);
                    setStep("treatment");
                  }}
                  className={cn(
                    "w-full rounded-2xl border p-4 text-left transition-colors hover:bg-surface",
                    outlet?.branch_id === o.branch_id ? "border-foreground" : "border-border"
                  )}
                >
                  <p className="font-semibold">{o.name}</p>
                  {(o.address || o.city) && (
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="mt-0.5 size-4 shrink-0" />
                      {[o.address, o.city].filter(Boolean).join(", ")}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="size-4 shrink-0" />
                    {shortClock(o.open_time)}–{shortClock(o.close_time)} WIB
                    {o.phone ? (
                      <>
                        <Phone className="ml-2 size-4 shrink-0" />
                        {o.phone}
                      </>
                    ) : null}
                  </p>
                </button>
              ))
            )}
          </section>
        )}

        {step === "treatment" && outlet && (
          <section className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold">Pilih treatment</h1>
              <p className="text-sm text-muted-foreground">{outlet.name} · boleh pilih lebih dari satu.</p>
            </div>
            {treatments.isLoading ? (
              <Spinner />
            ) : treatments.error ? (
              <ErrorNote>{treatments.error.message}</ErrorNote>
            ) : (treatments.data ?? []).length === 0 ? (
              <ErrorNote>Belum ada treatment yang bisa dipesan di outlet ini.</ErrorNote>
            ) : (
              (treatments.data ?? []).map((t) => (
                <div key={t.id} className="rounded-2xl border border-border p-4">
                  <p className="font-semibold">{t.name}</p>
                  {t.category && <p className="text-xs tracking-wide text-muted-foreground uppercase">{t.category}</p>}
                  {t.description && <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>}
                  <div className="mt-3 space-y-2">
                    {t.variants.map((v) => {
                      const on = picked.some((p) => p.variant.id === v.id);
                      return (
                        <button
                          key={v.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleVariant(v, t.name)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                            on ? "border-foreground bg-surface-2" : "border-border hover:bg-surface"
                          )}
                        >
                          <span className="flex items-center gap-3">
                            <span
                              className={cn(
                                "flex size-5 items-center justify-center rounded-md border",
                                on ? "border-foreground bg-foreground text-card" : "border-border"
                              )}
                            >
                              {on && <Check className="size-3.5" />}
                            </span>
                            <span>
                              <span className="font-medium">{v.name}</span>
                              <span className="block text-xs text-muted-foreground">{v.duration_min} menit</span>
                            </span>
                          </span>
                          <span className="font-semibold tabular-nums">{formatRupiah(v.price_idr)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </section>
        )}

        {step === "waktu" && outlet && (
          <section className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold">Pilih tanggal & jam</h1>
              <p className="text-sm text-muted-foreground">
                Waktu dalam WIB. Total durasi {totalDuration} menit; outlet buka {shortClock(outlet.open_time)}–
                {shortClock(outlet.close_time)}.
              </p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Tanggal</span>
              <input
                type="date"
                className={INPUT}
                value={date}
                min={today}
                max={addDaysToDate(today, MAX_DAYS_AHEAD)}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setDate(e.target.value < today ? today : e.target.value);
                  setSlotIso(null);
                }}
              />
            </label>
            <p className="text-sm font-medium">{formatDateLong(date)}</p>
            {slots.length === 0 ? (
              <ErrorNote>Tidak ada jam tersedia pada tanggal ini. Coba tanggal lain.</ErrorNote>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {slots.map((s) => (
                  <button
                    key={s.iso}
                    type="button"
                    aria-pressed={slotIso === s.iso}
                    onClick={() => setSlotIso(s.iso)}
                    className={cn(
                      "h-11 rounded-xl border text-sm font-medium tabular-nums transition-colors",
                      slotIso === s.iso ? "border-foreground bg-foreground text-card" : "border-border hover:bg-surface"
                    )}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Terapis akan ditentukan oleh outlet. Jadwal final dikonfirmasi resepsionis bila diperlukan.
            </p>
          </section>
        )}

        {step === "kontak" && outlet && slotIso && (
          <section className="space-y-4">
            <h1 className="text-2xl font-bold">Data diri</h1>
            <Summary outletName={outlet.name} slotIso={slotIso} picked={picked} total={totalPrice} />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Nama</span>
              <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Nomor HP / WhatsApp</span>
              <input
                className={INPUT}
                value={phone}
                inputMode="tel"
                autoComplete="tel"
                placeholder="08…"
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Preferensi terapis</legend>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(GENDER_PREF_LABEL) as GenderPref[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={pref === g}
                    onClick={() => setPref(g)}
                    className={cn(
                      "h-11 rounded-xl border text-sm font-medium",
                      pref === g ? "border-foreground bg-foreground text-card" : "border-border hover:bg-surface"
                    )}
                  >
                    {g === "any" ? "Bebas" : g === "male" ? "Pria" : "Wanita"}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Catatan (opsional)</span>
              <textarea
                className={cn(INPUT, "h-auto min-h-24 py-3")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Keluhan, area fokus, atau permintaan khusus"
              />
            </label>
            {formError && <ErrorNote>{formError}</ErrorNote>}
          </section>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto w-full max-w-lg px-5 py-3 md:max-w-2xl">
          {step === "treatment" && (
            <>
              <p className="mb-2 flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {picked.length} treatment · {totalDuration} menit
                </span>
                <span className="font-semibold tabular-nums">{formatRupiah(totalPrice)}</span>
              </p>
              <button type="button" className={CTA} disabled={picked.length === 0} onClick={() => setStep("waktu")}>
                Lanjut pilih waktu
              </button>
            </>
          )}
          {step === "waktu" && (
            <button
              type="button"
              className={CTA}
              disabled={!slotStillValid}
              onClick={() => {
                setFormError(null);
                setStep("kontak");
              }}
            >
              {slotStillValid && slotIso ? `Lanjut · ${formatTime(slotIso)} WIB` : "Pilih jam dulu"}
            </button>
          )}
          {step === "kontak" && (
            <button type="button" className={CTA} disabled={create.isPending} onClick={submit}>
              {create.isPending ? <Loader2 className="size-5 animate-spin" /> : null}
              {create.isPending ? "Mengirim…" : `Booking sekarang · ${formatRupiah(totalPrice)}`}
            </button>
          )}
          {step === "outlet" && <p className="py-3 text-center text-xs text-muted-foreground">Pembayaran dilakukan di outlet.</p>}
        </div>
      </footer>
    </div>
  );
}

function Summary({
  outletName,
  slotIso,
  picked,
  total,
}: {
  outletName: string;
  slotIso: string;
  picked: Picked[];
  total: number;
}) {
  return (
    <div className="rounded-2xl bg-surface-2 p-4 text-sm">
      <p className="font-semibold">{outletName}</p>
      <p className="text-muted-foreground">
        {formatDateLong(slotIso)} · {formatTime(slotIso)} WIB
      </p>
      <ul className="mt-2 space-y-1">
        {picked.map((p) => (
          <li key={p.variant.id} className="flex justify-between gap-3">
            <span>
              {p.treatmentName} — {p.variant.name}
            </span>
            <span className="tabular-nums">{formatRupiah(p.variant.price_idr)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatRupiah(total)}</span>
      </p>
    </div>
  );
}

function SuccessScreen({ result, outlet }: { result: PublicBookingResult; outlet: PublicOutlet | null }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center bg-card px-5 py-12 text-center text-foreground">
      <p className="text-lg font-bold tracking-tight">{BRAND}</p>
      <CheckCircle2 className="mt-8 size-16 text-success" />
      <h1 className="mt-4 text-2xl font-bold">Booking diterima</h1>
      <p className="mt-1 text-sm text-muted-foreground">Tunjukkan kode ini ke resepsionis saat tiba.</p>
      <p className="mt-6 rounded-2xl border-2 border-dashed border-border px-6 py-4 font-mono text-3xl font-bold tracking-widest select-all">
        {result.booking_code}
      </p>
      <div className="mt-6 w-full rounded-2xl bg-surface-2 p-4 text-left text-sm">
        <p className="font-semibold">{result.branch_name}</p>
        <p className="text-muted-foreground">
          {formatDateLong(result.scheduled_at)} · {formatTime(result.scheduled_at)} WIB
        </p>
        <ul className="mt-2 space-y-1">
          {result.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>
                {item.treatment_name} — {item.variant_name} ({item.duration_min} mnt)
              </span>
              <span className="tabular-nums">{formatRupiah(item.price_idr)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatRupiah(result.total_idr)}</span>
        </p>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Pembayaran dilakukan di outlet setelah treatment.
        {outlet?.phone ? ` Perlu mengubah jadwal? Hubungi ${outlet.phone}.` : ""}
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
      {children}
    </p>
  );
}
