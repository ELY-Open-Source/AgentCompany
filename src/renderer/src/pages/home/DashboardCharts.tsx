import { workloadBars } from "./workload-bars";
import type { UsageStatsRecord } from "../../../../shared/usage-stats";
import { useState, type ReactNode } from "react";
import type { AgentRecord, TaskRecord } from "../../../../shared/domain";
import { t } from "../../i18n/i18n";

const CHART_H = 116;
const CHART_W = 260;
const BAR_GAP = 4;

/** A metric tile that lifts on hover and surfaces a live readout in its
 * header — the hovered datum's value, or a resting summary otherwise. */
function ChartCard({ title, readout, children }: { title: string; readout: string; children: ReactNode }) {
  return (
    <section className="card metric-card">
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <span className="card-label">{title}</span>
        <span className="metric-readout num">{readout}</span>
      </div>
      {children}
    </section>
  );
}

/** Agents beyond this share one bar, so a large team still fits and is still counted. */
const MAX_WORKLOAD_BARS = 8;

export function AgentWorkloadChart({ agents, tasks }: { agents: AgentRecord[]; tasks: TaskRecord[] }) {
  const { bars: data, total } = workloadBars(agents, tasks, MAX_WORKLOAD_BARS);
  const max = Math.max(1, ...data.map((d) => d.count));
  const barW = data.length > 0 ? (CHART_W - (data.length - 1) * BAR_GAP) / data.length : 0;
  const [hover, setHover] = useState<number | null>(null);
  const readout = hover !== null && data[hover] ? `${data[hover]!.label} · ${data[hover]!.count}` : t("{n} open", { n: total });

  return (
    <ChartCard title={t("Agent workload")} readout={readout}>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: CHART_H }}>
        {data.map((d, i) => {
          const h = (d.count / max) * (CHART_H - 22);
          const x = i * (barW + BAR_GAP);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={0} width={barW} height={CHART_H - 16} fill="transparent" />
              <rect
                x={x}
                y={CHART_H - h - 16}
                width={barW}
                height={Math.max(2, h)}
                rx={4}
                fill="var(--accent)"
                opacity={hover === null || hover === i ? 0.85 : 0.32}
                style={{ transition: "opacity var(--motion-fast) var(--ease-out)" }}
              />
              <text x={x + barW / 2} y={CHART_H - 2} textAnchor="middle" fontSize="9" fill="var(--text-3)">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </ChartCard>
  );
}

export function RunActivityChart({ days }: { days: UsageDays }) {
  const buckets = days.map((day) => ({ label: weekdayFormat.format(new Date(day.dayStart)), count: day.runs }));
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const barW = (CHART_W - 6 * BAR_GAP) / 7;
  const [hover, setHover] = useState<number | null>(null);
  const readout = hover !== null && buckets[hover] ? `${buckets[hover]!.label} · ${buckets[hover]!.count}` : t("{n} in the last 7 days", { n: total });

  return (
    <ChartCard title={t("Run activity")} readout={readout}>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: CHART_H }}>
        {buckets.map((b, i) => {
          const h = (b.count / max) * (CHART_H - 24);
          const x = i * (barW + BAR_GAP);
          return (
            <g key={`${b.label}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={0} width={barW} height={CHART_H - 16} fill="transparent" />
              <rect
                x={x}
                y={CHART_H - h - 16}
                width={barW}
                height={Math.max(2, h)}
                rx={4}
                fill="var(--text-1)"
                opacity={hover === null || hover === i ? 0.82 : 0.28}
                style={{ transition: "opacity var(--motion-fast) var(--ease-out)" }}
              />
              <text x={x + barW / 2} y={CHART_H - 2} textAnchor="middle" fontSize="9" fill="var(--text-3)">{b.label}</text>
            </g>
          );
        })}
      </svg>
    </ChartCard>
  );
}

/** Of the work judged this week, how much was accepted (done) rather than sent back; session outcomes are shown apart, as what they are. */
export function AcceptanceChart({ days }: { days: UsageDays }) {
  const accepted = days.reduce((sum, day) => sum + day.acceptedTasks, 0);
  const returned = days.reduce((sum, day) => sum + day.returnedTasks, 0);
  const completed = days.reduce((sum, day) => sum + day.completedRuns, 0);
  const failed = days.reduce((sum, day) => sum + day.failedRuns, 0);
  const judged = accepted + returned;
  const rate = judged > 0 ? Math.round((accepted / judged) * 100) : 0;
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (rate / 100) * circumference;

  return (
    <ChartCard title={t("Work accepted (7 days)")} readout={t("{accepted} done · {returned} sent back · sessions: {ok} ended, {failed} failed", { accepted, returned, ok: completed, failed })}>
      <svg viewBox="0 0 100 100" style={{ width: 96, height: 96, margin: "4px auto", display: "block" }}>
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--panel-3)" strokeWidth="8" />
        <circle
          cx="50" cy="50" r="42" fill="none" stroke="var(--green)" strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dashoffset var(--motion-slow) var(--ease-out)" }}
        />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="20" fontWeight="600" fill="var(--text-1)">{judged > 0 ? `${rate}%` : "—"}</text>
      </svg>
    </ChartCard>
  );
}

/** Daily model tokens as the providers reported them; calls without reported usage are counted, not guessed. */
export function CostTrendChart({ days }: { days: UsageDays }) {
  const tokenBuckets = days.map((day) => ({ label: weekdayFormat.format(new Date(day.dayStart)), tokens: day.tokens }));
  const totalTokens = tokenBuckets.reduce((s, b) => s + b.tokens, 0);
  const unreported = days.reduce((sum, day) => sum + day.callsWithoutUsage, 0);
  const max = Math.max(1, ...tokenBuckets.map((b) => b.tokens));
  const coords = tokenBuckets.map((b, i) => ({
    x: (i / 6) * (CHART_W - 10) + 5,
    y: CHART_H - 20 - (b.tokens / max) * (CHART_H - 30),
    b,
  }));
  const points = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const [hover, setHover] = useState<number | null>(null);
  const week = unreported > 0
    ? t("{n} tokens in the last 7 days · {count} calls without usage", { n: compact(totalTokens), count: unreported })
    : t("{n} tokens in the last 7 days", { n: compact(totalTokens) });
  const readout = hover !== null && tokenBuckets[hover]
    ? `${tokenBuckets[hover]!.label} · ${compact(tokenBuckets[hover]!.tokens)}`
    : week;

  return (
    <ChartCard title={t("Token usage")} readout={readout}>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: CHART_H }}>
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c, i) => (
          <g key={`${c.b.label}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={c.x} cy={c.y} r="9" fill="transparent" />
            <circle cx={c.x} cy={c.y} r={hover === i ? 4 : 3} fill="var(--accent)" style={{ transition: "r var(--motion-fast) var(--ease-out)" }} />
            <text x={c.x} y={CHART_H - 2} textAnchor="middle" fontSize="9" fill="var(--text-3)">{c.b.label}</text>
          </g>
        ))}
      </svg>
    </ChartCard>
  );
}

function compact(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  return String(count);
}

const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });

type UsageDays = UsageStatsRecord["days"];
