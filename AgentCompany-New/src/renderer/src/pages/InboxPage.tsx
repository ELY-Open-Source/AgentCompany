import { useMemo, useState } from "react";
import { Avatar, Pill, Segmented } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import type { AgentRecord, ApprovalRecord, ChatMessageRecord, TaskRecord, TaskRunRecord } from "../../../shared/domain";
import { TASK_STATUS } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, formatRelative } from "./types";

type InboxFilter = "all" | "approvals" | "failures" | "blocked" | "messages";
const FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "approvals", label: "Approvals" },
  { id: "failures", label: "Failures" },
  { id: "blocked", label: "Blocked" },
  { id: "messages", label: "Messages" },
];

type View = "inbox" | "standup" | "performance";
const VIEWS: Array<{ id: View; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "standup", label: "Standup" },
  { id: "performance", label: "Performance" },
];

interface InboxItem {
  id: string;
  kind: InboxFilter;
  title: string;
  detail: string;
  agentName: string | null;
  timestamp: string;
  tone: "amber" | "red" | "violet" | undefined;
}

export function InboxPage({ snapshot }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const agents = useMemo(() => snapshot.agents.filter((a) => a.orgId === orgId), [snapshot.agents, orgId]);
  const tasks = useMemo(() => snapshot.tasks.filter((t) => t.orgId === orgId), [snapshot.tasks, orgId]);
  const taskRuns = useMemo(() => snapshot.taskRuns.filter((r) => r.orgId === orgId), [snapshot.taskRuns, orgId]);
  const approvals = useMemo(() => snapshot.approvals.filter((a) => a.orgId === orgId), [snapshot.approvals, orgId]);
  const messages = useMemo(() => snapshot.chatMessages.filter((m) => m.orgId === orgId), [snapshot.chatMessages, orgId]);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [view, setView] = useState<View>("inbox");

  const items = useMemo(() => buildInboxItems(approvals, taskRuns, tasks, messages, agents), [approvals, taskRuns, tasks, messages, agents]);
  const filtered = filter === "all" ? items : items.filter((item) => item.kind === filter);

  return (
    <div className="page">
      <TopbarActions>
        <Segmented value={view} onChange={setView} options={VIEWS} />
      </TopbarActions>
      <h1 className="page-h1">Inbox</h1>
      <p className="page-sub">{items.length} {items.length === 1 ? "item" : "items"}</p>

      {view === "inbox" && (
        <>
          <div style={{ marginBottom: 14 }}><Segmented value={filter} onChange={setFilter} options={FILTERS} /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((item) => (
              <div key={item.id} className="card" style={{ padding: 12 }}>
                <div className="row" style={{ gap: 10 }}>
                  {item.agentName && <Avatar name={item.agentName} size="sm" bot />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: "var(--text-3)" }}>{item.detail}</div>
                  </div>
                  <Pill tone={item.tone}>{humanize(item.kind)}</Pill>
                  <span className="mono" style={{ fontSize: 12, color: "var(--text-3)", flexShrink: 0 }}>{formatRelative(item.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {view === "standup" && <StandupView agents={agents} tasks={tasks} taskRuns={taskRuns} />}
      {view === "performance" && <PerformanceView agents={agents} tasks={tasks} taskRuns={taskRuns} />}
    </div>
  );
}

function StandupView({ agents, tasks, taskRuns }: { agents: AgentRecord[]; tasks: TaskRecord[]; taskRuns: TaskRunRecord[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {agents.map((agent) => {
        const agentTasks = tasks.filter((t) => t.assigneeAgentId === agent.id);
        const inProgress = agentTasks.filter((t) => t.status === TASK_STATUS.IN_PROGRESS).length;
        const done = agentTasks.filter((t) => t.status === TASK_STATUS.DONE).length;
        const agentRuns = taskRuns.filter((r) => r.agentId === agent.id);
        const lastRun = agentRuns[agentRuns.length - 1];
        return (
          <div key={agent.id} className="card" style={{ padding: 14 }}>
            <div className="row" style={{ gap: 10, marginBottom: 8 }}>
              <Avatar name={agent.name} size="sm" bot />
              <span style={{ fontWeight: 540 }}>{agent.name}</span>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{agent.role} · {agent.department}</span>
            </div>
            <div className="row" style={{ gap: 12, fontSize: 12 }}>
              <span>{inProgress} in progress</span>
              <span>{done} done</span>
              <span>{agentRuns.length} runs</span>
              {lastRun && <span style={{ color: "var(--text-3)" }}>{formatRelative(lastRun.createdAt)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PerformanceView({ agents, tasks, taskRuns }: { agents: AgentRecord[]; tasks: TaskRecord[]; taskRuns: TaskRunRecord[] }) {
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === TASK_STATUS.DONE).length;
  const completedRuns = taskRuns.filter((r) => r.state === "completed").length;
  const failedRuns = taskRuns.filter((r) => r.state === "failed").length;
  const successRate = completedRuns + failedRuns > 0 ? Math.round((completedRuns / (completedRuns + failedRuns)) * 100) : 0;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
        <MetricCard label="Tasks completed" value={String(doneTasks)} sub={`/ ${totalTasks}`} />
        <MetricCard label="Success rate" value={`${successRate}%`} />
        <MetricCard label="Total runs" value={String(taskRuns.length)} />
        <MetricCard label="Active agents" value={String(agents.filter((a) => a.lifecycle === "active").length)} />
      </div>
      <div className="section-label" style={{ marginBottom: 10 }}>Agent throughput</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" }}>
          <div>Agent</div><div>Tasks done</div><div>Runs</div><div>Failures</div>
        </div>
        {agents.map((agent, i) => {
          const agentDone = tasks.filter((t) => t.assigneeAgentId === agent.id && t.status === TASK_STATUS.DONE).length;
          const agentRuns = taskRuns.filter((r) => r.agentId === agent.id);
          const agentFailed = agentRuns.filter((r) => r.state === "failed").length;
          return (
            <div key={agent.id} className="table-row" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", borderBottom: i === agents.length - 1 ? "none" : "1px solid var(--border-soft)" }}>
              <div className="row" style={{ gap: 8 }}>
                <Avatar name={agent.name} size="sm" bot />
                <span style={{ fontWeight: 480 }}>{agent.name}</span>
              </div>
              <div className="num mono">{agentDone}</div>
              <div className="num mono">{agentRuns.length}</div>
              <div>{agentFailed > 0 ? <Pill tone="red">{agentFailed}</Pill> : <span className="num mono" style={{ color: "var(--text-3)" }}>0</span>}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="card-label" style={{ marginBottom: 6 }}>{label}</div>
      <div className="row" style={{ alignItems: "baseline", gap: 4 }}>
        <span className="num" style={{ fontSize: 18, fontWeight: 600 }}>{value}</span>
        {sub && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{sub}</span>}
      </div>
    </div>
  );
}

function buildInboxItems(
  approvals: ApprovalRecord[],
  taskRuns: TaskRunRecord[],
  tasks: TaskRecord[],
  messages: ChatMessageRecord[],
  agents: AgentRecord[],
): InboxItem[] {
  const items: InboxItem[] = [];
  for (const a of approvals.filter((a) => a.state === "pending")) {
    items.push({ id: `app-${a.id}`, kind: "approvals", title: a.title, detail: a.kind.replace(/_/g, " "), agentName: null, timestamp: a.createdAt, tone: "amber" });
  }
  for (const r of taskRuns.filter((r) => r.state === "failed")) {
    const task = tasks.find((t) => t.id === r.taskId);
    const agent = agents.find((a) => a.id === r.agentId);
    items.push({ id: `fail-${r.id}`, kind: "failures", title: task?.title ?? r.taskId, detail: r.errorMessage ?? "Run failed", agentName: agent?.name ?? null, timestamp: r.completedAt ?? r.createdAt, tone: "red" });
  }
  for (const t of tasks.filter((t) => t.status === TASK_STATUS.REVIEW)) {
    const agent = agents.find((a) => a.id === t.assigneeAgentId);
    items.push({ id: `blk-${t.id}`, kind: "blocked", title: t.title, detail: "Awaiting review", agentName: agent?.name ?? null, timestamp: t.updatedAt, tone: "violet" });
  }
  const recent = messages.filter((m) => m.senderType === "agent").slice(-10);
  for (const m of recent) {
    const agent = agents.find((a) => a.id === m.senderId);
    const preview = m.bodyMd.length > 60 ? `${m.bodyMd.slice(0, 57)}...` : m.bodyMd;
    items.push({ id: `msg-${m.id}`, kind: "messages", title: agent?.name ?? "Agent", detail: preview, agentName: agent?.name ?? null, timestamp: m.createdAt, tone: undefined });
  }
  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return items;
}

function humanize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
