import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { SectionHeading } from "../ui/section-heading";
import { landingHowItWorksNarrative } from "../../lib/product-narrative";

const steps = landingHowItWorksNarrative.steps;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 bg-[var(--bg-subtle)] py-20 md:py-28">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="How it works"
            title={landingHowItWorksNarrative.heading}
            align="center"
            className="mx-auto"
          />
        </Reveal>

        <Reveal delay={80} className="mx-auto mt-14 max-w-2xl">
          <div className="relative">
            <div className="absolute bottom-3 left-5 top-3 w-px bg-[var(--border)]" aria-hidden="true" />
            <ol className="space-y-8">
              {steps.map((step) => (
                <li key={step.number} className="relative flex gap-5">
                  <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-medium text-[var(--text-on-accent)]">
                    {step.number}
                  </span>
                  <div className="pt-1.5">
                    <h3 className="text-base font-medium tracking-tight text-[var(--text)]">{step.title}</h3>
                    <p className="mt-1 leading-relaxed text-[var(--muted)]">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
