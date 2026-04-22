"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { platformSupportSummary } from "../lib/platform-support";

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

function FaqItem({ question, answer, index }: { question: string; answer: string; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, delay: 0.06 * index, ease: [0.16, 1, 0.3, 1] }}
      className="border-b border-[var(--border)] last:border-b-0"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-6 text-left transition-colors duration-200 hover:text-[var(--accent)]"
      >
        <h3 className="text-base lg:text-lg font-semibold text-[var(--text)] pr-4">{question}</h3>
        <span
          className={`shrink-0 text-[var(--muted)] transition-transform duration-300 ${open ? "rotate-45" : ""}`}
          aria-hidden="true"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </span>
      </button>

      <div className={`overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? "max-h-96 pb-6" : "max-h-0"}`}>
        <p className="text-[var(--muted-strong)] leading-relaxed text-base pr-12">{answer}</p>
      </div>
    </motion.div>
  );
}

export function FAQ() {
  return (
    <section id="faq" className="py-24 lg:py-40 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-16 lg:mb-20"
        >
          <p className="font-mono text-xs font-medium uppercase tracking-[0.25em] text-[var(--accent)] mb-5">FAQ</p>
          <h2 className="font-serif text-[clamp(2rem,1.5rem+2.5vw,3.25rem)] tracking-[-0.01em] text-[var(--text)]">
            Frequently Asked Questions
          </h2>
        </motion.div>

        <div className="border-t border-[var(--border)]">
          {faqs.map((item, index) => (
            <FaqItem key={item.question} question={item.question} answer={item.answer} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
