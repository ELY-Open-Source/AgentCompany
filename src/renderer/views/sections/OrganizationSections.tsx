import type { SectionId } from "@shared/types";
import { NEW_ENTITY_ID } from "../../lib/constants";
import {
  Target,
  UserPlus,
  Kanban,
} from "../../components/ui/icons";
import { AgentCreator } from "../../components/organization/AgentCreator";
import { AgentEditor } from "../../components/organization/AgentEditor";
import { AgentRoster } from "../../components/organization/AgentRoster";
import { GoalCreator } from "../../components/organization/GoalCreator";
import { GoalEditor } from "../../components/organization/GoalEditor";
import { GoalList } from "../../components/organization/GoalList";
import { OrgChart } from "../../components/organization/OrgChart";
import { TeamHeaderSummary } from "../../components/organization/TeamHeaderSummary";
import { ProjectCreator } from "../../components/organization/ProjectCreator";
import { ProjectEditor } from "../../components/organization/ProjectEditor";
import { ProjectList } from "../../components/organization/ProjectList";
import { HiringPipeline } from "../../components/hiring/HiringPipeline";
import { ActionButton, Modal, Panel } from "../../components/ui";
import { useT } from "../../i18n";
import { useAppStore } from "../../state/store";
import { useSectionContext } from "../../hooks/useSectionContext";
import { useAppActions } from "../../hooks/useAppActions";

interface OrganizationSectionsProps {
  section: SectionId;
}

export function OrganizationSections({ section }: OrganizationSectionsProps) {
  const t = useT();
  const {
    snapshot,
    currentCompany,
    companyAgents,
    companyGoals,
    companyProjects,
    companyWorkspaces,
    pendingApprovals,
    editingAgent,
    selectedGoal,
    selectedProject,
  } = useSectionContext();
  const { refresh } = useAppActions();

  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useAppStore((s) => s.setSelectedAgentId);
  const editingAgentId = useAppStore((s) => s.editingAgentId);
  const setEditingAgentId = useAppStore((s) => s.setEditingAgentId);
  const selectedGoalId = useAppStore((s) => s.selectedGoalId);
  const setSelectedGoalId = useAppStore((s) => s.setSelectedGoalId);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useAppStore((s) => s.setSelectedProjectId);
  const setSection = useAppStore((s) => s.setSection);

  // Open the Edit modal on row / card click. `selectedAgentId` is updated
  // alongside so the roster highlight follows the user's last interaction
  // even after the modal closes.
  const openAgentEditor = (id: string) => {
    setSelectedAgentId(id);
    setEditingAgentId(id);
  };

  if (!snapshot || !currentCompany) return null;

  return (
    <>
      {section === "agents" ? (
        <>
          <TeamHeaderSummary agents={companyAgents} pendingApprovals={pendingApprovals} />
          <OrgChart agents={companyAgents} connectors={snapshot.connectors} onSelectAgent={openAgentEditor} />
          <Panel title={t("org.agentRoster")} action={<ActionButton label={t("org.newHireRequest")} icon={UserPlus} tone="accent" onClick={() => setEditingAgentId(NEW_ENTITY_ID)} />}>
            <AgentRoster
              agents={companyAgents}
              connectors={snapshot.connectors}
              workspaces={companyWorkspaces}
              selectedAgentId={selectedAgentId}
              onSelect={openAgentEditor}
            />
          </Panel>
          <Modal open={editingAgentId === NEW_ENTITY_ID} title={t("org.requestNewHire")} onClose={() => setEditingAgentId(null)}>
            <AgentCreator
              companyId={currentCompany.id}
              connectors={snapshot.connectors}
              workspaces={companyWorkspaces}
              agents={companyAgents}
              onSaved={async () => {
                setEditingAgentId(null);
                setSection("hiring");
                await refresh();
              }}
            />
          </Modal>
          <Modal
            open={!!editingAgent}
            title={editingAgent ? t("org.editAgentTitle").replace("{name}", editingAgent.name).replace("{role}", editingAgent.role) : ""}
            onClose={() => setEditingAgentId(null)}
          >
            {editingAgent ? (
              <AgentEditor
                key={editingAgent.id}
                agent={editingAgent}
                connectors={snapshot.connectors}
                workspaces={companyWorkspaces}
                agents={companyAgents}
                companyId={currentCompany.id}
                onSaved={refresh}
                onCancel={() => setEditingAgentId(null)}
                onDeleted={async () => { setEditingAgentId(null); await refresh(); }}
              />
            ) : null}
          </Modal>
        </>
      ) : null}

      {section === "hiring" && currentCompany ? (
        <HiringPipeline
          agents={companyAgents}
          approvals={(snapshot?.approvals ?? []).filter(a => a.companyId === currentCompany.id)}
          onNavigateToAgent={(id) => { setSelectedAgentId(id); setSection("agents"); }}
        />
      ) : null}

      {section === "goals" ? (
        <>
          <Panel title={t("org.goalStack")} action={<ActionButton label={t("org.newGoal")} icon={Target} tone="accent" onClick={() => setSelectedGoalId(NEW_ENTITY_ID)} />}>
            <GoalList goals={companyGoals} agents={companyAgents} selectedGoalId={selectedGoalId} onSelect={setSelectedGoalId} />
          </Panel>
          <Modal open={selectedGoalId === NEW_ENTITY_ID} title={t("org.newGoal")} onClose={() => setSelectedGoalId(null)}>
            <GoalCreator companyId={currentCompany.id} agents={companyAgents} goals={companyGoals} onSaved={async () => { setSelectedGoalId(null); await refresh(); }} />
          </Modal>
          <Modal open={!!selectedGoal} title={selectedGoal ? `Edit: ${selectedGoal.title}` : ""} onClose={() => setSelectedGoalId(null)}>
            {selectedGoal ? (
              <GoalEditor
                key={selectedGoalId}
                goal={selectedGoal}
                goals={companyGoals}
                agents={companyAgents}
                companyId={currentCompany.id}
                onSaved={async () => { setSelectedGoalId(null); await refresh(); }}
                onDeleted={async () => { setSelectedGoalId(null); await refresh(); }}
              />
            ) : null}
          </Modal>
        </>
      ) : null}

      {section === "projects" ? (
        <>
          <Panel title={t("nav.projects")} action={<ActionButton label={t("org.newProject")} icon={Kanban} tone="accent" onClick={() => setSelectedProjectId(NEW_ENTITY_ID)} />}>
            <ProjectList projects={companyProjects} goals={companyGoals} agents={companyAgents} workspaces={companyWorkspaces} selectedProjectId={selectedProjectId} onSelect={setSelectedProjectId} />
          </Panel>
          <Modal open={selectedProjectId === NEW_ENTITY_ID} title={t("org.newProject")} onClose={() => setSelectedProjectId(null)}>
            <ProjectCreator companyId={currentCompany.id} goals={companyGoals} agents={companyAgents} onSaved={async () => { setSelectedProjectId(null); await refresh(); }} />
          </Modal>
          <Modal open={!!selectedProject} title={selectedProject ? `Edit: ${selectedProject.name}` : ""} onClose={() => setSelectedProjectId(null)}>
            {selectedProject ? (
              <ProjectEditor
                key={selectedProjectId}
                project={selectedProject}
                goals={companyGoals}
                agents={companyAgents}
                companyId={currentCompany.id}
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
