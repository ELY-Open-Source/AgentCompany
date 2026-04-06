import type {
  AgentRecord,
  BrowserActionRecord,
  CompanyRecord,
  DocumentRecord,
  InboxItem,
  CompanyMetrics,
  KnowledgeEntryRecord,
  MeetingRecord,
  ProjectRecord,
  RunRecord,
  SectionId,
  SocialAccountRecord,
  SprintRecord,
  StandupReport,
  TaskRecord,
  WorkspaceRecord,
  ProfileSnapshot,
} from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { Inbox, StandupView, PerformanceView } from "../../components/inbox";
import { Dashboard } from "../../components/dashboard";
import { EntityWorkspace } from "../../components/EntityWorkspace";
import {
  SettingsPane,
  ModelManagement,
  WorkspaceCreator,
  WorkspaceInspector,
  WorkspaceList,
} from "../../components/execution";
import { SocialAccountsPanel } from "../../components/social";
import { AutomationPanel } from "../../components/automation";
import { CommunicationHub } from "../../components/communication";
import { SkillsSection } from "../../components/skills";
import { DocumentCenter, KnowledgeBaseManager, MeetingsManager, SprintManager } from "../../components/company-operations";
import { Panel } from "../../components/ui";
import { unwrap } from "../../lib/desktop";

interface OperationsSectionsProps {
  section: SectionId;
  snapshot: ProfileSnapshot;
  currentCompany: CompanyRecord | null;
  locale: AppLocale;
  tasks: TaskRecord[];
  runs: RunRecord[];
  companyAgents: AgentRecord[];
  companyProjects: ProjectRecord[];
  companyWorkspaces: WorkspaceRecord[];
  companyDocuments: DocumentRecord[];
  companyKnowledge: KnowledgeEntryRecord[];
  companyMeetings: MeetingRecord[];
  companySprints: SprintRecord[];
  socialAccounts: SocialAccountRecord[];
  browserActions: BrowserActionRecord[];
  inboxItems: InboxItem[];
  companyMetrics: CompanyMetrics | null;
  standupReport: StandupReport | null;
  companySecrets: ProfileSnapshot["secrets"];
  selectedWorkspace: WorkspaceRecord | null;
  setSelectedWorkspaceId: (id: string | null) => void;
  selectedCommunicationEntityId: string | null;
  setSelectedCommunicationEntityId: (id: string | null) => void;
  setSelectedTaskId: (id: string | null) => void;
  setSelectedApprovalId: (id: string | null) => void;
  setSection: (section: SectionId) => void;
  navigateTo: (section: SectionId, entityId?: string) => void;
  refresh: () => Promise<void>;
  openPathWithFeedback: (path: string) => Promise<void>;
  setError: (error: string | null) => void;
  filteredActivity: ReturnType<ProfileSnapshot["activity"]["filter"]>;
  companyCosts: ReturnType<ProfileSnapshot["costs"]["filter"]>;
  companyGoals: ReturnType<NonNullable<ProfileSnapshot["goals"]>["filter"]>;
}

export function OperationsSections({
  section,
  snapshot,
  currentCompany,
  locale,
  tasks,
  runs,
  companyAgents,
  companyProjects,
  companyWorkspaces,
  companyDocuments,
  companyKnowledge,
  companyMeetings,
  companySprints,
  socialAccounts,
  browserActions,
  inboxItems,
  companyMetrics,
  standupReport,
  companySecrets,
  selectedWorkspace,
  setSelectedWorkspaceId,
  selectedCommunicationEntityId,
  setSelectedCommunicationEntityId,
  setSelectedTaskId,
  setSelectedApprovalId,
  setSection,
  navigateTo,
  refresh,
  openPathWithFeedback,
  setError,
  filteredActivity,
  companyCosts,
  companyGoals,
}: OperationsSectionsProps) {
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
        <EntityWorkspace
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
        <div className="space-y-10">
          <Panel title={locale === "zh" ? "配置" : "Profile and release"}>
            <SettingsPane snapshot={snapshot} secrets={companySecrets} companyId={currentCompany.id} onSaved={refresh} />
          </Panel>
          <Panel title={locale === "zh" ? "模型管理" : "Model Management"}>
            <ModelManagement connectors={snapshot.connectors} locale={locale} onSaved={refresh} />
          </Panel>
        </div>
      ) : null}
    </>
  );
}
