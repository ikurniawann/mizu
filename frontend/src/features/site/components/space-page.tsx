import type { SpaceContent } from "../types";
import { BookingButton } from "./booking-link";
import { Container, Picture, Section, SectionHeading } from "./site-section";

export function SpacePage({ space }: { space: SpaceContent }) {
  return (
    <>
      <Section className="pb-6">
        <Container>
          <SectionHeading as="h1" kicker="Suasana" title={space.title} text={space.intro} />
        </Container>
      </Section>
      <Section className="pt-4">
        <Container className="space-y-6 md:space-y-10">
          {space.sections.map((s, i) => (
            <article
              key={`${s.title}-${i}`}
              className="grid grid-cols-1 items-center gap-6 md:grid-cols-2 md:gap-12 md:[&:nth-child(even)>div:first-child]:order-2"
            >
              <Picture src={s.image_url} alt={s.title} className="aspect-[4/3] w-full rounded-card" />
              <div className="space-y-3">
                <h2 className="font-display text-2xl font-semibold md:text-3xl">{s.title}</h2>
                <p className="text-body">{s.text}</p>
              </div>
            </article>
          ))}
          <div className="flex flex-wrap items-center gap-4 pt-4">
            <BookingButton size="lg">Booking treatment</BookingButton>
            <p className="text-sm text-muted-foreground">Pilih outlet dan jam yang pas, bayar di outlet.</p>
          </div>
        </Container>
      </Section>
    </>
  );
}
