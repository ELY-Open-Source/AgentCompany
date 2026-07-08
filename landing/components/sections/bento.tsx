"use client";

import { ShieldCheck } from "reicon-react/icons/ShieldCheck";
import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { Eyebrow } from "../ui/eyebrow";
import { SectionHeading } from "../ui/section-heading";
import { featureSections, type FeatureSection } from "../../lib/landing-content";

// Explicit order + column spans so the cells pack into full 12-column rows.
const layout: { id: string; span: string }[] = [
  { id: "org-chart", span: "lg:col-span-7" },
  { id: "cost-controls", span: "lg:col-span-5" },
  { id: "office", span: "lg:col-span-5" },
  { id: "messages", span: "lg:col-span-7" },
  { id: "connectors", span: "lg:col-span-8" },
];

const featureById = new Map(featureSections.map((feature) => [feature.id, feature]));

function CornerGlow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-70"
      style={{ filter: "blur(44px)", background: "radial-gradient(circle, var(--aurora-mint) 0%, transparent 70%)" }}
    />
  );
}

function BentoCard({ feature, span }: { feature: FeatureSection; span: string }) {
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 transition-colors duration-300 hover:border-[var(--border-strong)] lg:p-7 ${span}`}
    >
      <CornerGlow />
      <div className="relative flex flex-col gap-1.5">
        <Eyebrow>{feature.eyebrow}</Eyebrow>
        <h3 className="text-xl font-medium tracking-[-0.02em] text-[var(--text)]">{feature.title}</h3>
        <p className="max-w-[46ch] text-sm leading-relaxed text-[var(--muted)]">{feature.description}</p>
      </div>
      <div className="relative mt-6 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-illustration)] shadow-[0_18px_50px_-24px_rgba(10,29,8,0.28)]">
        <img
          src={feature.image}
          alt={feature.imageAlt}
          width={2400}
          height={1500}
          loading="lazy"
          decoding="async"
          className="block aspect-[16/10] w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.02]"
        />
      </div>
    </div>
  );
}

function LocalFirstCard() {
  return (
    <div
      className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border)] p-7 lg:col-span-4"
      style={{
        background:
          "linear-gradient(160deg, var(--aurora-mint) -40%, transparent 55%), var(--panel)",
      }}
    >
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
        <ShieldCheck size={22} />
      </span>
      <div className="mt-8">
        <h3 className="text-xl font-medium tracking-[-0.02em] text-[var(--text)]">Local-first and private</h3>
        <p className="mt-2 max-w-[36ch] text-sm leading-relaxed text-[var(--muted)]">
          Every company runs on your machine. Data lives in a local SQLite database, secrets are held in your OS
          keychain, and the only network calls go to the AI provider you connect.
        </p>
      </div>
    </div>
  );
}

export function Bento() {
  return (
    <section id="features" className="scroll-mt-20 py-20 md:py-28 lg:py-32">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="The platform"
            title="Everything a company needs, on your desktop"
            description="One goal in — an org that hires itself, works in the open, plugs into your stack, and holds its own budget."
            align="center"
            className="mx-auto"
          />
        </Reveal>

        <Reveal delay={80} className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-12">
          {layout.map(({ id, span }) => {
            const feature = featureById.get(id);
            return feature ? <BentoCard key={id} feature={feature} span={span} /> : null;
          })}
          <LocalFirstCard />
        </Reveal>
      </Container>
    </section>
  );
}
