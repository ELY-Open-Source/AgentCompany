import { Avatar, Pill } from "../../shared/ui";
import { TASK_STATUS, type AgentRecord, type ChatSpaceRecord, type ProjectRecord, type TaskRecord, type WorkspaceRecord } from "../../../../shared/domain";
import { t } from "../../i18n/i18n";

export function ProjectOverview({
  projects,
  tasks,
  agents,
  workspaces,
  chatSpaces,
}: {
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  agents: AgentRecord[];
  workspaces: WorkspaceRecord[];
  chatSpaces: ChatSpaceRecord[];
}) {
  if (projects.length === 0) return null;
  return (
    <section style={{ marginBottom: 18 }}>
      <div className="section-label" style={{ marginBottom: 10 }}>{t("Projects")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            tasks={tasks.filter((task) => task.projectId === project.id)}
            lead={agents.find((agent) => agent.id === project.leadAgentId) ?? null}
            workspace={workspaces.find((item) => item.projectId === project.id) ?? null}
            room={chatSpaces.find((space) => space.spaceType === "project" && space.topic === project.name) ?? null}
          />
        ))}
      </div>
    </section>
  );
}

function ProjectCard({
  project,
  tasks,
  lead,
  workspace,
  room,
}: {
  project: ProjectRecord;
  tasks: TaskRecord[];
  lead: AgentRecord | null;
  workspace: WorkspaceRecord | null;
  room: ChatSpaceRecord | null;
}) {
  const done = tasks.filter((task) => task.status === TASK_STATUS.DONE).length;
  return (
    <article className="card" style={{ padding: 14, minWidth: 0 }}>
      <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</div>
          <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
            <Pill>{project.status.replace(/_/g, " ")}</Pill>
            <Pill>{t("{done} / {total} tasks", { done, total: tasks.length })}</Pill>
            {workspace && <Pill>{workspace.name}</Pill>}
            {room && <Pill>#{room.name}</Pill>}
          </div>
        </div>
        {lead && (
          <div className="row" style={{ gap: 6, flexShrink: 0 }}>
            <Avatar name={lead.name} size="sm" bot />
            <span style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{lead.name}</span>
          </div>
        )}
      </div>
    </article>
  );
}
