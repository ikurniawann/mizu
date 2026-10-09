"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  Copy,
  Loader2,
  MapPin,
  MessageCircle,
  Moon,
  Phone,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Wallet,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container, Kicker } from "@/features/site/components/site-section";
import { formatDateLong, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCreatePublicBooking } from "../mutations";
import {
  clampDate,
  dateStrip,
  endClock,
  groupSlots,
  orderedTreatments,
  OTHER_CATEGORY,
  treatmentCategories,
  whatsappHref,
  type BookingPrefill,
  type SlotGroup,
} from "../public-booking";
import { usePublicSpaOutlets, usePublicSpaTreatments } from "../queries";
import { isValidPhone } from "../rules";
import { addDaysToDate, generateSlots, shortClock, wibClockOf, wibDateOf } from "../time";
import type { GenderPref, PublicBookingResult, PublicOutlet, PublicVariant } from "../types";

const MAX_DAYS_AHEAD = 30;
const STRIP_DAYS = 14;
const STEPS = ["outlet", "treatment", "waktu", "kontak"] as const;
type Step = (typeof STEPS)[number];

const STEP_META: Record<Step, { label: string; title: string; hint: string }> = {
  outlet: { label: "Outlet", title: "Mau datang ke outlet mana?", hint: "Dua outlet Mizu di Bandung, buka setiap hari." },
  treatment: { label: "Treatment", title: "Pilih treatment", hint: "Boleh lebih dari satu, mis. massage lalu refleksi kaki." },
  waktu: { label: "Jadwal", title: "Kapan kamu mau datang?", hint: "Semua jam dalam WIB." },
  kontak: { label: "Data diri", title: "Sedikit tentang kamu", hint: "Kami hubungi lewat WhatsApp bila jadwal perlu dikonfirmasi." },
};

const PREF_OPTIONS: { value: GenderPref; label: string }[] = [
  { value: "any", label: "Bebas" },
  { value: "female", label: "Wanita" },
  { value: "male", label: "Pria" },
];

const PERIOD_ICON: Record<SlotGroup["key"], typeof Sun> = { pagi: Sunrise, siang: Sun, sore: Sunset, malam: Moon };

const INPUT =
  "h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:border-accent-strong focus-visible:ring-2 focus-visible:ring-accent/30";

const NO_PREFILL: BookingPrefill = { outlet: null, treatment: null, date: null };

interface Picked {
  variant: PublicVariant;
  treatmentName: string;
}

/**
 * Halaman booking publik Mizu (tanpa login): outlet → treatment → jadwal →
 * data diri → kode booking. Bisa dibuka dengan isian awal dari menu
 * (?outlet=<branch_id>&treatment=<id>&date=YYYY-MM-DD).
 */
export function PublicSpaBookingWizard({ prefill = NO_PREFILL }: { prefill?: BookingPrefill }) {
  const [now, setNow] = useState(() => new Date());
  const today = wibDateOf(now);
  const [wanted, setWanted] = useState<Step>(prefill.outlet ? "treatment" : "outlet");
  const [outletId, setOutletId] = useState<string | null>(prefill.outlet);
  // null = belum disentuh: treatment dari menu (bila ada) langsung terpilih.
  const [pickedIds, setPickedIds] = useState<string[] | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [date, setDate] = useState(() => clampDate(prefill.date, wibDateOf(new Date()), MAX_DAYS_AHEAD));
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pref, setPref] = useState<GenderPref>("any");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicBookingResult | null>(null);
  const top = useRef<HTMLDivElement>(null);

  const outlets = usePublicSpaOutlets();
  const outlet = outlets.data?.find((o) => o.branch_id === outletId) ?? null;
  const treatments = usePublicSpaTreatments(outlet?.branch_id ?? "");
  const create = useCreatePublicBooking();

  // Slot "masa depan" dihitung terhadap jam sekarang; segarkan tiap menit.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const list = useMemo(() => orderedTreatments(treatments.data ?? [], prefill.treatment), [treatments.data, prefill.treatment]);
  const categories = useMemo(() => treatmentCategories(list), [list]);
  const byVariant = useMemo(
    () => new Map(list.flatMap((t) => t.variants.map((v) => [v.id, { variant: v, treatmentName: t.name }] as const))),
    [list]
  );
  const fromMenu = outletId === prefill.outlet ? list.find((t) => t.id === prefill.treatment) : undefined;
  const ids = pickedIds ?? (fromMenu ? [fromMenu.variants[0].id] : []);
  const picked: Picked[] = ids.flatMap((id) => byVariant.get(id) ?? []);

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
  const slotValid = !!slotIso && slots.some((s) => s.iso === slotIso);

  // Langkah yang boleh dibuka; langkah yang diminta mundur sampai yang terpenuhi.
  const reach: Record<Step, boolean> = {
    outlet: true,
    treatment: !!outlet,
    waktu: !!outlet && picked.length > 0,
    kontak: !!outlet && picked.length > 0 && slotValid,
  };
  let step = wanted;
  while (!reach[step]) step = STEPS[STEPS.indexOf(step) - 1];
  // Isian outlet dari URL masih dimuat: tampilkan langkah yang diminta (berisi pemuat).
  const loadingPrefill = !!prefill.outlet && outlets.isLoading && wanted !== "outlet";
  if (loadingPrefill) step = "treatment";

  const go = (next: Step) => {
    setWanted(next);
    setFormError(null);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const chooseOutlet = (o: PublicOutlet) => {
    if (o.branch_id !== outletId) {
      setOutletId(o.branch_id);
      setPickedIds([]);
      setCategory(null);
      setSlotIso(null);
    }
    go("treatment");
  };

  const toggleVariant = (variant: PublicVariant) => {
    setPickedIds(ids.includes(variant.id) ? ids.filter((id) => id !== variant.id) : [...ids, variant.id]);
    setSlotIso(null);
  };

  const submit = () => {
    if (!outlet || picked.length === 0) return;
    if (!slotIso || !slotValid) {
      setFormError("Jam yang dipilih sudah lewat. Silakan pilih jam lain.");
      return go("waktu");
    }
    if (name.trim().length < 2) return setFormError("Isi nama kamu dulu.");
    if (!isValidPhone(phone)) return setFormError("Nomor WhatsApp belum valid, contoh 0812-3456-7890.");
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
        onSuccess: (res) => {
          setResult(res);
          window.scrollTo({ top: 0, behavior: "smooth" });
        },
        onError: (err) => setFormError(err.message),
      }
    );
  };

  const restart = () => {
    setResult(null);
    setPickedIds([]);
    setSlotIso(null);
    setNotes("");
    go("treatment");
  };

  if (result) return <SuccessScreen result={result} outlet={outlet} onAgain={restart} />;

  // Label & status tombol utama dihitung terpisah dari aksinya (aksi menyentuh ref).
  const cta: { label: string; disabled: boolean } =
    step === "outlet"
      ? { label: "Pilih outlet dulu", disabled: true }
      : step === "treatment"
        ? { label: picked.length ? "Lanjut pilih jadwal" : "Pilih treatment dulu", disabled: picked.length === 0 }
        : step === "waktu"
          ? { label: slotValid && slotIso ? `Lanjut · ${wibClockOf(slotIso)} WIB` : "Pilih jam dulu", disabled: !slotValid }
          : { label: create.isPending ? "Mengirim…" : "Konfirmasi booking", disabled: create.isPending };
  const next = () => {
    if (step === "treatment") go("waktu");
    else if (step === "waktu") go("kontak");
    else if (step === "kontak") submit();
  };

  return (
    <div className="bg-background">
      <Hero step={step} reach={reach} onStep={go} />

      <Container className="grid grid-cols-1 gap-8 pt-8 pb-40 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pt-12 lg:pb-20">
        <div ref={top} className="min-w-0 scroll-mt-32 space-y-6">
          <div className="space-y-2">
            <Kicker>
              Langkah {STEPS.indexOf(step) + 1} dari {STEPS.length}
            </Kicker>
            <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{STEP_META[step].title}</h2>
            <p className="text-body">{STEP_META[step].hint}</p>
          </div>

          {step === "outlet" && (
            <OutletStep outlets={outlets} selectedId={outletId} onPick={chooseOutlet} />
          )}

          {step === "treatment" &&
            (loadingPrefill || !outlet ? (
              <Spinner />
            ) : (
              <TreatmentStep
                outlet={outlet}
                loading={treatments.isLoading}
                error={treatments.error?.message ?? null}
                list={list}
                categories={categories}
                category={category}
                onCategory={setCategory}
                pickedIds={ids}
                focusId={fromMenu?.id ?? null}
                onToggle={toggleVariant}
                onChangeOutlet={() => go("outlet")}
              />
            ))}

          {step === "waktu" && outlet && (
            <TimeStep
              outlet={outlet}
              today={today}
              date={date}
              onDate={(d) => {
                setDate(d);
                setSlotIso(null);
              }}
              slots={slots}
              slotIso={slotValid ? slotIso : null}
              onSlot={setSlotIso}
              totalDuration={totalDuration}
            />
          )}

          {step === "kontak" && outlet && slotIso && (
            <div className="space-y-5">
              <div className="lg:hidden">
                <Summary outlet={outlet} slotIso={slotIso} picked={picked} totalDuration={totalDuration} total={totalPrice} />
              </div>
              <div className="space-y-5 rounded-card bg-card p-5 shadow-card md:p-6">
                <Field label="Nama lengkap">
                  <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Nama kamu" />
                </Field>
                <Field label="Nomor WhatsApp" hint="Untuk konfirmasi jadwal. Tidak kami pakai untuk spam.">
                  <input
                    className={INPUT}
                    value={phone}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0812-3456-7890"
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">Preferensi terapis</legend>
                  <div className="grid grid-cols-3 gap-2 rounded-2xl bg-surface p-1">
                    {PREF_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={pref === o.value}
                        onClick={() => setPref(o.value)}
                        className={cn(
                          "h-11 rounded-xl text-sm font-semibold transition",
                          pref === o.value ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <Field label="Catatan untuk terapis" optional>
                  <textarea
                    className={cn(INPUT, "h-auto min-h-24 py-3")}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Keluhan, area yang ingin difokuskan, tekanan yang disukai…"
                  />
                </Field>
                {formError && <ErrorNote>{formError}</ErrorNote>}
                <p className="text-xs text-muted-foreground">
                  Dengan menekan Konfirmasi booking, kamu setuju dihubungi tim Mizu lewat WhatsApp terkait jadwal ini.
                </p>
              </div>
            </div>
          )}
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-28 space-y-3">
            <Summary
              outlet={outlet}
              slotIso={slotValid ? slotIso : null}
              picked={picked}
              totalDuration={totalDuration}
              total={totalPrice}
              onRemove={step === "treatment" ? toggleVariant : undefined}
            />
            <Button size="lg" className="w-full" disabled={cta.disabled} onClick={next}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              {cta.label}
              {!cta.disabled && !create.isPending ? <ArrowRight /> : null}
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Wallet className="size-3.5" /> Bayar di outlet setelah treatment
            </p>
          </div>
        </aside>
      </Container>

      {/* Bilah aksi ponsel */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          {step === "outlet" ? (
            <p className="flex-1 text-center text-sm text-muted-foreground">Pilih outlet untuk mulai · bayar di outlet</p>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-muted-foreground">
                  {picked.length ? `${picked.length} treatment · ${totalDuration} menit` : (outlet?.name ?? "")}
                </p>
                <p className="font-display text-lg font-bold tabular-nums">{formatRupiah(totalPrice)}</p>
              </div>
              <Button size="lg" disabled={cta.disabled} onClick={next}>
                {create.isPending ? <Loader2 className="animate-spin" /> : null}
                {step === "kontak" ? (create.isPending ? "Mengirim…" : "Konfirmasi") : "Lanjut"}
                {!cta.disabled && !create.isPending ? <ArrowRight /> : null}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Hero & langkah ───────────────────────────────────────────────────────────

function Hero({ step, reach, onStep }: { step: Step; reach: Record<Step, boolean>; onStep: (s: Step) => void }) {
  const current = STEPS.indexOf(step);
  return (
    <section className="relative isolate overflow-hidden bg-ink text-on-ink">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mizu-wallpaper.webp" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover object-center" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-ink via-ink/85 to-ink/40" />
      <Container className="space-y-8 pt-12 pb-8 md:pt-16">
        <div className="max-w-2xl space-y-4">
          <Kicker onInk>Booking online · Mizu Family Massage &amp; Reflexology</Kicker>
          <h1 className="font-display text-4xl font-bold tracking-tight text-balance md:text-5xl">Waktunya istirahat sejenak.</h1>
          <p className="max-w-xl text-on-ink-muted md:text-lg">
            Pilih outlet, treatment dan jam yang pas. Tanpa deposit, pembayaran langsung di outlet setelah treatment.
          </p>
          <ul className="flex flex-wrap gap-2 pt-1 text-xs font-medium text-on-ink">
            {[
              { icon: Wallet, text: "Bayar di outlet" },
              { icon: Sparkles, text: "Kode booking langsung" },
              { icon: UserRound, text: "Pilih terapis pria / wanita" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 backdrop-blur">
                <Icon className="size-3.5 text-accent" /> {text}
              </li>
            ))}
          </ul>
        </div>

        <ol className="grid grid-cols-4 gap-2 border-t border-white/10 pt-5">
          {STEPS.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s}>
                <button
                  type="button"
                  disabled={!reach[s] || active}
                  onClick={() => onStep(s)}
                  aria-current={active ? "step" : undefined}
                  className="group flex w-full flex-col items-start gap-2 text-left disabled:cursor-default"
                >
                  <span
                    className={cn(
                      "h-1 w-full rounded-full transition-colors",
                      active ? "bg-accent" : done ? "bg-accent/60" : "bg-white/15"
                    )}
                  />
                  <span className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        active ? "bg-accent text-ink" : done ? "bg-accent/25 text-accent" : "bg-white/10 text-on-ink-muted"
                      )}
                    >
                      {done ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    <span
                      className={cn(
                        "hidden font-medium sm:inline",
                        active ? "text-on-ink" : done ? "text-on-ink group-hover:underline" : "text-on-ink-muted"
                      )}
                    >
                      {STEP_META[s].label}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </Container>
    </section>
  );
}

// ── Langkah 1: outlet ────────────────────────────────────────────────────────

function OutletStep({
  outlets,
  selectedId,
  onPick,
}: {
  outlets: { isLoading: boolean; error: Error | null; data?: PublicOutlet[] };
  selectedId: string | null;
  onPick: (o: PublicOutlet) => void;
}) {
  if (outlets.isLoading) return <Spinner />;
  if (outlets.error) return <ErrorNote>{outlets.error.message}</ErrorNote>;
  const rows = outlets.data ?? [];
  if (rows.length === 0) return <ErrorNote>Booking online sedang tidak tersedia. Silakan hubungi outlet langsung.</ErrorNote>;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {rows.map((o) => {
        const on = o.branch_id === selectedId;
        return (
          <button
            key={o.branch_id}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(o)}
            className={cn(
              "group flex flex-col overflow-hidden rounded-card bg-card text-left shadow-card ring-2 transition hover:-translate-y-0.5 hover:shadow-float focus-visible:outline-none focus-visible:ring-accent",
              on ? "ring-accent-strong" : "ring-transparent"
            )}
          >
            <div className="relative h-28 overflow-hidden bg-ink">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/pattern.png" alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 transition group-hover:scale-105" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/mark-white.png" alt="" className="absolute bottom-4 left-5 size-10 opacity-90" />
              <span className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-on-ink backdrop-blur">
                <Clock className="size-3.5 text-accent" />
                {shortClock(o.open_time)}–{shortClock(o.close_time)}
              </span>
              {on && (
                <span className="absolute right-4 bottom-4 flex size-7 items-center justify-center rounded-full bg-accent text-ink">
                  <Check className="size-4" />
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-5">
              <h3 className="font-display text-xl font-semibold">{o.name}</h3>
              {(o.address || o.city) && (
                <p className="flex items-start gap-1.5 text-sm text-body">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  {[o.address, o.city].filter(Boolean).join(", ")}
                </p>
              )}
              {o.phone && (
                <p className="flex items-center gap-1.5 text-sm text-body">
                  <Phone className="size-4 shrink-0 text-muted-foreground" />
                  {o.phone}
                </p>
              )}
              <span className="mt-auto flex items-center gap-1 pt-2 text-sm font-semibold text-forest dark:text-accent">
                {on ? "Outlet dipilih" : "Pilih outlet ini"} <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Langkah 2: treatment ─────────────────────────────────────────────────────

function TreatmentStep({
  outlet,
  loading,
  error,
  list,
  categories,
  category,
  onCategory,
  pickedIds,
  focusId,
  onToggle,
  onChangeOutlet,
}: {
  outlet: PublicOutlet;
  loading: boolean;
  error: string | null;
  list: ReturnType<typeof orderedTreatments>;
  categories: string[];
  category: string | null;
  onCategory: (c: string | null) => void;
  pickedIds: string[];
  focusId: string | null;
  onToggle: (v: PublicVariant) => void;
  onChangeOutlet: () => void;
}) {
  const shown = category ? list.filter((t) => (t.category?.trim() || OTHER_CATEGORY) === category) : list;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 text-sm">
        <span className="flex items-center gap-2">
          <MapPin className="size-4 text-forest dark:text-accent" />
          Harga di <strong className="font-semibold">{outlet.name}</strong>
        </span>
        <button type="button" onClick={onChangeOutlet} className="font-semibold text-forest hover:underline dark:text-accent">
          Ganti outlet
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : list.length === 0 ? (
        <ErrorNote>Belum ada treatment yang bisa dipesan di outlet ini.</ErrorNote>
      ) : (
        <>
          {categories.length > 1 && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
              {[null, ...categories].map((c) => (
                <button
                  key={c ?? "all"}
                  type="button"
                  aria-pressed={category === c}
                  onClick={() => onCategory(c)}
                  className={cn(
                    "h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition",
                    category === c ? "bg-ink text-on-ink" : "bg-card text-body shadow-card hover:text-foreground"
                  )}
                >
                  {c ?? "Semua"}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {shown.map((t) => {
              const chosen = t.variants.some((v) => pickedIds.includes(v.id));
              return (
                <article
                  key={t.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-card bg-card p-5 shadow-card ring-2 transition",
                    chosen ? "ring-accent-strong" : "ring-transparent"
                  )}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-accent">
                        {t.category?.trim() || OTHER_CATEGORY}
                      </p>
                      {t.id === focusId && (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-foreground">Dari menu</span>
                      )}
                    </div>
                    <h3 className="font-display text-xl font-semibold">{t.name}</h3>
                    {t.description && <p className="line-clamp-3 text-sm text-body">{t.description}</p>}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2 pt-1">
                    {t.variants.map((v) => {
                      const on = pickedIds.includes(v.id);
                      return (
                        <button
                          key={v.id}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${t.name} ${v.duration_min} menit ${formatRupiah(v.price_idr)}`}
                          onClick={() => onToggle(v)}
                          className={cn(
                            "flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition",
                            on ? "border-ink bg-ink text-on-ink" : "border-border bg-background hover:border-foreground/40"
                          )}
                        >
                          {on ? <Check className="size-4 text-accent" /> : <Clock className="size-4 text-muted-foreground" />}
                          <span className="font-medium">{v.duration_min} mnt</span>
                          <span className={cn("tabular-nums", on ? "text-on-ink-muted" : "text-muted-foreground")}>
                            {formatRupiah(v.price_idr)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Langkah 3: jadwal ────────────────────────────────────────────────────────

function TimeStep({
  outlet,
  today,
  date,
  onDate,
  slots,
  slotIso,
  onSlot,
  totalDuration,
}: {
  outlet: PublicOutlet;
  today: string;
  date: string;
  onDate: (d: string) => void;
  slots: { time: string; iso: string }[];
  slotIso: string | null;
  onSlot: (iso: string) => void;
  totalDuration: number;
}) {
  const strip = dateStrip(today, STRIP_DAYS);
  const inStrip = strip.some((d) => d.date === date);
  const picker = useRef<HTMLInputElement>(null);
  const groups = groupSlots(slots);
  const selected = slots.find((s) => s.iso === slotIso);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">Tanggal</h3>
          <p className="text-sm text-body">{formatDateLong(date)}</p>
        </div>
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pt-1 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
          {strip.map((d) => {
            const on = d.date === date;
            return (
              <button
                key={d.date}
                type="button"
                aria-pressed={on}
                aria-label={`${d.weekday} ${d.day} ${d.month}`}
                onClick={() => onDate(d.date)}
                className={cn(
                  "flex w-16 shrink-0 snap-start flex-col items-center rounded-2xl py-2.5 transition",
                  on ? "bg-ink text-on-ink shadow-card" : "bg-card text-foreground shadow-card hover:bg-surface"
                )}
              >
                <span className={cn("text-[11px] font-semibold uppercase", on ? "text-accent" : "text-muted-foreground")}>
                  {d.label === "Hari ini" ? "Hari ini" : d.weekday}
                </span>
                <span className="font-display text-2xl leading-tight font-bold">{d.day}</span>
                <span className={cn("text-[11px]", on ? "text-on-ink-muted" : "text-muted-foreground")}>{d.month}</span>
              </button>
            );
          })}
          <label
            className={cn(
              "relative flex w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl px-2 text-center text-[11px] font-semibold transition",
              inStrip ? "bg-card text-body shadow-card hover:bg-surface" : "bg-ink text-on-ink"
            )}
            onClick={(e) => {
              e.preventDefault();
              try {
                picker.current?.showPicker();
              } catch {
                picker.current?.focus();
              }
            }}
          >
            <CalendarDays className="size-5" />
            {inStrip ? "Tanggal lain" : formatDateLong(date).split(",").pop()?.trim()}
            <input
              ref={picker}
              type="date"
              className="sr-only"
              aria-label="Pilih tanggal lain"
              value={date}
              min={today}
              max={addDaysToDate(today, MAX_DAYS_AHEAD)}
              onChange={(e) => e.target.value && onDate(clampDate(e.target.value, today, MAX_DAYS_AHEAD))}
            />
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">Jam mulai</h3>
          <p className="text-xs text-muted-foreground">
            Outlet buka {shortClock(outlet.open_time)}–{shortClock(outlet.close_time)} · durasi {totalDuration} menit
          </p>
        </div>
        {groups.length === 0 ? (
          <ErrorNote tone="muted">Tidak ada jam tersisa pada tanggal ini. Coba tanggal lain.</ErrorNote>
        ) : (
          groups.map((g) => {
            const Icon = PERIOD_ICON[g.key];
            return (
              <div key={g.key} className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  <Icon className="size-4" /> {g.label}
                </p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8">
                  {g.slots.map((s) => (
                    <button
                      key={s.iso}
                      type="button"
                      aria-pressed={slotIso === s.iso}
                      onClick={() => onSlot(s.iso)}
                      className={cn(
                        "h-11 rounded-xl text-sm font-semibold tabular-nums transition",
                        slotIso === s.iso ? "bg-ink text-on-ink shadow-card" : "bg-card text-foreground shadow-card hover:bg-surface"
                      )}
                    >
                      {s.time}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {selected ? (
        <div className="flex items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-sm">
          <Clock className="size-5 shrink-0 text-forest dark:text-accent" />
          <p>
            <strong className="font-semibold">
              {selected.time}–{endClock(selected.time, totalDuration)} WIB
            </strong>{" "}
            · {formatDateLong(date)}. Terapis ditentukan outlet sesuai preferensimu.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Terapis ditentukan outlet sesuai preferensimu. Datang 10 menit lebih awal ya.</p>
      )}
    </div>
  );
}

// ── Ringkasan ────────────────────────────────────────────────────────────────

function Summary({
  outlet,
  slotIso,
  picked,
  totalDuration,
  total,
  onRemove,
}: {
  outlet: PublicOutlet | null;
  slotIso: string | null;
  picked: Picked[];
  totalDuration: number;
  total: number;
  onRemove?: (v: PublicVariant) => void;
}) {
  return (
    <div className="overflow-hidden rounded-card bg-card shadow-card">
      <div className="relative overflow-hidden bg-ink px-5 py-4 text-on-ink">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/pattern.png" alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />
        <p className="relative text-xs font-semibold tracking-wider text-accent uppercase">Ringkasan booking</p>
        <p className="relative font-display text-lg font-semibold">{outlet?.name ?? "Belum pilih outlet"}</p>
      </div>
      <div className="space-y-4 p-5 text-sm">
        <SummaryRow icon={CalendarDays} label="Jadwal">
          {slotIso ? (
            <>
              {formatDateLong(wibDateOf(slotIso))}
              <span className="block text-body">
                {wibClockOf(slotIso)}–{endClock(wibClockOf(slotIso), totalDuration)} WIB
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Belum dipilih</span>
          )}
        </SummaryRow>
        <SummaryRow icon={Sparkles} label="Treatment">
          {picked.length === 0 ? (
            <span className="text-muted-foreground">Belum dipilih</span>
          ) : (
            <ul className="space-y-1.5">
              {picked.map((p) => (
                <li key={p.variant.id} className="flex items-start justify-between gap-3">
                  <span>
                    {p.treatmentName}
                    <span className="block text-xs text-muted-foreground">{p.variant.duration_min} menit</span>
                  </span>
                  <span className="flex items-center gap-1.5 tabular-nums">
                    {formatRupiah(p.variant.price_idr)}
                    {onRemove && (
                      <button
                        type="button"
                        aria-label={`Hapus ${p.treatmentName}`}
                        onClick={() => onRemove(p.variant)}
                        className="rounded-full px-1 text-muted-foreground hover:text-danger"
                      >
                        ×
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SummaryRow>
        <div className="flex items-end justify-between border-t border-dashed border-border pt-4">
          <span className="text-body">
            Total
            {totalDuration ? <span className="block text-xs text-muted-foreground">{totalDuration} menit</span> : null}
          </span>
          <span className="font-display text-2xl font-bold tabular-nums">{formatRupiah(total)}</span>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ icon: Icon, label, children }: { icon: typeof Sun; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface">
        <Icon className="size-4 text-forest dark:text-accent" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
        <div className="mt-0.5 font-medium">{children}</div>
      </div>
    </div>
  );
}

// ── Berhasil ─────────────────────────────────────────────────────────────────

function SuccessScreen({
  result,
  outlet,
  onAgain,
}: {
  result: PublicBookingResult;
  outlet: PublicOutlet | null;
  onAgain: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const when = `${formatDateLong(wibDateOf(result.scheduled_at))} pukul ${wibClockOf(result.scheduled_at)} WIB`;
  const wa = whatsappHref(outlet?.phone, `Halo Mizu, saya sudah booking dengan kode ${result.booking_code} untuk ${when}.`);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.booking_code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="bg-background pb-20">
      <section className="relative isolate overflow-hidden bg-ink text-on-ink">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mizu-wallpaper.webp" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-ink/70" />
        <Container className="flex flex-col items-center gap-4 py-14 text-center md:py-20">
          <span className="flex size-16 items-center justify-center rounded-full bg-accent text-ink">
            <Check className="size-8" />
          </span>
          <Kicker onInk>Booking diterima</Kicker>
          <h1 className="font-display text-4xl font-bold tracking-tight text-balance md:text-5xl">Sampai jumpa di {result.branch_name}!</h1>
          <p className="max-w-lg text-on-ink-muted">Tunjukkan kode booking ini ke resepsionis saat tiba. Datang 10 menit lebih awal ya.</p>
          <button
            type="button"
            onClick={() => void copy()}
            className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-dashed border-accent/60 bg-white/5 px-6 py-4 font-mono text-3xl font-bold tracking-widest backdrop-blur transition select-all hover:bg-white/10"
          >
            {result.booking_code}
            <span className="flex items-center gap-1 font-sans text-xs font-semibold tracking-normal text-accent">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Tersalin" : "Salin"}
            </span>
          </button>
        </Container>
      </section>

      <Container className="mt-8 max-w-2xl space-y-4">
        <div className="space-y-4 rounded-card bg-card p-6 shadow-card">
          <SummaryRow icon={MapPin} label="Outlet">
            {result.branch_name}
            {outlet && (outlet.address || outlet.city) ? (
              <span className="block font-normal text-body">{[outlet.address, outlet.city].filter(Boolean).join(", ")}</span>
            ) : null}
          </SummaryRow>
          <SummaryRow icon={CalendarDays} label="Jadwal">
            {when}
          </SummaryRow>
          <SummaryRow icon={Sparkles} label="Treatment">
            <ul className="space-y-1.5">
              {result.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    {item.treatment_name}
                    <span className="block text-xs font-normal text-muted-foreground">{item.duration_min} menit</span>
                  </span>
                  <span className="tabular-nums">{formatRupiah(item.price_idr)}</span>
                </li>
              ))}
            </ul>
          </SummaryRow>
          <div className="flex items-end justify-between border-t border-dashed border-border pt-4">
            <span className="text-body">Total · bayar di outlet</span>
            <span className="font-display text-2xl font-bold tabular-nums">{formatRupiah(result.total_idr)}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          {wa && (
            <Button asChild size="lg" className="flex-1">
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle /> Chat outlet di WhatsApp
              </a>
            </Button>
          )}
          <Button size="lg" variant="outline" className="flex-1" onClick={onAgain}>
            Booking lagi
          </Button>
          <Button asChild size="lg" variant="ghost" className="flex-1">
            <Link href="/">Kembali ke beranda</Link>
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Perlu ubah jadwal atau batal? Hubungi outlet{outlet?.phone ? ` di ${outlet.phone}` : ""} dengan menyebut kode booking.
        </p>
      </Container>
    </div>
  );
}

// ── Kecil-kecil ──────────────────────────────────────────────────────────────

function Field({ label, hint, optional, children }: { label: string; hint?: string; optional?: boolean; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between gap-2 text-sm font-semibold">
        {label}
        {optional ? <span className="text-xs font-normal text-muted-foreground">opsional</span> : null}
      </span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorNote({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "muted" }) {
  return (
    <p
      role={tone === "danger" ? "alert" : undefined}
      className={cn(
        "rounded-2xl px-4 py-3 text-sm",
        tone === "danger" ? "bg-danger-soft text-danger" : "bg-card text-body shadow-card"
      )}
    >
      {children}
    </p>
  );
}
