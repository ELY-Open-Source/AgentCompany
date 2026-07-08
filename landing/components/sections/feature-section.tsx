import { Reveal } from "../ui/reveal";
import { SectionHeading } from "../ui/section-heading";
import { MediaFrame } from "../ui/media-frame";
import type { FeatureSection as FeatureSectionData } from "../../lib/landing-content";

/** One feature: heading + subhead above a full-width product panel (adaline rhythm). */
export function FeatureSection({ feature }: { feature: FeatureSectionData }) {
  return (
    <div id={feature.id} className="flex scroll-mt-24 flex-col gap-8 md:gap-10">
      <Reveal>
        <SectionHeading eyebrow={feature.eyebrow} title={feature.title} description={feature.description} />
      </Reveal>
      <Reveal delay={90}>
        <MediaFrame src={feature.image} alt={feature.imageAlt} />
      </Reveal>
    </div>
  );
}
