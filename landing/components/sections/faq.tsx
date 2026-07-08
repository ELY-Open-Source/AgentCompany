"use client";

import { useState } from "react";
import { Plus } from "reicon-react/icons/Plus";
import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { SectionHeading } from "../ui/section-heading";
import { platformSupportSummary } from "../../lib/platform-support";

const faqs = [
  {
    question: "What is AgentCompany?",
    answer:
      "AgentCompany is a local-first desktop application for launching and operating autonomous AI companies. You define the mission, an AI CEO organizes the team, delegates work, and coordinates delivery across engineering, design, research, and operations.",
  },
  {
    question: "How do I download AgentCompany?",
    answer: platformSupportSummary.downloadAnswer,
  },
  {
    question: "What platforms does AgentCompany support?",
    answer: platformSupportSummary.platformAnswer,
  },
  {
    question: "What AI models can AgentCompany use?",
    answer:
      "AgentCompany supports multiple AI runtimes as first-class connectors: Claude Code (Anthropic), Codex CLI (OpenAI), and Gemini CLI (Google). You can connect your preferred provider during setup.",
  },
  {
    question: "How does the AI CEO work?",
    answer:
      "When you create a company with a goal, the AI CEO agent analyzes the objective, creates the necessary departments (Engineering, Design, Marketing, etc.), hires specialized agents for each role, builds an org chart, and delegates tasks. The CEO monitors progress, handles blockers, and coordinates cross-department work — all autonomously.",
  },
  {
    question: "Is my data private? Does it leave my machine?",
    answer:
      "AgentCompany is local-first. All data is stored in a local SQLite database on your machine. Secrets are encrypted via an OS-level keychain. The only external communication is between your machine and your AI provider's API — no data is sent to AgentCompany servers.",
  },
  {
    question: "What can an AI company actually deliver?",
    answer:
      "AI companies built with AgentCompany can produce code (full applications, scripts, APIs), content (blog posts, marketing copy, social media), research (competitive analysis, market research), business documents (business plans, technical specs, strategies), and more. The deliverables depend on the goal you set and the AI runtime you connect.",
  },
  {
    question: "How are updates delivered?",
    answer:
      "Desktop updates are published to a Cloudflare-hosted release lane. macOS builds include the signed update metadata required for in-app update checks, while the Windows and Linux installers and packages are distributed from the same release host.",
  },
];

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group flex w-full cursor-pointer items-center justify-between gap-4 py-5 text-left"
      >
        <span className="text-base font-medium tracking-tight text-[var(--text)] md:text-lg">{question}</span>
        <span
          className={`shrink-0 text-[var(--muted)] transition-transform duration-300 group-hover:text-[var(--text)] ${open ? "rotate-45" : ""}`}
          aria-hidden="true"
        >
          <Plus size={20} />
        </span>
      </button>
      <div
        className={`grid overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "grid-rows-[1fr] pb-5" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0">
          <p className="max-w-[68ch] pr-8 leading-relaxed text-[var(--muted)]">{answer}</p>
        </div>
      </div>
    </div>
  );
}

export function FAQ() {
  return (
    <section id="faq" className="scroll-mt-20 py-20 md:py-28">
      <Container>
        <Reveal>
          <SectionHeading eyebrow="FAQ" title="Frequently asked questions" align="center" className="mx-auto" />
        </Reveal>
        <Reveal delay={80} className="mx-auto mt-12 max-w-3xl border-t border-[var(--border)]">
          {faqs.map((faq) => (
            <FaqItem key={faq.question} question={faq.question} answer={faq.answer} />
          ))}
        </Reveal>
      </Container>
    </section>
  );
}
