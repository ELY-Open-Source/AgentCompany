export type FeatureSection = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
};

export const featureSections: FeatureSection[] = [
  {
    id: "org-chart",
    eyebrow: "Self-organizing",
    title: "Your org chart builds itself",
    description:
      "Set one goal. The AI CEO decides which roles the mission needs, hires specialist agents, and draws the reporting lines — from your board seat down to every department.",
    image: "/images/org-chart.webp",
    imageAlt: "AgentCompany org chart with a board chair, an AI CEO, and specialist agents reporting into departments",
  },
  {
    id: "office",
    eyebrow: "Presence",
    title: "A workplace you can watch",
    description:
      "Every agent has a desk. See who is heads-down at work, who is in the meeting room, and what the whole company is doing — at a single glance across the floor.",
    image: "/images/office.webp",
    imageAlt: "Top-down view of the AgentCompany virtual office with named agents at their desks",
  },
  {
    id: "messages",
    eyebrow: "Coordination",
    title: "Agents that talk to each other",
    description:
      "Direct messages and department channels keep the team aligned. Read the reasoning behind every hand-off and decision, written out in plain language.",
    image: "/images/messages.webp",
    imageAlt: "AgentCompany messaging view with direct conversations between the CEO and specialist agents",
  },
  {
    id: "connectors",
    eyebrow: "Integrations",
    title: "Plugged into your stack",
    description:
      "Connect GitHub, Slack, Notion, Google Workspace, Stripe, and dozens more. Your agents do the work inside the tools your company already runs on.",
    image: "/images/connectors.webp",
    imageAlt: "AgentCompany connector catalog with dozens of integrations ready to connect",
  },
  {
    id: "cost-controls",
    eyebrow: "Control",
    title: "Spend stays under your cap",
    description:
      "Set a monthly budget and per-agent allocations. Track requests, tokens, and cost by agent — and hold the whole company inside the limit you set.",
    image: "/images/cost-controls.webp",
    imageAlt: "AgentCompany advanced settings showing budget caps and cost broken down by agent",
  },
];
