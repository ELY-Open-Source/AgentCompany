import { Container } from "../ui/container";
import { FeatureSection } from "./feature-section";
import { featureSections } from "../../lib/landing-content";

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 py-20 md:py-28 lg:py-32">
      <Container className="flex flex-col gap-24 md:gap-32">
        {featureSections.map((feature) => (
          <FeatureSection key={feature.id} feature={feature} />
        ))}
      </Container>
    </section>
  );
}
