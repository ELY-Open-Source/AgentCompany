import { useMemo, useState } from "react";
import { Avatar, Button, Icon, IconButton, Pill, Segmented } from "../shared/ui";
import { MenuDivider, MenuLabel, MenuRow, Popover } from "../shared/Popover";
import { TopbarActions } from "../shared/TopbarActions";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type AgentRecord,
  type GoalRecord,
  type ProviderRecord,
  type ProjectRecord,
  type TaskPriority,
  type TaskRecord,
  type TaskRunRecord,
  type TaskStatus,
  type WorkspaceRecord,
} from "../../../shared/domain";
import { NewTaskDialog } from "./NewTaskDialog";
import { TaskDetailDialog } from "./work/TaskDetailDialog";
import { canRun, latestTaskRun, nextStatus, prettyRunState, prettyStatus, providerFor, runTone } from "./work/task-helpers";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";

type View = "board" | "list" | "timeline";

const COLUMNS: ReadonlyArray<{ id: TaskStatus; label: string; tone: string }> = [
  { id: TASK_STATUS.BACKLOG, label: "Backlog", tone: "var(--text-4)" },
  { id: TASK_STATUS.IN_PROGRESS, label: "In progress", tone: "var(--accent)" },
  { id: TASK_STATUS.REVIEW, label: "In review", tone: "var(--amber)" },
  { id: TASK_STATUS.DONE, label: "Done", tone: "var(--green)" },
];

const VIEW_OPTIONS: ReadonlyArray<{ id: View; label: string }> = [
  { id: "board", label: "Board" },
  { id: "list", label: "List" },
  { id: "timeline", label: "Timeline" },
];

export function WorkPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const [view, setView] = useState<View>("board");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  const allTasks = useMemo(() => snapshot.tasks.filter((task) => task.orgId === orgId), [snapshot.tasks, orgId]);
  const tasks = useMemo(
    () =>
      allTasks.filter((task) => {
        if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
        if (assigneeFilter !== "all" && task.assigneeAgentId !== assigneeFilter) return false;
        return true;
      }),
    [allTasks, priorityFilter, assigneeFilter],
  );
  const assigneeCount = useMemo(
    () => new Set(tasks.map((task) => task.assigneeAgentId).filter((id): id is string => id !== null)).size,
    [tasks],
  );
  const agents = useMemo(() => snapshot.agents.filter((agent) => agent.orgId === orgId), [snapshot.agents, orgId]);
  const projects = useMemo(() => snapshot.projects.filter((project) => project.orgId === orgId), [snapshot.projects, orgId]);
  const goals = useMemo(() => snapshot.goals.filter((goal) => goal.orgId === orgId), [snapshot.goals, orgId]);
  const workspaces = useMemo(() => snapshot.workspaces.filter((workspace) => workspace.orgId === orgId), [snapshot.workspaces, orgId]);
  const providers = useMemo(() => snapshot.providers.filter((provider) => provider.orgId === orgId), [snapshot.providers, orgId]);
  const taskRuns = useMemo(() => snapshot.taskRuns.filter((run) => run.orgId === orgId), [snapshot.taskRuns, orgId]);

  const advance = (task: TaskRecord) => {
    const next = nextStatus(task.status);
    if (!next) return;
    void actions.run(() => window.agentCompany.updateTaskStatus({ orgId, taskId: task.id, status: next }));
  };
  const runTask = (task: TaskRecord) => {
    void actions.run(() => window.agentCompany.runTask({ orgId, taskId: task.id }));
  };
  const detailTask = detailTaskId ? allTasks.find((task) => task.id === detailTaskId) ?? null : null;

  return (
    <div className="page-wide">
      <TopbarActions>
        <Segmented value={view} onChange={setView} options={VIEW_OPTIONS} />
        <WorkFilter
          agents={agents}
          priority={priorityFilter}
          assignee={assigneeFilter}
          onPriority={setPriorityFilter}
          onAssignee={setAssigneeFilter}
        />
        <Button tone="primary" onClick={() => setNewTaskOpen(true)}><Icon name="plus" size={13} /> New task</Button>
      </TopbarActions>
      <h1 className="page-h1">Work</h1>
      <p className="page-sub">
        {tasks.length} {tasks.length === 1 ? "task" : "tasks"} · {assigneeCount} {assigneeCount === 1 ? "assignee" : "assignees"}
      </p>

      {view === "board" && (
        <BoardView
          tasks={tasks}
          agents={agents}
          projects={projects}
          goals={goals}
          workspaces={workspaces}
          providers={providers}
          taskRuns={taskRuns}
          onAdvance={advance}
          onRun={runTask}
          onCreate={() => setNewTaskOpen(true)}
          onOpen={(task) => setDetailTaskId(task.id)}
        />
      )}
      {view === "list" && (
        <ListView
          tasks={tasks}
          agents={agents}
          projects={projects}
          providers={providers}
          onRun={runTask}
          onOpen={(task) => setDetailTaskId(task.id)}
        />
      )}
      {view === "timeline" && <TimelineView tasks={tasks} goals={goals} />}

      <NewTaskDialog open={newTaskOpen} orgId={orgId} snapshot={snapshot} actions={actions} onClose={() => setNewTaskOpen(false)} />
      <TaskDetailDialog
        task={detailTask}
        agents={agents}
        projects={projects}
        goals={goals}
        workspaces={workspaces}
        providers={providers}
        taskRuns={taskRuns}
        onClose={() => setDetailTaskId(null)}
        onAdvance={advance}
        onRun={runTask}
      />
    </div>
  );
}

function WorkFilter({
  agents,
  priority,
  assignee,
  onPriority,
  onAssignee,
}: {
  agents: AgentRecord[];
  priority: TaskPriority | "all";
  assignee: string;
  onPriority: (next: TaskPriority | "all") => void;
  onAssignee: (next: string) => void;
}) {
  const active = priority !== "all" || assignee !== "all";
  const priorities: ReadonlyArray<{ id: TaskPriority | "all"; label: string }> = [
    { id: "all", label: "All priorities" },
    { id: TASK_PRIORITY.HIGH, label: "High" },
    { id: TASK_PRIORITY.NORMAL, label: "Normal" },
    { id: TASK_PRIORITY.LOW, label: "Low" },
  ];
  return (
    <Popover
      trigger={({ toggle }) => (
        <button type="button" className="button ghost" aria-label="Filter tasks" onClick={toggle}>
          <Icon name="filter" size={13} color={active ? "var(--accent)" : "currentColor"} />
        </button>
      )}
    >
      {() => (
        <>
          <MenuLabel>Priority</MenuLabel>
          {priorities.map((option) => (
            <MenuRow key={option.id} active={priority === option.id} onClick={() => onPriority(option.id)}>
              {option.label}
              {priority === option.id && <span className="menu-check"><Icon name="check" size={13} /></span>}
            </MenuRow>
          ))}
          <MenuDivider />
          <MenuLabel>Assignee</MenuLabel>
          <MenuRow active={assignee === "all"} onClick={() => onAssignee("all")}>
            All assignees
            {assignee === "all" && <span className="menu-check"><Icon name="check" size={13} /></span>}
          </MenuRow>
          {agents.map((agent) => (
            <MenuRow key={agent.id} active={assignee === agent.id} onClick={() => onAssignee(agent.id)}>
              {agent.name}
              {assignee === agent.id && <span className="menu-check"><Icon name="check" size={13} /></span>}
            </MenuRow>
          ))}
        </>
      )}
    </Popover>
  );
}

function BoardView({
  tasks,
  agents,
  projects,
  goals,
  workspaces,
  providers,
  taskRuns,
  onAdvance,
  onRun,
  onCreate,
  onOpen,
}: {
  tasks: TaskRecord[];
  agents: AgentRecord[];
  projects: ProjectRecord[];
  goals: GoalRecord[];
  workspaces: WorkspaceRecord[];
  providers: ProviderRecord[];
  taskRuns: TaskRunRecord[];
  onAdvance: (task: TaskRecord) => void;
  onRun: (task: TaskRecord) => void;
  onCreate: () => void;
  onOpen: (task: TaskRecord) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, minWidth: 0 }}>
      {COLUMNS.map((column) => {
        const columnTasks = tasks.filter((task) => task.status === column.id);
        return (
          <div key={column.id} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div className="row" style={{ padding: "4px 6px 8px" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: column.tone, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, fontWeight: 540 }}>{column.label}</span>
              <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>{columnTasks.length}</span>
              <IconButton icon="plus" label="Add task" onClick={onCreate} />
            </div>
            {columnTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                assignee={agents.find((agent) => agent.id === task.assigneeAgentId) ?? null}
                project={projects.find((project) => project.id === task.projectId) ?? null}
                goal={goals.find((goal) => goal.id === task.goalId) ?? null}
                workspace={workspaces.find((workspace) => workspace.id === task.workspaceId) ?? null}
                provider={providerFor(agents.find((agent) => agent.id === task.assigneeAgentId) ?? null, providers)}
                latestRun={latestTaskRun(task.id, taskRuns)}
                onAdvance={() => onAdvance(task)}
                onRun={() => onRun(task)}
                onOpen={() => onOpen(task)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ListView({
  tasks,
  agents,
  projects,
  providers,
  onRun,
  onOpen,
}: {
  tasks: TaskRecord[];
  agents: AgentRecord[];
  projects: ProjectRecord[];
  providers: ProviderRecord[];
  onRun: (task: TaskRecord) => void;
  onOpen: (task: TaskRecord) => void;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="table-row head"
        style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr) 88px" }}
      >
        <div>Title</div><div>Status</div><div>Priority</div><div>Assignee</div><div />
      </div>
      {tasks.map((task, index) => {
        const assignee = agents.find((agent) => agent.id === task.assigneeAgentId) ?? null;
        const provider = providerFor(assignee, providers);
        const project = projects.find((p) => p.id === task.projectId) ?? null;
        const last = index === tasks.length - 1;
        return (
          <div
            key={task.id}
            role="button"
            tabIndex={0}
            className="table-row clickable"
            onClick={() => onOpen(task)}
            onKeyDown={(event) => { if (event.key === "Enter") onOpen(task); }}
            style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr) 88px", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
          >
            <div className="row" style={{ gap: 8, minWidth: 0 }}>
              {task.risk === "high" && <span style={{ width: 3, height: 12, background: "var(--red)", borderRadius: 2, flexShrink: 0 }} />}
              <span style={{ fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
              {project && <Pill>{project.name}</Pill>}
            </div>
            <div><Pill>{prettyStatus(task.status)}</Pill></div>
            <div><Pill tone={task.priority === "high" ? "amber" : undefined}>{task.priority}</Pill></div>
            <div>
              {assignee ? (
                <div className="row" style={{ gap: 8 }}>
                  <Avatar name={assignee.name} size="sm" bot />
                  <span style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assignee.name}</span>
                </div>
              ) : (
                <span style={{ color: "var(--text-4)" }}>—</span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }} onClick={(event) => event.stopPropagation()}>
              {assignee && <IconButton icon="send" label={`Run ${task.title}`} onClick={() => onRun(task)} disabled={!canRun(provider)} />}
              <IconButton icon="more" label={`Open ${task.title}`} onClick={() => onOpen(task)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineView({ tasks, goals }: { tasks: TaskRecord[]; goals: GoalRecord[] }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="section-label">By goal</div>
      {goals.map((goal) => {
        const linked = tasks.filter((task) => task.goalId === goal.id);
        const done = linked.filter((task) => task.status === TASK_STATUS.DONE).length;
        const pct = linked.length === 0 ? 0 : Math.round((done / linked.length) * 100);
        return (
          <div key={goal.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border-soft)" }}>
            <div className="row">
              <span style={{ fontWeight: 540 }}>{goal.title}</span>
              <span className="num" style={{ marginLeft: "auto", color: "var(--text-3)" }}>{done} / {linked.length}</span>
            </div>
            <div style={{ marginTop: 8, height: 3, background: "var(--panel-3)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--text-1)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  assignee,
  project,
  goal,
  workspace,
  provider,
  latestRun,
  onAdvance,
  onRun,
  onOpen,
}: {
  task: TaskRecord;
  assignee: AgentRecord | null;
  project: ProjectRecord | null;
  goal: GoalRecord | null;
  workspace: WorkspaceRecord | null;
  provider: ProviderRecord | null;
  latestRun: TaskRunRecord | null;
  onAdvance: () => void;
  onRun: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === "Enter") onOpen(); }}
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        cursor: "pointer",
        opacity: task.status === "done" ? 0.7 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        {task.priority === "high" && <span style={{ width: 3, height: 14, background: "var(--red)", borderRadius: 2, marginTop: 2, flexShrink: 0 }} />}
        <div
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 480,
            lineHeight: 1.35,
            letterSpacing: "-0.005em",
            textDecoration: task.status === "done" ? "line-through" : "none",
            color: task.status === "done" ? "var(--text-3)" : "var(--text-1)",
          }}
        >
          {task.title}
        </div>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {project ? <Pill>{project.name}</Pill> : <Pill>{capitalize(task.risk)}</Pill>}
        {goal && <Pill tone="violet">{truncate(goal.title, 20)}</Pill>}
        {workspace && <Pill>{workspace.name}</Pill>}
        {task.requiresFilesystem && <Pill>workspace</Pill>}
        {latestRun && <Pill tone={runTone(latestRun.state)}>{prettyRunState(latestRun.state)}</Pill>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }} onClick={(event) => event.stopPropagation()}>
          {assignee && <Avatar name={assignee.name} size="sm" bot />}
          {assignee && <IconButton icon="send" label={`Run ${task.title}`} onClick={onRun} disabled={!canRun(provider)} />}
          {nextStatus(task.status) && <IconButton icon="check" label="Advance" onClick={onAdvance} />}
        </div>
      </div>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
