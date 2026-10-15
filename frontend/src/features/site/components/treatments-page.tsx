import Link from "next/link";
import { Clock, MapPin, Palette, Smartphone, Sticker, Type } from "lucide-react";
import type { PublicOutlet, PublicTreatment } from "@/features/spa/types";
import type { ExperienceCatalog } from "@/features/spa/experience";
import { BackgroundSwatch, CasePreview } from "@/features/spa/components/case-design/case-preview";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Loaded } from "../lib/public-api";
import { durationsLabel, groupByCategory, openingHours } from "../lib/treatments";
import type { TrainingContent } from "../types";
import { BookingButton } from "./booking-link";
import { categoryPhoto } from "../lib/photos";
import { Container, EmptyNote, Picture, Section, SectionHeading } from "./site-section";
import { BeforeTreatment, TreatmentNeeds, VisitSteps } from "./treatment-guide";

/** The store chosen by ?outlet=, else the first one. */
export function pickOutlet(outlets: PublicOutlet[], branchId: string | undefined): PublicOutlet | null {
  return outlets.find((o) => o.branch_id === branchId) ?? outlets[0] ?? null;
}

function OutletSwitcher({ outlets, selected }: { outlets: PublicOutlet[]; selected: PublicOutlet }) {
  const hours = openingHours(selected.open_time, selected.close_time);
  const address = [selected.address, selected.city].filter(Boolean).join(", ");
  return (
    <div className="space-y-3">
      {outlets.length > 1 ? (
        <nav aria-label="Pilih toko" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {outlets.map((o) => {
            const active = o.branch_id === selected.branch_id;
            return (
              <Link
                key={o.branch_id}
                href={`/treatments?outlet=${encodeURIComponent(o.branch_id)}`}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  active ? "bg-ink text-on-ink" : "bg-card text-body shadow-card hover:bg-surface-2",
                )}
              >
                {o.name}
              </Link>
            );
          })}
        </nav>
      ) : null}
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-body">
        <span className="font-semibold text-foreground">{selected.name}</span>
        {address ? (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-3.5 text-muted-foreground" />
            {address}
          </span>
        ) : null}
        {hours ? (
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-muted-foreground" />
            Buka {hours} WIB
          </span>
        ) : null}
      </p>
    </div>
  );
}

function TreatmentCard({ treatment, outlet }: { treatment: PublicTreatment; outlet: PublicOutlet }) {
  return (
    <article className="flex h-full flex-col gap-4 rounded-card border-2 border-navy bg-card p-6 shadow-[4px_4px_0_0_var(--color-navy)]">
      <div className="space-y-1.5">
        <h3 className="font-display text-xl font-semibold">{treatment.name}</h3>
        <p className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-brand-text">{durationsLabel(treatment.variants)}</p>
        {treatment.description ? <p className="text-sm text-body">{treatment.description}</p> : null}
      </div>
      <ul className="mt-auto divide-y divide-border/60 border-y border-border/60 text-sm">
        {treatment.variants.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-3 py-2">
            <span className="text-body">{v.duration_min} menit</span>
            <span className="font-semibold text-foreground tabular-nums">{formatRupiah(v.price_idr)}</span>
          </li>
        ))}
      </ul>
      <BookingButton size="sm" className="self-start" outlet={outlet.slug} treatment={treatment.id} aria-label={`Booking ${treatment.name}`}>
        Booking
      </BookingButton>
    </article>
  );
}

/** Showcase Custom Case: galeri background & tema stiker dari katalog desain. */
function CustomCaseCard({ treatment, outlet, experience }: { treatment: PublicTreatment; outlet: PublicOutlet; experience: ExperienceCatalog }) {
  const price = Math.min(...treatment.variants.map((v) => v.price_idr));
  const sample = experience.themes.slice(0, 3);
  const bg = experience.backgrounds.find((b) => b.code === "star-dots") ?? experience.backgrounds[0];
  return (
    <article className="grid gap-6 overflow-hidden rounded-card border-2 border-navy bg-card p-5 shadow-[4px_4px_0_0_var(--color-navy)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:p-7">
      <div className="flex flex-col gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-brand-text">The Experience Room · {durationsLabel(treatment.variants)}</p>
          <h3 className="font-display text-3xl font-bold">{treatment.name}</h3>
          <p className="font-display text-2xl font-bold text-accent-strong tabular-nums">{formatRupiah(price)}</p>
          {treatment.description ? <p className="text-sm text-body">{treatment.description}</p> : null}
        </div>
        <p className="rounded-2xl bg-accent-soft px-4 py-3 text-sm font-semibold text-foreground">
          Pilih dari {experience.backgrounds.length} background & {experience.themes.length} tema stiker
        </p>
        <ol className="grid grid-cols-2 gap-2 text-sm">
          {[
            { icon: Smartphone, text: "Merk & tipe HP" },
            { icon: Sticker, text: `Layout ${experience.layouts.map((l) => l.slots).join(" / ")} gambar` },
            { icon: Type, text: `Nama, ${experience.fonts.length} font` },
            { icon: Palette, text: "Background case" },
          ].map(({ icon: Icon, text }, i) => (
            <li key={text} className="flex items-center gap-2 rounded-xl bg-surface px-2.5 py-2 sm:px-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-on-ink">{i + 1}</span>
              <Icon className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
              <span className="min-w-0 leading-tight">{text}</span>
            </li>
          ))}
        </ol>
        <BookingButton size="lg" className="mt-auto self-start" outlet={outlet.slug} treatment={treatment.id} aria-label={`Desain & booking ${treatment.name}`}>
          Desain case kamu
        </BookingButton>
      </div>
      <div className="space-y-4">
        <div className="flex items-end justify-center gap-4 rounded-2xl bg-[radial-gradient(circle_at_25%_20%,var(--color-sunny)_0,transparent_45%),radial-gradient(circle_at_80%_85%,var(--color-pink-200)_0,transparent_50%)] px-4 py-5 dark:bg-surface">
          {bg ? (
            <CasePreview
              className="w-24 -rotate-6"
              label="Contoh desain custom case"
              design={{
                background_image: bg.image,
                background_name: bg.name,
                name: "Kai",
                stickers: sample.map((t, i) => ({ theme: t.code, code: t.stickers[i % t.stickers.length].code, image: t.stickers[i % t.stickers.length].image, name: t.stickers[i % t.stickers.length].name })),
              }}
            />
          ) : null}
          <div className="grid grid-cols-6 gap-1.5">
            {experience.backgrounds.slice(0, 12).map((b) => (
              <span key={b.code} title={b.name} className="w-7">
                <BackgroundSwatch image={b.image} />
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{experience.themes.length} tema stiker</p>
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8 md:grid-cols-4 lg:grid-cols-8">
            {experience.themes.map((t) => (
              <li key={t.code} className="flex flex-col items-center gap-1 rounded-xl bg-surface p-1.5 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.stickers[0]?.image} alt="" loading="lazy" className="size-10 object-contain" />
                <span className="line-clamp-1 text-[10px] font-semibold text-body">{t.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

function Menu({ treatments, outlet, experience }: { treatments: Loaded<PublicTreatment[]>; outlet: PublicOutlet; experience: ExperienceCatalog | null }) {
  const outletName = outlet.name;
  if (!treatments.ok) {
    return <EmptyNote>Menu layanan experience {outletName} belum bisa dimuat. Muat ulang halaman sebentar lagi, atau langsung lanjut ke booking.</EmptyNote>;
  }
  const groups = groupByCategory(treatments.data);
  if (groups.length === 0) {
    return <EmptyNote>Belum ada layanan experience yang bisa di-booking online di {outletName}. Coba toko lain atau hubungi kami.</EmptyNote>;
  }
  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <section key={group.category} aria-labelledby={`cat-${group.category}`} className="space-y-4">
          <div className="relative isolate flex h-32 items-end overflow-hidden rounded-card border-2 border-navy bg-ink p-5 text-white shadow-[4px_4px_0_0_var(--color-navy)] md:h-40 md:p-6">
            <Picture src={categoryPhoto(group.category)} alt="" className="absolute inset-0 -z-20 h-full w-full" />
            <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-berry/90 via-berry/45 to-transparent" />
            <h2 id={`cat-${group.category}`} className="font-display text-2xl font-semibold md:text-3xl">
              {group.category}
            </h2>
          </div>
          {experience
            ? group.treatments.filter((t) => t.customizable).map((t) => <CustomCaseCard key={t.id} treatment={t} outlet={outlet} experience={experience} />)
            : null}
          {group.treatments.some((t) => !(t.customizable && experience)) ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.treatments.filter((t) => !(t.customizable && experience)).map((t) => (
                <TreatmentCard key={t.id} treatment={t} outlet={outlet} />
              ))}
            </div>
          ) : null}
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Harga berlaku di {outletName} dan dapat berubah sewaktu-waktu. Pembayaran dilakukan langsung di toko.</p>
    </div>
  );
}

export function TreatmentsPage({ guide, outlets, selected, treatments, experience = null }: {
  guide: TrainingContent;
  outlets: Loaded<PublicOutlet[]>;
  selected: PublicOutlet | null;
  treatments: Loaded<PublicTreatment[]>;
  /** Katalog desain custom case; null = galeri tidak ditampilkan. */
  experience?: ExperienceCatalog | null;
}) {
  return (
    <>
      <Section className="pb-6">
        <Container className="space-y-6">
          <SectionHeading as="h1" kicker="Paddy Experience" title={guide.intro.title} text={guide.intro.text || undefined} />
          <BookingButton size="lg">Booking sekarang</BookingButton>
        </Container>
      </Section>

      <Section className="pt-4">
        <Container className="space-y-8">
          {!outlets.ok ? (
            <EmptyNote>Menu layanan experience belum bisa dimuat. Muat ulang halaman sebentar lagi, atau langsung lanjut ke booking.</EmptyNote>
          ) : !selected ? (
            <EmptyNote>Belum ada toko yang membuka booking online.</EmptyNote>
          ) : (
            <>
              <OutletSwitcher outlets={outlets.data} selected={selected} />
              <Menu treatments={treatments} outlet={selected} experience={experience} />
            </>
          )}
        </Container>
      </Section>

      <TreatmentNeeds needs={guide.class_types} className="bg-surface" />
      <VisitSteps block={guide.block} />
      <BeforeTreatment laws={guide.laws} />
    </>
  );
}

/** The skeleton while the menu loads. */
export function TreatmentsSkeleton() {
  return (
    <Section>
      <Container className="space-y-8">
        <div className="max-w-2xl space-y-3">
          <div className="h-3 w-24 animate-pulse rounded-full bg-surface-2" />
          <div className="h-10 w-3/4 animate-pulse rounded-full bg-surface-2" />
          <div className="h-4 w-full animate-pulse rounded-full bg-surface-2" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-32 animate-pulse rounded-full bg-surface-2" />
          <div className="h-9 w-32 animate-pulse rounded-full bg-surface-2" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-card bg-surface-2" />
          ))}
        </div>
        <p role="status" className="sr-only">Memuat menu layanan experience…</p>
      </Container>
    </Section>
  );
}
