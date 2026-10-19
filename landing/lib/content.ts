import type { IconName } from "../components/pixel";

export const description =
  "AgentCompany is a local-first desktop app for running an autonomous AI company. Set a goal; an AI CEO hires a team, delegates real work, and the goal only closes when an isolated auditor approves the evidence.";

export const nav = [
  { label: "Quests", href: "#quests" },
  { label: "Party", href: "#party" },
  { label: "Items", href: "#items" },
  { label: "Save", href: "#save-point" },
];

export type Quest = { stage: string; title: string; icon: IconName; body: string; optional?: boolean };

export const quests: Quest[] = [
  { stage: "1-1", title: "Start", icon: "flag", body: "Pick English or 简体中文 and press Get started. The wizard runs once, on first launch." },
  { stage: "1-2", title: "Provider", icon: "key", body: "Bind one model provider: paste an API key or sign in with a plan you already pay for. Keys are encrypted with your OS secure storage and kept on your machine." },
  { stage: "1-3", title: "Company", icon: "building", body: "Name the company, name yourself as the human board chair, describe the business, and optionally bind a workspace folder." },
  { stage: "1-4", title: "Mode", icon: "sword", body: "Choose how much rope the CEO gets: AI CEO or AI Co-Founder. Character select is just below." },
  { stage: "1-5", title: "Goal", icon: "map", body: "State the first goal and its acceptance criteria, then hit Launch. The CEO starts hiring." },
  { stage: "1-6", title: "Connectors", icon: "plug", body: "Bring your own Composio key and connect the toolkits your project enables. Optional side quest: Skip works.", optional: true },
];

export type Mode = {
  id: "ceo" | "cofounder";
  name: string;
  className: string;
  icon: IconName;
  pitch: string;
  stats: { label: string; value: string }[];
  special: string;
};

export const modes: Mode[] = [
  {
    id: "ceo",
    name: "AI CEO",
    className: "Autonomous",
    icon: "trophy",
    pitch: "Runs on its own: approves its risky work and large hires, and writes deliverables without review.",
    stats: [
      { label: "Risky work", value: "Self-approved" },
      { label: "Large hires", value: "Self-approved" },
      { label: "Deliverables", value: "Ship unreviewed" },
    ],
    special: "Speedrun. You watch; it plays.",
  },
  {
    id: "cofounder",
    name: "AI Co-Founder",
    className: "Co-op",
    icon: "heart",
    pitch: "Checks with you: risky work and large hires wait for you, and deliverables wait for your review.",
    stats: [
      { label: "Risky work", value: "Your Approvals" },
      { label: "Large hires", value: "Your Approvals" },
      { label: "Deliverables", value: "Your review" },
    ],
    special: "Player 2 has the controller for the big calls.",
  },
];

export const items: { icon: IconName; name: string; description: string }[] = [
  { icon: "building", name: "Pixel office", description: "An isometric office where you watch agents walk between desks, coffee and meetings. The lighting follows your real clock." },
  { icon: "chat", name: "CEO chat", description: "Messages between agents and with you, with the CEO's line pinned on top. Chat follows the app language." },
  { icon: "approve", name: "Audited goals", description: "A goal only ends when an isolated auditor approves the evidence. No 'trust me, it's done'." },
  { icon: "check", name: "Approvals", description: "In Co-Founder mode, risky work and large hires queue here until you say yes." },
  { icon: "folder", name: "Files & library", description: "Every file the team produces, plus a library of docs and knowledge your agents can read." },
  { icon: "plug", name: "Connectors", description: "Your own Composio key unlocks the toolkits your Composio project enables. logo.dev keeps the logos crisp." },
  { icon: "sparkle", name: "Skills", description: "Agents carry the skills you grant them, plus an automatic humanizer house style for conversational writing." },
  { icon: "book", name: "EN / 中文", description: "The whole app speaks English and 简体中文. Switch any time." },
  { icon: "lock", name: "Local-first vault", description: "Keys encrypted with your OS secure storage, data in SQLite on your machine, no account to create." },
];

export type PartyClass = { name: string; badge: string; icon: IconName; blurb: string; members: string[] };

export const party: PartyClass[] = [
  {
    name: "API key",
    badge: "Key",
    icon: "key",
    blurb: "Paste a key and go. OpenAI defaults to gpt-6.1-sol.",
    members: ["OpenAI", "Anthropic", "xAI Grok", "Groq", "Mistral", "Cerebras", "OpenRouter", "Kimi", "Kimi CN"],
  },
  {
    name: "Plan sign-in",
    badge: "Sign-in",
    icon: "user",
    blurb: "Use a subscription you already have.",
    members: ["Claude Pro/Max", "GitHub Copilot", "Kimi Code", "GPT account (ChatGPT plan)"],
  },
  {
    name: "Cloud",
    badge: "Cloud",
    icon: "building",
    blurb: "Run through your company's cloud.",
    members: ["Azure OpenAI", "AWS Bedrock", "Vertex AI"],
  },
  {
    name: "Custom",
    badge: "Base URL",
    icon: "settings",
    blurb: "Anything that speaks a familiar protocol.",
    members: ["OpenAI-compatible endpoint", "Anthropic-compatible endpoint"],
  },
];

export const faqs: { question: string; answer: string[] }[] = [
  {
    question: "Where do my API keys go?",
    answer: [
      "Encrypted with your OS secure storage (Keychain, DPAPI or libsecret) and saved in a SQLite database on your machine, next to the company itself.",
      "No account, no sign-up. The app talks to the providers you pick, plus the web when agents search or fetch pages, and Composio if you connect it.",
    ],
  },
  {
    question: "Which AI providers can join?",
    answer: [
      "OpenAI, Anthropic, Claude Pro/Max, xAI Grok, Groq, Mistral, Cerebras, OpenRouter, Kimi, Kimi CN, GitHub Copilot, a GPT account on a ChatGPT plan, and Kimi Code.",
      "Also Azure OpenAI, AWS Bedrock, Vertex AI, and any custom OpenAI- or Anthropic-compatible endpoint.",
    ],
  },
  {
    question: "Is the macOS build signed?",
    answer: [
      "Yes. The DMG and ZIP are signed with a Developer ID and notarized by Apple, so Gatekeeper opens them without a fight.",
      "Apple Silicon and Intel each get their own build.",
    ],
  },
  {
    question: "What runs on Linux?",
    answer: ["An AppImage and a .deb package, both x64. Pick whichever your distro likes better."],
  },
  {
    question: "Where does the source live?",
    answer: [
      "On GitHub at github.com/ELY-Open-Source/AgentCompany.",
      "Want to help? Fork it, open a pull request, and you're in the party.",
    ],
  },
  {
    question: "When is a goal actually done?",
    answer: [
      "When an isolated auditor looks at the evidence and approves it. The CEO can't mark its own homework.",
    ],
  },
];

export const credits: { role: string; name: string }[] = [
  { role: "Starring", name: "Your AI CEO" },
  { role: "Supporting cast", name: "Whoever it hires" },
  { role: "Auditor", name: "Isolated. Unbribable." },
  { role: "Board chair", name: "You" },
  { role: "Guide", name: "Bit, the intern" },
];
