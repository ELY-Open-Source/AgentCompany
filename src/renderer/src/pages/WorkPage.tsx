import { useMemo, useState } from "react";
import { Avatar, Button, Icon, IconButton, Pill, Segmented } from "../shared/ui";
import { MenuDivider, MenuLabel, MenuRow, Popover } from "../shared/Popover";
import { TopbarActions } from "../shared/TopbarActions";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type AgentRecord,
  type ProviderRecord,
  type ProjectRecord,
  type TaskPriority,
  type TaskRecord,
  type TaskRunRecord,
  type TaskStatus,
} from "../../../shared/domain";
import { NewTaskDialog } from "./NewTaskDialog";
import { GoalDialog } from "./work/GoalDialog";
import { ProjectDialog } from "./work/ProjectDialog";
import { TaskDetailDialog } from "./work/TaskDetailDialog";
import { ProjectOverview } from "./work/ProjectOverview";
import { ListView } from "./work/ListView";
import { ProgressView } from "./work/ProgressView";
import { isBusinessTask, latestTaskRun, nextStatus, prettyRunState, providerFor, runBlocker, runTone } from "./work/task-helpers";
import type { PageProps } from "./types";
import { activeOrgId, type Focus } from "./types";
import { t } from "../i18n/i18n";

type View = "board" | "list" | "progress";

const COLUMNS: ReadonlyArray<{ id: TaskStatus; label: string; tone: string }> = [
  { id: TASK_STATUS.BACKLOG, label: t("Backlog"), tone: "var(--text-4)" },
  { id: TASK_STATUS.IN_PROGRESS, label: t("In progress"), tone: "var(--accent)" },
  { id: TASK_STATUS.REVIEW, label: t("In review"), tone: "var(--amber)" },
  { id: TASK_STATUS.DONE, label: t("Done"), tone: "var(--green)" },
];

const VIEW_OPTIONS: ReadonlyArray<{ id: View; label: string }> = [
  { id: "board", label: t("Board") },
  { id: "list", label: t("List") },
  { id: "progress", label: t("Progress") },
];

export function WorkPage({ snapshot, actions, navigate, focus }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const [view, setView] = useState<View>("board");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(focus?.kind === "task" ? focus.id : null);
  const [scope, setScope] = useState<Focus | null>(focus && (focus.kind === "goal" || focus.kind === "project") ? focus : null);
  const [actionError, setActionError] = useState<string | null>(null);

  // The board, its counts and its filters show real work; chat replies and goal checkpoints show on Messages, Home and Runs.
  const orgTasks = useMemo(() => snapshot.tasks.filter((task) => task.orgId === orgId), [snapshot.tasks, orgId]);
  const allTasks = useMemo(() => orgTasks.filter(isBusinessTask), [orgTasks]);
  const tasks = useMemo(
    () =>
      allTasks.filter((task) => {
        if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
        if (assigneeFilter !== "all" && task.assigneeAgentId !== assigneeFilter) return false;
        if (scope?.kind === "goal" && task.goalId !== scope.id) return false;
        if (scope?.kind === "project" && task.projectId !== scope.id) return false;
        return true;
      }),
    [allTasks, priorityFilter, assigneeFilter, scope],
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
  const chatSpaces = useMemo(() => snapshot.chatSpaces.filter((space) => space.orgId === orgId), [snapshot.chatSpaces, orgId]);

  const advance = (task: TaskRecord) => {
    const next = nextStatus(task.status);
    if (!next) return;
    perform(() => actions.run(() => window.agentCompany.updateTaskStatus({ orgId, taskId: task.id, status: next })));
  };
  const runTask = (task: TaskRecord) => {
    perform(() => actions.run(() => window.agentCompany.runTask({ orgId, taskId: task.id })));
  };
  const perform = (operation: () => Promise<unknown>) => {
    setActionError(null);
    operation().catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)));
  };
  // A link (from a run, say) can open an internal task too, though the board does not list it.
  const detailTask = detailTaskId ? orgTasks.find((task) => task.id === detailTaskId) ?? null : null;

  return (
    <div className="page-wide work-page">
      <TopbarActions>
        <Segmented value={view} onChange={setView} options={VIEW_OPTIONS} />
        <WorkFilter
          agents={agents}
          priority={priorityFilter}
          assignee={assigneeFilter}
          onPriority={setPriorityFilter}
          onAssignee={setAssigneeFilter}
        />
        <Button tone="ghost" onClick={() => setNewGoalOpen(true)}><Icon name="plus" size={16} /> {t("Goal")}</Button>
        <Button tone="ghost" onClick={() => setNewProjectOpen(true)}><Icon name="plus" size={16} /> {t("Project")}</Button>
        <Button tone="primary" onClick={() => setNewTaskOpen(true)}><Icon name="plus" size={16} /> {t("New task")}</Button>
      </TopbarActions>
      <h1 className="page-h1">{t("Work")}</h1>
      {scope && (
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <Pill>
            {scope.kind === "goal"
              ? t("Goal: {title}", { title: goals.find((goal) => goal.id === scope.id)?.title ?? scope.id })
              : t("Project: {name}", { name: projects.find((project) => project.id === scope.id)?.name ?? scope.id })}
          </Pill>
          <button type="button" className="link-button" style={{ fontSize: 12 }} onClick={() => setScope(null)}>{t("Show all work")}</button>
        </div>
      )}
      <p className="page-sub">
        {tasks.length === 1 ? t("{n} task", { n: tasks.length }) : t("{n} tasks", { n: tasks.length })} · {assigneeCount === 1 ? t("{n} assignee", { n: assigneeCount }) : t("{n} assignees", { n: assigneeCount })}
      </p>

      {actionError && <div className="form-error" role="alert">{actionError}</div>}
      <ProjectOverview projects={projects} tasks={allTasks} agents={agents} workspaces={workspaces} chatSpaces={chatSpaces} />

      <div className="work-page-body">
        {view === "board" && (
          <BoardView
            tasks={tasks}
            agents={agents}
            projects={projects}
            providers={providers}
            taskRuns={taskRuns}
            onAdvance={advance}
            onRun={runTask}
            onCreate={() => setNewTaskOpen(true)}
            onOpen={(task) => setDetailTaskId(task.id)}
          />
        )}
        {view === "list" && (
          <div className="work-scroll">
            <ListView
              tasks={tasks}
              agents={agents}
              projects={projects}
              providers={providers}
              taskRuns={taskRuns}
              onRun={runTask}
              onOpen={(task) => setDetailTaskId(task.id)}
            />
          </div>
        )}
        {view === "progress" && (
          <div className="work-scroll">
            <ProgressView tasks={tasks} goals={goals} projects={projects} />
          </div>
        )}
      </div>

      <GoalDialog open={newGoalOpen} orgId={orgId} agents={agents} actions={actions} onClose={() => setNewGoalOpen(false)} />
      <ProjectDialog open={newProjectOpen} orgId={orgId} goals={goals} agents={agents} actions={actions} onClose={() => setNewProjectOpen(false)} />
      <NewTaskDialog open={newTaskOpen} orgId={orgId} snapshot={snapshot} actions={actions} onClose={() => setNewTaskOpen(false)} />
      <TaskDetailDialog
        key={detailTask?.id ?? "none"}
        task={detailTask}
        agents={agents}
        projects={projects}
        goals={goals}
        workspaces={workspaces}
        providers={providers}
        taskRuns={taskRuns}
        allTasks={allTasks}
        approvals={snapshot.approvals.filter((a) => a.orgId === orgId)}
        auditEvents={snapshot.auditEvents.filter((e) => e.orgId === orgId)}
        orgId={orgId}
        actions={actions}
        onClose={() => setDetailTaskId(null)}
        onAdvance={advance}
        onRun={runTask}
        onOpenTask={setDetailTaskId}
        onMove={async (task, status) => {
          await actions.run(() => window.agentCompany.updateTaskStatus({ orgId, taskId: task.id, status }));
        }}
        onBlock={async (task, reason) => {
          await actions.run(() => window.agentCompany.setTaskBlocked({ orgId, taskId: task.id, reason }));
        }}
        onScope={(next) => {
          setScope(next);
          setDetailTaskId(null);
        }}
        navigate={navigate}
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
    { id: "all", label: t("All priorities") },
    { id: TASK_PRIORITY.HIGH, label: t("High") },
    { id: TASK_PRIORITY.NORMAL, label: t("Normal") },
    { id: TASK_PRIORITY.LOW, label: t("Low") },
  ];
  return (
    <Popover
      trigger={({ toggle }) => (
        <button type="button" className="button ghost" aria-label={t("Filter tasks")} onClick={toggle}>
          <Icon name="filter" size={16} color={active ? "var(--accent)" : "currentColor"} />
        </button>
      )}
    >
      {() => (
        <>
          <MenuLabel>{t("Priority")}</MenuLabel>
          {priorities.map((option) => (
            <MenuRow key={option.id} active={priority === option.id} onClick={() => onPriority(option.id)}>
              {option.label}
              {priority === option.id && <span className="menu-check"><Icon name="check" size={16} /></span>}
            </MenuRow>
          ))}
          <MenuDivider />
          <MenuLabel>{t("Assignee")}</MenuLabel>
          <MenuRow active={assignee === "all"} onClick={() => onAssignee("all")}>
            {t("All assignees")}
            {assignee === "all" && <span className="menu-check"><Icon name="check" size={16} /></span>}
          </MenuRow>
          {agents.map((agent) => (
            <MenuRow key={agent.id} active={assignee === agent.id} onClick={() => onAssignee(agent.id)}>
              {agent.name}
              {assignee === agent.id && <span className="menu-check"><Icon name="check" size={16} /></span>}
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
  providers: ProviderRecord[];
  taskRuns: TaskRunRecord[];
  onAdvance: (task: TaskRecord) => void;
  onRun: (task: TaskRecord) => void;
  onCreate: () => void;
  onOpen: (task: TaskRecord) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, minWidth: 0, flex: 1, minHeight: 0 }}>
      {COLUMNS.map((column) => {
        const columnTasks = tasks.filter((task) => task.status === column.id);
        return (
          <div key={column.id} style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            <div className="row" style={{ padding: "4px 6px 8px", flexShrink: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: column.tone, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 540 }}>{column.label}</span>
              <span className="num" style={{ fontSize: 12, color: "var(--text-3)" }}>{columnTasks.length}</span>
              <IconButton icon="plus" label={t("Add task")} onClick={onCreate} />
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingBottom: 24 }}>
              {columnTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  assignee={agents.find((agent) => agent.id === task.assigneeAgentId) ?? null}
                  project={projects.find((project) => project.id === task.projectId) ?? null}
                  blocker={runBlocker(task, providerFor(agents.find((agent) => agent.id === task.assigneeAgentId) ?? null, providers), taskRuns)}
                  latestRun={latestTaskRun(task.id, taskRuns)}
                  onAdvance={() => onAdvance(task)}
                  onRun={() => onRun(task)}
                  onOpen={() => onOpen(task)}
                />
              ))}
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
  blocker,
  latestRun,
  onAdvance,
  onRun,
  onOpen,
}: {
  task: TaskRecord;
  assignee: AgentRecord | null;
  project: ProjectRecord | null;
  blocker: string | null;
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
            minWidth: 0,
            fontSize: 14,
            fontWeight: 480,
            lineHeight: 1.35,
            letterSpacing: "-0.005em",
            color: task.status === "done" ? "var(--text-3)" : "var(--text-1)",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {task.title}
        </div>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6, minWidth: 0 }}>
        {project ? <Pill>{project.name}</Pill> : <Pill>{capitalize(task.risk)}</Pill>}
        {task.stalledReason && task.status !== "done" && <Pill tone="red">{t("stalled")}</Pill>}
        {task.blockedReason && task.status !== "done" && (
          <span title={task.blockedReason} style={{ display: "inline-flex" }}><Pill tone="red">{t("blocked")}</Pill></span>
        )}
        {task.hold && !task.stalledReason && !task.blockedReason && (
          <span title={task.hold.reason} style={{ display: "inline-flex" }}>
            <Pill tone={task.hold.waitingOn === "operator" ? "red" : "amber"}>{task.hold.waitingOn === "operator" ? t("needs you") : t("waiting")}</Pill>
          </span>
        )}
        {task.status !== "done" && latestRun && (
          <span style={{ flexShrink: 0, display: "inline-flex" }}>
            <Pill tone={runTone(latestRun.state)}>{prettyRunState(latestRun.state)}</Pill>
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }} onClick={(event) => event.stopPropagation()}>
          {assignee && <Avatar name={assignee.name} size="sm" bot />}
          {assignee && <IconButton icon="send" label={blocker ?? t("Run {title}", { title: task.title })} onClick={onRun} disabled={blocker !== null} />}
          {nextStatus(task.status) && <IconButton icon="check" label={t("Advance")} onClick={onAdvance} />}
        </div>
      </div>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
