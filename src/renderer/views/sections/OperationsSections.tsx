import type { SectionId } from "@shared/types";
import { Inbox } from "../../components/inbox/Inbox";
import { StandupView } from "../../components/inbox/StandupView";
import { PerformanceView } from "../../components/inbox/PerformanceView";
import { Dashboard } from "../../components/dashboard/Dashboard";
import { TwoPaneLayout } from "../../components/TwoPaneLayout";
import { SettingsShell } from "../../components/execution/SettingsShell";
import { WorkspaceCreator } from "../../components/execution/WorkspaceCreator";
import { WorkspaceInspector } from "../../components/execution/WorkspaceInspector";
import { WorkspaceList } from "../../components/execution/WorkspaceList";
import { OAuthPromptDialog } from "../../components/settings/dialogs/OAuthPromptDialog";
import { SocialAccountsPanel } from "../../components/social/SocialPanel";
import { AutomationPanel } from "../../components/automation/AutomationPanel";
import { CommunicationHub } from "../../components/communication/CommunicationHub";
import { SkillsSection } from "../../components/skills";
import { DocumentCenter } from "../../components/company-operations/DocumentCenter";
import { KnowledgeBaseManager } from "../../components/company-operations/KnowledgeBaseManager";
import { MeetingsManager } from "../../components/company-operations/MeetingsManager";
import { SprintManager } from "../../components/company-operations/SprintManager";
import { Panel } from "../../components/ui";
import { unwrap } from "../../lib/desktop";
import { useAppStore } from "../../state/store";
import { useSectionContext } from "../../hooks/useSectionContext";
import { useAppActions } from "../../hooks/useAppActions";

interface OperationsSectionsProps {
  section: SectionId;
}

export function OperationsSections({ section }: OperationsSectionsProps) {
  const {
    snapshot,
    currentCompany,
    tasks,
    runs,
    companyAgents,
    companyProjects,
    companyWorkspaces,
    companyDocuments,
    companyKnowledge,
    companyMeetings,
    companySprints,
    companyCosts,
    companyGoals,
    companySecrets,
    filteredActivity,
    selectedWorkspace,
  } = useSectionContext();
  const { refresh, openPathWithFeedback, setError } = useAppActions();

  const inboxItems = useAppStore((s) => s.inboxItems);
  const companyMetrics = useAppStore((s) => s.companyMetrics);
  const standupReport = useAppStore((s) => s.standupReport);
  const socialAccounts = useAppStore((s) => s.socialAccounts);
  const browserActions = useAppStore((s) => s.browserActions);
  const selectedCommunicationEntityId = useAppStore((s) => s.selectedCommunicationEntityId);
  const setSelectedCommunicationEntityId = useAppStore((s) => s.setSelectedCommunicationEntityId);
  const setSelectedWorkspaceId = useAppStore((s) => s.setSelectedWorkspaceId);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);
  const setSelectedApprovalId = useAppStore((s) => s.setSelectedApprovalId);
  const setSection = useAppStore((s) => s.setSection);
  const navigateTo = useAppStore((s) => s.navigateTo);

  if (!snapshot) return null;

  return (
    <>
      {section === "overview" ? (
        <Dashboard
          companyName={currentCompany?.name}
          companyId={currentCompany?.id}
          agents={companyAgents}
          tasks={tasks}
          runs={runs}
          approvals={snapshot.approvals?.filter((a) => !currentCompany || a.companyId === currentCompany.id) ?? []}
          goals={companyGoals}
          projects={companyProjects}
          activity={filteredActivity}
          costs={companyCosts}
          messages={snapshot.agentMessages?.filter((message) => !currentCompany || message.companyId === currentCompany.id) ?? []}
          onNavigate={navigateTo}
        />
      ) : null}

      {section === "inbox" ? (
        <Inbox
          items={inboxItems}
          onNavigate={navigateTo}
        />
      ) : null}

      {section === "standup" ? (
        <StandupView
          report={standupReport}
          onNavigate={navigateTo}
        />
      ) : null}

      {section === "performance" ? (
        <PerformanceView
          metrics={companyMetrics}
          onNavigate={navigateTo}
        />
      ) : null}

      {section === "social" && snapshot?.currentCompanyId && (
        <SocialAccountsPanel
          accounts={socialAccounts}
          actions={browserActions}
          agents={companyAgents.map(a => ({ id: a.id, name: a.name }))}
          companyId={snapshot.currentCompanyId}
          onAddAndLogin={async (platform, requireApproval) => {
            if (!snapshot?.currentCompanyId) return;
            try {
              const accountId = unwrap(await window.agentCompany.saveSocialAccount({
                companyId: snapshot.currentCompanyId,
                platform,
                accountName: platform,
                displayName: "",
                requireApproval,
                profileUrl: "",
                status: "login_required",
                metadataJson: "{}",
              }));
              await refresh();
              unwrap(await window.agentCompany.triggerBrowserLogin({ companyId: snapshot.currentCompanyId, socialAccountId: accountId }));
              setError(null);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            }
          }}
          onDelete={async (id) => {
            if (!snapshot?.currentCompanyId) return;
            try {
              unwrap(await window.agentCompany.deleteSocialAccount({ id, companyId: snapshot.currentCompanyId }));
              await refresh();
              setError(null);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            }
          }}
          onLogin={async (accountId) => {
            if (!snapshot?.currentCompanyId) return;
            try {
              unwrap(await window.agentCompany.triggerBrowserLogin({ companyId: snapshot.currentCompanyId, socialAccountId: accountId }));
              await refresh();
              setError(null);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            }
          }}
          onOpenPath={async (path) => {
            try {
              unwrap(await window.agentCompany.openPath(path));
              setError(null);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            }
          }}
          onCancelAction={async (actionId) => {
            if (!snapshot?.currentCompanyId) return;
            try {
              unwrap(await window.agentCompany.cancelBrowserAction({ actionId, companyId: snapshot.currentCompanyId }));
              await refresh();
              setError(null);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            }
          }}
          onNavigate={(sectionName, entityId) => {
            setSection(sectionName);
            if (sectionName === "tasks") setSelectedTaskId(entityId);
            if (sectionName === "approvals") setSelectedApprovalId(entityId);
          }}
        />
      )}

      {section === "skills" && currentCompany ? (
        <SkillsSection companyId={currentCompany.id} agents={companyAgents} onRefresh={refresh} />
      ) : null}

      {section === "automation" && currentCompany ? (
        <AutomationPanel
          key={currentCompany.id}
          rules={snapshot.automationRules?.filter(r => r.companyId === currentCompany.id) ?? []}
          workflows={snapshot.workflows?.filter(w => w.companyId === currentCompany.id) ?? []}
          companyId={currentCompany.id}
          onRefresh={refresh}
        />
      ) : null}

      {section === "communication" && currentCompany ? (
        <CommunicationHub
          messages={snapshot.agentMessages?.filter(m => m.companyId === currentCompany.id) ?? []}
          comments={snapshot.comments?.filter((comment) => comment.companyId === currentCompany.id) ?? []}
          tasks={tasks}
          agents={companyAgents}
          projects={companyProjects}
          documents={companyDocuments}
          companyId={currentCompany.id}
          selectedEntityId={selectedCommunicationEntityId}
          onEntityConsumed={() => setSelectedCommunicationEntityId(null)}
          onNavigateToTask={(taskId) => {
            setSection("tasks");
            setSelectedTaskId(taskId);
          }}
          onRefresh={refresh}
        />
      ) : null}

      {section === "documents" && currentCompany ? (
        <DocumentCenter
          companyId={currentCompany.id}
          documents={companyDocuments}
          agents={companyAgents}
          projects={companyProjects}
          goals={companyGoals}
          onRefresh={refresh}
        />
      ) : null}

      {section === "knowledge" && currentCompany ? (
        <KnowledgeBaseManager companyId={currentCompany.id} entries={companyKnowledge} onRefresh={refresh} />
      ) : null}

      {section === "meetings" && currentCompany ? (
        <MeetingsManager companyId={currentCompany.id} meetings={companyMeetings} agents={companyAgents} onRefresh={refresh} />
      ) : null}

      {section === "sprints" && currentCompany ? (
        <SprintManager companyId={currentCompany.id} sprints={companySprints} onRefresh={refresh} />
      ) : null}

      {section === "workspaces" && currentCompany ? (
        <TwoPaneLayout
          title="Workspaces"
          eyebrow={undefined}
          primary={
            <Panel title="Workspace registry">
              <WorkspaceList
                workspaces={companyWorkspaces}
                projects={companyProjects}
                companyId={currentCompany.id}
                selectedWorkspaceId={selectedWorkspace?.id ?? null}
                onSelect={setSelectedWorkspaceId}
                onOpen={openPathWithFeedback}
                onDeleted={refresh}
              />
            </Panel>
          }
          secondary={
            <div className="space-y-6">
              <Panel title="Workspace control center">
                <WorkspaceInspector
                  workspace={selectedWorkspace}
                  agents={companyAgents}
                  tasks={tasks}
                  runs={runs}
                  documents={companyDocuments}
                  project={selectedWorkspace ? (companyProjects.find((project) => project.id === selectedWorkspace.projectId) ?? null) : null}
                  onOpen={openPathWithFeedback}
                />
              </Panel>
              <Panel title="Add workspace">
                <WorkspaceCreator companyId={currentCompany.id} projects={companyProjects} onSaved={refresh} />
              </Panel>
            </div>
          }
        />
      ) : null}

      {section === "settings" && currentCompany ? (
        <>
          <SettingsShell
            snapshot={snapshot}
            secrets={companySecrets}
            companyId={currentCompany.id}
            onSaved={refresh}
          />
          <OAuthPromptDialog />
        </>
      ) : null}
    </>
  );
}
