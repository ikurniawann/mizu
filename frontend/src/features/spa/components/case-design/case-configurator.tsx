"use client";

/* eslint-disable @next/next/no-img-element -- gambar katalog statis (WebP kecil) di public/experience */
import { useMemo, useState, type ReactNode } from "react";
import { Check, Dices, Search, Smartphone, Sparkles, Type, X } from "lucide-react";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  cleanName,
  filterModels,
  missingSections,
  resolveDraft,
  withLayout,
  type CaseDraft,
  type DraftSection,
  type ExperienceCatalog,
} from "../../experience";
import { BackgroundSwatch, CasePreview } from "./case-preview";

const SECTION_LABEL: Record<DraftSection, string> = {
  hp: "Tipe HP",
  layout: "Layout",
  stiker: "Stiker",
  nama: "Nama",
  background: "Background",
};

const chip = (on: boolean) =>
  cn(
    "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition",
    on ? "border-ink bg-ink text-on-ink" : "border-border bg-background text-body hover:border-foreground/40 hover:text-foreground"
  );

const tile = (on: boolean) =>
  cn(
    "relative overflow-hidden rounded-2xl border-2 bg-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    on ? "border-accent-strong shadow-card" : "border-border hover:border-foreground/30"
  );

/**
 * Konfigurator custom case ala The Experience Room: tipe HP → layout 2/3 gambar →
 * tema & stiker per gambar → nama + font (opsional) → background, dengan
 * pratinjau live. Dipakai di booking online dan dialog "Desain" Book Order.
 */
export function CaseConfigurator({
  catalog,
  value,
  onChange,
  compact = false,
}: {
  catalog: ExperienceCatalog;
  value: CaseDraft;
  onChange: (draft: CaseDraft) => void;
  /** Dialog dashboard: pratinjau lebih kecil, tanpa harga. */
  compact?: boolean;
}) {
  const [slot, setSlot] = useState(() => Math.max(0, value.stickers.findIndex((s) => !s)));
  const [query, setQuery] = useState("");
  const missing = missingSections(value, catalog);
  const done = (s: DraftSection) => !missing.includes(s);
  const design = useMemo(() => resolveDraft(value, catalog), [value, catalog]);
  const brand = catalog.brands.find((b) => b.code === value.brand) ?? null;
  const layout = catalog.layouts.find((l) => l.code === value.layout) ?? catalog.layouts[0];
  const activeSlot = Math.min(slot, (layout?.slots ?? 1) - 1);
  const slotTheme = catalog.themes.find((t) => t.code === value.slotThemes[activeSlot]) ?? catalog.themes[0];
  const font = catalog.fonts.find((f) => f.code === value.font) ?? null;
  const models = brand ? filterModels(brand.models, query) : [];
  const steps = (["hp", "layout", "stiker", "nama", "background"] as const).filter(done).length;

  const set = (patch: Partial<CaseDraft>) => onChange({ ...value, ...patch });

  const pickSticker = (code: string) => {
    if (!slotTheme) return;
    const stickers = [...value.stickers];
    stickers[activeSlot] = { theme: slotTheme.code, code };
    onChange({ ...value, stickers });
    // Lanjut ke gambar berikutnya yang masih kosong.
    const next = stickers.findIndex((s, i) => !s && i !== activeSlot);
    if (next >= 0) setSlot(next);
  };

  const pickTheme = (code: string) => {
    const slotThemes = [...value.slotThemes];
    slotThemes[activeSlot] = code;
    set({ slotThemes });
  };

  const randomize = () => {
    const rnd = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    const b = brand ?? rnd(catalog.brands);
    const l = rnd(catalog.layouts);
    const themes = Array.from({ length: l.slots }, () => rnd(catalog.themes));
    onChange({
      ...value,
      brand: b.code,
      model: brand && value.model ? value.model : rnd(b.models),
      layout: l.code,
      slotThemes: themes.map((t) => t.code),
      stickers: themes.map((t) => ({ theme: t.code, code: rnd(t.stickers).code })),
      font: value.withName ? (value.font || rnd(catalog.fonts).code) : value.font,
      background: rnd(catalog.backgrounds).code,
      withName: value.withName ?? false,
    });
    setSlot(0);
  };

  const preview = (
    <div className="space-y-3">
      <div className="relative mx-auto rounded-[28px] bg-[radial-gradient(circle_at_30%_20%,var(--color-sunny)_0,transparent_45%),radial-gradient(circle_at_80%_80%,var(--color-pink-200)_0,transparent_50%)] p-5 dark:bg-none">
        <img src="/brand/mark-lime.png" alt="" aria-hidden className="pointer-events-none absolute -top-2 -left-2 size-10 -rotate-12 opacity-90" />
        <CasePreview
          design={design}
          showEmptySlots
          activeSlot={activeSlot}
          onSlot={(i) => setSlot(i)}
          className={cn("mx-auto", compact ? "w-32" : "w-36 sm:w-44 lg:w-48")}
        />
      </div>
      <div className="space-y-1 text-center text-xs">
        <p className="font-semibold text-foreground">
          {value.model ? value.model : "Pilih tipe HP"}
          {design.background_name ? ` · ${design.background_name}` : ""}
        </p>
        {design.name && font ? (
          <p className="flex items-center justify-center gap-1.5 text-muted-foreground">
            <Type className="size-3.5" /> Dicetak dengan font <strong className="text-foreground">{font.name}</strong>
          </p>
        ) : null}
        {font && design.name ? (
          <img src={font.sample} alt={`Contoh font ${font.name}`} className="mx-auto h-10 w-auto object-contain opacity-80 dark:invert" />
        ) : null}
        <p className="text-muted-foreground">
          {steps}/5 bagian lengkap
          {!compact ? ` · ${formatRupiah(catalog.price)}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={randomize}
        className="mx-auto flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-body transition hover:text-foreground"
      >
        <Dices className="size-3.5" /> Acak desain
      </button>
    </div>
  );

  return (
    <div className={cn("grid gap-5", compact ? "md:grid-cols-[minmax(0,1fr)_11rem]" : "md:grid-cols-[minmax(0,1fr)_14rem]")}>
      {/* Pratinjau: di ponsel bilah ringkas yang menempel di atas supaya tiap pilihan langsung terlihat. */}
      <div className={cn("sticky z-20 md:hidden", compact ? "-top-4" : "top-16")}>
        <div className="flex items-center gap-3 rounded-card bg-card/95 p-2.5 shadow-float backdrop-blur">
          <div className="rounded-2xl bg-[radial-gradient(circle_at_30%_20%,var(--color-sunny)_0,transparent_55%),radial-gradient(circle_at_80%_80%,var(--color-pink-200)_0,transparent_60%)] px-3 py-2 dark:bg-none">
            <CasePreview design={design} showEmptySlots activeSlot={activeSlot} onSlot={(i) => setSlot(i)} className="w-[4.25rem]" />
          </div>
          <div className="min-w-0 flex-1 space-y-1 text-xs">
            <p className="truncate font-display text-base leading-tight font-bold">{value.model || "Desain case kamu"}</p>
            <p className="truncate text-muted-foreground">
              {[design.background_name, design.name ? `“${design.name}”` : null].filter(Boolean).join(" · ") || "Pilih tiap bagian di bawah"}
            </p>
            {design.name && font ? <p className="truncate text-muted-foreground">Font cetak: <strong className="text-foreground">{font.name}</strong></p> : null}
            <div className="flex items-center gap-2 pt-0.5">
              <span className="flex gap-1" aria-label={`${steps} dari 5 bagian lengkap`}>
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} className={cn("h-1.5 w-4 rounded-full", i < steps ? "bg-accent-strong" : "bg-surface")} />
                ))}
              </span>
              <button type="button" onClick={randomize} className="ml-auto flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 font-semibold text-body">
                <Dices className="size-3.5" /> Acak
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className={cn("hidden md:order-2 md:block md:self-start", compact ? "md:sticky md:top-0" : "md:sticky md:top-28")}>
        <div className="rounded-card bg-card p-4 shadow-card">{preview}</div>
      </div>

      <div className="min-w-0 space-y-4 md:order-1">
        <Section n={1} title="Merk & tipe HP" done={done("hp")} icon={<Smartphone className="size-4" />}>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {catalog.brands.map((b) => (
              <button
                key={b.code}
                type="button"
                aria-pressed={value.brand === b.code}
                onClick={() => {
                  if (b.code !== value.brand) set({ brand: b.code, model: "" });
                  setQuery("");
                }}
                className={chip(value.brand === b.code)}
              >
                {b.name}
              </button>
            ))}
          </div>
          {brand ? (
            <div className="space-y-2">
              <label className="relative block">
                <span className="sr-only">Cari tipe {brand.name}</span>
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Cari tipe ${brand.name}, mis. ${brand.models[0]}`}
                  className="h-11 w-full rounded-xl border border-border bg-background pr-9 pl-9 text-base outline-none focus-visible:border-accent-strong focus-visible:ring-2 focus-visible:ring-accent/30 md:text-sm"
                />
                {query ? (
                  <button type="button" aria-label="Hapus pencarian" onClick={() => setQuery("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-muted-foreground">
                    <X className="size-4" />
                  </button>
                ) : null}
              </label>
              <div role="listbox" aria-label={`Tipe ${brand.name}`} className="grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto rounded-xl bg-surface p-1.5 sm:grid-cols-3">
                {models.length === 0 ? (
                  <p className="col-span-full px-2 py-3 text-sm text-muted-foreground">Tipe tidak ditemukan. Tanyakan ke crew di toko ya.</p>
                ) : (
                  models.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      aria-selected={value.model === m}
                      onClick={() => set({ model: m })}
                      className={cn(
                        "flex min-h-10 items-center justify-between gap-1 rounded-lg px-2.5 text-left text-sm transition",
                        value.model === m ? "bg-ink font-semibold text-on-ink" : "bg-background hover:bg-card"
                      )}
                    >
                      <span className="truncate">{m}</span>
                      {value.model === m ? <Check className="size-4 shrink-0 text-sunny" /> : null}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Pilih merk HP dulu.</p>
          )}
        </Section>

        <Section n={2} title="Layout" done={done("layout")} hint="Mau berapa gambar di case?">
          <div className="grid grid-cols-2 gap-3">
            {catalog.layouts.map((l) => {
              const on = value.layout === l.code;
              return (
                <button
                  key={l.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    onChange(withLayout(value, l, catalog));
                    setSlot((s) => Math.min(s, l.slots - 1));
                  }}
                  className={cn(tile(on), "flex items-center gap-3 p-3 text-left")}
                >
                  <span className="relative h-16 w-8 shrink-0 rounded-[10px] border-2 border-current/30 bg-surface">
                    {Array.from({ length: l.slots }, (_, i) => (
                      <span
                        key={i}
                        className="absolute size-2.5 rounded-full bg-accent-strong"
                        style={{ left: `${l.slots === 2 ? [55, 25][i] : [60, 20, 55][i]}%`, top: `${l.slots === 2 ? [25, 60][i] : [18, 45, 70][i]}%` }}
                      />
                    ))}
                  </span>
                  <span>
                    <span className="block font-display text-lg leading-tight font-bold">{l.slots} gambar</span>
                    <span className="block text-xs text-muted-foreground">{l.name}</span>
                  </span>
                  {on ? <Check className="absolute top-2 right-2 size-4 text-accent-strong" /> : null}
                </button>
              );
            })}
          </div>
        </Section>

        <Section n={3} title="Stiker" done={done("stiker")} hint="Pilih kategori gambar, lalu satu dari 4 stiker untuk tiap gambar.">
          <div className="flex gap-2">
            {value.stickers.map((s, i) => {
              const theme = s ? catalog.themes.find((t) => t.code === s.theme) : null;
              const img = theme?.stickers.find((x) => x.code === s?.code)?.image;
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={activeSlot === i}
                  onClick={() => setSlot(i)}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl border-2 p-1.5 text-center text-xs font-semibold transition sm:h-14 sm:flex-row sm:gap-2 sm:px-2 sm:text-left",
                    activeSlot === i ? "border-accent-strong bg-accent-soft/60" : "border-border bg-background"
                  )}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface">
                    {img ? <img src={img} alt="" className="size-9 object-contain" /> : <span className="text-muted-foreground">{i + 1}</span>}
                  </span>
                  <span className="w-full min-w-0">
                    <span className="block">Gambar {i + 1}</span>
                    <span className="block truncate font-normal text-muted-foreground">{theme ? theme.name : "Belum dipilih"}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" aria-label="Kategori gambar">
            {catalog.themes.map((t) => (
              <button key={t.code} type="button" aria-pressed={slotTheme?.code === t.code} onClick={() => pickTheme(t.code)} className={cn(chip(slotTheme?.code === t.code), "h-9 px-3 text-xs")}>
                {t.name}
              </button>
            ))}
          </div>
          {slotTheme ? (
            <div className="grid grid-cols-4 gap-2">
              {slotTheme.stickers.map((s) => {
                const on = value.stickers[activeSlot]?.code === s.code;
                return (
                  <button key={s.code} type="button" aria-pressed={on} aria-label={s.name} onClick={() => pickSticker(s.code)} className={cn(tile(on), "aspect-square bg-surface p-1.5")}>
                    <img src={s.image} alt="" loading="lazy" className="size-full object-contain transition hover:scale-105" />
                    {on ? (
                      <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-accent-strong text-white">
                        <Check className="size-3" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </Section>

        <Section n={4} title="Nama" done={done("nama")} icon={<Type className="size-4" />} hint="Apakah kamu ingin menggunakan nama?">
          <div className="flex gap-2">
            {[
              { v: true, label: "Ya, pakai nama" },
              { v: false, label: "Tidak" },
            ].map(({ v, label }) => (
              <button key={label} type="button" aria-pressed={value.withName === v} onClick={() => set({ withName: v })} className={chip(value.withName === v)}>
                {label}
              </button>
            ))}
          </div>
          {value.withName ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {catalog.fonts.map((f) => {
                  const on = value.font === f.code;
                  return (
                    <button key={f.code} type="button" aria-pressed={on} onClick={() => set({ font: f.code })} className={cn(tile(on), "flex flex-col items-center gap-1 bg-white p-2 dark:bg-white")}>
                      <img src={f.sample} alt="" loading="lazy" className="h-12 w-full object-contain" />
                      <span className="text-[11px] font-semibold text-ink">{f.name}</span>
                      {on ? <Check className="absolute top-1.5 right-1.5 size-4 text-accent-strong" /> : null}
                    </button>
                  );
                })}
              </div>
              <label className="block space-y-1.5">
                <span className="flex items-baseline justify-between text-sm font-semibold">
                  Nama yang dicetak
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {value.name.length}/{catalog.name_max_length}
                  </span>
                </span>
                <input
                  value={value.name}
                  maxLength={catalog.name_max_length}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder="mis. Kai"
                  autoComplete="off"
                  className="h-12 w-full rounded-xl border border-border bg-background px-4 font-display text-lg font-bold outline-none focus-visible:border-accent-strong focus-visible:ring-2 focus-visible:ring-accent/30"
                />
                {value.name && !cleanName(value.name) ? <span className="text-xs text-danger">Nama tidak boleh hanya spasi.</span> : null}
                {!value.font ? <span className="block text-xs text-muted-foreground">Pilih salah satu font di atas.</span> : null}
              </label>
            </div>
          ) : null}
        </Section>

        <Section n={5} title="Background" done={done("background")} hint="Warna & motif dasar case kamu.">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {catalog.backgrounds.map((b) => {
              const on = value.background === b.code;
              return (
                <button key={b.code} type="button" aria-pressed={on} onClick={() => set({ background: b.code })} className={cn(tile(on), "flex flex-col items-center gap-1 bg-surface p-2 pb-1.5")}>
                  <BackgroundSwatch image={b.image} />
                  <span className="w-full truncate text-center text-[11px] font-semibold">{b.name}</span>
                  {on ? (
                    <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-accent-strong text-white">
                      <Check className="size-3" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </Section>

        {missing.length > 0 ? (
          <p className="flex items-start gap-2 rounded-2xl bg-surface px-4 py-3 text-sm text-body">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-strong" />
            Tinggal lengkapi: {missing.map((m) => SECTION_LABEL[m]).join(", ")}.
          </p>
        ) : (
          <p className="flex items-center gap-2 rounded-2xl bg-accent-soft px-4 py-3 text-sm font-semibold text-foreground">
            <Check className="size-4 text-accent-strong" /> Desain lengkap! Crew Paddy akan mencetaknya di toko.
          </p>
        )}
      </div>
    </div>
  );
}

function Section({
  n,
  title,
  hint,
  done,
  icon,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  done: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-card bg-card p-4 shadow-card md:p-5" aria-labelledby={`case-step-${n}`}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            done ? "bg-accent-strong text-white" : "bg-surface text-body"
          )}
        >
          {done ? <Check className="size-4" /> : n}
        </span>
        <div className="min-w-0">
          <h3 id={`case-step-${n}`} className="flex items-center gap-1.5 font-display text-lg leading-tight font-bold">
            {title} {icon ? <span className="text-muted-foreground">{icon}</span> : null}
          </h3>
          {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}
