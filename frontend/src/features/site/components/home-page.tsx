import Link from "next/link";
import { ArrowRight, Camera, MapPin, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicOutlet, PublicTreatment } from "@/features/spa/types";
import { formatRupiah } from "@/lib/format";
import { durationsLabel, featured, startingPrice } from "../lib/treatments";
import type { Article, BranchSummary, HomeContent, SiteEvent, SocialContent, TrainingContent } from "../types";
import { BookingButton } from "./booking-link";
import { HomeLatest, MemberStories } from "./home-discovery";
import { Container, Kicker, Picture, Section, SectionHeading, Tile } from "./site-section";
import { TreatmentNeeds } from "./treatment-guide";

/** Taglines from Mizu's own Instagram posts; quotes without names, not reviews. */
const MOMENTS = [
  { title: "Walked all day?", text: "Your feet need this. Refleksi kaki untuk melepas penat setelah seharian berjalan." },
  { title: "You need some me-time.", text: "Satu sesi untuk diri sendiri: ponsel diheningkan, napas melambat." },
  { title: "A traditional Indonesian wellness experience.", text: "Pijat tradisional Jawa, lulur dan totok wajah, warisan perawatan nusantara." },
  { title: "Better together.", text: "Me-time berdua atau bersama keluarga, di ruangan yang sama." },
] as const;

/** The seniors promo runs at the Westhoff outlet (branch slug from the seed). */
const PROMO_BRANCH_SLUG = "mizu-westhoff";

function Hero({ hero }: { hero: HomeContent["hero"] }) {
  return (
    <section className="relative isolate overflow-hidden bg-ink text-on-ink">
      {hero.video_url ? (
        <video
          className="absolute inset-0 -z-10 h-full w-full object-cover opacity-40"
          src={hero.video_url}
          poster={hero.image_url || undefined}
          autoPlay
          muted
          loop
          playsInline
        />
      ) : hero.image_url ? (
        <Picture src={hero.image_url} alt="" className="absolute inset-0 -z-10 h-full w-full opacity-40" />
      ) : (
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-32 -z-10 size-96 rounded-full bg-accent/25 blur-3xl" />
      )}
      <Container className="flex min-h-[70dvh] flex-col justify-end gap-6 py-16 md:min-h-[78dvh] md:py-24">
        <div className="max-w-3xl space-y-4">
          {hero.kicker ? <Kicker onInk>{hero.kicker}</Kicker> : null}
          <h1 className="font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-6xl">{hero.title}</h1>
          {hero.subtitle ? <p className="max-w-xl text-base text-on-ink-muted md:text-lg">{hero.subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <BookingButton size="lg">{hero.cta_label || "Booking Sekarang"}</BookingButton>
          <Button asChild variant="onInk" size="lg">
            <Link href="/treatments">
              <Sparkles /> Lihat treatment
            </Link>
          </Button>
          <Button asChild variant="onInk" size="lg">
            <Link href="/locations">
              <MapPin /> Lokasi
            </Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}

function Partners({ partners }: { partners: HomeContent["partners"] }) {
  if (partners.length === 0) return null;
  return (
    <div className="border-b border-border/60 bg-surface">
      <Container className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 py-6">
        {partners.map((p) => (
          <span key={p.name} className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            {p.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.logo_url} alt={p.name} className="h-7 w-auto" loading="lazy" />
            ) : (
              p.name
            )}
          </span>
        ))}
      </Container>
    </div>
  );
}

function Pillars({ pillars }: { pillars: HomeContent["pillars"] }) {
  if (pillars.length === 0) return null;
  return (
    <Section>
      <Container className="space-y-8">
        <SectionHeading kicker="Kenapa Mizu" title="Jeda yang kamu butuhkan" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {pillars.map((p, i) => (
            <Tile key={`${p.code}-${i}`} className="space-y-3">
              <p className="font-display text-sm font-bold tracking-wider text-forest uppercase dark:text-accent">{p.code}</p>
              <h3 className="font-display text-xl font-semibold">{p.title}</h3>
              <p className="text-sm text-body">{p.text}</p>
            </Tile>
          ))}
        </div>
      </Container>
    </Section>
  );
}

function SignatureTreatments({ outlet, treatments }: { outlet: PublicOutlet | null; treatments: PublicTreatment[] }) {
  const pick = featured(treatments);
  if (!outlet || pick.length === 0) return null;
  const menuHref = `/treatments?outlet=${encodeURIComponent(outlet.branch_id)}`;
  return (
    <Section className="bg-surface">
      <Container className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading kicker="Treatment" title="Treatment pilihan" text={`Harga di ${outlet.name}. Lihat menu lengkap untuk outlet lain.`} />
          <Button asChild variant="outline">
            <Link href={menuHref}>
              Semua treatment <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pick.map((t) => {
            const from = startingPrice(t.variants);
            return (
              <Link key={t.id} href={menuHref} className="group block">
                <Tile className="flex h-full flex-col gap-2 transition-shadow group-hover:shadow-float">
                  {t.category ? <p className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-accent">{t.category}</p> : null}
                  <h3 className="font-display text-xl font-semibold">{t.name}</h3>
                  {t.description ? <p className="line-clamp-2 text-sm text-body">{t.description}</p> : null}
                  <p className="mt-auto flex flex-wrap items-baseline justify-between gap-2 pt-3 text-sm">
                    <span className="text-muted-foreground">{durationsLabel(t.variants)}</span>
                    {from !== null ? <span className="font-semibold text-foreground">mulai {formatRupiah(from)}</span> : null}
                  </p>
                </Tile>
              </Link>
            );
          })}
        </div>
        <BookingButton outlet={outlet.slug}>Booking treatment</BookingButton>
      </Container>
    </Section>
  );
}

function Mission({ mission }: { mission: HomeContent["mission"] }) {
  if (!mission.quote) return null;
  return (
    <Section className="py-0">
      <Container>
        <figure className="rounded-hero bg-accent px-6 py-12 text-accent-foreground shadow-glow md:px-16 md:py-20">
          <blockquote className="font-display max-w-3xl text-2xl font-semibold text-balance md:text-4xl">“{mission.quote}”</blockquote>
          {mission.author ? <figcaption className="mt-6 text-sm font-semibold">{mission.author}</figcaption> : null}
        </figure>
      </Container>
    </Section>
  );
}

function Moments({ instagram, promoHref }: { instagram: string; promoHref: string }) {
  return (
    <Section>
      <Container className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading kicker="@mizufamily.id" title="Warm up. Slow down." text="Sedikit cerita dari Instagram kami." />
          {instagram ? (
            <Button asChild variant="outline">
              <a href={instagram} target="_blank" rel="noopener noreferrer">
                <Camera className="size-4" /> Ikuti di Instagram
              </a>
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <article className="flex flex-col justify-between gap-6 rounded-card bg-ink p-6 text-on-ink md:row-span-2">
            <div className="space-y-3">
              <p className="text-xs font-semibold tracking-wider text-accent uppercase">Promo</p>
              <h3 className="font-display text-3xl font-bold text-balance">Buy 1 Get 1 untuk usia 60+</h3>
              <p className="text-sm text-on-ink-muted">Setiap hari kerja di Mizu 1.0, Jl. Westhoff No. 1. Tanyakan detail promo ke tim outlet.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <BookingButton size="sm" outlet={PROMO_BRANCH_SLUG}>Booking</BookingButton>
              <Button asChild size="sm" variant="onInk">
                <Link href={promoHref}>Lihat outlet</Link>
              </Button>
            </div>
          </article>
          {MOMENTS.map((m) => (
            <figure key={m.title} className="rounded-card bg-card p-6 shadow-card">
              <blockquote className="font-display text-xl font-semibold text-balance">“{m.title}”</blockquote>
              <figcaption className="mt-3 text-sm text-body">{m.text}</figcaption>
            </figure>
          ))}
        </div>
      </Container>
    </Section>
  );
}

function Reel({ reel }: { reel: HomeContent["reel"] }) {
  if (reel.length === 0) return null;
  const hasSamples = reel.some((item) => item.caption.startsWith("Sample photo:"));
  return (
    <Section>
      <Container className="space-y-6">
        <SectionHeading kicker={hasSamples ? "Contoh konten" : "Suasana"} title={hasSamples ? "Pratinjau galeri" : "Momen di Mizu"} text={hasSamples ? "Gambar contoh. Ganti dengan foto asli yang sudah disetujui." : undefined} />
        <ul className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
          {reel.map((item, i) => (
            <li key={`${item.image_url}-${i}`} className="w-[78vw] shrink-0 snap-start sm:w-80">
              <figure className="overflow-hidden rounded-card bg-card shadow-card">
                <Picture src={item.image_url} alt={item.caption} className="aspect-[4/5] w-full" />
                {item.caption ? <figcaption className="px-4 py-3 text-sm text-body">{item.caption}</figcaption> : null}
              </figure>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}

function Outlets({ branches }: { branches: BranchSummary[] }) {
  if (branches.length === 0) return null;
  return (
    <Section>
      <Container className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading kicker="Lokasi" title={branches.length === 2 ? "Dua outlet di Bandung" : "Outlet Mizu"} />
          <Button asChild variant="outline">
            <Link href="/locations">Semua lokasi</Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.slice(0, 3).map((b) => (
            <Tile key={b.slug} className="flex h-full flex-col gap-2">
              <Picture src={b.hero_image_url} alt="" className="-mx-6 -mt-6 mb-4 aspect-[3/2] w-[calc(100%+3rem)] max-w-none rounded-t-card" />
              <h3 className="font-display text-lg font-semibold">{b.name}</h3>
              <p className="flex items-start gap-1.5 text-sm text-body">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                {[b.address, b.city].filter(Boolean).join(", ") || "Alamat segera hadir"}
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                <BookingButton size="sm" outlet={b.slug}>Booking</BookingButton>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/locations/${b.slug}`}>Lihat outlet</Link>
                </Button>
              </div>
            </Tile>
          ))}
        </div>
      </Container>
    </Section>
  );
}

function BookingBand() {
  return (
    <Section className="pb-0">
      <Container>
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-hero bg-ink px-6 py-10 text-on-ink md:px-12">
          <div className="max-w-xl space-y-2">
            <h2 className="font-display text-2xl font-bold md:text-3xl">Siap untuk istirahat sejenak?</h2>
            <p className="text-sm text-on-ink-muted md:text-base">Pilih outlet, treatment dan jam yang pas. Pembayaran dilakukan langsung di outlet.</p>
          </div>
          <BookingButton size="lg">Booking sekarang</BookingButton>
        </div>
      </Container>
    </Section>
  );
}

export function HomePage({ home, guide, social, branches, outlet, treatments, articles, events }: {
  home: HomeContent;
  guide: TrainingContent;
  social: SocialContent;
  branches: BranchSummary[];
  /** The outlet whose prices the treatment teaser shows. */
  outlet: PublicOutlet | null;
  treatments: PublicTreatment[];
  articles: Article[];
  events: SiteEvent[];
}) {
  const promoHref = branches.some((b) => b.slug === PROMO_BRANCH_SLUG) ? `/locations/${PROMO_BRANCH_SLUG}` : "/locations";
  return (
    <>
      <Hero hero={home.hero} />
      <Partners partners={home.partners} />
      <Pillars pillars={home.pillars} />
      <SignatureTreatments outlet={outlet} treatments={treatments} />
      <TreatmentNeeds needs={guide.class_types} />
      <Mission mission={home.mission} />
      <Moments instagram={social.instagram} promoHref={promoHref} />
      <Reel reel={home.reel} />
      <MemberStories stories={home.stories ?? []} />
      <Outlets branches={branches} />
      <HomeLatest articles={articles} events={events} />
      <BookingBand />
    </>
  );
}
