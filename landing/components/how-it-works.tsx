"use client";

import { motion, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const demoMessages = [
  { agent: "You", role: "system", text: "Build a SaaS landing page with pricing, blog, and auth.", delay: 0 },
  { agent: "CEO", role: "ceo", text: "Analyzing goal... Creating departments: Engineering, Design, Content.", delay: 800 },
  { agent: "CEO", role: "ceo", text: "Hiring 4 specialists for this mission.", delay: 1600 },
  { agent: "Lead Engineer", role: "engineer", text: "Picked up task: Set up Next.js project with auth routes.", delay: 2400 },
  { agent: "UI Designer", role: "designer", text: "Picked up task: Design landing page and pricing components.", delay: 3000 },
  { agent: "Researcher", role: "researcher", text: "Picked up task: Competitive analysis of SaaS pricing models.", delay: 3600 },
  { agent: "Lead Engineer", role: "engineer", text: "Completed: Auth scaffolding with JWT + session middleware.", delay: 4400 },
  { agent: "UI Designer", role: "designer", text: "Completed: Responsive landing page with 3-tier pricing grid.", delay: 5200 },
  { agent: "CEO", role: "ceo", text: "All tasks delivered. 3 documents ready for review.", delay: 6000 },
];

const logTone: Record<(typeof demoMessages)[number]["role"], string> = {
  system: "text-[var(--muted-strong)]",
  ceo: "text-[#ca8a04]",
  engineer: "text-[var(--accent)]",
  designer: "text-[#8b5cf6]",
  researcher: "text-[#059669]",
};

const steps = [
  { number: 1, title: "Set Your Goal", description: "Describe the company, its mission, and what you want delivered." },
  { number: 2, title: "Agents Self-Organize", description: "A CEO analyzes your goal, hires specialists, and delegates the work." },
  { number: 3, title: "Collect Results", description: "Review deliverables, approve decisions, and download finished work." },
];

function DemoPanel() {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const isVisible = useInView(anchorRef, { once: true, amount: 0.4 });
  const [visibleCount, setVisibleCount] = useState(0);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isVisible) return;

    const timers = demoMessages.map((message, index) =>
      window.setTimeout(() => setVisibleCount(index + 1), message.delay),
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [isVisible]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [visibleCount]);

  return (
    <div ref={anchorRef} className="relative">
      <div className="rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--panel)] shadow-[0_8px_40px_-8px_rgba(0,0,0,0.1),0_24px_80px_-24px_var(--glow-warm)]">
        <div className="flex items-center gap-2 px-4 py-3 bg-[var(--panel-soft)] border-b border-[var(--border)]">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" aria-hidden="true" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" aria-hidden="true" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" aria-hidden="true" />
          <span className="ml-2 text-xs text-[var(--muted)] font-mono">AgentCompany</span>
        </div>

        <div ref={logRef} role="log" aria-label="Agent activity demonstration" className="p-5 lg:p-6 font-mono text-sm leading-relaxed h-[340px] overflow-y-auto">
          {demoMessages.slice(0, visibleCount).map((message, index) => (
            <motion.div
              key={`${message.agent}-${index}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex gap-3 mb-3 last:mb-0"
            >
              <span className={`shrink-0 font-semibold inline-flex items-center gap-1.5 ${logTone[message.role]}`}>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    message.role === "system"
                      ? "bg-[var(--muted-strong)]"
                      : message.role === "ceo"
                        ? "bg-[#ca8a04]"
                        : message.role === "engineer"
                          ? "bg-[var(--accent)]"
                          : message.role === "designer"
                            ? "bg-[#8b5cf6]"
                            : "bg-[#059669]"
                  }`}
                  aria-hidden="true"
                />
                {message.agent}
              </span>
              <span className="text-[var(--text)]">{message.text}</span>
            </motion.div>
          ))}

          {visibleCount < demoMessages.length && isVisible && (
            <span className="inline-block w-2 h-4 bg-[var(--accent)] animate-pulse rounded-sm" aria-hidden="true" />
          )}

          {visibleCount >= demoMessages.length && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-4 pt-4 border-t border-[var(--border)] flex items-center gap-2 text-[#059669]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 12 2 2 4-4" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span className="font-semibold">Company run complete. All deliverables ready.</span>
            </motion.div>
          )}

          <div />
        </div>
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 lg:py-40 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="text-center mb-20 lg:mb-24">
          <p className="font-mono text-xs font-medium uppercase tracking-[0.25em] text-[var(--accent)] mb-5">
            How It Works
          </p>
          <h2 className="font-serif text-[clamp(2rem,1.5rem+2.5vw,3.25rem)] tracking-[-0.01em] text-[var(--text)]">
            Watch a Company Come to Life
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 lg:gap-16 items-start">
          <div className="lg:col-span-2 relative">
            <div className="absolute left-[15px] top-10 bottom-4 w-px bg-[var(--border)] hidden lg:block" aria-hidden="true" />

            <div className="space-y-10">
              {steps.map((step, index) => (
                <motion.div
                  key={step.number}
                  initial={{ opacity: 0, x: -24 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ duration: 0.5, delay: 0.12 * index, ease: [0.16, 1, 0.3, 1] }}
                  className="flex gap-5"
                >
                  <div className="relative z-10 shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--text-on-accent)] text-sm font-bold shadow-[0_2px_12px_-2px_var(--accent)]">
                    {step.number}
                  </div>
                  <div className="pt-0.5">
                    <h3 className="text-base font-bold text-[var(--text)] mb-1.5 tracking-tight">{step.title}</h3>
                    <p className="text-sm leading-relaxed text-[var(--muted)]">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <motion.div
            className="lg:col-span-3"
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <DemoPanel />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
