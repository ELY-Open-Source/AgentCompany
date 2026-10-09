import { workloadBars } from "./workload-bars";
import type { UsageStatsRecord } from "../../../../shared/usage-stats";
import { useState, type ReactNode, type KeyboardEvent } from "react";
import type { AgentRecord, TaskRecord } from "../../../../shared/domain";
import { t } from "../../i18n/i18n";

/** Plot height; axis labels sit below it as HTML text. */
const PLOT_H = 100;
const CHART_W = 260;
const BAR_GAP = 4;

/** A metric tile with a live readout: hover, or focus it and use the arrow keys, to read one datum; every value is also listed as text. */
function ChartCard({ title, readout, values, point, onPoint, children }: {
  title: string;
  readout: string;
  /** Each datum as text, in order. */
  values: string[];
  point?: number | null;
  onPoint?: (index: number | null) => void;
  children: ReactNode;
}) {
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onPoint || values.length === 0) return;
    const current = point ?? -1;
    const next = event.key === "ArrowRight" ? Math.min(values.length - 1, current + 1)
      : event.key === "ArrowLeft" ? Math.max(0, current <= 0 ? 0 : current - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onPoint(next);
  };
  return (
    <section className="card metric-card" aria-label={title}>
      <div style={{ display: "grid", gap: 4, marginBottom: 12 }}>
        <span className="card-label">{title}</span>
        <span className="metric-readout num" aria-live="polite">{readout}</span>
      </div>
      <div
        tabIndex={onPoint ? 0 : undefined}
        role={onPoint ? "group" : undefined}
        aria-label={onPoint ? t("{title}: use the arrow keys to read each value", { title }) : undefined}
        onKeyDown={step}
        onBlur={() => onPoint?.(null)}
      >
        {children}
      </div>
      <ul className="sr-only">{values.map((value, index) => <li key={index}>{value}</li>)}</ul>
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
    <ChartCard title={t("Agent workload")} readout={readout} values={data.map((d) => `${d.label}: ${d.count}`)} point={hover} onPoint={setHover}>
      <svg viewBox={`0 0 ${CHART_W} ${PLOT_H}`} preserveAspectRatio="none" shapeRendering="crispEdges" style={{ width: "100%", height: PLOT_H }}>
        {data.map((d, i) => {
          const h = (d.count / max) * (PLOT_H - 6);
          const x = i * (barW + BAR_GAP);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={0} width={barW} height={PLOT_H} fill="transparent" />
              <rect
                x={x}
                y={PLOT_H - h}
                width={barW}
                height={Math.max(2, h)}
                fill="var(--accent)"
                opacity={hover === null || hover === i ? 0.85 : 0.32}
                style={{ transition: "opacity var(--motion-fast) var(--ease-out)" }}
              />
            </g>
          );
        })}
      </svg>
      <ChartAxis labels={data.map((d) => d.label)} />
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
    <ChartCard title={t("Run activity")} readout={readout} values={buckets.map((b) => `${b.label}: ${b.count}`)} point={hover} onPoint={setHover}>
      <svg viewBox={`0 0 ${CHART_W} ${PLOT_H}`} preserveAspectRatio="none" shapeRendering="crispEdges" style={{ width: "100%", height: PLOT_H }}>
        {buckets.map((b, i) => {
          const h = (b.count / max) * (PLOT_H - 6);
          const x = i * (barW + BAR_GAP);
          return (
            <g key={`${b.label}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={0} width={barW} height={PLOT_H} fill="transparent" />
              <rect
                x={x}
                y={PLOT_H - h}
                width={barW}
                height={Math.max(2, h)}
                fill="var(--text-1)"
                opacity={hover === null || hover === i ? 0.82 : 0.28}
                style={{ transition: "opacity var(--motion-fast) var(--ease-out)" }}
              />
            </g>
          );
        })}
      </svg>
      <ChartAxis labels={buckets.map((b) => b.label)} />
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
    <ChartCard
      title={t("Work accepted (7 days)")}
      readout={t("{accepted} done · {returned} sent back · sessions: {ok} ended, {failed} failed", { accepted, returned, ok: completed, failed })}
      values={[judged > 0 ? t("{rate}% of judged work accepted", { rate }) : t("No work judged yet")]}
    >
      <div style={{ position: "relative", width: 96, height: 96, margin: "4px auto" }}>
        <svg viewBox="0 0 100 100" shapeRendering="crispEdges" style={{ width: 96, height: 96, display: "block" }}>
          <circle cx="50" cy="50" r="42" fill="none" stroke="var(--panel-3)" strokeWidth="8" />
          <circle
            cx="50" cy="50" r="42" fill="none" stroke="var(--green)" strokeWidth="8"
            strokeDasharray={circumference} strokeDashoffset={offset}
            transform="rotate(-90 50 50)"
            style={{ transition: "stroke-dashoffset var(--motion-slow) var(--ease-out)" }}
          />
        </svg>
        <span className="num" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: "var(--fs-display)" }}>{judged > 0 ? `${rate}%` : "—"}</span>
      </div>
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
    y: PLOT_H - 4 - (b.tokens / max) * (PLOT_H - 8),
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
    <ChartCard title={t("Token usage")} readout={readout} values={tokenBuckets.map((b) => `${b.label}: ${compact(b.tokens)}`)} point={hover} onPoint={setHover}>
      <svg viewBox={`0 0 ${CHART_W} ${PLOT_H}`} shapeRendering="crispEdges" style={{ width: "100%", height: PLOT_H }}>
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" />
        {coords.map((c, i) => {
          const side = hover === i ? 8 : 6;
          return (
            <g key={`${c.b.label}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={c.x - 9} y={c.y - 9} width={18} height={18} fill="transparent" />
              <rect x={c.x - side / 2} y={c.y - side / 2} width={side} height={side} fill="var(--accent)" />
            </g>
          );
        })}
      </svg>
      <ChartAxis labels={tokenBuckets.map((b) => b.label)} />
    </ChartCard>
  );
}

/** Axis labels as pixel text, one evenly spaced cell per datum under the plot. */
function ChartAxis({ labels }: { labels: string[] }) {
  return (
    <div aria-hidden="true" style={{ display: "flex", marginTop: 2, fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
      {labels.map((label, index) => <span key={index} style={{ flex: 1, textAlign: "center", overflow: "hidden", whiteSpace: "nowrap" }}>{label}</span>)}
    </div>
  );
}

function compact(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  return String(count);
}

const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });

type UsageDays = UsageStatsRecord["days"];
