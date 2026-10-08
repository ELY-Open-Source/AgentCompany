import { useMemo, useState, type CSSProperties } from "react";
import { Avatar, Button, Icon, Pill } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import type {
  AgentRecord,
  ApprovalRecord,
  ChatMessageRecord,
  EmployeeRecord,
  GoalRecord,
  ProviderRecord,
  TaskRecord,
  TaskRunRecord,
} from "../../../shared/domain";
import { NewTaskDialog } from "./NewTaskDialog";
import { AgentWorkloadChart, CostTrendChart, RunActivityChart, SuccessRateChart } from "./home/DashboardCharts";
import type { PageProps } from "./types";
import { activeOrgId, formatRelative, formatTime, money, requireActiveEmployee, requireActiveOrganization } from "./types";
import { t } from "../i18n/i18n";

const STRIP: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, marginBottom: 16 };
const METRICS: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 16 };
const ACTIVITY: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 };

export function HomePage({ snapshot, actions, navigate }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const organization = requireActiveOrganization(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const tasks = useMemo(() => snapshot.tasks.filter((task) => task.orgId === orgId), [snapshot.tasks, orgId]);
  const agents = useMemo(() => snapshot.agents.filter((agent) => agent.orgId === orgId), [snapshot.agents, orgId]);
  const approvals = useMemo(() => snapshot.approvals.filter((item) => item.orgId === orgId), [snapshot.approvals, orgId]);
  const goals = useMemo(() => snapshot.goals.filter((item) => item.orgId === orgId), [snapshot.goals, orgId]);
  const providers = useMemo(() => snapshot.providers.filter((provider) => provider.orgId === orgId), [snapshot.providers, orgId]);
  const budgetCapCents = useMemo(
    () => snapshot.hiringPolicies.filter((policy) => policy.orgId === orgId).reduce((sum, policy) => sum + policy.monthlyBudgetLimitCents, 0),
    [snapshot.hiringPolicies, orgId],
  );
  const taskRuns = useMemo(() => snapshot.taskRuns.filter((run) => run.orgId === orgId), [snapshot.taskRuns, orgId]);
  const chatMessages = useMemo(() => snapshot.chatMessages.filter((m) => m.orgId === orgId), [snapshot.chatMessages, orgId]);
  const chatSpaces = useMemo(() => snapshot.chatSpaces.filter((s) => s.orgId === orgId), [snapshot.chatSpaces, orgId]);
  const providerRequests = useMemo(() => snapshot.providerRequests.filter((r) => r.orgId === orgId), [snapshot.providerRequests, orgId]);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const pendingApprovals = approvals.filter((approval) => approval.state === "pending");
  const totalBudgetCents = agents.reduce((sum, agent) => sum + agent.budgetCents, 0);
  const primaryGoal = goals.find((goal) => goal.status === "active") ?? goals[0] ?? null;
  const goalProgress = computeGoalProgress(primaryGoal, tasks);
  const firstName = employee.displayName.split(/\s+/)[0] ?? employee.displayName;
  const greeting = greetingFor(new Date().getHours());

  return (
    <div className="page-wide" style={{ maxWidth: 1240 }}>
      <TopbarActions>
        <Button tone="primary" onClick={() => setNewTaskOpen(true)}><Icon name="plus" size={16} /> {t("New task")}</Button>
      </TopbarActions>
      <h1 className="page-h1">{greeting}, {firstName}</h1>
      <p className="page-sub">{renderSummary(pendingApprovals.length, agents.length)}</p>

      <div style={STRIP}>
        <GoalCard goal={primaryGoal} progress={goalProgress} organizationName={organization.name} />
        <SpendCard providers={providers} totalBudgetCents={totalBudgetCents} capCents={budgetCapCents} agents={agents} />
        <WaitingCard
          approvals={pendingApprovals}
          agents={agents}
          employees={[employee]}
          onApprove={(approvalId) => void actions.run(() => window.agentCompany.decideApproval({ orgId, approvalId, state: "approved", decidedByEmployeeId: employee.id }))}
          onOpen={() => navigate("approvals")}
        />
      </div>

      <div style={METRICS}>
        <AgentWorkloadChart agents={agents} tasks={tasks} />
        <RunActivityChart taskRuns={taskRuns} />
        <SuccessRateChart taskRuns={taskRuns} />
        <CostTrendChart providerRequests={providerRequests} />
      </div>

      <div style={ACTIVITY}>
        <RunActivityCard taskRuns={taskRuns} tasks={tasks} agents={agents} onViewAll={() => navigate("runs")} />
        <RecentMessagesCard messages={chatMessages} agents={agents} employees={[employee]} spaces={chatSpaces} onViewAll={() => navigate("chat")} />
      </div>

      <NewTaskDialog open={newTaskOpen} orgId={orgId} snapshot={snapshot} actions={actions} onClose={() => setNewTaskOpen(false)} />
    </div>
  );
}

function GoalCard({
  goal,
  progress,
  organizationName,
}: {
  goal: GoalRecord | null;
  progress: { percent: number; status: "ahead" | "on_track" | "behind" } | null;
  organizationName: string;
}) {
  const percent = progress?.percent ?? 0;
  return (
    <section className="card">
      <div className="card-label" style={{ marginBottom: 12 }}>{t("Quarter goal")}</div>
      <div style={{ fontSize: 16, fontWeight: 540, lineHeight: 1.4, letterSpacing: "-0.01em", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 44 }}>
        {goal ? goal.title : t("Set the first goal for {organizationName}.", { organizationName })}
      </div>
      <div className="row" style={{ alignItems: "baseline", gap: 8, marginTop: 16 }}>
        <span className="num" style={{ fontSize: 18, fontWeight: 600 }}>{progress ? `${percent}%` : "—"}</span>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{progress ? statusLabel(progress.status) : t("no work yet")}</span>
      </div>
      <div style={{ marginTop: 12, height: 4, background: "var(--panel-3)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${percent}%`, height: "100%", background: "var(--text-1)", transition: "width var(--motion-slow) var(--ease-out)" }} />
      </div>
    </section>
  );
}

function SpendCard({
  providers,
  totalBudgetCents,
  capCents,
  agents,
}: {
  providers: ProviderRecord[];
  totalBudgetCents: number;
  capCents: number;
  agents: AgentRecord[];
}) {
  const connected = providers.filter((provider) => provider.enabled);
  const fillPct = capCents > 0 ? Math.min(100, Math.round((totalBudgetCents / capCents) * 100)) : 0;
  return (
    <section className="card">
      <div className="card-label" style={{ marginBottom: 12 }}>{t("Monthly budget")}</div>
      <div className="row" style={{ alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 18, fontWeight: 600 }}>{money(totalBudgetCents)}</span>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{capCents > 0 ? `/ ${money(capCents)}` : t("allocated")}</span>
      </div>
      <div style={{ marginTop: 12, height: 4, background: "var(--panel-3)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${fillPct}%`, height: "100%", background: "var(--text-1)" }} />
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {connected.slice(0, 3).map((provider) => {
          const allocatedCents = agents.filter((agent) => agent.modelProviderId === provider.id).reduce((sum, agent) => sum + agent.budgetCents, 0);
          return (
            <div key={provider.id} className="row" style={{ fontSize: 14 }}>
              <span style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</span>
              <span className="num mono" style={{ marginLeft: "auto", color: "var(--text-1)", fontWeight: 500 }}>{money(allocatedCents)}</span>
            </div>
          );
        })}
        {connected.length === 0 && <span style={{ fontSize: 14, color: "var(--text-3)" }}>{t("No providers connected")}</span>}
      </div>
    </section>
  );
}

function WaitingCard({
  approvals,
  agents,
  employees,
  onApprove,
  onOpen,
}: {
  approvals: ApprovalRecord[];
  agents: AgentRecord[];
  employees: EmployeeRecord[];
  onApprove: (approvalId: string) => void;
  onOpen: () => void;
}) {
  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="card-label">{t("Waiting on you")}</span>
        {approvals.length > 0 && <span style={{ marginLeft: "auto" }}><Pill tone="amber">{approvals.length}</Pill></span>}
      </div>
      {approvals.length === 0 ? (
        <div className="row" style={{ gap: 8, color: "var(--text-3)", fontSize: 14 }}>
          <Icon name="check" size={16} /><span>{t("You're all caught up")}</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {approvals.slice(0, 2).map((approval) => (
            <div key={approval.id}>
              <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{approval.title}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 8px" }}>
                {t("{kind} · {risk} risk · from {requester}", { kind: humanizeLabel(approval.kind), risk: humanizeLabel(approval.risk), requester: resolveRequester(approval, employees, agents) })}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Button tone="primary" size="small" onClick={() => onApprove(approval.id)}>{t("Approve")}</Button>
                <Button size="small" onClick={onOpen}>{t("Open")}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RunActivityCard({
  taskRuns,
  tasks,
  agents,
  onViewAll,
}: {
  taskRuns: TaskRunRecord[];
  tasks: TaskRecord[];
  agents: AgentRecord[];
  onViewAll: () => void;
}) {
  const recent = taskRuns.slice(0, 6);
  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="card-label">{t("Agent runs")}</span>
        <button type="button" className="link-button" style={{ marginLeft: "auto", fontSize: 12 }} onClick={onViewAll}>{t("All runs")} →</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {recent.map((run) => {
          const task = tasks.find((t) => t.id === run.taskId);
          const agent = agents.find((a) => a.id === run.agentId);
          return (
            <div key={run.id} className="row" style={{ gap: 10 }}>
              {agent && <Avatar name={agent.name} size="sm" bot />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task?.title ?? run.taskId}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>{agent?.name ?? t("Agent")} · {run.trigger}</div>
              </div>
              <Pill tone={runStateTone(run.state)}>{runStateLabel(run.state)}</Pill>
              <span className="mono" style={{ fontSize: 12, color: "var(--text-3)", flexShrink: 0 }}>{formatRelative(run.createdAt)}</span>
            </div>
          );
        })}
        {recent.length === 0 && <div style={{ fontSize: 14, color: "var(--text-3)" }}>{t("No runs yet")}</div>}
      </div>
    </section>
  );
}

function RecentMessagesCard({
  messages,
  agents,
  employees,
  spaces,
  onViewAll,
}: {
  messages: ChatMessageRecord[];
  agents: AgentRecord[];
  employees: EmployeeRecord[];
  spaces: Array<{ id: string; name: string }>;
  onViewAll: () => void;
}) {
  const recent = messages.slice(-6).reverse();
  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="card-label">{t("Recent messages")}</span>
        <button type="button" className="link-button" style={{ marginLeft: "auto", fontSize: 12 }} onClick={onViewAll}>{t("Open chat")} →</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {recent.map((msg) => {
          const senderAgent = msg.senderType === "agent" ? agents.find((a) => a.id === msg.senderId) : null;
          const senderEmployee = msg.senderType === "employee" ? employees.find((e) => e.id === msg.senderId) : null;
          const name = senderAgent?.name ?? senderEmployee?.displayName ?? msg.senderType;
          const space = spaces.find((s) => s.id === msg.spaceId);
          const preview = msg.bodyMd.length > 80 ? `${msg.bodyMd.slice(0, 77)}...` : msg.bodyMd;
          return (
            <div key={msg.id} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
              <Avatar name={name} size="sm" bot={msg.senderType === "agent"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 540 }}>{name}</span>
                  {space && <span style={{ fontSize: 12, color: "var(--text-3)" }}>#{space.name}</span>}
                  <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-3)", flexShrink: 0 }}>{formatTime(msg.createdAt)}</span>
                </div>
                <div style={{ fontSize: 14, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4 }}>{preview}</div>
              </div>
            </div>
          );
        })}
        {recent.length === 0 && <div style={{ fontSize: 14, color: "var(--text-3)" }}>{t("No messages yet")}</div>}
      </div>
    </section>
  );
}

function computeGoalProgress(goal: GoalRecord | null, tasks: TaskRecord[]): { percent: number; status: "ahead" | "on_track" | "behind" } | null {
  if (!goal) return null;
  const scoped = tasks.filter((task) => task.goalId === goal.id);
  if (scoped.length === 0) return { percent: 0, status: "on_track" };
  const done = scoped.filter((task) => task.status === "done").length;
  const percent = Math.round((done / scoped.length) * 100);
  if (percent >= 75) return { percent, status: "ahead" };
  if (percent >= 30) return { percent, status: "on_track" };
  return { percent, status: "behind" };
}

function statusLabel(status: "ahead" | "on_track" | "behind"): string {
  if (status === "ahead") return t("ahead");
  if (status === "behind") return t("behind");
  return t("on track");
}

function greetingFor(hour: number): string {
  if (hour < 12) return t("Good morning");
  if (hour < 17) return t("Good afternoon");
  return t("Good evening");
}

function renderSummary(pending: number, agents: number): string {
  const things = pending === 1
    ? t("{n} thing waiting on you", { n: pending })
    : t("{n} things waiting on you", { n: pending });
  const onDeck = agents === 1
    ? t("{n} agent on deck", { n: agents })
    : t("{n} agents on deck", { n: agents });
  return `${things} · ${onDeck}`;
}

function humanizeLabel(value: string): string {
  if (!value) return value;
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function resolveRequester(approval: ApprovalRecord, employees: EmployeeRecord[], agents: AgentRecord[]): string {
  if (approval.requestedByType === "employee" && approval.requestedById) {
    const employee = employees.find((item) => item.id === approval.requestedById);
    if (employee) return employee.displayName;
  }
  if (approval.requestedByType === "agent" && approval.requestedById) {
    const agent = agents.find((item) => item.id === approval.requestedById);
    if (agent) return agent.name;
  }
  return t("System");
}

function runStateTone(state: string): "red" | "amber" | "violet" | "green" | undefined {
  if (state === "failed") return "red";
  if (state === "running") return "violet";
  if (state === "queued") return "amber";
  if (state === "completed") return "green";
  return undefined;
}

function runStateLabel(state: string): string {
  if (state === "queued") return t("Queued");
  if (state === "running") return t("Running");
  if (state === "completed") return t("Done");
  if (state === "failed") return t("Failed");
  if (state === "superseded") return t("Superseded");
  return state;
}
