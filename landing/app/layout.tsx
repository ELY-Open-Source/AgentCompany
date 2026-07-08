import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "../components/theme-provider";
import {
  landingHowItWorksNarrative,
  landingStructuredDataNarrative,
} from "../lib/product-narrative";
import { platformSupportSummary } from "../lib/platform-support";

const description =
  "Local-first desktop control plane for autonomous AI companies. Set a goal, let an AI CEO assemble specialists, delegate work, and deliver code, research, content, and operations from your desktop.";

export const metadata: Metadata = {
  metadataBase: new URL("https://agent-company.dev"),
  title: "AgentCompany - Launch an Autonomous AI Company from Your Desktop",
  description,
  keywords: [
    "AI company",
    "autonomous AI agents",
    "AI automation",
    "multi-agent system",
    "AI CEO",
    "AI agent orchestration",
    "autonomous agents desktop app",
    "AI task delegation",
    "AI team management",
    "AI code generation",
    "AI content generation",
    "AI research automation",
    "self-organizing AI",
    "AI workforce",
    "Claude Code",
    "Codex CLI",
    "Gemini CLI",
    "multi-agent framework",
    "AI company builder",
  ],
  openGraph: {
    title: "AgentCompany - Launch an Autonomous AI Company from Your Desktop",
    description,
    url: "https://agent-company.dev/",
    siteName: "AgentCompany",
    locale: "en_US",
    images: [
      {
        url: "/screenshots/Dashboard.jpeg",
        width: 1920,
        height: 1080,
        alt: "AgentCompany dashboard showing autonomous AI agents managing a company",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentCompany - Launch an Autonomous AI Company from Your Desktop",
    description,
    images: ["/screenshots/Dashboard.jpeg"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icon.png",
  },
};

const themeScript = `
(function(){try{var t=localStorage.getItem("agentcompany-theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme:dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}})();
`;

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "AgentCompany",
  applicationCategory: "BusinessApplication",
  operatingSystem: "macOS, Windows, Linux",
  url: "https://agent-company.dev",
  downloadUrl: "https://agent-company.dev/#download",
  screenshot: "https://agent-company.dev/screenshots/Dashboard.jpeg",
  softwareVersion: landingStructuredDataNarrative.softwareVersion,
  description,
  featureList: landingStructuredDataNarrative.featureList,
  author: { "@type": "Organization", name: "AgentCompany", url: "https://agent-company.dev" },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "AgentCompany",
  url: "https://agent-company.dev",
  logo: "https://agent-company.dev/icon.png",
};

const howToJsonLd = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to Launch an Autonomous AI Company with AgentCompany",
  description: "Complete the AgentCompany desktop first-run flow and queue the first mission.",
  step: landingHowItWorksNarrative.steps.map((step) => ({
    "@type": "HowToStep",
    position: step.number,
    name: step.title,
    text: step.description,
  })),
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is AgentCompany?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AgentCompany is a local-first desktop application for launching and operating autonomous AI companies. You define the mission, an AI CEO organizes the team, delegates work, and coordinates delivery across engineering, design, research, and operations.",
      },
    },
    {
      "@type": "Question",
      name: "How do I download AgentCompany?",
      acceptedAnswer: {
        "@type": "Answer",
        text: platformSupportSummary.downloadAnswer,
      },
    },
    {
      "@type": "Question",
      name: "What platforms does AgentCompany support?",
      acceptedAnswer: {
        "@type": "Answer",
        text: platformSupportSummary.platformAnswer,
      },
    },
    {
      "@type": "Question",
      name: "What AI models can AgentCompany use?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AgentCompany supports multiple AI runtimes as first-class connectors: Claude Code, Codex CLI, and Gemini CLI. You can connect your preferred provider during setup.",
      },
    },
    {
      "@type": "Question",
      name: "How does the AI CEO work?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "When you create a company with a goal, the AI CEO agent analyzes the objective, creates the necessary departments, hires specialized agents for each role, builds an org chart, and delegates tasks. The CEO monitors progress, handles blockers, and coordinates cross-department work.",
      },
    },
    {
      "@type": "Question",
      name: "Is my data private? Does it leave my machine?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AgentCompany is local-first. All data is stored in a local SQLite database on your machine. Secrets are encrypted via an OS-level keychain. The only external communication is between your machine and your AI provider's API.",
      },
    },
    {
      "@type": "Question",
      name: "What can an AI company actually deliver?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AI companies built with AgentCompany can produce code, content, research, business documents, and more. The deliverables depend on the goal you set and the AI runtime you connect.",
      },
    },
    {
      "@type": "Question",
      name: "How are updates delivered?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Desktop updates are published to a Cloudflare-hosted release lane. macOS builds include the signed update metadata required for in-app update checks, while Windows and Linux builds are delivered from the same release host for manual installation.",
      },
    },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="googlebot" content="index, follow, max-video-preview:-1, max-image-preview:large, max-snippet:-1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      </head>
      <body className="bg-[var(--bg)] text-[var(--text)] antialiased transition-colors duration-300">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
