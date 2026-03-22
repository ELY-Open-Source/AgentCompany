import { useMemo } from "react";
import {
  ArrowRight,
  Briefcase,
  Cpu,
  CurrencyCircleDollar,
  Heartbeat,
  Lightning,
  ShieldCheck,
  Target,
  TreeStructure,
  Users,
  Warning,
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
import { formatMoney } from "../../lib/formatters";
import { StatusPill } from "../ui";
import { useT } from "../../i18n";
import { computeHealthScore, HealthRing } from "./HealthCard";
import { MetricCard } from "./MetricsGrid";
import { ActivityFeed } from "./ActivityFeed";
import { WorkforceGrid } from "./QuickActions";
import { DepartmentOverview } from "./DepartmentOverview";
import { TaskPipeline } from "./TaskPipeline";
import { SprintProgress } from "./SprintProgress";
import { GoalProgress } from "./GoalProgress";
import { NeedsAttention } from "./NeedsAttention";

export interface DashboardProps {
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

        <div className="grid flex-1 grid-cols-2 gap-2 lg:grid-cols-3">
          <MetricCard label={t("dash.liveRuns")} value={liveRuns.length} icon={Heartbeat} tone={liveRuns.length > 0 ? "success" : "default"} onClick={() => onNavigate("runs")} subtitle={liveRuns.length > 0 ? `${liveRuns.filter((r) => r.status === "running").length} ${t("dash.running")}` : t("dash.allQuiet")} />
          <MetricCard label={t("dash.activeTasks")} value={activeTasks.length} icon={Briefcase} tone={activeTasks.length > 0 ? "accent" : "default"} onClick={() => onNavigate("tasks")} subtitle={`${tasks.filter((t) => t.status === "todo").length} ${t("dash.queued")}`} />
          <MetricCard label={t("dash.approvals")} value={pendingApprovals.length} icon={ShieldCheck} tone={pendingApprovals.length > 0 ? "warn" : "default"} onClick={() => onNavigate("approvals")} subtitle={pendingApprovals.length > 0 ? t("dash.needsAttention") : t("dash.allClear")} />
          <MetricCard label={t("dash.failedRuns")} value={failedRuns.length} icon={Warning} tone={failedRuns.length > 0 ? "danger" : "default"} onClick={() => onNavigate("runs")} />
          <MetricCard label={t("dash.totalSpend")} value={formatMoney(totalSpend)} icon={CurrencyCircleDollar} onClick={() => onNavigate("costs")} />
          <MetricCard label={t("dash.projects")} value={projects.filter((p) => p.status === "in_progress").length} icon={Target} onClick={() => onNavigate("projects")} subtitle={`${projects.length} ${t("dash.total")}`} />
          <MetricCard label={t("dash.unreadMessages")} value={unreadMessages.length} icon={Users} tone={urgentMessages.length > 0 ? "warn" : unreadMessages.length > 0 ? "accent" : "default"} onClick={() => onNavigate("communication")} subtitle={urgentMessages.length > 0 ? `${urgentMessages.length} urgent` : unreadMessages.length > 0 ? "Needs triage" : "All read"} />
          <MetricCard label={t("dash.browserOps")} value={blockedBrowserActions.length} icon={Cpu} tone={blockedBrowserActions.length > 0 ? "warn" : "default"} onClick={() => onNavigate("social")} subtitle={blockedBrowserActions.length > 0 ? "Blocked or failed" : "Nominal"} />
          <MetricCard label={t("dash.workflowStalls")} value={stalledWorkflows.length} icon={Lightning} tone={stalledWorkflows.length > 0 ? "warn" : "default"} onClick={() => onNavigate("automation")} subtitle={stalledWorkflows.length > 0 ? "Paused or failed" : "Healthy"} />
        </div>
      </div>

      {/* Department Overview */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("dash.departments")}</div>
          <button type="button" onClick={() => onNavigate("orgchart")} className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline">
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
              <button type="button" onClick={() => onNavigate("sprints")} className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline">
                Manage <ArrowRight size={12} />
              </button>
            </div>
            <SprintProgress sprint={activeSprint} tasks={tasks} />
          </section>
        ) : null}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("dash.goalProgress")}</div>
            <button type="button" onClick={() => onNavigate("goals")} className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline">
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
          <button type="button" onClick={() => onNavigate("tasks")} className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline">
            View all <ArrowRight size={12} />
          </button>
        </div>
        <div className="overflow-x-auto rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
          <TaskPipeline tasks={tasks} />
        </div>
      </section>

      {/* Workforce + Activity */}
      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("dash.workforce")}</div>
            <button type="button" onClick={() => onNavigate("orgchart")} className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline">
              {t("dash.orgChart")} <TreeStructure size={12} />
            </button>
          </div>
          <WorkforceGrid agents={agents} onSelectAgent={(id) => onNavigate("agents", id)} />
        </section>
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("dash.recentActivity")}</div>
            <button type="button" onClick={() => onNavigate("activity")} className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--accent)] transition hover:underline">
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
      <NeedsAttention
        agents={agents}
        approvals={approvals}
        runs={runs}
        messages={messages}
        browserActions={browserActions}
        workflows={workflows}
        onNavigate={onNavigate}
      />
    </div>
  );
}
