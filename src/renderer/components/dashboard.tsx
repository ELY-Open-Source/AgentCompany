import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Briefcase,
  Buildings,
  CalendarCheck,
  ChartLineUp,
  CheckCircle,
  Clock,
  Cpu,
  CurrencyCircleDollar,
  Heartbeat,
  Lightning,
  Robot,
  Rocket,
  ShieldCheck,
  Target,
  TreeStructure,
  TrendUp,
  Users,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import type {
  ActivityRecord,
  AgentRecord,
  AgentMessageRecord,
  ApprovalRecord,
  BrowserActionRecord,
  ConnectorRecord,
  CostRecord,
  GoalRecord,
  MeetingRecord,
  ProjectRecord,
  RunRecord,
  SectionId,
  SprintRecord,
  TaskRecord,
  WorkflowPipelineRecord,
} from "@shared/types";
import { isConnectorExecutionReady } from "@shared/connector-policy";
import { formatMoney, getAgentInitials, timeAgo } from "../lib/formatters";
import { StatusPill } from "./ui";
import { useT } from "../i18n";

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
  messages?: AgentMessageRecord[];
  browserActions?: BrowserActionRecord[];
  workflows?: WorkflowPipelineRecord[];
  meetings?: MeetingRecord[];
  sprints?: SprintRecord[];
  onNavigate: (section: SectionId, entityId?: string) => void;
}

function computeHealthScore(props: Pick<DashboardProps, "agents" | "tasks" | "runs" | "approvals" | "connectors" | "messages" | "browserActions" | "workflows">): number {
  let score = 100;
  const { agents, tasks, runs, approvals, connectors, messages = [], browserActions = [], workflows = [] } = props;

  const failedRuns = runs.filter((r) => r.status === "failed" || r.status === "timed_out");
  score -= Math.min(failedRuns.length * 5, 25);

  const blockedTasks = tasks.filter((t) => t.status === "blocked");
  score -= Math.min(blockedTasks.length * 8, 20);

  const pendingApprovals = approvals.filter((a) => a.state === "pending");
  score -= Math.min(pendingApprovals.length * 5, 15);

  const errorAgents = agents.filter((a) => a.status === "error");
  score -= Math.min(errorAgents.length * 10, 20);

  const readyConnectors = connectors.filter((connector) => isConnectorExecutionReady(connector));
  if (readyConnectors.length === 0 && connectors.length > 0) score -= 15;

  const overBudget = agents.filter((a) => a.budgetMonthlyUsd > 0 && a.spentMonthlyUsd >= a.budgetMonthlyUsd);
  score -= Math.min(overBudget.length * 5, 10);

  const urgentMessages = messages.filter((message) => !message.readAt && (message.priority === "urgent" || message.channel === "incident"));
  score -= Math.min(urgentMessages.length * 4, 12);

  const blockedBrowserActions = browserActions.filter((action) => action.status === "approval_required" || action.status === "failed");
  score -= Math.min(blockedBrowserActions.length * 4, 12);

  const stalledWorkflows = workflows.filter((workflow) => workflow.status === "paused" || workflow.status === "failed");
  score -= Math.min(stalledWorkflows.length * 5, 15);

  return Math.max(0, Math.min(100, score));
}

function healthLabel(score: number): { label: string; tone: string } {
  if (score >= 90) return { label: "Excellent", tone: "text-[color:var(--success)]" };
  if (score >= 70) return { label: "Good", tone: "text-[color:var(--success)]" };
  if (score >= 50) return { label: "Fair", tone: "text-[color:var(--warn)]" };
  if (score >= 30) return { label: "Poor", tone: "text-[color:var(--warn)]" };
  return { label: "Critical", tone: "text-[color:var(--danger)]" };
}

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
  const initials = getAgentInitials(agent.name);

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

const DEPARTMENT_INFO: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  executive: { label: "Executive", icon: Buildings, color: "var(--accent)" },
  engineering: { label: "Engineering", icon: Cpu, color: "#6366f1" },
  product: { label: "Product", icon: Rocket, color: "#8b5cf6" },
  design: { label: "Design", icon: Target, color: "#ec4899" },
  marketing: { label: "Marketing", icon: TrendUp, color: "#f59e0b" },
  sales: { label: "Sales", icon: ChartLineUp, color: "#10b981" },
  hr: { label: "People", icon: Users, color: "#06b6d4" },
  finance: { label: "Finance", icon: CurrencyCircleDollar, color: "#14b8a6" },
  legal: { label: "Legal", icon: ShieldCheck, color: "#64748b" },
  operations: { label: "Operations", icon: Lightning, color: "#f97316" },
  customer_support: { label: "Support", icon: Heartbeat, color: "#3b82f6" },
  research: { label: "Research", icon: Target, color: "#a855f7" },
};

function DepartmentOverview({
  agents,
  tasks,
  runs,
  onNavigate,
}: {
  agents: AgentRecord[];
  tasks: TaskRecord[];
  runs: RunRecord[];
  onNavigate: (section: SectionId) => void;
}) {
  const departments = useMemo(() => {
    const depts = new Map<string, { agents: AgentRecord[]; tasks: TaskRecord[]; activeRuns: number }>();
    for (const agent of agents) {
      if (agent.status === "terminated") continue;
      const dept = agent.department ?? "unassigned";
      if (!depts.has(dept)) depts.set(dept, { agents: [], tasks: [], activeRuns: 0 });
      depts.get(dept)!.agents.push(agent);
    }
    for (const task of tasks) {
      if (task.assigneeAgentId) {
        const agent = agents.find((a) => a.id === task.assigneeAgentId);
        if (agent?.department) {
          const dept = depts.get(agent.department);
          if (dept) dept.tasks.push(task);
        }
      }
    }
    for (const run of runs) {
      if (run.status === "running") {
        const agent = agents.find((a) => a.id === run.agentId);
        if (agent?.department) {
          const dept = depts.get(agent.department);
          if (dept) dept.activeRuns++;
        }
      }
    }
    return Array.from(depts.entries())
      .filter(([key]) => key !== "unassigned")
      .sort((a, b) => b[1].agents.length - a[1].agents.length);
  }, [agents, tasks, runs]);

  if (departments.length <= 1) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {departments.map(([deptId, data]) => {
        const info = DEPARTMENT_INFO[deptId] ?? { label: deptId, icon: Buildings, color: "var(--muted)" };
        const Icon = info.icon;
        const activeTasks = data.tasks.filter((t) => t.status === "in_progress" || t.status === "in_review").length;
        const doneTasks = data.tasks.filter((t) => t.status === "done").length;
        const blockedTasks = data.tasks.filter((t) => t.status === "blocked").length;
        const runningAgents = data.agents.filter((a) => a.status === "running").length;

        return (
          <button
            key={deptId}
            type="button"
            onClick={() => onNavigate("agents")}
            className="focus-ring group relative overflow-hidden rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] p-3 text-left transition hover:border-[color:var(--line-strong)] hover:shadow-sm"
          >
            <div className="absolute left-0 top-0 h-full w-[3px]" style={{ backgroundColor: info.color }} />

            <div className="flex items-center gap-2 pl-1">
              <Icon size={14} style={{ color: info.color }} />
              <span className="text-[11px] font-semibold text-[color:var(--text)]">{info.label}</span>
              {runningAgents > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--success)]" />
                  <span className="text-[9px] text-[color:var(--success)]">{runningAgents}</span>
                </span>
              )}
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1 pl-1">
              <div>
                <div className="text-[14px] font-bold text-[color:var(--text)]">{data.agents.length}</div>
                <div className="text-[8px] uppercase tracking-[0.1em] text-[color:var(--muted)]">People</div>
              </div>
              <div>
                <div className="text-[14px] font-bold text-[color:var(--accent)]">{activeTasks}</div>
                <div className="text-[8px] uppercase tracking-[0.1em] text-[color:var(--muted)]">Active</div>
              </div>
              <div>
                <div className={`text-[14px] font-bold ${blockedTasks > 0 ? "text-[color:var(--danger)]" : "text-[color:var(--success)]"}`}>
                  {blockedTasks > 0 ? blockedTasks : doneTasks}
                </div>
                <div className="text-[8px] uppercase tracking-[0.1em] text-[color:var(--muted)]">
                  {blockedTasks > 0 ? "Blocked" : "Done"}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SprintProgress({ sprint, tasks }: { sprint: SprintRecord; tasks: TaskRecord[] }) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  const progress = useMemo(() => {
    if (sprint.velocityPoints === 0) return 0;
    return Math.min(100, Math.round((sprint.completedPoints / sprint.velocityPoints) * 100));
  }, [sprint]);

  const daysLeft = useMemo(() => {
    const end = new Date(sprint.endDate).getTime();
    const now = nowMs ?? end;
    return Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
  }, [sprint, nowMs]);

  const sprintTasks = useMemo(() => {
    const done = tasks.filter((t) => t.status === "done").length;
    const active = tasks.filter((t) => t.status === "in_progress" || t.status === "in_review").length;
    const total = tasks.length;
    return { done, active, total };
  }, [tasks]);

  return (
    <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarCheck size={16} className="text-[color:var(--accent)]" />
          <span className="text-[12px] font-semibold text-[color:var(--text)]">{sprint.name}</span>
          <StatusPill status={sprint.status} />
        </div>
        <div className="flex items-center gap-1 text-[11px] text-[color:var(--muted)]">
          <Clock size={12} />
          {daysLeft} days left
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
        <motion.div
          className="h-full rounded-full bg-[color:var(--accent)]"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-[color:var(--muted)]">
        <span>{sprint.completedPoints}/{sprint.velocityPoints} points ({progress}%)</span>
        <div className="flex items-center gap-3">
          <span className="text-[color:var(--success)]">{sprintTasks.done} done</span>
          <span className="text-[color:var(--accent)]">{sprintTasks.active} active</span>
          <span>{sprintTasks.total} total</span>
        </div>
      </div>

      {sprint.goal && (
        <div className="mt-2 text-[11px] italic text-[color:var(--muted)]">"{sprint.goal}"</div>
      )}
    </div>
  );
}

function GoalProgress({ goals, tasks, onNavigate }: { goals: GoalRecord[]; tasks: TaskRecord[]; onNavigate: (section: SectionId) => void }) {
  const activeGoals = useMemo(() => goals.filter((g) => g.status === "active"), [goals]);

  if (activeGoals.length === 0) return null;

  return (
    <div className="space-y-2">
      {activeGoals.slice(0, 5).map((goal) => {
        const goalTasks = tasks.filter((t) => t.goalId === goal.id);
        const done = goalTasks.filter((t) => t.status === "done").length;
        const total = goalTasks.length;
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);

        return (
          <button
            key={goal.id}
            type="button"
            onClick={() => onNavigate("goals")}
            className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 text-left transition hover:border-[color:var(--line-strong)]"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target size={14} className="text-[color:var(--accent)]" />
                <span className="text-[12px] font-medium text-[color:var(--text)]">{goal.title}</span>
              </div>
              <span className="text-[11px] font-bold text-[color:var(--accent)]">{pct}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
              <motion.div
                className="h-full rounded-full bg-[color:var(--accent)]"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <div className="mt-1 text-[10px] text-[color:var(--muted)]">{done}/{total} tasks complete</div>
          </button>
        );
      })}
    </div>
  );
}

export function Dashboard(props: DashboardProps) {
  const t = useT();
  const { agents, tasks, runs, approvals, goals, projects, activity, costs, connectors, messages = [], browserActions = [], workflows = [], sprints = [], onNavigate } = props;

  const healthScore = useMemo(
    () => computeHealthScore({ agents, tasks, runs, approvals, connectors, messages, browserActions, workflows }),
    [agents, tasks, runs, approvals, connectors, messages, browserActions, workflows],
  );

  const liveRuns = useMemo(() => runs.filter((r) => r.status === "running" || r.status === "queued"), [runs]);
  const failedRuns = useMemo(() => runs.filter((r) => r.status === "failed" || r.status === "timed_out" || r.status === "interrupted"), [runs]);
  const pendingApprovals = useMemo(() => approvals.filter((a) => a.state === "pending"), [approvals]);
  const activeTasks = useMemo(() => tasks.filter((t) => t.status === "in_progress" || t.status === "in_review"), [tasks]);
  const activeGoals = useMemo(() => goals.filter((g) => g.status === "active"), [goals]);
  const totalSpend = useMemo(() => costs.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0), [costs]);
  const activeAgents = useMemo(() => agents.filter((a) => a.status !== "terminated" && a.status !== "pending_approval"), [agents]);
  const readyConnectors = useMemo(() => connectors.filter((connector) => isConnectorExecutionReady(connector)), [connectors]);
  const activeSprint = useMemo(() => sprints.find((s) => s.status === "active"), [sprints]);
  const unreadMessages = useMemo(() => messages.filter((message) => !message.readAt), [messages]);
  const urgentMessages = useMemo(() => messages.filter((message) => !message.readAt && (message.priority === "urgent" || message.channel === "incident")), [messages]);
  const blockedBrowserActions = useMemo(() => browserActions.filter((action) => action.status === "approval_required" || action.status === "failed"), [browserActions]);
  const stalledWorkflows = useMemo(() => workflows.filter((workflow) => workflow.status === "paused" || workflow.status === "failed"), [workflows]);

  return (
    <div className="space-y-8">
      {/* Health + Metrics */}
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
            label={t("dash.liveRuns")}
            value={liveRuns.length}
            icon={Heartbeat}
            tone={liveRuns.length > 0 ? "success" : "default"}
            onClick={() => onNavigate("runs")}
            subtitle={liveRuns.length > 0 ? `${liveRuns.filter((r) => r.status === "running").length} ${t("dash.running")}` : t("dash.allQuiet")}
          />
          <MetricCard
            label={t("dash.activeTasks")}
            value={activeTasks.length}
            icon={Briefcase}
            tone={activeTasks.length > 0 ? "accent" : "default"}
            onClick={() => onNavigate("tasks")}
            subtitle={`${tasks.filter((t) => t.status === "todo").length} ${t("dash.queued")}`}
          />
          <MetricCard
            label={t("dash.approvals")}
            value={pendingApprovals.length}
            icon={ShieldCheck}
            tone={pendingApprovals.length > 0 ? "warn" : "default"}
            onClick={() => onNavigate("approvals")}
            subtitle={pendingApprovals.length > 0 ? t("dash.needsAttention") : t("dash.allClear")}
          />
          <MetricCard
            label={t("dash.failedRuns")}
            value={failedRuns.length}
            icon={Warning}
            tone={failedRuns.length > 0 ? "danger" : "default"}
            onClick={() => onNavigate("runs")}
          />
          <MetricCard
            label={t("dash.totalSpend")}
            value={formatMoney(totalSpend)}
            icon={CurrencyCircleDollar}
            onClick={() => onNavigate("costs")}
          />
          <MetricCard
            label={t("dash.projects")}
            value={projects.filter((p) => p.status === "in_progress").length}
            icon={Target}
            onClick={() => onNavigate("projects")}
            subtitle={`${projects.length} ${t("dash.total")}`}
          />
          <MetricCard
            label={t("dash.unreadMessages")}
            value={unreadMessages.length}
            icon={Users}
            tone={urgentMessages.length > 0 ? "warn" : unreadMessages.length > 0 ? "accent" : "default"}
            onClick={() => onNavigate("communication")}
            subtitle={urgentMessages.length > 0 ? `${urgentMessages.length} urgent` : unreadMessages.length > 0 ? "Needs triage" : "All read"}
          />
          <MetricCard
            label={t("dash.browserOps")}
            value={blockedBrowserActions.length}
            icon={Cpu}
            tone={blockedBrowserActions.length > 0 ? "warn" : "default"}
            onClick={() => onNavigate("social")}
            subtitle={blockedBrowserActions.length > 0 ? "Blocked or failed" : "Nominal"}
          />
          <MetricCard
            label={t("dash.workflowStalls")}
            value={stalledWorkflows.length}
            icon={Lightning}
            tone={stalledWorkflows.length > 0 ? "warn" : "default"}
            onClick={() => onNavigate("automation")}
            subtitle={stalledWorkflows.length > 0 ? "Paused or failed" : "Healthy"}
          />
        </div>
      </div>

      {/* Department Overview */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("dash.departments")}</div>
          <button
            type="button"
            onClick={() => onNavigate("orgchart")}
            className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline"
          >
            {t("dash.orgChart")} <TreeStructure size={12} />
          </button>
        </div>
        <DepartmentOverview agents={agents} tasks={tasks} runs={runs} onNavigate={onNavigate} />
      </section>

      {/* Sprint + Goals */}
      <div className="grid gap-6 lg:grid-cols-2">
        {activeSprint ? (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("dash.currentSprint")}</div>
              <button
                type="button"
                onClick={() => onNavigate("sprints")}
                className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline"
              >
                Manage <ArrowRight size={12} />
              </button>
            </div>
            <SprintProgress sprint={activeSprint} tasks={tasks} />
          </section>
        ) : null}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("dash.goalProgress")}</div>
            <button
              type="button"
              onClick={() => onNavigate("goals")}
              className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline"
            >
              All goals <ArrowRight size={12} />
            </button>
          </div>
          <GoalProgress goals={goals} tasks={tasks} onNavigate={onNavigate} />
        </section>
      </div>

      {/* Task Pipeline */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("dash.taskPipeline")}</div>
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

      {/* Workforce + Activity */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Workforce */}
        <section className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("dash.workforce")}</div>
            <button
              type="button"
              onClick={() => onNavigate("orgchart")}
              className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline"
            >
              {t("dash.orgChart")} <TreeStructure size={12} />
            </button>
          </div>
          <WorkforceGrid agents={agents} onSelectAgent={(id) => onNavigate("agents", id)} />
        </section>

        {/* Activity Feed */}
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("dash.recentActivity")}</div>
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

      {/* Connector Health */}
      <section>
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("dash.infrastructure")}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {connectors.map((connector) => {
            const isReady = isConnectorExecutionReady(connector);
            const isError = connector.status === "error" || connector.status === "auth_required";
            const agentsUsing = agents.filter((a) => a.connectorId === connector.id).length;
            return (
              <button
                key={connector.id}
                type="button"
                onClick={() => onNavigate("connectors", connector.id)}
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

      {/* Needs Attention */}
      {(pendingApprovals.length > 0 || failedRuns.length > 0 || urgentMessages.length > 0 || blockedBrowserActions.length > 0 || stalledWorkflows.length > 0) ? (
        <section>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--warn)]">{t("dash.needsAttentionSection")}</div>
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
                  onClick={() => onNavigate("runs", run.id)}
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
            {urgentMessages.slice(0, 3).map((message) => {
              const sender = agents.find((agent) => agent.id === message.fromAgentId);
              return (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => onNavigate("communication", message.id)}
                  className="focus-ring flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--warn)] border-opacity-20 bg-[color:var(--warn-soft)] px-4 py-3 text-left transition hover:border-opacity-40"
                >
                  <Users size={18} className="shrink-0 text-[color:var(--warn)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{message.subject}</div>
                    <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                      {sender?.name ?? "Unknown"} — {message.channel} {message.priority === "urgent" ? "· urgent" : ""}
                    </div>
                  </div>
                  <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
                </button>
              );
            })}
            {blockedBrowserActions.slice(0, 3).map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => onNavigate("social")}
                className="focus-ring flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--warn)] border-opacity-20 bg-[color:var(--warn-soft)] px-4 py-3 text-left transition hover:border-opacity-40"
              >
                <Cpu size={18} className="shrink-0 text-[color:var(--warn)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{action.resultSummary || action.actionType}</div>
                  <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">Browser action {action.status.replaceAll("_", " ")}</div>
                </div>
                <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
              </button>
            ))}
            {stalledWorkflows.slice(0, 3).map((workflow) => (
              <button
                key={workflow.id}
                type="button"
                onClick={() => onNavigate("automation")}
                className="focus-ring flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--warn)] border-opacity-20 bg-[color:var(--warn-soft)] px-4 py-3 text-left transition hover:border-opacity-40"
              >
                <Lightning size={18} className="shrink-0 text-[color:var(--warn)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{workflow.name}</div>
                  <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">Workflow {workflow.status}</div>
                </div>
                <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

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
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className={`h-2 w-2 rounded-full ${col.dotColor}`} />
              <span className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${col.tone}`}>{col.label}</span>
              <span className="ml-auto rounded-full bg-[color:var(--panel-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[color:var(--muted)]">
                {colTasks.length}
              </span>
            </div>
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
