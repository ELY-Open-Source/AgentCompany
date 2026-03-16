import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Briefcase,
  CheckCircle,
  Cpu,
  CurrencyCircleDollar,
  Heartbeat,
  Lightning,
  Robot,
  ShieldCheck,
  Target,
  TreeStructure,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import type {
  ActivityRecord,
  AgentRecord,
  ApprovalRecord,
  ConnectorRecord,
  CostRecord,
  GoalRecord,
  ProjectRecord,
  RunRecord,
  SectionId,
  TaskRecord,
} from "@shared/types";
import { formatMoney } from "../lib/formatters";
import { StatusPill } from "./ui";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DashboardProps {
  agents: AgentRecord[];
  tasks: TaskRecord[];
  runs: RunRecord[];
  approvals: ApprovalRecord[];
  goals: GoalRecord[];
  projects: ProjectRecord[];
  activity: ActivityRecord[];
  costs: CostRecord[];
  connectors: ConnectorRecord[];
  onNavigate: (section: SectionId, entityId?: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Health Score Computation                                           */
/* ------------------------------------------------------------------ */

function computeHealthScore(props: Pick<DashboardProps, "agents" | "tasks" | "runs" | "approvals" | "connectors">): number {
  let score = 100;
  const { agents, tasks, runs, approvals, connectors } = props;

  // Penalize for failed runs (recent)
  const failedRuns = runs.filter((r) => r.status === "failed" || r.status === "timed_out");
  score -= Math.min(failedRuns.length * 5, 25);

  // Penalize for blocked tasks
  const blockedTasks = tasks.filter((t) => t.status === "blocked");
  score -= Math.min(blockedTasks.length * 8, 20);

  // Penalize for pending approvals (bottleneck)
  const pendingApprovals = approvals.filter((a) => a.state === "pending");
  score -= Math.min(pendingApprovals.length * 5, 15);

  // Penalize for agents in error state
  const errorAgents = agents.filter((a) => a.status === "error");
  score -= Math.min(errorAgents.length * 10, 20);

  // Penalize for no ready connectors
  const readyConnectors = connectors.filter((c) => c.status === "ready");
  if (readyConnectors.length === 0 && connectors.length > 0) score -= 15;

  // Penalize for overbudget agents
  const overBudget = agents.filter((a) => a.budgetMonthlyUsd > 0 && a.spentMonthlyUsd >= a.budgetMonthlyUsd);
  score -= Math.min(overBudget.length * 5, 10);

  return Math.max(0, Math.min(100, score));
}

function healthLabel(score: number): { label: string; tone: string } {
  if (score >= 90) return { label: "Excellent", tone: "text-[color:var(--success)]" };
  if (score >= 70) return { label: "Good", tone: "text-[color:var(--success)]" };
  if (score >= 50) return { label: "Fair", tone: "text-[color:var(--warn)]" };
  if (score >= 30) return { label: "Poor", tone: "text-[color:var(--warn)]" };
  return { label: "Critical", tone: "text-[color:var(--danger)]" };
}

/* ------------------------------------------------------------------ */
/*  Health Ring                                                        */
/* ------------------------------------------------------------------ */

function HealthRing({ score }: { score: number }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const { label, tone } = healthLabel(score);

  const strokeColor = score >= 70
    ? "var(--success)"
    : score >= 50
      ? "var(--warn)"
      : "var(--danger)";

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-[90px] w-[90px] shrink-0">
        <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
          <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--line)" strokeWidth="6" />
          <motion.circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-[22px] font-bold ${tone}`}>{score}</span>
        </div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Company Health</div>
        <div className={`text-[16px] font-semibold ${tone}`}>{label}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Metric Card                                                        */
/* ------------------------------------------------------------------ */

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  onClick,
  subtitle,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  tone?: "default" | "success" | "warn" | "danger" | "accent";
  onClick?: () => void;
  subtitle?: string;
}) {
  const toneMap = {
    default: "text-[color:var(--text)]",
    success: "text-[color:var(--success)]",
    warn: "text-[color:var(--warn)]",
    danger: "text-[color:var(--danger)]",
    accent: "text-[color:var(--accent)]",
  };
  const bgMap = {
    default: "bg-[color:var(--panel-soft)]",
    success: "bg-[color:var(--success-soft)]",
    warn: "bg-[color:var(--warn-soft)]",
    danger: "bg-[color:var(--danger-soft)]",
    accent: "bg-[color:var(--accent-soft)]",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex items-center gap-3.5 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3.5 text-left transition duration-150 hover:border-[color:var(--line-strong)] hover:shadow-sm"
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] ${bgMap[tone]}`}>
        <Icon size={20} weight="fill" className={toneMap[tone]} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[color:var(--muted)]">{label}</div>
        <div className={`text-[20px] font-bold tracking-[-0.02em] leading-tight ${toneMap[tone]}`}>{value}</div>
        {subtitle ? <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted)]">{subtitle}</div> : null}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent Workforce Grid                                               */
/* ------------------------------------------------------------------ */

const statusGlow: Record<string, string> = {
  running: "ring-2 ring-[color:var(--success)] ring-opacity-50",
  active: "ring-1 ring-[color:var(--success)] ring-opacity-30",
  idle: "",
  paused: "opacity-60",
  error: "ring-2 ring-[color:var(--danger)] ring-opacity-50",
  pending_approval: "ring-1 ring-[color:var(--warn)] ring-opacity-40",
  terminated: "opacity-40",
};

function AgentCard({ agent, onClick }: { agent: AgentRecord; onClick: () => void }) {
  const initials = agent.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const isActive = agent.status === "running" || agent.status === "active";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring group relative flex flex-col items-center gap-2 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-3 text-center transition duration-150 hover:border-[color:var(--line-strong)] hover:shadow-sm ${statusGlow[agent.status] ?? ""}`}
    >
      <div className="relative">
        <div className={`flex h-11 w-11 items-center justify-center rounded-full text-[14px] font-bold ${
          isActive ? "bg-[color:var(--success-soft)] text-[color:var(--success)]" : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)]"
        }`}>
          {initials}
        </div>
        {agent.status === "running" ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--success)] opacity-40" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[color:var(--success)]" />
          </span>
        ) : (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[color:var(--panel)]"
            style={{
              backgroundColor: agent.status === "error"
                ? "var(--danger)"
                : agent.status === "active"
                  ? "var(--success)"
                  : agent.status === "pending_approval"
                    ? "var(--warn)"
                    : agent.status === "paused" || agent.status === "terminated"
                      ? "var(--muted)"
                      : "var(--muted)",
            }}
          />
        )}
      </div>
      <div className="w-full min-w-0">
        <div className="truncate text-[12px] font-semibold text-[color:var(--text)]">{agent.name}</div>
        <div className="truncate text-[10px] text-[color:var(--muted)]">{agent.title || agent.role}</div>
      </div>
    </button>
  );
}

function WorkforceGrid({ agents, onSelectAgent }: { agents: AgentRecord[]; onSelectAgent: (id: string) => void }) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-[color:var(--line)] py-10 text-center">
        <Robot size={32} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">No agents hired yet</div>
        <div className="mt-1 text-[12px] text-[color:var(--muted)]">Create a CEO agent to start building your company</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} onClick={() => onSelectAgent(agent.id)} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Activity Stream                                                    */
/* ------------------------------------------------------------------ */

const actionIcons: Record<string, React.ElementType> = {
  created: CheckCircle,
  updated: Lightning,
  deleted: XCircle,
  started: Heartbeat,
  completed: CheckCircle,
  failed: Warning,
  approved: ShieldCheck,
  rejected: XCircle,
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ActivityFeed({ activity, agents, limit = 15 }: { activity: ActivityRecord[]; agents: AgentRecord[]; limit?: number }) {
  const recentActivity = useMemo(() => {
    return [...activity]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }, [activity, limit]);

  if (recentActivity.length === 0) {
    return (
      <div className="flex h-full items-center justify-center py-8 text-center">
        <div className="text-[13px] text-[color:var(--muted)]">No activity yet. Start by creating agents and tasks.</div>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {recentActivity.map((item, index) => {
        const Icon = actionIcons[item.action] ?? Lightning;
        const agent = agents.find((a) => a.id === item.actor);
        const actorName = agent?.name ?? (item.actor === "board" ? "Board" : item.actor.slice(0, 8));

        return (
          <motion.div
            key={item.id}
            initial={index === 0 ? { opacity: 0, y: -8 } : false}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 rounded-[6px] px-3 py-2 transition hover:bg-[color:var(--panel-soft)]"
          >
            <div className="mt-0.5 shrink-0">
              <Icon size={14} className="text-[color:var(--muted)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] leading-relaxed text-[color:var(--text)]">
                <span className="font-medium">{actorName}</span>
                {" "}
                <span className="text-[color:var(--muted)]">{item.action}</span>
                {" "}
                <span className="text-[color:var(--muted-strong)]">{item.entityType}</span>
                {item.detail ? (
                  <span className="text-[color:var(--muted)]"> — {item.detail.slice(0, 60)}{item.detail.length > 60 ? "..." : ""}</span>
                ) : null}
              </div>
              <div className="mt-0.5 text-[10px] text-[color:var(--muted)]">{timeAgo(item.createdAt)}</div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Workflow Pipeline (visual task flow)                                */
/* ------------------------------------------------------------------ */

function TaskPipeline({ tasks }: { tasks: TaskRecord[] }) {
  const stages = useMemo(() => {
    const counts = { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0, blocked: 0 };
    for (const t of tasks) {
      if (t.status in counts) counts[t.status as keyof typeof counts]++;
    }
    return [
      { label: "Backlog", count: counts.backlog, tone: "text-[color:var(--muted)]", bg: "bg-[color:var(--panel-soft)]" },
      { label: "Todo", count: counts.todo, tone: "text-[color:var(--warn)]", bg: "bg-[color:var(--warn-soft)]" },
      { label: "In Progress", count: counts.in_progress, tone: "text-[color:var(--accent)]", bg: "bg-[color:var(--accent-soft)]" },
      { label: "In Review", count: counts.in_review, tone: "text-[color:var(--warn)]", bg: "bg-[color:var(--warn-soft)]" },
      { label: "Done", count: counts.done, tone: "text-[color:var(--success)]", bg: "bg-[color:var(--success-soft)]" },
      { label: "Blocked", count: counts.blocked, tone: "text-[color:var(--danger)]", bg: "bg-[color:var(--danger-soft)]" },
    ];
  }, [tasks]);

  return (
    <div className="flex items-center gap-1.5">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex items-center gap-1.5">
          <div className={`flex items-center gap-2 rounded-[8px] px-3 py-2 ${stage.bg}`}>
            <span className={`text-[18px] font-bold ${stage.tone}`}>{stage.count}</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[color:var(--muted)]">{stage.label}</span>
          </div>
          {i < stages.length - 1 ? (
            <ArrowRight size={12} className="text-[color:var(--muted)]" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Dashboard                                                     */
/* ------------------------------------------------------------------ */

export function Dashboard(props: DashboardProps) {
  const { agents, tasks, runs, approvals, goals, projects, activity, costs, connectors, onNavigate } = props;

  const healthScore = useMemo(
    () => computeHealthScore({ agents, tasks, runs, approvals, connectors }),
    [agents, tasks, runs, approvals, connectors],
  );

  const liveRuns = useMemo(() => runs.filter((r) => r.status === "running" || r.status === "queued"), [runs]);
  const failedRuns = useMemo(() => runs.filter((r) => r.status === "failed" || r.status === "timed_out" || r.status === "interrupted"), [runs]);
  const pendingApprovals = useMemo(() => approvals.filter((a) => a.state === "pending"), [approvals]);
  const activeTasks = useMemo(() => tasks.filter((t) => t.status === "in_progress" || t.status === "in_review"), [tasks]);
  const activeGoals = useMemo(() => goals.filter((g) => g.status === "active"), [goals]);
  const totalSpend = useMemo(() => costs.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0), [costs]);
  const activeAgents = useMemo(() => agents.filter((a) => a.status !== "terminated" && a.status !== "pending_approval"), [agents]);
  const readyConnectors = useMemo(() => connectors.filter((c) => c.status === "ready"), [connectors]);

  return (
    <div className="space-y-8">
      {/* Row 1: Health + Metrics */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Health Ring */}
        <div className="shrink-0 rounded-[12px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5">
          <HealthRing score={healthScore} />
          <div className="mt-3 flex gap-3">
            <div className="text-center">
              <div className="text-[16px] font-bold text-[color:var(--text)]">{activeAgents.length}</div>
              <div className="text-[10px] text-[color:var(--muted)]">Agents</div>
            </div>
            <div className="h-8 w-px bg-[color:var(--line)]" />
            <div className="text-center">
              <div className="text-[16px] font-bold text-[color:var(--text)]">{readyConnectors.length}/{connectors.length}</div>
              <div className="text-[10px] text-[color:var(--muted)]">Connectors</div>
            </div>
            <div className="h-8 w-px bg-[color:var(--line)]" />
            <div className="text-center">
              <div className="text-[16px] font-bold text-[color:var(--text)]">{activeGoals.length}</div>
              <div className="text-[10px] text-[color:var(--muted)]">Goals</div>
            </div>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid flex-1 grid-cols-2 gap-2 lg:grid-cols-3">
          <MetricCard
            label="Live Runs"
            value={liveRuns.length}
            icon={Heartbeat}
            tone={liveRuns.length > 0 ? "success" : "default"}
            onClick={() => onNavigate("tasks")}
            subtitle={liveRuns.length > 0 ? `${liveRuns.filter((r) => r.status === "running").length} running` : "All quiet"}
          />
          <MetricCard
            label="Active Tasks"
            value={activeTasks.length}
            icon={Briefcase}
            tone={activeTasks.length > 0 ? "accent" : "default"}
            onClick={() => onNavigate("tasks")}
            subtitle={`${tasks.filter((t) => t.status === "todo").length} queued`}
          />
          <MetricCard
            label="Approvals"
            value={pendingApprovals.length}
            icon={ShieldCheck}
            tone={pendingApprovals.length > 0 ? "warn" : "default"}
            onClick={() => onNavigate("approvals")}
            subtitle={pendingApprovals.length > 0 ? "Needs your attention" : "All clear"}
          />
          <MetricCard
            label="Failed Runs"
            value={failedRuns.length}
            icon={Warning}
            tone={failedRuns.length > 0 ? "danger" : "default"}
            onClick={() => onNavigate("tasks")}
          />
          <MetricCard
            label="Total Spend"
            value={formatMoney(totalSpend)}
            icon={CurrencyCircleDollar}
            onClick={() => onNavigate("costs")}
          />
          <MetricCard
            label="Projects"
            value={projects.filter((p) => p.status === "in_progress").length}
            icon={Target}
            onClick={() => onNavigate("projects")}
            subtitle={`${projects.length} total`}
          />
        </div>
      </div>

      {/* Row 2: Task Pipeline */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Task Pipeline</div>
          <button
            type="button"
            onClick={() => onNavigate("tasks")}
            className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline"
          >
            View all <ArrowRight size={12} />
          </button>
        </div>
        <div className="overflow-x-auto rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
          <TaskPipeline tasks={tasks} />
        </div>
      </section>

      {/* Row 3: Workforce + Activity */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Workforce */}
        <section className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Workforce</div>
            <button
              type="button"
              onClick={() => onNavigate("orgchart")}
              className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline"
            >
              Org chart <TreeStructure size={12} />
            </button>
          </div>
          <WorkforceGrid agents={agents} onSelectAgent={(id) => onNavigate("agents", id)} />
        </section>

        {/* Activity Feed */}
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Recent Activity</div>
            <button
              type="button"
              onClick={() => onNavigate("activity")}
              className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline"
            >
              View all <ArrowRight size={12} />
            </button>
          </div>
          <div className="max-h-[400px] overflow-y-auto rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] py-2">
            <ActivityFeed activity={activity} agents={agents} />
          </div>
        </section>
      </div>

      {/* Row 4: Connector health (compact) */}
      <section>
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Infrastructure</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {connectors.map((connector) => {
            const isReady = connector.status === "ready";
            const isError = connector.status === "error" || connector.status === "auth_required";
            const agentsUsing = agents.filter((a) => a.connectorId === connector.id).length;
            return (
              <button
                key={connector.id}
                type="button"
                onClick={() => onNavigate("connectors")}
                className={`focus-ring flex items-center gap-2.5 rounded-[8px] border px-3 py-2.5 text-left transition duration-150 hover:bg-[color:var(--panel-soft)] ${
                  isError ? "border-[color:var(--danger)] border-opacity-30" : "border-[color:var(--line)]"
                }`}
              >
                <Cpu size={16} className={isReady ? "text-[color:var(--success)]" : isError ? "text-[color:var(--danger)]" : "text-[color:var(--muted)]"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-[color:var(--text)]">{connector.label}</div>
                  <div className="flex items-center gap-2 text-[10px] text-[color:var(--muted)]">
                    <StatusPill status={connector.status} />
                    {agentsUsing > 0 ? <span>{agentsUsing} agent{agentsUsing > 1 ? "s" : ""}</span> : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Row 5: Quick Actions / Needs Attention */}
      {(pendingApprovals.length > 0 || failedRuns.length > 0) ? (
        <section>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--warn)]">Needs Attention</div>
          <div className="space-y-1.5">
            {pendingApprovals.slice(0, 5).map((approval) => {
              const requester = agents.find((a) => a.id === approval.requestedByAgentId);
              return (
                <button
                  key={approval.id}
                  type="button"
                  onClick={() => onNavigate("approvals", approval.id)}
                  className="focus-ring flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--warn)] border-opacity-20 bg-[color:var(--warn-soft)] px-4 py-3 text-left transition hover:border-opacity-40"
                >
                  <ShieldCheck size={18} className="shrink-0 text-[color:var(--warn)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{approval.payloadSummary}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[color:var(--muted)]">
                      <span className="uppercase tracking-[0.1em]">{approval.type.replaceAll("_", " ")}</span>
                      {requester ? <span>by {requester.name}</span> : null}
                    </div>
                  </div>
                  <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
                </button>
              );
            })}
            {failedRuns.slice(0, 3).map((run) => {
              const agent = agents.find((a) => a.id === run.agentId);
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onNavigate("tasks")}
                  className="focus-ring flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--danger)] border-opacity-20 bg-[color:var(--danger-soft)] px-4 py-3 text-left transition hover:border-opacity-40"
                >
                  <XCircle size={18} className="shrink-0 text-[color:var(--danger)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{run.summary || "Run failed"}</div>
                    <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                      {agent?.name} — {run.errorMessage?.slice(0, 80) ?? "Unknown error"}
                    </div>
                  </div>
                  <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Kanban Board                                                       */
/* ------------------------------------------------------------------ */

interface KanbanProps {
  tasks: TaskRecord[];
  agents: AgentRecord[];
  runs: RunRecord[];
  onSelectTask: (taskId: string) => void;
}

const KANBAN_COLUMNS: Array<{ status: TaskRecord["status"]; label: string; tone: string; dotColor: string }> = [
  { status: "backlog", label: "Backlog", tone: "text-[color:var(--muted)]", dotColor: "bg-[color:var(--muted)]" },
  { status: "todo", label: "Todo", tone: "text-[color:var(--warn)]", dotColor: "bg-[color:var(--warn)]" },
  { status: "in_progress", label: "In Progress", tone: "text-[color:var(--accent)]", dotColor: "bg-[color:var(--accent)]" },
  { status: "in_review", label: "In Review", tone: "text-[color:var(--warn)]", dotColor: "bg-[color:var(--warn)]" },
  { status: "done", label: "Done", tone: "text-[color:var(--success)]", dotColor: "bg-[color:var(--success)]" },
  { status: "blocked", label: "Blocked", tone: "text-[color:var(--danger)]", dotColor: "bg-[color:var(--danger)]" },
];

const priorityColors: Record<string, string> = {
  critical: "border-l-[color:var(--danger)]",
  high: "border-l-[color:var(--warn)]",
  medium: "border-l-[color:var(--accent)]",
  low: "border-l-[color:var(--muted)]",
};

export function KanbanBoard({ tasks, agents, runs, onSelectTask }: KanbanProps) {
  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, TaskRecord[]> = {};
    for (const col of KANBAN_COLUMNS) grouped[col.status] = [];
    for (const task of tasks) {
      if (task.status === "cancelled") continue;
      const bucket = grouped[task.status];
      if (bucket) bucket.push(task);
      else grouped.backlog?.push(task);
    }
    // Sort each column by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    for (const col of Object.values(grouped)) {
      col.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));
    }
    return grouped;
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-[color:var(--line)] py-16 text-center">
        <Briefcase size={32} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">No tasks yet</div>
        <div className="mt-1 text-[12px] text-[color:var(--muted)]">Tasks created by agents will appear here on the board</div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {KANBAN_COLUMNS.map((col) => {
        const colTasks = tasksByStatus[col.status] ?? [];
        return (
          <div key={col.status} className="flex w-[220px] shrink-0 flex-col">
            {/* Column header */}
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className={`h-2 w-2 rounded-full ${col.dotColor}`} />
              <span className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${col.tone}`}>{col.label}</span>
              <span className="ml-auto rounded-full bg-[color:var(--panel-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[color:var(--muted)]">
                {colTasks.length}
              </span>
            </div>
            {/* Cards */}
            <div className="flex flex-1 flex-col gap-1.5 rounded-[8px] bg-[color:var(--panel-soft)] p-1.5" style={{ minHeight: 120 }}>
              {colTasks.map((task) => {
                const assignee = agents.find((a) => a.id === task.assigneeAgentId);
                const activeRun = runs.find((r) => r.id === task.activeRunId);
                const isRunning = activeRun?.status === "running";
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onSelectTask(task.id)}
                    className={`focus-ring rounded-[6px] border border-l-[3px] border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2.5 text-left transition hover:shadow-sm ${priorityColors[task.priority] ?? ""}`}
                  >
                    <div className="text-[12px] font-medium leading-snug text-[color:var(--text)]">{task.title}</div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {assignee ? (
                        <span className="flex items-center gap-1 text-[10px] text-[color:var(--muted)]">
                          <Robot size={10} />
                          {assignee.name}
                        </span>
                      ) : (
                        <span className="text-[10px] italic text-[color:var(--muted)]">Unassigned</span>
                      )}
                      {isRunning ? (
                        <span className="flex items-center gap-1 text-[10px] text-[color:var(--success)]">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--success)]" />
                          Running
                        </span>
                      ) : null}
                    </div>
                    {task.priority === "critical" || task.priority === "high" ? (
                      <div className={`mt-1 text-[9px] font-bold uppercase tracking-[0.12em] ${task.priority === "critical" ? "text-[color:var(--danger)]" : "text-[color:var(--warn)]"}`}>
                        {task.priority}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
