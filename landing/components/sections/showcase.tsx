import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { Aurora } from "../ui/aurora";

export function Showcase() {
  return (
    <section className="relative overflow-hidden bg-[var(--band)] text-[var(--band-text)]">
      <Aurora />
      <Container className="relative py-24 md:py-32 lg:py-40">
        <Reveal className="mx-auto max-w-4xl text-center">
          <p className="eyebrow text-sm opacity-60">One human in the loop</p>
          <h2 className="mt-6 font-serif text-[clamp(2.25rem,1.4rem+3.6vw,4.5rem)] font-light leading-[1.05] tracking-[-0.02em]">
            Set the goal.
            <br />
            The company forms around it.
          </h2>
          <p className="mx-auto mt-6 max-w-[52ch] text-lg leading-relaxed opacity-75">
            An AI CEO hires the roles the mission needs, delegates the work, and reports back — while you keep the final
            say on every decision that matters.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
