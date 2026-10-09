import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicOutlet, PublicTreatment } from "@/features/spa/types";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { bookable, durationsLabel, featured, openingHours, startingPrice } from "../lib/treatments";
import type { BranchSummary, HomeContent, SocialContent } from "../types";
import { BookingButton, bookingHref } from "./booking-link";
import { Container, Picture } from "./site-section";

/** The seniors promo runs at the Westhoff outlet (branch slug from the seed). */
const PROMO_BRANCH_SLUG = "mizu-westhoff";
/** Brand art used wherever the CMS has no photo yet. */
const WALLPAPER = "/brand/mizu-wallpaper.webp";

/**
 * Mizu home: a calm, image-led page in five parts — full-bleed hero, a short
 * about, one booking card, a few offers and a closing call to action. The
 * header floats over the hero (see SiteHeader).
 */
export function HomePage({ home, social, branches, outlet, treatments }: {
  home: HomeContent;
  social?: SocialContent;
  branches: BranchSummary[];
  /** The outlet whose prices the treatment card shows. */
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
    <section className="relative isolate overflow-hidden rounded-b-[2.5rem] bg-ink text-white md:rounded-b-[4rem]">
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
        <Picture src={hero.image_url || WALLPAPER} alt="" className="absolute inset-0 -z-20 h-full w-full" />
      )}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-ink/80 via-ink/20 to-ink/40" />
      <Container className="flex min-h-[88dvh] flex-col justify-end gap-8 pt-40 pb-16 md:min-h-[92dvh] md:pb-24">
        <div className="max-w-3xl space-y-5">
          {hero.kicker ? <p className="text-xs font-medium tracking-[0.3em] text-white/75 uppercase">{hero.kicker}</p> : null}
          <h1 className="font-display text-5xl font-medium tracking-tight text-balance sm:text-6xl md:text-7xl">{hero.title}</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <BookingButton size="lg">{hero.cta_label || "Booking sekarang"}</BookingButton>
          <Button asChild variant="onInk" size="lg">
            <Link href="/treatments">Lihat treatment</Link>
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
    <section className="py-20 md:py-28">
      <Container className="max-w-3xl space-y-6 text-center">
        <p className="text-sm tracking-wide text-body">Tentang kami</p>
        <h2 className="font-display text-4xl font-medium tracking-tight text-balance md:text-5xl">Mizu Family Massage &amp; Reflexology</h2>
        {subtitle ? <p className="text-base leading-relaxed text-body md:text-lg">{subtitle}</p> : null}
        {names.length > 0 ? (
          <p className="text-base leading-relaxed text-body md:text-lg">
            {names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} dan ${names.at(-1)}`} di Bandung
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
                @mizufamily.id
              </a>
            </Button>
          ) : null}
        </div>
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
        <div className="grid overflow-hidden rounded-hero bg-card shadow-float md:grid-cols-[1.35fr_1fr]">
          <div className="flex flex-col justify-center gap-6 p-8 md:p-14 lg:p-16">
            <h2 className="font-display text-3xl font-medium tracking-tight text-balance md:text-4xl">Treatment untuk setiap lelah.</h2>
            <p className="max-w-lg leading-relaxed text-body">
              {categories.length > 0 ? `${categories.join(", ")}.` : "Pijat, refleksi dan perawatan tubuh."}{" "}
              {from !== null && outlet ? `Mulai ${formatRupiah(from)} di ${outlet.name}. ` : ""}
              Pilih treatment dan jam yang pas, lalu bayar di outlet setelah treatment.
            </p>
            <div className="flex flex-wrap gap-3">
              <BookingButton size="lg" variant="ink" className="px-7" outlet={outlet?.slug}>
                Booking sekarang
              </BookingButton>
              <Button asChild size="lg" variant="outline" className="px-7">
                <Link href="/treatments">
                  Lihat menu <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
          <div className="relative min-h-72 bg-ink md:min-h-[26rem]">
            <Picture src={photo || WALLPAPER} alt="" className={cn("absolute inset-0 h-full w-full", !photo && "object-[60%_center]")} />
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
  /** Background treatment for cards without a photo. */
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
      title: "Buy 1 Get 1 untuk usia 60+",
      href: bookingHref({ outlet: promoBranch.slug }),
      tone: "from-ink/90 via-ink/40 to-transparent",
      imagePosition: "object-[50%_35%]",
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
      tone: "from-accent-dark/90 via-ink/50 to-ink/10",
      imagePosition: "object-[20%_60%] scale-x-[-1]",
    });
  }
  offers.push({
    key: "together",
    eyebrow: "Me-time berdua atau bersama keluarga, di ruangan yang sama.",
    title: "Better together.",
    href: bookingHref(),
    tone: "from-ink/95 via-ink/50 to-ink/20",
    imagePosition: "object-[80%_80%]",
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
            <p className="text-sm tracking-wide text-body">Spesial</p>
            <h2 className="font-display text-4xl font-medium tracking-tight md:text-5xl">Penawaran &amp; momen</h2>
          </div>
          <p className="leading-relaxed text-body md:text-right">
            Promo dan ritual pilihan untuk melengkapi waktu istirahatmu. Tanyakan detail promo ke tim outlet saat booking.
          </p>
        </div>
        <div className="space-y-4">
          {offers.map((o) => (
            <Link
              key={o.key}
              href={o.href}
              className="group relative isolate flex h-72 items-end overflow-hidden rounded-card bg-ink p-6 text-white md:h-96 md:p-8"
            >
              <Picture
                src={WALLPAPER}
                alt=""
                className={cn("absolute inset-0 -z-20 h-full w-full transition duration-700 group-hover:scale-105", o.imagePosition)}
              />
              <div aria-hidden className={cn("absolute inset-0 -z-10 bg-gradient-to-t", o.tone)} />
              <div className="flex w-full items-end justify-between gap-6">
                <div className="space-y-2">
                  <p className="text-xs tracking-wide text-white/75 md:text-sm">{o.eyebrow}</p>
                  <h3 className="font-display text-2xl font-medium md:text-3xl">{o.title}</h3>
                </div>
                <span className="hidden shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur transition group-hover:bg-white/20 sm:flex">
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
        <Sparkles className="mx-auto size-6 text-forest dark:text-accent" />
        <h2 className="font-display text-4xl font-medium tracking-tight text-balance md:text-5xl">Siap untuk istirahat sejenak?</h2>
        <p className="leading-relaxed text-body md:text-lg">Booking online dalam satu menit. Pembayaran langsung di outlet.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <BookingButton size="lg" className="px-8">Booking sekarang</BookingButton>
          <Button asChild variant="outline" size="lg" className="px-8">
            <Link href="/locations">Lihat lokasi</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}
