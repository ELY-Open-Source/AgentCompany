import { Avatar, Button, Icon, Pill } from "../shared/ui";
import type { ApprovalRecord, TaskRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, money } from "./types";

export function HomePage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const organization = snapshot.organizations.find((item) => item.id === orgId);
  if (!organization) throw new Error("Active organization is missing.");
  const employee = snapshot.employees.find((item) => item.orgId === orgId);
  if (!employee) throw new Error("Active employee is missing.");
  const tasks = snapshot.tasks.filter((item) => item.orgId === orgId);
  const approvals = snapshot.approvals.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);
  const providers = snapshot.providers.filter((item) => item.orgId === orgId && item.enabled);
  const goals = snapshot.goals.filter((item) => item.orgId === orgId);
  const pending = approvals.filter((item) => item.state === "pending");
  const inProgress = tasks.filter((item) => item.status === "in_progress");
  const totalBudgetCents = agents.reduce((sum, agent) => sum + agent.budgetCents, 0);
  const primaryGoal = goals[0] ?? null;
  const greeting = greetingByHour(new Date().getHours());
  const firstName = employee.displayName.split(" ")[0];

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-h1">{greeting}, {firstName}</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            {pending.length} {pending.length === 1 ? "thing" : "things"} waiting on you · {agents.length} {agents.length === 1 ? "agent" : "agents"} on deck
          </p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Button tone="ghost" onClick={() => void actions.reload()}><Icon name="refresh" /></Button>
          <Button tone="primary" onClick={() => void 0}><Icon name="plus" /> New task</Button>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 12 }}>
        <TodayCard tasks={inProgress} agents={agents} />
        <WaitingCard approvals={pending} onApprove={(id) => {
          const emp = employee;
          void actions.run(() => window.agentCompany.decideApproval({ orgId, approvalId: id, state: "approved", decidedByEmployeeId: emp.id }));
        }} />
        <SpendCard providers={providers} totalBudgetCents={totalBudgetCents} />
      </div>

      <div className="grid-3">
        <InProgressCard tasks={inProgress} agents={agents} />
        <TeamCard agents={agents} employee={employee} />
        <GoalCard goal={primaryGoal} totalTasks={tasks.length} doneTasks={tasks.filter((t) => t.status === "done").length} />
      </div>
    </div>
  );
}

function TodayCard({ tasks, agents }: { tasks: TaskRecord[]; agents: Array<{ id: string; name: string }> }) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="card-label">Today</div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{today}</div>
      </div>
      {tasks.length === 0 ? (
        <div style={{ color: "var(--text-3)", padding: "6px 0" }}>No active work</div>
      ) : tasks.slice(0, 4).map((task) => {
        const agent = agents.find((a) => a.id === task.assigneeAgentId);
        return (
          <div key={task.id} className="row" style={{ gap: 12, padding: "9px 0", borderBottom: "1px solid var(--border-soft)" }}>
            <span className="num" style={{ width: 36, fontSize: 12, color: "var(--text-3)" }}>—</span>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 500 }}>{task.title}</span>
              {agent && <span style={{ color: "var(--text-3)", marginLeft: 6 }}>· {agent.name}</span>}
            </div>
            {task.risk === "high" && <Pill tone="amber">High risk</Pill>}
          </div>
        );
      })}
    </div>
  );
}

function WaitingCard({ approvals, onApprove }: { approvals: ApprovalRecord[]; onApprove: (id: string) => void }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="card-label">Waiting on you</div>
        {approvals.length > 0 && <span style={{ marginLeft: "auto" }}><Pill tone="amber">{approvals.length}</Pill></span>}
      </div>
      {approvals.length === 0 ? (
        <div style={{ color: "var(--text-3)", padding: "6px 0" }}>Nothing pending</div>
      ) : approvals.slice(0, 2).map((approval) => (
        <div key={approval.id} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{approval.title}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10 }}>
            {approval.risk} risk · {approval.kind}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Button tone="primary" size="small" onClick={() => onApprove(approval.id)}>Approve</Button>
            <Button size="small">Open</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SpendCard({ providers, totalBudgetCents }: { providers: Array<{ id: string; label: string; budgetCents?: number }>; totalBudgetCents: number }) {
  const topProviders = providers.slice(0, 3);
  const budgetLabel = money(totalBudgetCents);
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="card-label" style={{ marginBottom: 14 }}>Monthly budget</div>
      <div className="row" style={{ alignItems: "baseline", gap: 6 }}>
        <div className="num" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{budgetLabel}</div>
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>allocated</div>
      </div>
      <div style={{ marginTop: 14, height: 4, background: "var(--panel-3)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: totalBudgetCents > 0 ? "100%" : "0%", height: "100%", background: "var(--text-1)" }} />
      </div>
      {topProviders.length === 0 ? (
        <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-3)" }}>No providers</div>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {topProviders.map((provider) => (
            <div key={provider.id} className="row" style={{ fontSize: 12 }}>
              <span style={{ color: "var(--text-2)" }}>{provider.label}</span>
              <span className="num" style={{ marginLeft: "auto", color: "var(--text-1)", fontWeight: 500 }}>—</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InProgressCard({ tasks, agents }: { tasks: TaskRecord[]; agents: Array<{ id: string; name: string; department: string }> }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="card-label">In progress</div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)", cursor: "pointer" }}>All work →</div>
      </div>
      {tasks.length === 0 ? (
        <div style={{ color: "var(--text-3)", padding: "6px 0" }}>No active work</div>
      ) : tasks.slice(0, 4).map((task, index) => {
        const agent = agents.find((a) => a.id === task.assigneeAgentId);
        const isLast = index === tasks.slice(0, 4).length - 1;
        return (
          <div key={task.id} className="row" style={{ gap: 10, padding: "10px 0", borderBottom: isLast ? "none" : "1px solid var(--border-soft)" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-4)", flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 480 }}>{task.title}</div>
            {agent && <Pill>{agent.department || "Agent"}</Pill>}
            {agent && <Avatar name={agent.name} size="sm" bot />}
          </div>
        );
      })}
    </div>
  );
}

function TeamCard({ agents, employee }: { agents: Array<{ id: string; name: string; role: string }>; employee: { displayName: string; role: string } }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="card-label" style={{ marginBottom: 14 }}>Team</div>
      {agents.slice(0, 4).map((agent) => (
        <div key={agent.id} className="row" style={{ gap: 10, padding: "7px 0" }}>
          <Avatar name={agent.name} size="sm" bot />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{agent.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>{agent.role}</div>
        </div>
      ))}
      <div className="row" style={{ gap: 10, padding: "7px 0" }}>
        <Avatar name={employee.displayName} size="sm" />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{employee.displayName}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{employee.role} · human</div>
      </div>
    </div>
  );
}

function GoalCard({ goal, totalTasks, doneTasks }: { goal: { title: string; description: string } | null; totalTasks: number; doneTasks: number }) {
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  return (
    <div className="card" style={{ padding: 18, background: "linear-gradient(180deg, #0a0a0b 0%, #18181b 100%)", color: "#fff", border: "1px solid #18181b" }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 540, letterSpacing: "0.02em", marginBottom: 12 }}>Quarter goal</div>
      <div style={{ fontSize: 15, fontWeight: 540, lineHeight: 1.35, marginBottom: 18, letterSpacing: "-0.01em" }}>
        {goal ? goal.title : "No active goal"}
      </div>
      <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
        <div className="num" style={{ fontSize: 24, fontWeight: 600 }}>{pct}%</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>complete</div>
      </div>
      <div style={{ marginTop: 10, height: 3, background: "rgba(255,255,255,0.12)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#fff" }} />
      </div>
    </div>
  );
}

function greetingByHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
