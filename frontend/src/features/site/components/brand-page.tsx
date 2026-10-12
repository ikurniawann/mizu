import { Markdown } from "../lib/markdown";
import type { BrandContent } from "../types";
import { BookingButton } from "./booking-link";
import { Container, Picture, Section, SectionHeading, Tile } from "./site-section";
import { photoOr, SITE_PHOTOS } from "../lib/photos";

export function BrandPage({ brand }: { brand: BrandContent }) {
  return (
    <>
      <Section className="pb-6">
        <Container>
          <SectionHeading as="h1" kicker="Tentang" title={brand.title} text={brand.intro} />
        </Container>
      </Section>
      <Section className="pt-4">
        <Container className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-12">
          <div className="space-y-8">
            <Markdown source={brand.story_md} className="prose-site" />
            <BookingButton>Booking treatment</BookingButton>
          </div>
          <Picture src={photoOr(brand.image_url, SITE_PHOTOS.hero)} alt="" className="aspect-[4/5] w-full rounded-card" />
        </Container>
      </Section>
      {brand.values.length > 0 ? (
        <Section className="pt-0">
          <Container className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {brand.values.map((v, i) => (
              <Tile key={`${v.title}-${i}`} className="space-y-2">
                <h2 className="font-display text-xl font-semibold">{v.title}</h2>
                <p className="text-sm text-body">{v.text}</p>
              </Tile>
            ))}
          </Container>
        </Section>
      ) : null}
    </>
  );
}
