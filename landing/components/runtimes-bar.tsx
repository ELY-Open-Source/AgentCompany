"use client";

import { motion } from "framer-motion";

function AnthropicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.257 0H10.173L16.74 20.48H13.14L11.07 14.98H5.355l-1.937 5.5H0L6.57 3.52zm4.132 8.69L8.18 5.86l-2.522 6.35h5.244z" />
    </svg>
  );
}

function OpenAIIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.047 6.047 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 11.366v3.473h5.51c-.226 1.408-1.644 4.126-5.51 4.126-3.314 0-6.017-2.744-6.017-6.127S8.686 6.71 12 6.71c1.888 0 3.152.804 3.874 1.497l2.637-2.54C16.63 3.952 14.534 3 12 3 6.477 3 2 7.477 2 13s4.477 10 10 10c5.773 0 9.6-4.057 9.6-9.773 0-.656-.07-1.157-.156-1.657H12z" />
    </svg>
  );
}

function MoonshotIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 0 1 .5 15.98A10.5 10.5 0 0 0 17 12c0-3.14-1.37-5.96-3.54-7.9A8.03 8.03 0 0 1 12 4z" />
    </svg>
  );
}

function ZhipuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 4h16v3H8.5l11 10H20v3H4v-3h11.5L4.5 7H4V4z" />
    </svg>
  );
}

function MiniMaxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 20V4l5 8 5-8 5 8 5-8v16h-3V10.5l-2 4-5-8-5 8-2-4V20H2z" />
    </svg>
  );
}

function OllamaIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7zm-2 15v-1h4v1h-4zm3.5-4.15l-.5.35V15h-2v-1.8l-.5-.35A4.98 4.98 0 0 1 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5a4.98 4.98 0 0 1-3.5 4.85zM10 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm7 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
    </svg>
  );
}

function ApiIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

const runtimes = [
  { name: "Claude Code", provider: "Anthropic", icon: AnthropicIcon },
  { name: "Codex CLI", provider: "OpenAI", icon: OpenAIIcon },
  { name: "Gemini CLI", provider: "Google", icon: GoogleIcon },
  { name: "Kimi", provider: "Moonshot AI", icon: MoonshotIcon },
  { name: "GLM", provider: "Zhipu AI", icon: ZhipuIcon },
  { name: "MiniMax", provider: "MiniMax", icon: MiniMaxIcon },
  { name: "Ollama", provider: "Local", icon: OllamaIcon },
  { name: "Anthropic Compatible API", provider: "Any Provider", icon: ApiIcon },
];

export function RuntimesBar() {
  return (
    <section className="border-y border-[var(--border)] py-12 lg:py-16">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="text-center"
        >
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)] mb-10">
            Supported AI Runtimes
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-6 lg:gap-x-12">
            {runtimes.map((runtime) => {
              const Icon = runtime.icon;
              return (
                <div key={runtime.name} className="flex items-center gap-2.5">
                  <span className="text-[var(--muted)] opacity-60">
                    <Icon />
                  </span>
                  <span className="text-base font-semibold tracking-tight text-[var(--text)]">
                    {runtime.name}
                  </span>
                  <span className="text-sm text-[var(--muted)] hidden sm:inline">
                    {runtime.provider}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
