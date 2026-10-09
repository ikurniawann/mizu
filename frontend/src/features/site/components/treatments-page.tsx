import Link from "next/link";
import { Clock, MapPin } from "lucide-react";
import type { PublicOutlet, PublicTreatment } from "@/features/spa/types";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Loaded } from "../lib/public-api";
import { durationsLabel, groupByCategory, openingHours } from "../lib/treatments";
import type { TrainingContent } from "../types";
import { BookingButton } from "./booking-link";
import { Container, EmptyNote, Section, SectionHeading } from "./site-section";
import { BeforeTreatment, TreatmentNeeds, VisitSteps } from "./treatment-guide";

/** The outlet chosen by ?outlet=, else the first one. */
export function pickOutlet(outlets: PublicOutlet[], branchId: string | undefined): PublicOutlet | null {
  return outlets.find((o) => o.branch_id === branchId) ?? outlets[0] ?? null;
}

function OutletSwitcher({ outlets, selected }: { outlets: PublicOutlet[]; selected: PublicOutlet }) {
  const hours = openingHours(selected.open_time, selected.close_time);
  const address = [selected.address, selected.city].filter(Boolean).join(", ");
  return (
    <div className="space-y-3">
      {outlets.length > 1 ? (
        <nav aria-label="Pilih outlet" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
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
    <article className="flex h-full flex-col gap-4 rounded-card bg-card p-6 shadow-card">
      <div className="space-y-1.5">
        <h3 className="font-display text-xl font-semibold">{treatment.name}</h3>
        <p className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-accent">{durationsLabel(treatment.variants)}</p>
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

function Menu({ treatments, outlet }: { treatments: Loaded<PublicTreatment[]>; outlet: PublicOutlet }) {
  const outletName = outlet.name;
  if (!treatments.ok) {
    return <EmptyNote>Menu treatment {outletName} belum bisa dimuat. Muat ulang halaman sebentar lagi, atau langsung lanjut ke booking.</EmptyNote>;
  }
  const groups = groupByCategory(treatments.data);
  if (groups.length === 0) {
    return <EmptyNote>Belum ada treatment yang bisa di-booking online di {outletName}. Coba outlet lain atau hubungi kami.</EmptyNote>;
  }
  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <section key={group.category} aria-labelledby={`cat-${group.category}`} className="space-y-4">
          <h2 id={`cat-${group.category}`} className="font-display text-2xl font-semibold md:text-3xl">
            {group.category}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.treatments.map((t) => (
              <TreatmentCard key={t.id} treatment={t} outlet={outlet} />
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Harga berlaku di {outletName} dan dapat berubah sewaktu-waktu. Pembayaran dilakukan langsung di outlet.</p>
    </div>
  );
}

export function TreatmentsPage({ guide, outlets, selected, treatments }: {
  guide: TrainingContent;
  outlets: Loaded<PublicOutlet[]>;
  selected: PublicOutlet | null;
  treatments: Loaded<PublicTreatment[]>;
}) {
  return (
    <>
      <Section className="pb-6">
        <Container className="space-y-6">
          <SectionHeading as="h1" kicker="Treatment" title={guide.intro.title} text={guide.intro.text || undefined} />
          <BookingButton size="lg">Booking sekarang</BookingButton>
        </Container>
      </Section>

      <Section className="pt-4">
        <Container className="space-y-8">
          {!outlets.ok ? (
            <EmptyNote>Menu treatment belum bisa dimuat. Muat ulang halaman sebentar lagi, atau langsung lanjut ke booking.</EmptyNote>
          ) : !selected ? (
            <EmptyNote>Belum ada outlet yang membuka booking online.</EmptyNote>
          ) : (
            <>
              <OutletSwitcher outlets={outlets.data} selected={selected} />
              <Menu treatments={treatments} outlet={selected} />
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
        <p role="status" className="sr-only">Memuat menu treatment…</p>
      </Container>
    </Section>
  );
}
