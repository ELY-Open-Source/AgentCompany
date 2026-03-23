import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Briefcase,
  CurrencyCircleDollar,
  Robot,
  ShieldCheck,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import type {
  ActivityRecord,
  AgentRecord,
  AgentMessageRecord,
  ApprovalRecord,
  CostRecord,
  GoalRecord,
  ProjectRecord,
  RunRecord,
  SectionId,
  TaskRecord,
} from "@shared/types";
import { formatMoney } from "../../lib/formatters";
import { useT } from "../../i18n";
import { MetricCard } from "./MetricsGrid";
import { ActivityFeed } from "./ActivityFeed";
import { RecoveryBanner } from "./RecoveryBanner";
import { BudgetAlertBanner } from "./BudgetAlertBanner";

export interface DashboardProps {
  companyName?: string;
  agents: AgentRecord[];
  tasks: TaskRecord[];
  runs: RunRecord[];
  approvals: ApprovalRecord[];
  goals: GoalRecord[];
  projects: ProjectRecord[];
  activity: ActivityRecord[];
  costs: CostRecord[];
  messages?: AgentMessageRecord[];
  onNavigate: (section: SectionId, entityId?: string) => void;
}

export function Dashboard(props: DashboardProps) {
  const t = useT();
  const { companyName, agents, tasks, runs, approvals, activity, costs, messages = [], onNavigate } = props;

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const activeAgents = useMemo(() => agents.filter((a) => a.status !== "terminated" && a.status !== "pending_approval"), [agents]);
  const activeTasks = useMemo(() => tasks.filter((t) => t.status === "in_progress" || t.status === "in_review"), [tasks]);
  const pendingApprovals = useMemo(() => approvals.filter((a) => a.state === "pending"), [approvals]);
  const totalSpend = useMemo(() => costs.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0), [costs]);

  // Attention items
  const failedRuns = useMemo(() => runs.filter((r) => r.status === "failed" || r.status === "timed_out" || r.status === "interrupted"), [runs]);
  const urgentMessages = useMemo(() => messages.filter((m) => !m.readAt && (m.priority === "urgent" || m.channel === "incident")), [messages]);
  const hasAttentionItems = pendingApprovals.length > 0 || failedRuns.length > 0 || urgentMessages.length > 0;

  // Active work — agents currently running tasks
  const activeWork = useMemo(() => {
    return runs
      .filter((r) => r.status === "running" || r.status === "queued")
      .map((run) => {
        const agent = agentMap.get(run.agentId);
        const task = taskMap.get(run.taskId);
        return { run, agent, task };
      })
      .slice(0, 8);
  }, [runs, agentMap, taskMap]);

  return (
    <div className="space-y-6">
      {/* Company status line */}
      {companyName ? (
        <div>
          <h2 className="text-[28px] font-bold tracking-[-0.02em] text-[color:var(--text)]">{companyName}</h2>
          <div className="mt-2 flex items-center gap-3 text-[13px] tracking-[0.005em] text-[color:var(--muted)]">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--success)]" />
              {activeAgents.length} {activeAgents.length === 1 ? "agent" : "agents"} active
            </span>
            <span className="h-3 w-px bg-[color:var(--line-strong)]" />
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
              {activeTasks.length} {activeTasks.length === 1 ? "task" : "tasks"} in progress
            </span>
            <span className="h-3 w-px bg-[color:var(--line-strong)]" />
            <span>{tasks.filter((tk) => tk.status === "done").length} completed</span>
          </div>
        </div>
      ) : null}

      {/* Conditional banners */}
      <RecoveryBanner />
      <BudgetAlertBanner agents={agents} onNavigate={onNavigate} />

      {/* Key Metrics — 4 cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
          label="Agents"
          value={activeAgents.length}
          icon={Robot}
          tone={activeAgents.filter((a) => a.status === "running").length > 0 ? "success" : "default"}
          onClick={() => onNavigate("agents")}
          subtitle={`${activeAgents.filter((a) => a.status === "running").length} running`}
        />
        <MetricCard
          label={t("dash.totalSpend")}
          value={formatMoney(totalSpend)}
          icon={CurrencyCircleDollar}
          onClick={() => onNavigate("settings")}
        />
      </div>

      {/* Needs Attention — moved to top, only shows when items exist */}
      {hasAttentionItems ? (
        <section>
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--warn)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--warn)]" />
            {t("dash.needsAttentionSection")}
          </div>
          <div className="space-y-1.5">
            {pendingApprovals.slice(0, 5).map((approval, i) => {
              const requester = approval.requestedByAgentId ? agentMap.get(approval.requestedByAgentId) : undefined;
              return (
                <motion.button
                  key={approval.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
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
                </motion.button>
              );
            })}
            {failedRuns.slice(0, 3).map((run) => {
              const agent = agentMap.get(run.agentId);
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
            {urgentMessages.slice(0, 3).map((msg) => {
              const sender = agentMap.get(msg.fromAgentId);
              return (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => onNavigate("communication", msg.id)}
                  className="focus-ring flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--warn)] border-opacity-20 bg-[color:var(--warn-soft)] px-4 py-3 text-left transition hover:border-opacity-40"
                >
                  <Warning size={18} className="shrink-0 text-[color:var(--warn)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[color:var(--text)]">{msg.subject}</div>
                    <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                      {sender?.name ?? "Unknown"} — {msg.channel}{msg.priority === "urgent" ? " · urgent" : ""}
                    </div>
                  </div>
                  <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Active Work — what's running right now */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
            Active Work
          </div>
          <button type="button" onClick={() => onNavigate("runs")} className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline">
            All runs <ArrowRight size={12} />
          </button>
        </div>
        {activeWork.length > 0 ? (
          <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] divide-y divide-[color:var(--line)]">
            {activeWork.map(({ run, agent, task }) => (
              <button
                key={run.id}
                type="button"
                onClick={() => onNavigate("runs", run.id)}
                className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[color:var(--panel-soft)]"
              >
                <div className="relative shrink-0">
                  <Robot size={16} className="text-[color:var(--success)]" />
                  {run.status === "running" ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--success)] opacity-40" style={{ willChange: "transform" }} />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[color:var(--success)]" />
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[color:var(--text)]">
                    {task?.title ?? run.summary ?? `Run ${run.id.slice(0, 8)}`}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                    {agent?.name ?? "Unknown agent"} · {run.status}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-[8px] border border-dashed border-[color:var(--line)] py-8 text-center">
            <div className="text-[13px] text-[color:var(--muted)]">{t("dash.allQuiet")}</div>
            <div className="mt-1 text-[11px] text-[color:var(--muted)]">No tasks currently running</div>
          </div>
        )}
      </section>

      {/* Recent Activity */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
            {t("dash.recentActivity")}
          </div>
        </div>
        <div className="max-h-[360px] overflow-y-auto rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] py-2">
          <ActivityFeed activity={activity} agents={agents} limit={10} />
        </div>
      </section>
    </div>
  );
}
