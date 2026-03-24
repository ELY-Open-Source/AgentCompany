import { memo } from "react";

/**
 * Scrolling ASCII agent-activity backdrop for the onboarding hero panel.
 * Pure CSS animation (translateY on compositor thread) — no JS ticks.
 * Content is doubled for seamless looping.
 */

const LINES = [
  "",
  "       ╭──────────╮",
  "       │   CEO    │",
  "       ╰────┬─────╯",
  "       ┌────┴─────┐",
  "    ╭──┴──╮    ╭──┴──╮",
  "    │ CTO │    │ CMO │",
  "    ╰──┬──╯    ╰──┬──╯",
  "    ╭──┴──╮    ╭──┴──╮",
  "    │ Eng │    │ Mkt │",
  "    ╰─────╯    ╰─────╯",
  "",
  "  $ deploy --agents 12",
  "  ████████████████████ 100%",
  "  [OK] all agents online",
  "",
  "  CEO    │ analyzing requirements",
  "  CEO    │ identifying deliverables",
  "  CEO    │ delegating to leads",
  "",
  "  CTO    │ reviewing architecture",
  "  CTO    │ → Dev.01: auth module",
  "  CTO    │ → Dev.02: API layer",
  "  CTO    │ → QA: test strategy",
  "",
  "  CMO    │ go-to-market strategy",
  "  CMO    │ → Mkt.01: launch copy",
  "  CMO    │ → Mkt.02: social plan",
  "",
  "  ┌─ SPRINT 1 ────────────────┐",
  "  │ tasks  ████████░░  80%    │",
  "  │ agents 12 active          │",
  "  │ tests  128 passing        │",
  "  └──────────────────────────┘",
  "",
  "  Dev.01 │ scaffolding auth",
  "  Dev.02 │ REST endpoints",
  "  Design │ component library",
  "  QA     │ integration tests",
  "  Mkt.01 │ blog post drafted",
  "",
  "  CEO    │ sprint review: ✓",
  "  CTO    │ code review: merged",
  "  Dev.01 │ PR #12 → main",
  "  QA     │ all tests green",
  "  CMO    │ brief approved",
  "",
  "  [INFO] Sprint 1 complete",
  "  [INFO] Advancing to Sprint 2",
  "",
];

const BLOCK = LINES.join("\n");

export const AsciiAnimation = memo(function AsciiAnimation() {
  return (
    <div className="pointer-events-none absolute inset-0 select-none overflow-hidden">
      {/* Fade masks */}
      <div
        className="absolute inset-x-0 top-0 z-10 h-32"
        style={{ background: "linear-gradient(to bottom, var(--bg), transparent)" }}
      />
      <div
        className="absolute inset-x-0 bottom-0 z-10 h-32"
        style={{ background: "linear-gradient(to top, var(--bg), transparent)" }}
      />

      {/* Scrolling track — doubled for seamless loop */}
      <div className="ascii-scroll-track whitespace-pre font-mono text-[11px] leading-[1.8] text-[color:var(--accent)] opacity-[0.08]">
        {BLOCK}
        {"\n"}
        {BLOCK}
      </div>
    </div>
  );
});
