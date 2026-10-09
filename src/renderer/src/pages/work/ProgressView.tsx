import { TASK_STATUS, type GoalRecord, type ProjectRecord, type TaskRecord, type TaskStatus } from "../../../../shared/domain";
import { t } from "../../i18n/i18n";

const SEGMENTS: ReadonlyArray<{ id: TaskStatus; label: string; tone: string }> = [
  { id: TASK_STATUS.DONE, label: t("Done"), tone: "var(--green)" },
  { id: TASK_STATUS.REVIEW, label: t("In review"), tone: "var(--amber)" },
  { id: TASK_STATUS.IN_PROGRESS, label: t("In progress"), tone: "var(--accent)" },
  { id: TASK_STATUS.BACKLOG, label: t("Backlog"), tone: "var(--panel-3)" },
];

/** How far work is per goal and project, as bars of task status; it shows progress, not dates. */
export function ProgressView({ tasks, goals, projects }: { tasks: TaskRecord[]; goals: GoalRecord[]; projects: ProjectRecord[] }) {
  const unlinked = tasks.filter((task) => !task.goalId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {goals.map((goal) => {
        const linked = tasks.filter((task) => task.goalId === goal.id);
        const goalProjects = projects.filter((project) => project.goalId === goal.id);
        return (
          <section key={goal.id} className="card" style={{ padding: 18 }}>
            <div className="row" style={{ gap: 12 }}>
              <span style={{ fontWeight: 560, fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {goal.title}
              </span>
              <CompletionReadout tasks={linked} />
            </div>
            <StatusBar tasks={linked} height={6} style={{ marginTop: 12 }} />
            <Legend tasks={linked} />
            {goalProjects.length > 0 && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {goalProjects.map((project) => {
                  const projectTasks = linked.filter((task) => task.projectId === project.id);
                  return (
                    <div key={project.id} className="row" style={{ gap: 12 }}>
                      <span
                        style={{
                          fontSize: 13,
                          color: "var(--text-2)",
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          width: 260,
                          flexShrink: 0,
                        }}
                      >
                        {project.name}
                      </span>
                      <StatusBar tasks={projectTasks} height={4} style={{ flex: 1 }} />
                      <CompletionReadout tasks={projectTasks} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      {unlinked.length > 0 && (
        <section className="card" style={{ padding: 18 }}>
          <div className="row" style={{ gap: 12 }}>
            <span style={{ fontWeight: 560, fontSize: 14, color: "var(--text-2)", flex: 1 }}>{t("Unlinked tasks")}</span>
            <CompletionReadout tasks={unlinked} />
          </div>
          <StatusBar tasks={unlinked} height={6} style={{ marginTop: 12 }} />
          <Legend tasks={unlinked} />
        </section>
      )}
    </div>
  );
}

function counts(tasks: TaskRecord[]): Map<TaskStatus, number> {
  const map = new Map<TaskStatus, number>();
  for (const segment of SEGMENTS) map.set(segment.id, 0);
  for (const task of tasks) map.set(task.status, (map.get(task.status) ?? 0) + 1);
  return map;
}

function StatusBar({ tasks, height, style }: { tasks: TaskRecord[]; height: number; style?: React.CSSProperties }) {
  const byStatus = counts(tasks);
  if (tasks.length === 0) {
    return <div style={{ height, borderRadius: height, background: "var(--panel-3)", ...style }} />;
  }
  return (
    <div style={{ display: "flex", gap: 2, height, ...style }}>
      {SEGMENTS.map((segment) => {
        const count = byStatus.get(segment.id) ?? 0;
        if (count === 0) return null;
        return (
          <span
            key={segment.id}
            style={{
              flex: count,
              background: segment.tone,
              borderRadius: height,
              minWidth: height,
            }}
          />
        );
      })}
    </div>
  );
}

function Legend({ tasks }: { tasks: TaskRecord[] }) {
  const byStatus = counts(tasks);
  return (
    <div className="row" style={{ gap: 14, marginTop: 10, flexWrap: "wrap" }}>
      {SEGMENTS.map((segment) => (
        <span key={segment.id} className="row" style={{ gap: 6, fontSize: 12, color: "var(--text-3)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: segment.tone, flexShrink: 0 }} />
          <span className="num">{byStatus.get(segment.id) ?? 0}</span>
          {segment.label}
        </span>
      ))}
    </div>
  );
}

function CompletionReadout({ tasks }: { tasks: TaskRecord[] }) {
  const done = tasks.filter((task) => task.status === TASK_STATUS.DONE).length;
  return (
    <span className="num" style={{ color: "var(--text-3)", fontSize: 13, flexShrink: 0 }}>
      {done} / {tasks.length}
    </span>
  );
}
