import { useMemo, useState } from "react";
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
import { AgentWorkloadChart, BudgetUtilizationChart, CostTrendChart, RunActivityChart, SuccessRateChart } from "./home/DashboardCharts";
import type { PageProps } from "./types";
import { activeOrgId, formatRelative, formatTime, money, requireActiveEmployee, requireActiveOrganization } from "./types";

export function HomePage({ snapshot, actions, navigate }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const organization = requireActiveOrganization(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const tasks = useMemo(() => snapshot.tasks.filter((task) => task.orgId === orgId), [snapshot.tasks, orgId]);
  const agents = useMemo(() => snapshot.agents.filter((agent) => agent.orgId === orgId), [snapshot.agents, orgId]);
  const approvals = useMemo(() => snapshot.approvals.filter((item) => item.orgId === orgId), [snapshot.approvals, orgId]);
  const goals = useMemo(() => snapshot.goals.filter((item) => item.orgId === orgId), [snapshot.goals, orgId]);
  const providers = useMemo(
    () => snapshot.providers.filter((provider) => provider.orgId === orgId),
    [snapshot.providers, orgId],
  );
  const budgetCapCents = useMemo(
    () =>
      snapshot.hiringPolicies
        .filter((policy) => policy.orgId === orgId)
        .reduce((sum, policy) => sum + policy.monthlyBudgetLimitCents, 0),
    [snapshot.hiringPolicies, orgId],
  );
  const taskRuns = useMemo(() => snapshot.taskRuns.filter((run) => run.orgId === orgId), [snapshot.taskRuns, orgId]);
  const chatMessages = useMemo(() => snapshot.chatMessages.filter((m) => m.orgId === orgId), [snapshot.chatMessages, orgId]);
  const chatSpaces = useMemo(() => snapshot.chatSpaces.filter((s) => s.orgId === orgId), [snapshot.chatSpaces, orgId]);
  const providerRequests = useMemo(() => snapshot.providerRequests.filter((r) => r.orgId === orgId), [snapshot.providerRequests, orgId]);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const pendingApprovals = approvals.filter((approval) => approval.state === "pending");
  const inProgressTasks = tasks.filter((task) => task.status === "in_progress");
  const today = new Date();
  const agendaTasks = collectAgendaTasks(tasks, today);
  const totalBudgetCents = agents.reduce((sum, agent) => sum + agent.budgetCents, 0);
  const primaryGoal = goals.find((goal) => goal.status === "active") ?? goals[0] ?? null;
  const goalProgress = computeGoalProgress(primaryGoal, tasks);
  const firstName = employee.displayName.split(/\s+/)[0] ?? employee.displayName;
  const greeting = greetingFor(today.getHours());
  const summaryText = renderSummary(pendingApprovals.length, agents.length);

  return (
    <div className="page">
      <TopbarActions>
        <Button tone="ghost" onClick={() => void actions.reload()} title="Refresh"><Icon name="refresh" size={13} /></Button>
        <Button tone="primary" onClick={() => setNewTaskOpen(true)}><Icon name="plus" size={13} /> New task</Button>
      </TopbarActions>
      <h1 className="page-h1">{greeting}, {firstName}</h1>
      <p className="page-sub">{summaryText}</p>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 12, marginBottom: 12 }}>
        <TodayCard date={today} tasks={agendaTasks} agents={agents} employee={employee} approvals={pendingApprovals} />
        <WaitingCard
          approvals={pendingApprovals}
          agents={agents}
          employees={[employee]}
          onApprove={(approvalId) => void actions.run(() => window.agentCompany.decideApproval({
            orgId,
            approvalId,
            state: "approved",
            decidedByEmployeeId: employee.id,
          }))}
          onOpen={() => navigate("approvals")}
        />
        <SpendCard providers={providers} totalBudgetCents={totalBudgetCents} capCents={budgetCapCents} agents={agents} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
        <InProgressCard tasks={inProgressTasks} agents={agents} onViewAll={() => navigate("work")} />
        <TeamCard agents={agents} employee={employee} />
        <GoalCard goal={primaryGoal} progress={goalProgress} organizationName={organization.name} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
        <AgentWorkloadChart agents={agents} tasks={tasks} />
        <BudgetUtilizationChart agents={agents} providers={providers} />
        <RunActivityChart taskRuns={taskRuns} />
        <SuccessRateChart taskRuns={taskRuns} />
        <CostTrendChart providerRequests={providerRequests} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, marginTop: 12 }}>
        <RunActivityCard taskRuns={taskRuns} tasks={tasks} agents={agents} onViewAll={() => navigate("runs")} />
        <RecentMessagesCard messages={chatMessages} agents={agents} employees={[employee]} spaces={chatSpaces} onViewAll={() => navigate("chat")} />
      </div>

      <NewTaskDialog open={newTaskOpen} orgId={orgId} snapshot={snapshot} actions={actions} onClose={() => setNewTaskOpen(false)} />
    </div>
  );
}

function TodayCard({
  date,
  tasks,
  agents,
  employee,
  approvals,
}: {
  date: Date;
  tasks: TaskRecord[];
  agents: AgentRecord[];
  employee: EmployeeRecord;
  approvals: ApprovalRecord[];
}) {
  const formatted = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const rows = tasks.slice(0, 4);
  return (
    <section className="card" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="card-label">Today</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{formatted}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((task) => {
          const owner = agents.find((agent) => agent.id === task.assigneeAgentId);
          const ownerName = owner?.name ?? employee.displayName;
          const time = agendaTime(task, date);
          const requiresApproval = approvals.some(
            (approval) => approval.sourceEntityType === "task" && approval.sourceEntityId === task.id,
          );
          return (
            <div key={task.id} className="row" style={{ gap: 12 }}>
              <span className="num mono" style={{ width: 36, fontSize: 12, color: "var(--text-3)" }}>{time}</span>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                <span style={{ fontWeight: 500 }}>{task.title}</span>
                <span style={{ color: "var(--text-3)", marginLeft: 6 }}>· {ownerName}</span>
              </div>
              {requiresApproval && <Pill tone="amber">You</Pill>}
            </div>
          );
        })}
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
    <section className="card" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="card-label">Waiting on you</span>
        {approvals.length > 0 && <span style={{ marginLeft: "auto" }}><Pill tone="amber">{approvals.length}</Pill></span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {approvals.slice(0, 2).map((approval) => {
          const from = resolveRequester(approval, employees, agents);
          return (
            <div key={approval.id} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{approval.title}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10 }}>
                {humanizeLabel(approval.kind)} · {humanizeLabel(approval.risk)} risk · from {from}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Button tone="primary" size="small" onClick={() => onApprove(approval.id)}>Approve</Button>
                <Button size="small" onClick={onOpen}>Open</Button>
              </div>
            </div>
          );
        })}
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
    <section className="card" style={{ padding: 18 }}>
      <div className="card-label" style={{ marginBottom: 14 }}>Monthly budget</div>
      <div className="row" style={{ alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{money(totalBudgetCents)}</span>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{capCents > 0 ? `/ ${money(capCents)}` : "allocated"}</span>
      </div>
      <div style={{ marginTop: 14, height: 4, background: "var(--panel-3)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${fillPct}%`, height: "100%", background: "var(--text-1)" }} />
      </div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        {connected.slice(0, 3).map((provider) => {
          const allocatedCents = agents
            .filter((agent) => agent.modelProviderId === provider.id)
            .reduce((sum, agent) => sum + agent.budgetCents, 0);
          return (
            <div key={provider.id} className="row" style={{ fontSize: 12 }}>
              <span style={{ color: "var(--text-2)" }}>{provider.label}</span>
              <span className="num mono" style={{ marginLeft: "auto", color: "var(--text-1)", fontWeight: 500 }}>
                {money(allocatedCents)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InProgressCard({ tasks, agents, onViewAll }: { tasks: TaskRecord[]; agents: AgentRecord[]; onViewAll: () => void }) {
  const rows = tasks.slice(0, 4);
  return (
    <section className="card" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="card-label">In progress</span>
        <button
          type="button"
          className="link-button"
          style={{ marginLeft: "auto", fontSize: 11 }}
          onClick={onViewAll}
        >
          All work →
        </button>
      </div>
      {rows.map((task, index) => {
        const owner = agents.find((agent) => agent.id === task.assigneeAgentId);
        const last = index === rows.length - 1;
        return (
          <div key={task.id} className="row" style={{ gap: 10, padding: "10px 0", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-4)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</div>
            {owner && <Pill>{owner.department}</Pill>}
            {owner && <Avatar name={owner.name} size="sm" bot />}
          </div>
        );
      })}
    </section>
  );
}

function TeamCard({ agents, employee }: { agents: AgentRecord[]; employee: EmployeeRecord }) {
  return (
    <section className="card" style={{ padding: 18 }}>
      <div className="card-label" style={{ marginBottom: 14 }}>Team</div>
      {agents.slice(0, 4).map((agent) => (
        <div key={agent.id} className="row" style={{ gap: 10, padding: "7px 0" }}>
          <Avatar name={agent.name} size="sm" bot />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.name}</span>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{agent.role}</span>
        </div>
      ))}
      <div className="row" style={{ gap: 10, padding: "7px 0" }}>
        <Avatar name={employee.displayName} size="sm" />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{employee.displayName}</span>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{employee.role} · human</span>
      </div>
    </section>
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
  return (
    <section
      className="card"
      style={{
        padding: 18,
        background: "linear-gradient(180deg, #0a0a0b 0%, #18181b 100%)",
        color: "#fff",
        border: "1px solid #18181b",
      }}
    >
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 540, letterSpacing: "0.02em", marginBottom: 12 }}>
        Quarter goal
      </div>
      <div style={{ fontSize: 15, fontWeight: 540, lineHeight: 1.35, marginBottom: 18, letterSpacing: "-0.01em" }}>
        {goal ? goal.title : `Set the first goal for ${organizationName}.`}
      </div>
      <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 600 }}>{progress ? `${progress.percent}%` : "—"}</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
          {progress ? statusLabel(progress.status) : "no work yet"}
        </span>
      </div>
      <div style={{ marginTop: 10, height: 3, background: "rgba(255,255,255,0.12)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${progress?.percent ?? 0}%`, height: "100%", background: "#fff" }} />
      </div>
    </section>
  );
}

function agendaTime(task: TaskRecord, reference: Date): string {
  const updated = new Date(task.updatedAt);
  if (Number.isNaN(updated.getTime())) return "—";
  const sameDay =
    updated.getFullYear() === reference.getFullYear() &&
    updated.getMonth() === reference.getMonth() &&
    updated.getDate() === reference.getDate();
  if (!sameDay) return "—";
  return formatTime(task.updatedAt);
}

function collectAgendaTasks(tasks: TaskRecord[], reference: Date): TaskRecord[] {
  const startOfDay = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
  const todays = tasks.filter((task) => {
    const updated = new Date(task.updatedAt).getTime();
    return updated >= startOfDay && updated < endOfDay && task.status !== "done";
  });
  if (todays.length > 0) return todays.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return tasks.filter((task) => task.status !== "done").slice(0, 4);
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
  if (status === "ahead") return "ahead";
  if (status === "behind") return "behind";
  return "on track";
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function renderSummary(pending: number, agents: number): string {
  const things = `${pending} ${pending === 1 ? "thing" : "things"} waiting on you`;
  const onDeck = `${agents} ${agents === 1 ? "agent" : "agents"} on deck`;
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
  return "System";
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
  const recent = taskRuns.slice(0, 8);
  return (
    <section className="card" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="card-label">Agent runs</span>
        <button type="button" className="link-button" style={{ marginLeft: "auto", fontSize: 11 }} onClick={onViewAll}>
          All work →
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {recent.map((run) => {
          const task = tasks.find((t) => t.id === run.taskId);
          const agent = agents.find((a) => a.id === run.agentId);
          return (
            <div key={run.id} className="row" style={{ gap: 10 }}>
              {agent && <Avatar name={agent.name} size="sm" bot />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {task?.title ?? run.taskId}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {agent?.name ?? "Agent"} · {run.trigger}
                </div>
              </div>
              <Pill tone={runStateTone(run.state)}>{runStateLabel(run.state)}</Pill>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>{formatRelative(run.createdAt)}</span>
            </div>
          );
        })}
        {recent.length === 0 && <div style={{ fontSize: 13, color: "var(--text-3)" }}>No runs yet</div>}
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
  const recent = messages.slice(-8).reverse();
  return (
    <section className="card" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="card-label">Recent messages</span>
        <button type="button" className="link-button" style={{ marginLeft: "auto", fontSize: 11 }} onClick={onViewAll}>
          Open chat →
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                  <span style={{ fontSize: 12.5, fontWeight: 540 }}>{name}</span>
                  {space && <span style={{ fontSize: 11, color: "var(--text-3)" }}>#{space.name}</span>}
                  <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>{formatTime(msg.createdAt)}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4 }}>
                  {preview}
                </div>
              </div>
            </div>
          );
        })}
        {recent.length === 0 && <div style={{ fontSize: 13, color: "var(--text-3)" }}>No messages yet</div>}
      </div>
    </section>
  );
}

function runStateTone(state: string): "red" | "amber" | "violet" | undefined {
  if (state === "failed") return "red";
  if (state === "running") return "violet";
  if (state === "queued") return "amber";
  return undefined;
}

function runStateLabel(state: string): string {
  if (state === "queued") return "Queued";
  if (state === "running") return "Running";
  if (state === "completed") return "Done";
  if (state === "failed") return "Failed";
  return state;
}
