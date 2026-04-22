import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { releaseVersion } from "../../landing/components/release-links.generated";
import {
  landingHeroNarrative,
  landingHowItWorksNarrative,
  landingStructuredDataNarrative,
  onboardingFlowNarrative,
} from "../../landing/lib/product-narrative";

describe("landing product narrative", () => {
  it("uses the generated release version for software structured data", () => {
    expect(releaseVersion).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(landingStructuredDataNarrative.softwareVersion).toBe(releaseVersion);
  });

  it("describes the current first-run setup flow", () => {
    expect(landingHeroNarrative).toMatchObject({
      eyebrow: "AgentCompany Desktop",
      titleLine1: "Launch an Autonomous AI Company",
      titleLine2: "from Your Desktop",
    });
    expect(landingHeroNarrative.description).toContain("AI CEO by default");
    expect(landingHeroNarrative.description).toContain("AI Co-Founder for human-reviewed decisions");

    expect(landingHowItWorksNarrative.steps.map((step) => step.title)).toEqual([
      "Requirements",
      "Providers",
      "Company",
      "Team Models",
      "Mode",
      "Mission",
      "Launch",
    ]);
    expect(landingHowItWorksNarrative.demoMessages.map((message) => message.text)).toEqual([
      "Node.js ready. CLI runtimes can call the local API.",
      "Runtime connected.",
      "Company profile and workspace saved.",
      "Model pool enabled for CEO and workers.",
      "AI CEO mode selected.",
      "First goal and acceptance description captured.",
      "Company, CEO agent, kickoff task, and initial run created.",
    ]);
    expect(landingStructuredDataNarrative.featureList).toContain(
      "Multi-connector support (Claude Code, Codex CLI, Gemini CLI)",
    );
  });

  it("keeps first-run documentation ordered by the same setup sections", () => {
    const files = [
      "README.md",
      "docs/rebuild/05-design-system-and-flows.md",
      "landing/README.md",
    ];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const positions = [];
      let searchOffset = 0;

      for (const step of onboardingFlowNarrative.sections) {
        const position = text.indexOf(step.title, searchOffset);
        positions.push(position);
        searchOffset = position + step.title.length;
      }

      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    }
  });
});
