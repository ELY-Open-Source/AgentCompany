import type {
  AgentRecord,
  CompanyRecord,
  GoalRecord,
  ProjectRecord,
  WorkspaceRecord,
  ProfileSnapshot,
  SectionId,
} from "@shared/types";
import {
  Target,
  UserPlus,
  Kanban,
} from "@phosphor-icons/react";
import {
  AgentCreator,
  AgentEditor,
  AgentRoster,
  GoalCreator,
  GoalEditor,
  GoalList,
  OrgChart,
  ProjectCreator,
  ProjectEditor,
  ProjectList,
} from "../../components/organization";
import { HiringPipeline } from "../../components/hiring";
import { ActionButton, Modal, Panel } from "../../components/ui";

interface OrganizationSectionsProps {
  section: SectionId;
  snapshot: ProfileSnapshot;
  currentCompany: CompanyRecord | null;
  companyAgents: AgentRecord[];
  companyGoals: GoalRecord[];
  companyProjects: ProjectRecord[];
  companyWorkspaces: WorkspaceRecord[];
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
  selectedGoalId: string | null;
  setSelectedGoalId: (id: string | null) => void;
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  setSection: (section: SectionId) => void;
  refresh: () => Promise<void>;
}

export function OrganizationSections({
  section,
  snapshot,
  currentCompany,
  companyAgents,
  companyGoals,
  companyProjects,
  companyWorkspaces,
  selectedAgentId,
  setSelectedAgentId,
  selectedGoalId,
  setSelectedGoalId,
  selectedProjectId,
  setSelectedProjectId,
  setSection,
  refresh,
}: OrganizationSectionsProps) {
  const selectedAgent = companyAgents.find((a) => a.id === selectedAgentId) ?? null;
  const selectedGoal = companyGoals.find((g) => g.id === selectedGoalId) ?? null;
  const selectedProject = companyProjects.find((p) => p.id === selectedProjectId) ?? null;

  return (
    <>
      {section === "agents" ? (
        <>
          <OrgChart agents={companyAgents} connectors={snapshot.connectors} onSelectAgent={(id) => setSelectedAgentId(id)} />
          <Panel title="Agent roster" action={<ActionButton label="New hire request" icon={UserPlus} tone="accent" onClick={() => setSelectedAgentId("__new__")} />}>
            <AgentRoster
              agents={companyAgents}
              connectors={snapshot.connectors}
              workspaces={companyWorkspaces}
              selectedAgentId={selectedAgentId}
              onSelect={setSelectedAgentId}
            />
          </Panel>
          <Modal open={selectedAgentId === "__new__"} title="Request new hire" onClose={() => setSelectedAgentId(null)}>
            <AgentCreator
              companyId={currentCompany!.id}
              connectors={snapshot.connectors}
              workspaces={companyWorkspaces}
              agents={companyAgents}
              onSaved={async () => {
                setSelectedAgentId(null);
                setSection("hiring");
                await refresh();
              }}
            />
          </Modal>
          <Modal open={!!selectedAgent} title={selectedAgent ? `Edit: ${selectedAgent.name}` : ""} onClose={() => setSelectedAgentId(null)}>
            {selectedAgent ? (
              <AgentEditor
                key={selectedAgentId}
                agent={selectedAgent}
                connectors={snapshot.connectors}
                workspaces={companyWorkspaces}
                agents={companyAgents}
                companyId={currentCompany!.id}
                onSaved={refresh}
                onDeleted={async () => { setSelectedAgentId(null); await refresh(); }}
              />
            ) : null}
          </Modal>
        </>
      ) : null}

      {section === "orgchart" ? (
        <OrgChart agents={companyAgents} connectors={snapshot.connectors} onSelectAgent={(id) => { setSelectedAgentId(id); setSection("agents"); }} />
      ) : null}

      {section === "hiring" && currentCompany ? (
        <HiringPipeline
          agents={companyAgents}
          approvals={(snapshot?.approvals ?? []).filter(a => a.companyId === currentCompany!.id)}
          onRefresh={refresh}
          onNavigateToAgent={(id) => { setSelectedAgentId(id); setSection("agents"); }}
        />
      ) : null}

      {section === "goals" ? (
        <>
          <Panel title="Goal stack" action={<ActionButton label="New goal" icon={Target} tone="accent" onClick={() => setSelectedGoalId("__new__")} />}>
            <GoalList goals={companyGoals} agents={companyAgents} selectedGoalId={selectedGoalId} onSelect={setSelectedGoalId} />
          </Panel>
          <Modal open={selectedGoalId === "__new__"} title="New goal" onClose={() => setSelectedGoalId(null)}>
            <GoalCreator companyId={currentCompany!.id} agents={companyAgents} goals={companyGoals} onSaved={async () => { setSelectedGoalId(null); await refresh(); }} />
          </Modal>
          <Modal open={!!selectedGoal} title={selectedGoal ? `Edit: ${selectedGoal.title}` : ""} onClose={() => setSelectedGoalId(null)}>
            {selectedGoal ? (
              <GoalEditor
                key={selectedGoalId}
                goal={selectedGoal}
                goals={companyGoals}
                agents={companyAgents}
                companyId={currentCompany!.id}
                onSaved={async () => { setSelectedGoalId(null); await refresh(); }}
                onDeleted={async () => { setSelectedGoalId(null); await refresh(); }}
              />
            ) : null}
          </Modal>
        </>
      ) : null}

      {section === "projects" ? (
        <>
          <Panel title="Projects" action={<ActionButton label="New project" icon={Kanban} tone="accent" onClick={() => setSelectedProjectId("__new__")} />}>
            <ProjectList projects={companyProjects} goals={companyGoals} agents={companyAgents} workspaces={companyWorkspaces} selectedProjectId={selectedProjectId} onSelect={setSelectedProjectId} />
          </Panel>
          <Modal open={selectedProjectId === "__new__"} title="New project" onClose={() => setSelectedProjectId(null)}>
            <ProjectCreator companyId={currentCompany!.id} goals={companyGoals} agents={companyAgents} onSaved={async () => { setSelectedProjectId(null); await refresh(); }} />
          </Modal>
          <Modal open={!!selectedProject} title={selectedProject ? `Edit: ${selectedProject.name}` : ""} onClose={() => setSelectedProjectId(null)}>
            {selectedProject ? (
              <ProjectEditor
                key={selectedProjectId}
                project={selectedProject}
                goals={companyGoals}
                agents={companyAgents}
                companyId={currentCompany!.id}
                onSaved={async () => { setSelectedProjectId(null); await refresh(); }}
                onDeleted={async () => { setSelectedProjectId(null); await refresh(); }}
              />
            ) : null}
          </Modal>
        </>
      ) : null}
    </>
  );
}
