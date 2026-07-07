import { useState, type ReactNode } from "react";
import type { AgentRecord, TaskRecord, TaskRunRecord } from "../../../../shared/domain";
import { TASK_STATUS } from "../../../../shared/domain";

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

export function AgentWorkloadChart({ agents, tasks }: { agents: AgentRecord[]; tasks: TaskRecord[] }) {
  const data = agents.slice(0, 8).map((a) => ({
    name: a.name.split(/\s+/)[0] ?? a.name,
    count: tasks.filter((t) => t.assigneeAgentId === a.id && t.status !== TASK_STATUS.DONE).length,
  }));
  const total = data.reduce((s, d) => s + d.count, 0);
  const max = Math.max(1, ...data.map((d) => d.count));
  const barW = data.length > 0 ? (CHART_W - (data.length - 1) * BAR_GAP) / data.length : 0;
  const [hover, setHover] = useState<number | null>(null);
  const readout = hover !== null && data[hover] ? `${data[hover]!.name} · ${data[hover]!.count}` : `${total} open`;

  return (
    <ChartCard title="Agent workload" readout={readout}>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: CHART_H }}>
        {data.map((d, i) => {
          const h = (d.count / max) * (CHART_H - 22);
          const x = i * (barW + BAR_GAP);
          return (
            <g key={d.name} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
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
              <text x={x + barW / 2} y={CHART_H - 2} textAnchor="middle" fontSize="9" fill="var(--text-3)">{d.name}</text>
            </g>
          );
        })}
      </svg>
    </ChartCard>
  );
}

export function RunActivityChart({ taskRuns }: { taskRuns: TaskRunRecord[] }) {
  const buckets = last7DayBuckets(taskRuns.map((r) => r.createdAt));
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const barW = (CHART_W - 6 * BAR_GAP) / 7;
  const [hover, setHover] = useState<number | null>(null);
  const readout = hover !== null && buckets[hover] ? `${buckets[hover]!.label} · ${buckets[hover]!.count}` : `${total} this week`;

  return (
    <ChartCard title="Run activity" readout={readout}>
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

export function SuccessRateChart({ taskRuns }: { taskRuns: TaskRunRecord[] }) {
  const completed = taskRuns.filter((r) => r.state === "completed").length;
  const failed = taskRuns.filter((r) => r.state === "failed").length;
  const total = completed + failed;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (rate / 100) * circumference;

  return (
    <ChartCard title="Success rate" readout={`${completed} ok · ${failed} failed`}>
      <svg viewBox="0 0 100 100" style={{ width: 96, height: 96, margin: "4px auto", display: "block" }}>
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--panel-3)" strokeWidth="8" />
        <circle
          cx="50" cy="50" r="42" fill="none" stroke="var(--green)" strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dashoffset var(--motion-slow) var(--ease-out)" }}
        />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="20" fontWeight="600" fill="var(--text-1)">{rate}%</text>
      </svg>
    </ChartCard>
  );
}

export function CostTrendChart({ providerRequests }: { providerRequests: Array<{ createdAt: string; inputCharCount: number; outputCharCount: number }> }) {
  const buckets = last7DayBuckets(providerRequests.map((r) => r.createdAt));
  const charBuckets = buckets.map((b, i) => {
    const dayStart = dayStartMs(i);
    const dayEnd = dayStart + 86400000;
    const chars = providerRequests
      .filter((r) => { const t = new Date(r.createdAt).getTime(); return t >= dayStart && t < dayEnd; })
      .reduce((s, r) => s + r.inputCharCount + r.outputCharCount, 0);
    return { ...b, chars };
  });
  const totalChars = charBuckets.reduce((s, b) => s + b.chars, 0);
  const max = Math.max(1, ...charBuckets.map((b) => b.chars));
  const coords = charBuckets.map((b, i) => ({
    x: (i / 6) * (CHART_W - 10) + 5,
    y: CHART_H - 20 - (b.chars / max) * (CHART_H - 30),
    b,
  }));
  const points = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const [hover, setHover] = useState<number | null>(null);
  const readout = hover !== null && charBuckets[hover]
    ? `${charBuckets[hover]!.label} · ${kchars(charBuckets[hover]!.chars)}`
    : `${kchars(totalChars)} this week`;

  return (
    <ChartCard title="Token usage" readout={readout}>
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

function kchars(chars: number): string {
  if (chars >= 1000) return `${(chars / 1000).toFixed(chars >= 10000 ? 0 : 1)}k`;
  return String(chars);
}

function last7DayBuckets(dates: string[]): Array<{ label: string; count: number }> {
  const now = Date.now();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return Array.from({ length: 7 }, (_, i) => {
    const offset = 6 - i;
    const start = new Date(now - offset * 86400000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const count = dates.filter((d) => { const t = new Date(d).getTime(); return t >= start.getTime() && t < end.getTime(); }).length;
    return { label: dayNames[start.getDay()] ?? "", count };
  });
}

function dayStartMs(bucketIndex: number): number {
  const offset = 6 - bucketIndex;
  const start = new Date(Date.now() - offset * 86400000);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}
