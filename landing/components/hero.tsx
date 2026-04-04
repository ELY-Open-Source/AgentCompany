"use client";

import { motion } from "framer-motion";
import { AsciiBackground } from "./ascii-background";

const sharedEase: [number, number, number, number] = [0.16, 1, 0.3, 1];

function heroMotion(delay: number) {
  return {
    initial: { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay, ease: sharedEase },
  };
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 12V6.5l8-1.1V12H3zm0 .5h8v6.6l-8-1.1V12.5zM11.5 5.3l9.5-1.3v8h-9.5V5.3zm0 7.2h9.5v8l-9.5-1.3V12.5z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.5 2C10 2 8.2 4.2 8.2 7c0 1.5.3 2.2.7 3.2.3.8.7 1.7.7 3 0 .3 0 .6-.1.9-.2 1-.6 1.8-1.2 2.3-.8.7-1.8 1.1-2.8 1.6-.7.3-1.4.7-1.9 1.2-.4.4-.6.9-.6 1.4 0 .5.2.9.6 1.2.7.6 2 .7 3.1.7.8 0 1.6-.1 2.2-.2.6-.1 1.2-.3 1.9-.3.7 0 1.3.2 1.9.3.6.1 1.4.2 2.2.2 1.1 0 2.4-.1 3.1-.7.4-.3.6-.7.6-1.2 0-.5-.2-1-.6-1.4-.5-.5-1.2-.9-1.9-1.2-1-.5-2-1-2.8-1.6-.6-.5-1-1.3-1.2-2.3-.1-.3-.1-.6-.1-.9 0-1.3.4-2.2.7-3 .4-1 .7-1.7.7-3.2 0-2.8-1.8-5-4.3-5h-.2zm-1 5c0-.8.5-1.5 1.2-1.5s1.2.7 1.2 1.5-.5 1.5-1.2 1.5S11.5 7.8 11.5 7z" />
    </svg>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-24 lg:pt-44 lg:pb-36">
      <AsciiBackground cssVar="--accent" baseOpacity={0.06} speed={1} />
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, var(--glow-warm) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 50% 20%, var(--glow-accent) 0%, transparent 60%)",
        }}
      />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center text-center">
          <motion.div {...heroMotion(0.05)}>
            <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide bg-[var(--accent-soft)] text-[var(--accent)] dark:text-[var(--muted-strong)] border border-[var(--border)]">
              Agent Company
            </span>
          </motion.div>

          <motion.h1
            {...heroMotion(0.15)}
            className="mt-8 font-serif italic text-[clamp(2.75rem,2rem+3.8vw,5rem)] tracking-[-0.02em] text-[var(--text)] leading-[1.08]"
          >
            Launch an AI Company <br className="hidden sm:block" />
            <span className="text-[var(--cta)]">in Minutes</span>
          </motion.h1>

          <motion.p
            {...heroMotion(0.25)}
            className="mt-7 max-w-2xl text-lg sm:text-xl leading-relaxed text-[var(--muted)]"
          >
            Describe your company&apos;s mission. A CEO agent recruits the team, delegates work, and delivers real
            results — code, content, research, and more. You&apos;re the founder.
          </motion.p>

          <motion.div {...heroMotion(0.35)} className="mt-12">
            <a
              href="#download"
              className="group inline-flex items-center justify-center px-9 py-4 rounded-xl text-[17px] font-semibold bg-[var(--cta)] text-[var(--text-on-cta)] hover:bg-[var(--cta-hover)] hover:scale-[1.03] active:scale-[0.98] transition-all duration-200 will-change-transform shadow-[0_4px_24px_-4px_var(--cta),0_8px_40px_-12px_var(--cta)]"
            >
              See Downloads
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="ml-2 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              >
                <path d="m7 7 10 10" />
                <path d="M17 7v10H7" />
              </svg>
            </a>
          </motion.div>

          <motion.div {...heroMotion(0.45)} className="mt-5 flex items-center gap-3 text-xs text-[var(--muted)]">
            <div className="flex items-center gap-1.5 opacity-70">
              <AppleIcon />
              <WindowsIcon />
              <LinuxIcon />
            </div>
            <span>Available on macOS, Windows & Linux</span>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.5, ease: sharedEase }}
          className="mt-20 lg:mt-24 mx-auto max-w-5xl"
        >
          <img
            src="/screenshots/Dashboard.jpeg"
            alt="AgentCompany dashboard showing autonomous AI agents managing a company"
            width="1920"
            height="1080"
            className="w-full h-auto block rounded-2xl border border-[var(--border)] shadow-[0_8px_40px_-8px_rgba(0,0,0,0.12),0_20px_80px_-20px_var(--glow-warm)] transition-shadow duration-500"
            loading="eager"
          />
        </motion.div>
      </div>
    </section>
  );
}
