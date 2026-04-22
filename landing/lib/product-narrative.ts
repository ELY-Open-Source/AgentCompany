import { releaseVersion } from "../components/release-links.generated";

export const landingHeroNarrative = {
  eyebrow: "AgentCompany Desktop",
  titleLine1: "Launch an Autonomous AI Company",
  titleLine2: "from Your Desktop",
  description:
    "Run AI CEO by default, switch to AI Co-Founder for human-reviewed decisions, and launch the first mission from a local desktop setup.",
  availability: "Available on macOS, Windows, and Linux",
} as const;

export const onboardingFlowNarrative = {
  prelude: "Welcome",
  sections: [
    {
      number: 1,
      title: "Requirements",
      description: "Check Node.js because CLI runtimes call the local API through node -e.",
    },
    {
      number: 2,
      title: "Providers",
      description: "Connect at least one runtime before company creation continues.",
    },
    {
      number: 3,
      title: "Company",
      description: "Enter company name, description, and workspace.",
    },
    {
      number: 4,
      title: "Team Models",
      description: "Enable the models available to the CEO and workers.",
    },
    {
      number: 5,
      title: "Mode",
      description: "Use AI CEO by default, or choose AI Co-Founder for human-reviewed decisions.",
    },
    {
      number: 6,
      title: "Mission",
      description: "Capture the first goal and acceptance description.",
    },
    {
      number: 7,
      title: "Launch",
      description: "Create the company, CEO agent, workspace, kickoff task, and initial run handoff.",
    },
  ],
} as const;

export const landingHowItWorksNarrative = {
  heading: "Follow the Desktop First-Run Flow",
  steps: onboardingFlowNarrative.sections,
  completionText: "Initial run queued. Open Control Center.",
  demoMessages: [
    { agent: "Requirements", role: "system", text: "Node.js ready. CLI runtimes can call the local API.", delay: 0 },
    { agent: "Providers", role: "system", text: "Runtime connected.", delay: 700 },
    { agent: "Company", role: "system", text: "Company profile and workspace saved.", delay: 1400 },
    { agent: "Team Models", role: "system", text: "Model pool enabled for CEO and workers.", delay: 2100 },
    { agent: "Mode", role: "system", text: "AI CEO mode selected.", delay: 2800 },
    { agent: "Mission", role: "system", text: "First goal and acceptance description captured.", delay: 3500 },
    { agent: "Launch", role: "system", text: "Company, CEO agent, kickoff task, and initial run created.", delay: 4400 },
  ],
} as const;

export const landingStructuredDataNarrative = {
  softwareVersion: releaseVersion,
  featureList: [
    "Guided first-run setup",
    "Node.js readiness check for CLI runtimes",
    "Provider connection and model-pool selection",
    "Multi-connector support (Claude Code, Codex CLI, Gemini CLI)",
    "AI CEO autonomous operating mode",
    "AI Co-Founder human-reviewed operating mode",
    "Local-first SQLite storage",
    "Cross-platform desktop releases for macOS, Windows, and Linux",
  ],
};
