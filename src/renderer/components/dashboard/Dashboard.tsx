import { useMemo } from "react";
import {
  ArrowRight,
  Briefcase,
  CurrencyCircleDollar,
  Robot,
  ShieldCheck,
  Warning,
  XCircle,
} from "../ui/icons";
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
import { ChartSection } from "./ChartSection";
import { AttentionRow, Eyebrow } from "../ui";

export interface DashboardProps {
  companyId?: string;
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
  const { companyId, agents, tasks, runs, approvals, activity, costs, messages = [], onNavigate } = props;

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const activeAgents = useMemo(() => agents.filter((a) => a.status !== "terminated" && a.status !== "pending_approval"), [agents]);
  const activeTasks = useMemo(() => tasks.filter((t) => t.status === "in_progress" || t.status === "in_review"), [tasks]);
  const pendingApprovals = useMemo(() => approvals.filter((a) => a.state === "pending"), [approvals]);
  const totalSpend = useMemo(() => costs.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0), [costs]);

  // Attention items
  const failedRuns = useMemo(() => runs.filter((r) =>
    (r.status === "failed" || r.status === "timed_out") ||
    (r.status === "interrupted" && r.summary !== "Application shut down." && r.summary !== "Worker process crashed.")
  ), [runs]);
  const urgentMessages = useMemo(() => messages.filter((m) => !m.readAt && (m.priority === "urgent" || m.channel === "incident")), [messages]);
  const hasAttentionItems = pendingApprovals.length > 0 || failedRuns.length > 0 || urgentMessages.length > 0;

  // Active work — agents currently running tasks
  const activeWork = useMemo(() => {
    return runs
      .filter((r) => r.status === "running" || r.status === "queued")
      .map((run) => {
        const agent = agentMap.get(run.agentId);
        const task = run.taskId ? taskMap.get(run.taskId) : undefined;
        return { run, agent, task };
      })
      .slice(0, 8);
  }, [runs, agentMap, taskMap]);

  return (
    <div className="space-y-6">
      {/* Conditional banners */}
      <RecoveryBanner />
      <BudgetAlertBanner agents={agents} onNavigate={onNavigate} companyId={companyId} />

      {/* Key Metrics — 4 cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
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
          label={t("common.agents")}
          value={activeAgents.length}
          icon={Robot}
          tone={activeAgents.filter((a) => a.status === "running").length > 0 ? "success" : "default"}
          onClick={() => onNavigate("agents")}
          subtitle={`${activeAgents.filter((a) => a.status === "running").length} ${t("dash.running")}`}
        />
        <MetricCard
          label={t("dash.totalSpend")}
          value={formatMoney(totalSpend)}
          icon={CurrencyCircleDollar}
          onClick={() => onNavigate("settings")}
        />
      </div>

      {/* Performance Charts */}
      {companyId ? <ChartSection runs={runs} costs={costs} agents={agents} companyId={companyId} /> : null}

      {/* Needs Attention — moved to top, only shows when items exist */}
      {hasAttentionItems ? (
        <section>
          <Eyebrow tone="warning" className="mb-3 flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
            {t("dash.needsAttentionSection")}
          </Eyebrow>
          <div className="space-y-1.5">
            {pendingApprovals.slice(0, 5).map((approval, i) => {
              const requester = approval.requestedByAgentId ? agentMap.get(approval.requestedByAgentId) : undefined;
              return (
                <AttentionRow
                  key={approval.id}
                  icon={ShieldCheck}
                  tone="warn"
                  index={i}
                  title={approval.payloadSummary}
                  subtitle={
                    <span className="flex items-center gap-2">
                      <span className="uppercase tracking-[0.1em]">{approval.type.replaceAll("_", " ")}</span>
                      {requester ? <span>by {requester.name}</span> : null}
                    </span>
                  }
                  onClick={() => onNavigate("approvals", approval.id)}
                />
              );
            })}
            {failedRuns.slice(0, 3).map((run, i) => {
              const agent = agentMap.get(run.agentId);
              return (
                <AttentionRow
                  key={run.id}
                  icon={XCircle}
                  tone="danger"
                  index={pendingApprovals.length + i}
                  title={run.summary || "Run failed"}
                  subtitle={`${agent?.name ?? ""} — ${run.errorMessage?.slice(0, 80) ?? "Unknown error"}`}
                  onClick={() => onNavigate("runs", run.id)}
                />
              );
            })}
            {urgentMessages.slice(0, 3).map((msg, i) => {
              const sender = agentMap.get(msg.fromAgentId);
              return (
                <AttentionRow
                  key={msg.id}
                  icon={Warning}
                  tone="warn"
                  index={pendingApprovals.length + failedRuns.length + i}
                  title={msg.subject}
                  subtitle={`${sender?.name ?? "Unknown"} — ${msg.channel}${msg.priority === "urgent" ? " · urgent" : ""}`}
                  onClick={() => onNavigate("communication", msg.id)}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Active Work — what's running right now */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <Eyebrow>{t("dash.activeWork")}</Eyebrow>
          <button type="button" onClick={() => onNavigate("runs")} className="flex items-center gap-1 text-[11px] font-medium text-primary transition hover:underline">
            {t("dash.allRuns")} <ArrowRight size={12} />
          </button>
        </div>
        {activeWork.length > 0 ? (
          <div className="rounded-lg border border-border bg-card divide-y divide-[color:var(--border)]">
            {activeWork.map(({ run, agent, task }, i) => (
              <button
                key={run.id}
                type="button"
                onClick={() => onNavigate("runs", run.id)}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted"
              >
                <div className="relative shrink-0">
                  <Robot size={16} className="text-success" />
                  {run.status === "running" ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2">
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {task?.title ?? run.summary ?? `Run ${run.id.slice(0, 8)}`}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {agent?.name ?? "Unknown agent"} · {run.status}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <div className="text-[13px] text-muted-foreground">{t("dash.allQuiet")}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{t("dash.noTasksRunning")}</div>
          </div>
        )}
      </section>

      {/* Recent Activity */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <Eyebrow>{t("dash.recentActivity")}</Eyebrow>
        </div>
        <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border bg-card py-2">
          <ActivityFeed activity={activity} agents={agents} limit={10} />
        </div>
      </section>
    </div>
  );
}
