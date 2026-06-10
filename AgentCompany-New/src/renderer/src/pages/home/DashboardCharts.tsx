import type { AgentRecord, ProviderRecord, TaskRecord, TaskRunRecord } from "../../../../shared/domain";
import { TASK_STATUS } from "../../../../shared/domain";

const CHART_H = 120;
const CHART_W = 260;
const BAR_GAP = 4;

export function AgentWorkloadChart({ agents, tasks }: { agents: AgentRecord[]; tasks: TaskRecord[] }) {
  const data = agents.slice(0, 8).map((a) => ({
    name: a.name.split(/\s+/)[0],
    count: tasks.filter((t) => t.assigneeAgentId === a.id && t.status !== TASK_STATUS.DONE).length,
  }));
  const max = Math.max(1, ...data.map((d) => d.count));
  const barW = data.length > 0 ? (CHART_W - (data.length - 1) * BAR_GAP) / data.length : 0;

  return (
    <ChartCard title="Agent workload">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: CHART_H }}>
        {data.map((d, i) => {
          const h = (d.count / max) * (CHART_H - 20);
          const x = i * (barW + BAR_GAP);
          return (
            <g key={d.name}>
              <rect x={x} y={CHART_H - h - 16} width={barW} height={h} rx={3} fill="var(--accent)" opacity={0.7 + (d.count / max) * 0.3} />
              <text x={x + barW / 2} y={CHART_H - 2} textAnchor="middle" fontSize="9" fill="var(--text-3)">{d.name}</text>
            </g>
          );
        })}
      </svg>
    </ChartCard>
  );
}

export function BudgetUtilizationChart({ agents, providers }: { agents: AgentRecord[]; providers: ProviderRecord[] }) {
  const connected = providers.filter((p) => p.enabled);
  const data = connected.slice(0, 6).map((p) => {
    const allocated = agents.filter((a) => a.modelProviderId === p.id).reduce((s, a) => s + a.budgetCents, 0);
    return { label: p.label.split(/\s+/)[0], cents: allocated };
  });
  const total = Math.max(1, data.reduce((s, d) => s + d.cents, 0));

  const segments = stackSegments(data, total);
  const colors = ["var(--accent)", "var(--green)", "var(--amber)", "var(--violet)", "var(--red)", "var(--text-3)"];

  return (
    <ChartCard title="Budget utilization">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: CHART_H }}>
        {segments.map((segment, i) => (
          <g key={segment.label}>
            <rect x={segment.x} y={20} width={Math.max(1, segment.w - 2)} height={CHART_H - 40} rx={4} fill={colors[i % colors.length]} opacity={0.8} />
            <text x={segment.x + segment.w / 2} y={CHART_H - 4} textAnchor="middle" fontSize="9" fill="var(--text-3)">{segment.label}</text>
            <text x={segment.x + segment.w / 2} y={14} textAnchor="middle" fontSize="9" fill="var(--text-2)">${Math.round(segment.cents / 100)}</text>
          </g>
        ))}
      </svg>
    </ChartCard>
  );
}

function stackSegments(
  data: Array<{ label: string; cents: number }>,
  total: number,
): Array<{ label: string; cents: number; x: number; w: number }> {
  const segments: Array<{ label: string; cents: number; x: number; w: number }> = [];
  let cumX = 0;
  for (const d of data) {
    const w = (d.cents / total) * CHART_W;
    segments.push({ label: d.label, cents: d.cents, x: cumX, w });
    cumX += w;
  }
  return segments;
}

export function RunActivityChart({ taskRuns }: { taskRuns: TaskRunRecord[] }) {
  const buckets = last7DayBuckets(taskRuns.map((r) => r.createdAt));
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const barW = (CHART_W - 6 * BAR_GAP) / 7;

  return (
    <ChartCard title="Run activity (7d)">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: CHART_H }}>
        {buckets.map((b, i) => {
          const h = (b.count / max) * (CHART_H - 24);
          const x = i * (barW + BAR_GAP);
          return (
            <g key={b.label}>
              <rect x={x} y={CHART_H - h - 16} width={barW} height={h} rx={3} fill="var(--text-1)" opacity={0.6 + (b.count / max) * 0.4} />
              <text x={x + barW / 2} y={CHART_H - 2} textAnchor="middle" fontSize="8" fill="var(--text-3)">{b.label}</text>
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
    <ChartCard title="Success rate">
      <svg viewBox="0 0 100 100" style={{ width: 100, height: 100, margin: "0 auto", display: "block" }}>
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--panel-3)" strokeWidth="8" />
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--green)" strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 50 50)" />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="18" fontWeight="600" fill="var(--text-1)">{rate}%</text>
      </svg>
      <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
        {completed} passed · {failed} failed
      </div>
    </ChartCard>
  );
}

export function CostTrendChart({ providerRequests }: { providerRequests: Array<{ createdAt: string; inputCharCount: number; outputCharCount: number }> }) {
  const buckets = last7DayBuckets(providerRequests.map((r) => r.createdAt));
  const charBuckets = buckets.map((b, i) => {
    const dayStart = dayStartMs(i);
    const dayEnd = dayStart + 86400000;
    const dayRequests = providerRequests.filter((r) => {
      const t = new Date(r.createdAt).getTime();
      return t >= dayStart && t < dayEnd;
    });
    return { ...b, chars: dayRequests.reduce((s, r) => s + r.inputCharCount + r.outputCharCount, 0) };
  });
  const max = Math.max(1, ...charBuckets.map((b) => b.chars));
  const points = charBuckets.map((b, i) => {
    const x = (i / 6) * (CHART_W - 10) + 5;
    const y = CHART_H - 20 - (b.chars / max) * (CHART_H - 30);
    return `${x},${y}`;
  }).join(" ");

  return (
    <ChartCard title="Token usage (7d)">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: CHART_H }}>
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {charBuckets.map((b, i) => {
          const x = (i / 6) * (CHART_W - 10) + 5;
          const y = CHART_H - 20 - (b.chars / max) * (CHART_H - 30);
          return <circle key={b.label} cx={x} cy={y} r="3" fill="var(--accent)" />;
        })}
        {charBuckets.map((b, i) => {
          const x = (i / 6) * (CHART_W - 10) + 5;
          return <text key={`l-${b.label}`} x={x} y={CHART_H - 2} textAnchor="middle" fontSize="8" fill="var(--text-3)">{b.label}</text>;
        })}
      </svg>
    </ChartCard>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 14 }}>
      <div className="card-label" style={{ marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  );
}

function last7DayBuckets(dates: string[]): Array<{ label: string; count: number }> {
  const now = Date.now();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return Array.from({ length: 7 }, (_, i) => {
    const offset = 6 - i;
    const start = new Date(now - offset * 86400000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const count = dates.filter((d) => {
      const t = new Date(d).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).length;
    return { label: dayNames[start.getDay()], count };
  });
}

function dayStartMs(bucketIndex: number): number {
  const offset = 6 - bucketIndex;
  const start = new Date(Date.now() - offset * 86400000);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}
