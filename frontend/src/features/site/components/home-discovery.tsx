import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSiteDate } from "../lib/dates";
import type { Article, HomeContent, SiteEvent } from "../types";
import { Container, Picture, Section, SectionHeading } from "./site-section";

export function MemberStories({ stories }: { stories: HomeContent["stories"] }) {
  const published = stories.filter((story) => story.name.trim() && story.quote.trim());
  if (published.length === 0) return null;
  const hasSamples = published.some((story) => story.role === "Sample story");
  return (
    <Section className="bg-surface">
      <Container className="space-y-6">
        <SectionHeading kicker={hasSamples ? "Contoh konten" : "Cerita tamu"} title={hasSamples ? "Pratinjau cerita tamu" : "Kata mereka tentang Mizu"} text={hasSamples ? "Contoh di bawah ini fiktif. Ganti dengan kutipan tamu asli yang sudah disetujui sebelum tayang." : undefined} />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {published.slice(0, 3).map((story, index) => (
            <figure key={`${story.name}-${index}`} className="overflow-hidden rounded-card bg-card shadow-card">
              {story.image_url ? <Picture src={story.image_url} alt={story.name} className="aspect-[4/3] w-full" /> : null}
              <div className="p-6">
                {story.role === "Sample story" ? <p className="mb-3 inline-block rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">Sample story</p> : null}
                {story.outcome ? <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-forest dark:text-accent">{story.outcome}</p> : null}
                <blockquote className="text-base leading-7 text-body">“{story.quote}”</blockquote>
                <figcaption className="mt-5 text-sm font-semibold">{story.name}{story.role && story.role !== "Sample story" ? <span className="font-normal text-muted-foreground"> · {story.role}</span> : null}</figcaption>
              </div>
            </figure>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export function HomeLatest({ articles, events }: { articles: Article[]; events: SiteEvent[] }) {
  if (articles.length === 0 && events.length === 0) return null;
  return (
    <Section>
      <Container className="space-y-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading kicker="Kabar terbaru" title="Dari Mizu" />
          {articles.length > 0 ? <Button asChild variant="outline"><Link href="/news">Semua berita <ArrowRight className="size-4" /></Link></Button> : null}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {events.map((event) => (
            <Link key={event.id} href={`/events/${event.slug}`} className="group block overflow-hidden rounded-card bg-card shadow-card transition-shadow hover:shadow-float">
              {event.cover_image_url ? <Picture src={event.cover_image_url} alt="" className="aspect-[16/10] w-full" /> : null}
              <div className="p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-forest dark:text-accent">Acara · {formatSiteDate(event.starts_at)}</p>
                <h3 className="mt-2 font-display text-lg font-semibold">{event.title}</h3>
                {event.location_text ? <p className="mt-2 flex items-center gap-1 text-sm text-body"><MapPin className="size-4" />{event.location_text}</p> : null}
                <p className="mt-4 text-sm font-semibold text-forest dark:text-accent">Lihat acara <ArrowRight className="inline size-4" /></p>
              </div>
            </Link>
          ))}
          {articles.map((article) => (
            <Link key={article.id} href={`/news/${article.slug}`} className="group block overflow-hidden rounded-card bg-card shadow-card transition-shadow hover:shadow-float">
              {article.cover_image_url ? <Picture src={article.cover_image_url} alt="" className="aspect-[16/10] w-full" /> : null}
              <div className="p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-forest dark:text-accent">Berita</p>
                <h3 className="mt-2 font-display text-lg font-semibold">{article.title}</h3>
                {article.excerpt ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-body">{article.excerpt}</p> : null}
                <p className="mt-4 text-sm font-semibold text-forest dark:text-accent">Baca selengkapnya <ArrowRight className="inline size-4" /></p>
              </div>
            </Link>
          ))}
        </div>
      </Container>
    </Section>
  );
}
