import { Container } from "../ui/container";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { MediaFrame } from "../ui/media-frame";
import { landingHeroNarrative } from "../../lib/product-narrative";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% -5%, var(--glow-warm) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 50% 10%, var(--glow-accent) 0%, transparent 60%)",
        }}
      />

      <Container className="relative pb-16 pt-20 md:pb-24 md:pt-28 lg:pt-36">
        <div className="flex flex-col items-center text-center">
          <Badge className="enter-rise">{landingHeroNarrative.eyebrow}</Badge>

          <h1
            className="enter-rise mt-7 max-w-[17ch] text-balance text-[40px] font-medium leading-[1.04] tracking-[-0.03em] text-[var(--text)] md:text-[54px] lg:text-[64px]"
            style={{ animationDelay: "0.06s" }}
          >
            {landingHeroNarrative.titleLine1} {landingHeroNarrative.titleLine2}
          </h1>

          <p
            className="enter-rise mt-6 max-w-[60ch] text-lg leading-relaxed text-[var(--muted)] md:text-xl"
            style={{ animationDelay: "0.12s" }}
          >
            {landingHeroNarrative.description}
          </p>

          <div
            className="enter-rise mt-9 flex flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: "0.18s" }}
          >
            <Button href="#download">Download</Button>
            <Button href="#how-it-works" variant="ghost">
              How it works
            </Button>
          </div>

          <p
            className="eyebrow enter-rise mt-6 text-sm text-[var(--muted)]"
            style={{ animationDelay: "0.24s" }}
          >
            {landingHeroNarrative.availability}
          </p>
        </div>

        <div className="enter-rise relative mt-14 md:mt-20" style={{ animationDelay: "0.3s" }}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-8 -top-10 bottom-0"
            style={{
              filter: "blur(52px)",
              background:
                "radial-gradient(55% 45% at 50% 22%, var(--aurora-mint) 0%, transparent 70%)," +
                "radial-gradient(45% 40% at 22% 65%, var(--aurora-teal) 0%, transparent 72%)," +
                "radial-gradient(45% 42% at 80% 60%, var(--aurora-lime) 0%, transparent 72%)",
            }}
          />
          <div className="relative z-10">
            <MediaFrame
              src="/images/dashboard.webp"
              alt="AgentCompany desktop dashboard showing the quarter goal, budget, agent workload, and recent runs"
              priority
            />
          </div>
        </div>
      </Container>
    </section>
  );
}
