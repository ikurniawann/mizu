"use client";

import { ROOM_CATEGORY_LABEL } from "../rooms";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  CreditCard,
  DoorOpen,
  QrCode,
  Loader2,
  MapPin,
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
  type BookingPrefill,
  type SlotGroup,
} from "../public-booking";
import { resetBookingFunnel, trackBookingStep } from "../booking-funnel";
import { publicSpaApi } from "../api";
import { usePublicSpaOutlets, usePublicSpaRooms, usePublicSpaSlots, usePublicSpaTherapists, usePublicSpaTreatments } from "../queries";
import { isValidPhone } from "../rules";
import { addDaysToDate, shortClock, wibClockOf, wibDateOf } from "../time";
import type { GenderPref, PublicOutlet, PublicPaymentMethod, PublicRoom, PublicTherapist, PublicVariant } from "../types";

const MAX_DAYS_AHEAD = 30;
const STRIP_DAYS = 14;
const STEPS = ["outlet", "treatment", "waktu", "kontak"] as const;
type Step = (typeof STEPS)[number];

const STEP_META: Record<Step, { label: string; title: string; hint: string }> = {
  outlet: { label: "Outlet", title: "Mau datang ke outlet mana?", hint: "Dua outlet Mizu di Bandung, buka setiap hari." },
  treatment: { label: "Treatment", title: "Pilih treatment", hint: "Boleh lebih dari satu, mis. massage lalu refleksi kaki." },
  waktu: { label: "Jadwal", title: "Kapan kamu mau datang?", hint: "Pilih jam, lalu pilih terapis atau biarkan Mizu yang memilihkan. Semua jam dalam WIB." },
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
 * data diri → halaman status booking. Bisa dibuka dengan isian awal dari menu
 * (?outlet=<slug atau branch_id>&treatment=<id>&date=YYYY-MM-DD). Jam yang
 * ditawarkan berasal dari server (cek terapis & preferensi gender).
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
  // null = "Pilihkan oleh Mizu"; pilihan hanya berlaku selama terapis itu masih kosong di jam terpilih.
  const [therapistId, setTherapistId] = useState<string | null>(null);
  // null = tanpa room khusus; pilihan berlaku selama room itu masih punya tempat di jam terpilih.
  const [roomId, setRoomId] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<PublicPaymentMethod>("outlet");
  const [redirecting, setRedirecting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<"name" | "phone" | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const outlets = usePublicSpaOutlets();
  // Kebijakan DP berlaku global; dipakai di teks pembuka sebelum outlet dipilih.
  const heroDeposit = outlets.data?.find((o) => (o.deposit_idr ?? 0) > 0)?.deposit_idr ?? 0;
  const outlet = outlets.data?.find((o) => o.branch_id === outletId || o.slug === outletId) ?? null;
  const treatments = usePublicSpaTreatments(outlet?.branch_id ?? "");
  const create = useCreatePublicBooking();

  // "Hari ini" mengikuti jam dinding; segarkan tiap menit.
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
  const treatmentPrice = picked.reduce((sum, p) => sum + p.variant.price_idr, 0);
  const availableSlots = usePublicSpaSlots(outlet?.branch_id ?? "", date, ids, pref);
  const slots = useMemo(
    () => (availableSlots.data ?? []).map((slot) => ({ iso: slot.starts_at, time: wibClockOf(slot.starts_at) })),
    [availableSlots.data]
  );
  const slotValid = !!slotIso && slots.some((s) => s.iso === slotIso);
  const freeTherapists = usePublicSpaTherapists(outlet?.branch_id ?? "", slotValid ? slotIso : null, ids, pref);
  const therapist = freeTherapists.data?.find((t) => t.id === therapistId) ?? null;
  const freeRooms = usePublicSpaRooms(outlet?.branch_id ?? "", slotValid ? slotIso : null, ids);
  const room = freeRooms.data?.find((r) => r.id === roomId) ?? null;
  // Total yang dibayar tamu: treatment + room (bila dipilih).
  const totalPrice = treatmentPrice + (room?.price_idr ?? 0);
  const onlineReady = !!outlet?.online_payment;
  // DP: booking online menahan jadwal setelah DP dibayar; sisa di outlet.
  const depositIdr = outlet?.deposit_idr ?? 0;
  const needsDeposit = onlineReady && depositIdr > 0;
  const payOnline = onlineReady && !needsDeposit && payMethod === "online";

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

  // Funnel anonim (tanpa data pelanggan) untuk laporan konversi booking.
  const funnelBranch = outlet?.branch_id;
  useEffect(() => {
    trackBookingStep("open", funnelBranch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sekali saat halaman dibuka
  }, []);
  useEffect(() => {
    trackBookingStep(step === "waktu" ? "time" : step === "kontak" ? "contact" : step, funnelBranch);
  }, [step, funnelBranch]);

  const go = (next: Step) => {
    setWanted(next);
    setFormError(null);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const chooseOutlet = (o: PublicOutlet) => {
    if (o.branch_id !== outlet?.branch_id) {
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

  const submit = async () => {
    if (!outlet || picked.length === 0) return;
    if (!slotIso || !slotValid) {
      setFormError("Jam yang dipilih sudah lewat. Silakan pilih jam lain.");
      return go("waktu");
    }
    if (name.trim().length < 2) {
      setFieldError("name");
      nameInput.current?.focus();
      return;
    }
    if (!isValidPhone(phone)) {
      setFieldError("phone");
      phoneInput.current?.focus();
      return;
    }
    setFieldError(null);
    setFormError(null);
    // Refresh the guest's optional picks immediately before creating the
    // booking; the server repeats this check inside its transaction.
    const [therapistResult, roomResult] = await Promise.all([
      therapistId ? freeTherapists.refetch() : Promise.resolve(null),
      roomId ? freeRooms.refetch() : Promise.resolve(null),
    ]);
    if (therapistId && !(therapistResult?.data ?? []).some((row) => row.id === therapistId)) {
      setTherapistId(null);
      go("waktu");
      setFormError("Terapis pilihan baru saja terisi. Pilih terapis lain atau biarkan Mizu memilihkan.");
      return;
    }
    if (roomId && !(roomResult?.data ?? []).some((row) => row.id === roomId)) {
      setRoomId(null);
      go("waktu");
      setFormError("Room pilihan baru saja terisi. Pilih room atau jadwal lain.");
      return;
    }
    trackBookingStep("submit", outlet.branch_id);
    create.mutate(
      {
        branch_id: outlet.branch_id,
        scheduled_at: slotIso,
        customer_name: name.trim(),
        customer_phone: phone.replace(/[\s-]/g, ""),
        therapist_gender_pref: pref,
        notes: notes.trim(),
        variant_ids: picked.map((p) => p.variant.id),
        ...(therapistId ? { therapist_id: therapistId } : {}),
        ...(roomId ? { room_id: roomId } : {}),
        payment_method: payOnline ? "online" : "outlet",
      },
      {
        onSuccess: async (res) => {
          trackBookingStep("success", outlet.branch_id);
          resetBookingFunnel();
          const statusPath = `/booking/spa/status/${encodeURIComponent(res.access_token)}`;
          if (res.deposit?.deposit_status === "pending") {
            // DP: langsung ke halaman bayar DP; bila link belum ada, halaman
            // status membuatkannya.
            setRedirecting(true);
            try {
              const url = res.deposit.deposit_invoice_url ?? (await publicSpaApi.payDeposit(res.access_token)).invoice_url;
              window.location.assign(url);
            } catch {
              router.replace(`${statusPath}?bayar=dp-gagal`);
            }
            return;
          }
          if (!payOnline) return router.replace(statusPath);
          // Bayar online: langsung ke halaman bayar; bila gagal, halaman status
          // menyediakan tombol "Bayar online" untuk mencoba lagi.
          setRedirecting(true);
          try {
            const pay = await publicSpaApi.pay(res.access_token);
            window.location.assign(pay.invoice_url);
          } catch {
            router.replace(`${statusPath}?bayar=gagal`);
          }
        },
        onError: (err) => {
          trackBookingStep("error", outlet.branch_id);
          setFormError(err.message);
          // Jam atau terapis keburu terisi orang lain: kembali ke pilihan yang segar.
          if (err.message.includes("penuh") || err.message.includes("Terapis pilihanmu") || err.message.includes("Room ")) {
            if (err.message.includes("penuh")) setSlotIso(null);
            setTherapistId(null);
            setRoomId(null);
            go("waktu");
            void availableSlots.refetch();
            void freeTherapists.refetch();
            void freeRooms.refetch();
          }
        },
      }
    );
  };

  // Label & status tombol utama dihitung terpisah dari aksinya (aksi menyentuh ref).
  const cta: { label: string; disabled: boolean } =
    step === "outlet"
      ? { label: "Pilih outlet dulu", disabled: true }
      : step === "treatment"
        ? { label: picked.length ? "Lanjut pilih jadwal" : "Pilih treatment dulu", disabled: picked.length === 0 }
        : step === "waktu"
          ? { label: slotValid && slotIso ? `Lanjut · ${wibClockOf(slotIso)} WIB` : "Pilih jam dulu", disabled: !slotValid }
          : {
              label: redirecting ? "Menuju pembayaran…" : create.isPending ? "Mengirim…" : needsDeposit ? `Konfirmasi & bayar DP ${formatRupiah(depositIdr * Math.max(1, 1))}` : payOnline ? "Konfirmasi & bayar" : "Konfirmasi booking",
              disabled: create.isPending || redirecting,
            };
  const next = () => {
    if (step === "treatment") go("waktu");
    else if (step === "waktu") go("kontak");
    else if (step === "kontak") submit();
  };

  return (
    <div className="bg-background">
      <Hero step={step} reach={reach} onStep={go} deposit={heroDeposit} />

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
              loading={availableSlots.isLoading}
              failed={!!availableSlots.error}
              slotIso={slotValid ? slotIso : null}
              onSlot={(iso) => {
                setSlotIso(iso);
                setFormError(null);
              }}
              pref={pref}
              onPref={(g) => {
                setPref(g);
                setSlotIso(null);
              }}
              error={formError}
              totalDuration={totalDuration}
              therapists={freeTherapists.data ?? []}
              therapistsLoading={freeTherapists.isLoading}
              therapistId={therapist?.id ?? null}
              onTherapist={setTherapistId}
              rooms={freeRooms.data ?? []}
              roomId={room?.id ?? null}
              onRoom={setRoomId}
            />
          )}

          {step === "kontak" && outlet && slotIso && (
            <div className="space-y-5">
              <div className="lg:hidden">
                <Summary
                  outlet={outlet}
                  slotIso={slotIso}
                  picked={picked}
                  totalDuration={totalDuration}
                  total={totalPrice}
                  deposit={needsDeposit ? depositIdr : 0}
                  therapistName={therapist?.name ?? null}
                  room={room}
                />
              </div>
              <div className="space-y-5 rounded-card bg-card p-5 shadow-card md:p-6">
                <Field label="Nama lengkap" error={fieldError === "name" ? "Isi nama kamu (minimal 2 huruf)." : undefined} id="spa-name">
                  <input
                    ref={nameInput}
                    id="spa-name"
                    className={cn(INPUT, fieldError === "name" && "border-danger")}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (fieldError === "name") setFieldError(null);
                    }}
                    autoComplete="name"
                    placeholder="Nama kamu"
                    aria-invalid={fieldError === "name"}
                    aria-describedby={fieldError === "name" ? "spa-name-error" : undefined}
                  />
                </Field>
                <Field
                  label="Nomor WhatsApp"
                  hint="Untuk konfirmasi jadwal. Tidak kami pakai untuk spam."
                  error={fieldError === "phone" ? "Nomor WhatsApp belum valid, contoh 0812-3456-7890." : undefined}
                  id="spa-phone"
                >
                  <input
                    ref={phoneInput}
                    id="spa-phone"
                    className={cn(INPUT, fieldError === "phone" && "border-danger")}
                    value={phone}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0812-3456-7890"
                    onChange={(e) => {
                      setPhone(e.target.value);
                      if (fieldError === "phone") setFieldError(null);
                    }}
                    aria-invalid={fieldError === "phone"}
                    aria-describedby={fieldError === "phone" ? "spa-phone-error" : undefined}
                  />
                </Field>
                {needsDeposit && (
                  <div className="space-y-2 rounded-2xl border border-border bg-background p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <CreditCard className="size-4 text-forest dark:text-accent" /> DP {formatRupiah(depositIdr)} untuk mengunci jadwal
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Setelah konfirmasi kamu diarahkan ke halaman pembayaran DP (VA, e-wallet, QRIS, kartu). Jadwal ditahan{" "}
                      {outlet?.deposit_hold_minutes ?? 60} menit sampai DP dibayar; sisa{" "}
                      <span className="font-semibold text-foreground">{formatRupiah(Math.max(0, totalPrice - depositIdr))}</span> dibayar di outlet setelah treatment.
                    </p>
                  </div>
                )}
                {onlineReady && !needsDeposit && (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold">Pembayaran</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(
                        [
                          { value: "outlet", title: "Bayar di outlet", text: "Setelah treatment, tunai atau non-tunai di kasir.", icon: Wallet },
                          { value: "online", title: "Bayar online sekarang", text: "Transfer VA, e-wallet, QRIS atau kartu lewat Xendit.", icon: CreditCard },
                        ] as const
                      ).map(({ value, title, text, icon: Icon }) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={payMethod === value}
                          onClick={() => setPayMethod(value)}
                          className={cn(
                            "flex items-start gap-3 rounded-2xl border p-4 text-left transition",
                            payMethod === value ? "border-ink bg-ink text-on-ink" : "border-border bg-background hover:border-foreground/40"
                          )}
                        >
                          <Icon className={cn("mt-0.5 size-5 shrink-0", payMethod === value ? "text-accent" : "text-muted-foreground")} />
                          <span>
                            <span className="block text-sm font-semibold">{title}</span>
                            <span className={cn("block text-xs", payMethod === value ? "text-on-ink-muted" : "text-muted-foreground")}>{text}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
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
              deposit={needsDeposit ? depositIdr : 0}
              therapistName={therapist?.name ?? null}
              room={room}
              showTherapist={step === "waktu" || step === "kontak"}
              onRemove={step === "treatment" ? toggleVariant : undefined}
            />
            <Button size="lg" className="w-full" disabled={cta.disabled} onClick={next}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              {cta.label}
              {!cta.disabled && !create.isPending ? <ArrowRight /> : null}
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Wallet className="size-3.5" /> {needsDeposit ? `DP ${formatRupiah(depositIdr)} online · sisa di outlet` : payOnline ? "Bayar online lewat Xendit" : "Bayar di outlet atau online"}
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
                <p className="font-display text-lg font-bold tabular-nums">
                  {formatRupiah(totalPrice)}
                  {needsDeposit && picked.length > 0 ? (
                    <span className="ml-1.5 text-xs font-medium text-muted-foreground">· DP {formatRupiah(depositIdr)}</span>
                  ) : null}
                </p>
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

function Hero({ step, reach, onStep, deposit }: { step: Step; reach: Record<Step, boolean>; onStep: (s: Step) => void; deposit: number }) {
  const current = STEPS.indexOf(step);
  const heroDeposit = deposit;
  return (
    <section className="relative isolate overflow-hidden bg-ink text-on-ink">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/site/photos/mizu-back-massage.webp" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover object-[center_40%]" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-ink via-ink/85 to-ink/40" />
      <Container className="space-y-8 pt-12 pb-8 md:pt-16">
        <div className="max-w-2xl space-y-4">
          <Kicker onInk>Booking online · Mizu Family Massage &amp; Reflexology</Kicker>
          <h1 className="font-display text-4xl font-bold tracking-tight text-balance md:text-5xl">Waktunya istirahat sejenak.</h1>
          <p className="max-w-xl text-on-ink-muted md:text-lg">
            Pilih outlet, treatment, jam dan terapis favoritmu.{" "}
            {heroDeposit > 0 ? `Kunci jadwal dengan DP ${formatRupiah(heroDeposit)}, sisanya dibayar di outlet setelah treatment.` : "Bayar di outlet setelah treatment, atau langsung online."}
          </p>
          <ul className="flex flex-wrap gap-2 pt-1 text-xs font-medium text-on-ink">
            {[
              { icon: UserRound, text: "Pilih terapis sendiri" },
              { icon: CreditCard, text: heroDeposit > 0 ? `DP ${formatRupiah(heroDeposit)} · sisa di outlet` : "Bayar di outlet atau online" },
              { icon: QrCode, text: "Kode & QR booking langsung" },
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
  loading,
  failed,
  slotIso,
  onSlot,
  pref,
  onPref,
  error,
  totalDuration,
  therapists,
  therapistsLoading,
  therapistId,
  onTherapist,
  rooms,
  roomId,
  onRoom,
}: {
  outlet: PublicOutlet;
  today: string;
  date: string;
  onDate: (d: string) => void;
  slots: { time: string; iso: string }[];
  loading: boolean;
  failed: boolean;
  slotIso: string | null;
  onSlot: (iso: string) => void;
  pref: GenderPref;
  onPref: (g: GenderPref) => void;
  error: string | null;
  totalDuration: number;
  therapists: PublicTherapist[];
  therapistsLoading: boolean;
  therapistId: string | null;
  onTherapist: (id: string | null) => void;
  rooms: PublicRoom[];
  roomId: string | null;
  onRoom: (id: string | null) => void;
}) {
  const strip = dateStrip(today, STRIP_DAYS);
  const inStrip = strip.some((d) => d.date === date);
  const picker = useRef<HTMLInputElement>(null);
  const groups = groupSlots(slots);
  const selected = slots.find((s) => s.iso === slotIso);

  return (
    <div className="space-y-6">
      {error && <ErrorNote>{error}</ErrorNote>}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Preferensi terapis</legend>
        <div className="grid max-w-md grid-cols-3 gap-2 rounded-2xl bg-surface p-1">
          {PREF_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={pref === o.value}
              onClick={() => onPref(o.value)}
              className={cn(
                "h-10 rounded-xl text-sm font-semibold transition",
                pref === o.value ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

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
        {loading ? (
          <Spinner />
        ) : failed ? (
          <ErrorNote>Jam belum bisa dimuat. Coba lagi sebentar.</ErrorNote>
        ) : groups.length === 0 ? (
          <ErrorNote tone="muted">
            Tidak ada jam kosong pada tanggal ini{pref === "any" ? "" : " untuk terapis pilihanmu"}. Coba tanggal lain
            {pref === "any" ? "" : " atau pilih Bebas"}.
          </ErrorNote>
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

      {selected && (
        <TherapistPicker therapists={therapists} loading={therapistsLoading} value={therapistId} onChange={onTherapist} />
      )}

      {selected && rooms.length > 0 && <RoomPicker rooms={rooms} value={roomId} onChange={onRoom} />}

      {selected ? (
        <div className="flex items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-sm">
          <Clock className="size-5 shrink-0 text-forest dark:text-accent" />
          <p>
            <strong className="font-semibold">
              {selected.time}–{endClock(selected.time, totalDuration)} WIB
            </strong>{" "}
            · {formatDateLong(date)}.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Terapis ditentukan outlet sesuai preferensimu. Datang 10 menit lebih awal ya.</p>
      )}
    </div>
  );
}

// ── Pilih terapis ────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .replace(/\./g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** Terapis untuk jam terpilih: "Pilihkan oleh Mizu" (bawaan) atau salah satu terapis yang kosong. */
function TherapistPicker({
  therapists,
  loading,
  value,
  onChange,
}: {
  therapists: PublicTherapist[];
  loading: boolean;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const option = (on: boolean) =>
    cn(
      "flex items-center gap-3 rounded-2xl p-3 text-left text-sm shadow-card ring-2 transition",
      on ? "bg-ink text-on-ink ring-ink" : "bg-card ring-transparent hover:bg-surface"
    );
  return (
    <fieldset className="space-y-3">
      <legend className="flex w-full items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">Terapis</span>
        <span className="text-xs text-muted-foreground">{loading ? "Mengecek terapis…" : `${therapists.length} terapis kosong di jam ini`}</span>
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={option(value === null)}>
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              value === null ? "bg-accent text-ink" : "bg-accent-soft text-forest dark:text-accent"
            )}
          >
            <Sparkles className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">Pilihkan oleh Mizu</span>
            <span className={cn("block text-xs", value === null ? "text-on-ink-muted" : "text-muted-foreground")}>
              Terapis terbaik yang kosong di jam ini
            </span>
          </span>
        </button>
        {loading
          ? [0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface" />)
          : therapists.map((t) => {
              const on = value === t.id;
              return (
                <button key={t.id} type="button" aria-pressed={on} onClick={() => onChange(t.id)} className={option(on)}>
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold",
                      on ? "bg-accent text-ink" : "bg-surface text-foreground"
                    )}
                  >
                    {initials(t.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{t.name}</span>
                    <span className={cn("block text-xs", on ? "text-on-ink-muted" : "text-muted-foreground")}>
                      {t.gender === "female" ? "Terapis wanita" : t.gender === "male" ? "Terapis pria" : "Terapis"} · tersedia
                    </span>
                  </span>
                </button>
              );
            })}
      </div>
    </fieldset>
  );
}

// ── Pilih room ───────────────────────────────────────────────────────────────

/** Room untuk jam terpilih (revisi R6): "Tanpa room khusus" (bawaan) atau room yang masih punya tempat; harganya ditambahkan ke total. */
function RoomPicker({ rooms, value, onChange }: { rooms: PublicRoom[]; value: string | null; onChange: (id: string | null) => void }) {
  const option = (on: boolean) =>
    cn(
      "flex items-start gap-3 rounded-2xl p-3 text-left text-sm shadow-card ring-2 transition",
      on ? "bg-ink text-on-ink ring-ink" : "bg-card ring-transparent hover:bg-surface"
    );
  return (
    <fieldset className="space-y-3">
      <legend className="flex w-full items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">Room</span>
        <span className="text-xs text-muted-foreground">{rooms.length} room tersedia di jam ini</span>
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={option(value === null)}>
          <DoorOpen className="mt-0.5 size-5 shrink-0" />
          <span className="min-w-0">
            <span className="block font-semibold">Tanpa room khusus</span>
            <span className={cn("block text-xs", value === null ? "text-on-ink-muted" : "text-muted-foreground")}>Outlet menyiapkan ruang treatment · gratis</span>
          </span>
        </button>
        {rooms.map((r) => {
          const on = value === r.id;
          return (
            <button key={r.id} type="button" aria-pressed={on} onClick={() => onChange(r.id)} className={option(on)}>
              <DoorOpen className="mt-0.5 size-5 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{r.name}</span>
                <span className={cn("block text-xs", on ? "text-on-ink-muted" : "text-muted-foreground")}>
                  {ROOM_CATEGORY_LABEL[r.category]} · {r.capacity} orang · {r.price_idr > 0 ? `+${formatRupiah(r.price_idr)}` : "gratis"}
                  {r.description ? ` · ${r.description}` : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ── Ringkasan ────────────────────────────────────────────────────────────────

function Summary({
  outlet,
  slotIso,
  picked,
  totalDuration,
  total,
  deposit = 0,
  therapistName,
  room = null,
  showTherapist = true,
  onRemove,
}: {
  outlet: PublicOutlet | null;
  slotIso: string | null;
  picked: Picked[];
  totalDuration: number;
  total: number;
  /** Booking fee (DP) yang dibayar online sekarang; 0 = tidak ada DP. */
  deposit?: number;
  /** Room pilihan tamu (harganya sudah termasuk total). */
  room?: PublicRoom | null;
  therapistName: string | null;
  showTherapist?: boolean;
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
        {showTherapist && (
          <SummaryRow icon={UserRound} label="Terapis">
            {therapistName ?? <span className="text-body">Dipilihkan oleh Mizu</span>}
          </SummaryRow>
        )}
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
        {room && (
          <SummaryRow icon={DoorOpen} label="Room">
            <span className="flex items-start justify-between gap-3">
              <span>{room.name}</span>
              <span className="tabular-nums">{room.price_idr > 0 ? formatRupiah(room.price_idr) : "Gratis"}</span>
            </span>
          </SummaryRow>
        )}
        <div className="flex items-end justify-between border-t border-dashed border-border pt-4">
          <span className="text-body">
            Total
            {totalDuration ? <span className="block text-xs text-muted-foreground">{totalDuration} menit</span> : null}
          </span>
          <span className="font-display text-2xl font-bold tabular-nums">{formatRupiah(total)}</span>
        </div>
        {deposit > 0 && picked.length > 0 && (
          <div className="space-y-1.5 rounded-lg bg-surface px-3 py-2.5 text-xs" data-testid="summary-deposit">
            <div className="flex items-center justify-between gap-3">
              <span className="text-body">Booking fee (DP) · bayar online sekarang</span>
              <span className="font-semibold tabular-nums text-foreground">{formatRupiah(Math.min(deposit, total))}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-body">Sisa · bayar di outlet setelah treatment</span>
              <span className="font-semibold tabular-nums text-foreground">{formatRupiah(Math.max(0, total - deposit))}</span>
            </div>
            <p className="text-muted-foreground">DP mengunci jadwal kamu dan langsung mengurangi total treatment.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function SummaryRow({ icon: Icon, label, children }: { icon: typeof Sun; label: string; children: ReactNode }) {
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

// ── Kecil-kecil ──────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  optional,
  error,
  id,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  error?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5" htmlFor={id}>
      <span className="flex items-baseline justify-between gap-2 text-sm font-semibold">
        {label}
        {optional ? <span className="text-xs font-normal text-muted-foreground">opsional</span> : null}
      </span>
      {children}
      {error ? (
        <span id={id ? `${id}-error` : undefined} role="alert" className="block text-sm text-danger">
          {error}
        </span>
      ) : hint ? (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      ) : null}
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
