import { useMemo, useState } from "react";
import { Avatar, Button, Icon, Pill } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import type {
  AgentRecord,
  ApprovalRecord,
  EmployeeRecord,
  GoalRecord,
  ProviderRecord,
  TaskRecord,
} from "../../../shared/domain";
import { NewTaskDialog } from "./NewTaskDialog";
import type { PageProps } from "./types";
import { activeOrgId, formatTime, money, requireActiveEmployee, requireActiveOrganization } from "./types";

export function HomePage({ snapshot, actions }: PageProps) {
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
        />
        <SpendCard providers={providers} totalBudgetCents={totalBudgetCents} agents={agents} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
        <InProgressCard tasks={inProgressTasks} agents={agents} />
        <TeamCard agents={agents} employee={employee} />
        <GoalCard goal={primaryGoal} progress={goalProgress} organizationName={organization.name} />
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
          const requiresApproval = approvals.some((approval) => approval.title === task.title);
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
}: {
  approvals: ApprovalRecord[];
  agents: AgentRecord[];
  employees: EmployeeRecord[];
  onApprove: (approvalId: string) => void;
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
                {approval.kind} · {approval.risk} risk · from {from}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Button tone="primary" size="small" onClick={() => onApprove(approval.id)}>Approve</Button>
                <Button size="small">Open</Button>
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
  agents,
}: {
  providers: ProviderRecord[];
  totalBudgetCents: number;
  agents: AgentRecord[];
}) {
  const connected = providers.filter((provider) => provider.enabled);
  const cap = totalBudgetCents > 0 ? totalBudgetCents * 4 : 0;
  const fillPct = cap > 0 ? Math.min(100, Math.round((totalBudgetCents / cap) * 100)) : 0;
  return (
    <section className="card" style={{ padding: 18 }}>
      <div className="card-label" style={{ marginBottom: 14 }}>This month</div>
      <div className="row" style={{ alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{money(totalBudgetCents)}</span>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{cap > 0 ? `/ ${money(cap)}` : "allocated"}</span>
      </div>
      <div style={{ marginTop: 14, height: 4, background: "var(--panel-3)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${fillPct}%`, height: "100%", background: "var(--text-1)" }} />
      </div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        {connected.slice(0, 3).map((provider) => {
          const usingAgents = agents.filter((agent) => agent.modelProviderId === provider.id).length;
          return (
            <div key={provider.id} className="row" style={{ fontSize: 12 }}>
              <span style={{ color: "var(--text-2)" }}>{provider.label}</span>
              <span className="num mono" style={{ marginLeft: "auto", color: "var(--text-1)", fontWeight: 500 }}>
                {usingAgents} {usingAgents === 1 ? "agent" : "agents"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InProgressCard({ tasks, agents }: { tasks: TaskRecord[]; agents: AgentRecord[] }) {
  const rows = tasks.slice(0, 4);
  return (
    <section className="card" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="card-label">In progress</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{tasks.length} active</span>
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
