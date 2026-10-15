import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicOutlet, PublicTreatment } from "@/features/spa/types";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SITE_PHOTOS } from "../lib/photos";
import { bookable, durationsLabel, featured, openingHours, startingPrice } from "../lib/treatments";
import type { BranchSummary, HomeContent, SocialContent } from "../types";
import { BookingButton, bookingHref } from "./booking-link";
import { DoodleHeart, GooglyEyes, Sparkle, Squiggle, StickerBadge } from "./doodles";
import { Container, Picture } from "./site-section";

/** The student-day promo runs at the PVJ store (branch slug from the seed). */
const PROMO_BRANCH_SLUG = "paddy-store-pvj";
/** Sample photos (see lib/photos); a CMS photo wins when set. */
const PHOTO = {
  hero: SITE_PHOTOS.hero,
  menu: SITE_PHOTOS.cases,
  promo: SITE_PHOTOS.bags,
  signature: SITE_PHOTOS.pods,
  together: SITE_PHOTOS.accessories,
} as const;

/** Paddy's product lines, shown as stickers under the about text. */
const PRODUCT_LINES = [
  { name: "Paddy Case", image: "/products/paddy/pdy-ct-007.webp", tone: "bg-bubblegum" },
  { name: "Catalogue Case", image: "/products/paddy/pdy-ct-003.webp", tone: "bg-sunny" },
  { name: "Paddy Pods", image: "/products/paddy/pdy-pd-002.webp", tone: "bg-sky" },
  { name: "Paddy Bags", image: "/products/paddy/pdy-bg-002.webp", tone: "bg-lilac" },
  { name: "Pop Socket", image: "/products/paddy/pdy-ps-002.webp", tone: "bg-sunny" },
  { name: "G-Series Watch", image: "/products/paddy/pdy-wt-004.webp", tone: "bg-bubblegum" },
] as const;

/**
 * Paddy home: a playful, colour-blocked page in five parts — doodle hero,
 * a short hello with the product lines, one Paddy Experience booking card, a few
 * offers and a closing call to action. The header floats over the hero (see
 * SiteHeader).
 */
export function HomePage({ home, social, branches, outlet, treatments }: {
  home: HomeContent;
  social?: SocialContent;
  branches: BranchSummary[];
  /** The store whose prices the studio card shows. */
  outlet: PublicOutlet | null;
  treatments: PublicTreatment[];
}) {
  return (
    <>
      <Hero hero={home.hero} />
      <About subtitle={home.hero.subtitle} branches={branches} outlet={outlet} instagram={social?.instagram ?? ""} />
      <MenuCard outlet={outlet} treatments={treatments} photo={branches.find((b) => b.hero_image_url)?.hero_image_url ?? null} />
      <Offers outlet={outlet} treatments={treatments} branches={branches} />
      <Closing />
    </>
  );
}

function Hero({ hero }: { hero: HomeContent["hero"] }) {
  return (
    <section className="relative isolate overflow-hidden rounded-b-[2.5rem] bg-accent text-white md:rounded-b-[4rem]">
      {hero.video_url ? (
        <video
          className="absolute inset-0 -z-20 h-full w-full object-cover"
          src={hero.video_url}
          poster={hero.image_url || undefined}
          autoPlay
          muted
          loop
          playsInline
        />
      ) : (
        <Picture src={hero.image_url || PHOTO.hero} alt="" className="absolute inset-0 -z-20 h-full w-full object-[70%_center]" />
      )}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-berry/85 via-berry/20 to-transparent md:bg-gradient-to-r md:from-berry/80 md:via-berry/30" />
      <Container className="relative flex min-h-[88dvh] flex-col justify-end gap-8 pt-40 pb-16 md:min-h-[92dvh] md:pb-24">
        <GooglyEyes className="absolute top-32 right-6 w-20 -rotate-6 md:top-40 md:right-auto md:left-[42%] md:w-24" />
        <div className="max-w-2xl space-y-5">
          {hero.kicker ? <StickerBadge>{hero.kicker}</StickerBadge> : null}
          <h1 className="font-display text-5xl font-bold tracking-tight text-balance [text-shadow:4px_4px_0_var(--color-navy)] sm:text-6xl md:text-7xl">
            {hero.title}
          </h1>
          {hero.subtitle ? <p className="max-w-xl text-base text-white/90 md:text-lg">{hero.subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <BookingButton size="lg" variant="sticker">{hero.cta_label || "Booking sekarang"}</BookingButton>
          <Button asChild variant="onInk" size="lg">
            <Link href="/treatments">Lihat layanan experience</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}

function About({ subtitle, branches, outlet, instagram }: {
  subtitle: string;
  branches: BranchSummary[];
  outlet: PublicOutlet | null;
  instagram: string;
}) {
  const names = branches.map((b) => b.name);
  const hours = outlet ? openingHours(outlet.open_time, outlet.close_time) : "";
  return (
    <section className="relative py-20 md:py-28">
      <Sparkle className="absolute top-14 left-[8%] size-8 text-sunny" outline />
      <DoodleHeart className="absolute top-24 right-[10%] size-8 rotate-12" fill="var(--color-bubblegum)" />
      <Container className="max-w-3xl space-y-6 text-center">
        <p className="text-sm font-bold tracking-wide text-brand-text">Hai, Paddy Besties!</p>
        <h2 className="font-display text-4xl font-bold tracking-tight text-balance md:text-5xl">Paddy — Your Adorable Companion</h2>
        {subtitle ? <p className="text-base leading-relaxed text-body md:text-lg">{subtitle}</p> : null}
        <p className="text-base leading-relaxed text-body md:text-lg">
          Dari Bandung sejak 2016 (dulu Paddycases): case HP custom, Catalogue Case kolaborasi ilustrator lokal, Paddy Pods,
          Paddy Bags sampai aksesori lucu untuk menemani harimu.
        </p>
        {names.length > 0 ? (
          <p className="text-base leading-relaxed text-body md:text-lg">
            Mampir ke {names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} dan ${names.at(-1)}`} di Bandung
            {hours ? `, buka setiap hari ${hours}` : ""}.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button asChild variant="ink" size="lg" className="px-8">
            <Link href="/brand">Cerita kami</Link>
          </Button>
          {instagram ? (
            <Button asChild variant="ghost" size="lg">
              <a href={instagram} target="_blank" rel="noopener noreferrer">
                @paddy.id
              </a>
            </Button>
          ) : null}
        </div>
      </Container>
      <Container className="mt-14">
        <ul className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-3 md:mx-0 md:grid md:grid-cols-6 md:overflow-visible md:px-0">
          {PRODUCT_LINES.map((line, i) => (
            <li
              key={line.name}
              className={cn(
                "w-36 shrink-0 snap-start rounded-3xl border-2 border-navy p-2 shadow-[4px_4px_0_0_var(--color-navy)] md:w-auto",
                line.tone,
                i % 2 === 0 ? "-rotate-2" : "rotate-2",
              )}
            >
              <Picture src={line.image} alt={line.name} className="aspect-square w-full rounded-2xl bg-white" />
              <p className="px-1 pt-2 pb-1 text-center text-sm font-extrabold text-navy">{line.name}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

function MenuCard({ outlet, treatments, photo }: { outlet: PublicOutlet | null; treatments: PublicTreatment[]; photo: string | null }) {
  const list = bookable(treatments);
  const categories = [...new Set(list.map((t) => t.category?.trim()).filter(Boolean))] as string[];
  const from = startingPrice(list.flatMap((t) => t.variants));
  return (
    <section className="pb-20 md:pb-28">
      <Container>
        <div className="grid overflow-hidden rounded-hero border-2 border-navy bg-card shadow-[6px_6px_0_0_var(--color-navy)] md:grid-cols-[1.35fr_1fr]">
          <div className="flex flex-col justify-center gap-6 p-8 md:p-14 lg:p-16">
            <StickerBadge tone="pink" className="self-start">Paddy Experience</StickerBadge>
            <h2 className="font-display text-3xl font-bold tracking-tight text-balance md:text-4xl">Bikin barang kesayanganmu jadi one of a kind.</h2>
            <p className="max-w-lg leading-relaxed text-body">
              {categories.length > 0 ? `${categories.join(", ")} dengan desain kamu sendiri: tipe HP, stiker, nama, dan background.` : "Custom case dengan desain kamu sendiri: tipe HP, stiker, nama, dan background."}{" "}
              {from !== null && outlet ? `Mulai ${formatRupiah(from)} di ${outlet.name}. ` : ""}
              Pilih layanan dan jam yang pas, lalu bayar di toko setelah sesi selesai.
            </p>
            <div className="flex flex-wrap gap-3">
              <BookingButton size="lg" variant="ink" className="px-7" outlet={outlet?.slug}>
                Booking sekarang
              </BookingButton>
              <Button asChild size="lg" variant="outline" className="px-7">
                <Link href="/treatments">
                  Lihat layanan <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
          <div className="relative min-h-72 bg-sunny md:min-h-[26rem]">
            <Picture src={photo || PHOTO.menu} alt="Custom case Paddy" className="absolute inset-0 h-full w-full" />
          </div>
        </div>
      </Container>
    </section>
  );
}

interface Offer {
  key: string;
  eyebrow: string;
  title: string;
  href: string;
  image: string;
  /** Gradient over the photo, keeps the caption readable. */
  tone: string;
  imagePosition: string;
}

function offersFor(outlet: PublicOutlet | null, treatments: PublicTreatment[], branches: BranchSummary[]): Offer[] {
  const offers: Offer[] = [];
  const promoBranch = branches.find((b) => b.slug === PROMO_BRANCH_SLUG);
  if (promoBranch) {
    offers.push({
      key: "promo",
      eyebrow: `Setiap hari kerja di ${promoBranch.name}`,
      title: "Student Day: diskon 15% Paddy Experience",
      href: bookingHref({ outlet: promoBranch.slug }),
      image: PHOTO.promo,
      tone: "from-navy/90 via-navy/40 to-transparent",
      imagePosition: "object-[center_45%]",
    });
  }
  const signature = featured(treatments, 1)[0];
  if (signature && outlet) {
    const from = startingPrice(signature.variants);
    offers.push({
      key: "signature",
      eyebrow: [durationsLabel(signature.variants), from !== null ? `mulai ${formatRupiah(from)}` : ""].filter(Boolean).join(" · "),
      title: signature.name,
      href: bookingHref({ outlet: outlet.slug, treatment: signature.id }),
      image: PHOTO.signature,
      tone: "from-berry/90 via-berry/40 to-transparent",
      imagePosition: "object-[center_50%]",
    });
  }
  offers.push({
    key: "together",
    eyebrow: "Ajak bestie desain couple case, pulang bawa case kembaran.",
    title: "Better with besties.",
    href: bookingHref(),
    image: PHOTO.together,
    tone: "from-ink/90 via-ink/40 to-transparent",
    imagePosition: "object-[center_50%]",
  });
  return offers;
}

function Offers({ outlet, treatments, branches }: { outlet: PublicOutlet | null; treatments: PublicTreatment[]; branches: BranchSummary[] }) {
  const offers = offersFor(outlet, treatments, branches);
  return (
    <section className="bg-surface py-20 md:py-28">
      <Container className="space-y-12">
        <div className="grid gap-6 md:grid-cols-2 md:items-end">
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-bold tracking-wide text-brand-text">
              <Sparkle className="size-4" /> Spesial
            </p>
            <h2 className="font-display text-4xl font-bold tracking-tight md:text-5xl">Promo &amp; momen seru</h2>
          </div>
          <p className="leading-relaxed text-body md:text-right">
            Promo dan sesi experience pilihan untuk kamu dan bestie. Tanyakan detail promo ke crew toko saat booking.
          </p>
        </div>
        <div className="space-y-4">
          {offers.map((o, i) => (
            <Link
              key={o.key}
              href={o.href}
              className={cn(
                "group relative isolate flex h-72 items-end overflow-hidden rounded-card border-2 border-navy bg-ink p-6 text-white shadow-[5px_5px_0_0_var(--color-navy)] md:h-96 md:p-8",
                i % 2 === 0 ? "md:-rotate-[0.6deg]" : "md:rotate-[0.6deg]",
              )}
            >
              <Picture
                src={o.image}
                alt=""
                className={cn("absolute inset-0 -z-20 h-full w-full transition duration-700 group-hover:scale-105", o.imagePosition)}
              />
              <div aria-hidden className={cn("absolute inset-0 -z-10 bg-gradient-to-t", o.tone)} />
              <div className="flex w-full items-end justify-between gap-6">
                <div className="space-y-2">
                  <p className="text-xs tracking-wide text-white/85 md:text-sm">{o.eyebrow}</p>
                  <h3 className="font-display text-2xl font-bold md:text-3xl">{o.title}</h3>
                </div>
                <span className="hidden shrink-0 items-center gap-2 rounded-full border-2 border-navy bg-sunny px-4 py-2 text-sm font-bold text-navy shadow-[3px_3px_0_0_var(--color-navy)] transition group-hover:-translate-y-0.5 sm:flex">
                  Booking <ArrowRight className="size-4" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </Container>
    </section>
  );
}

function Closing() {
  return (
    <section className="py-20 md:py-28">
      <Container className="max-w-2xl space-y-6 text-center">
        <div className="flex items-center justify-center gap-3 text-brand-text">
          <Squiggle />
          <GooglyEyes className="w-14" />
          <Squiggle />
        </div>
        <h2 className="font-display text-4xl font-bold tracking-tight text-balance md:text-5xl">Grab it, love it!</h2>
        <p className="leading-relaxed text-body md:text-lg">
          Booking sesi Paddy Experience online dalam satu menit, sisanya bayar di toko. Happy shopping, Paddy Besties!
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <BookingButton size="lg" className="px-8">Booking sekarang</BookingButton>
          <Button asChild variant="outline" size="lg" className="px-8">
            <Link href="/locations">Lihat toko</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}
