import type { TrainingContent } from "../types";
import { Container, Section, SectionHeading, Tile } from "./site-section";

/**
 * The editable Paddy Experience guide (content key "training"): which studio
 * service suits which need, the visit steps and what to know before a session.
 */

export function TreatmentNeeds({ needs, className }: { needs: TrainingContent["class_types"]; className?: string }) {
  if (needs.length === 0) return null;
  return (
    <Section className={className}>
      <Container className="space-y-8">
        <SectionHeading kicker="Which Paddy are you?" title="Pilih sesuai kebutuhanmu" text="Belum yakin mau sesi apa? Mulai dari barang yang paling ingin kamu bikin lucu hari ini." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {needs.map((need, i) => (
            <Tile key={`${need.name}-${i}`} className="flex h-full flex-col gap-2">
              <h3 className="font-display text-xl font-semibold">{need.name}</h3>
              {need.duration ? <p className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-brand-text">{need.duration}</p> : null}
              <p className="text-sm text-body">{need.text}</p>
            </Tile>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export function VisitSteps({ block }: { block: TrainingContent["block"] }) {
  if (block.phases.length === 0) return null;
  return (
    <Section className="bg-ink text-on-ink">
      <Container className="space-y-8">
        <SectionHeading kicker="Kunjunganmu ke Experience Room" title={block.title} text={block.text} onInk />
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {block.phases.map((step, i) => (
            <li key={`${step.name}-${i}`} className="rounded-card border-2 border-white/15 bg-white/5 p-5">
              <p className="text-xs font-semibold tracking-wider text-sunny uppercase">{step.weeks}</p>
              <h3 className="font-display mt-2 text-lg font-semibold">{step.name}</h3>
              <p className="mt-2 text-sm text-on-ink-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}

export function BeforeTreatment({ laws }: { laws: TrainingContent["laws"] }) {
  if (laws.items.length === 0) return null;
  return (
    <Section>
      <Container className="space-y-6">
        <SectionHeading kicker="Untuk kenyamananmu" title={laws.title} />
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {laws.items.map((item, i) => (
            <li key={i} className="flex gap-4 rounded-card bg-card p-5 shadow-card">
              <span className="font-display text-2xl font-bold text-forest tabular-nums dark:text-brand-text">{String(i + 1).padStart(2, "0")}</span>
              <p className="self-center text-body">{item}</p>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
