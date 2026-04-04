import { AnimatePresence, motion } from "framer-motion";
import { WarningCircle } from "@phosphor-icons/react";
import type {
  AgentRecord,
  ApprovalRecord,
  BrowserActionRecord,
  CompanyRecord,
  CostRecord,
  DocumentRecord,
  GoalRecord,
  InboxItem,
  CompanyMetrics,
  KnowledgeEntryRecord,
  MeetingRecord,
  ProfileSnapshot,
  ProjectRecord,
  RunRecord,
  SectionId,
  SocialAccountRecord,
  SprintRecord,
  StandupReport,
  TaskRecord,
  WorkspaceRecord,
} from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { ErrorBoundary } from "../components/ui";
import { OrganizationSections } from "./sections/OrganizationSections";
import { ExecutionSections } from "./sections/ExecutionSections";
import { OperationsSections } from "./sections/OperationsSections";

interface SectionContentViewProps {
  section: SectionId;
  error: string | null;
  snapshot: ProfileSnapshot;
  currentCompany: CompanyRecord | null;
  locale: AppLocale;
  // data collections
  tasks: TaskRecord[];
  runs: RunRecord[];
  approvals: ApprovalRecord[];
  pendingApprovals: ApprovalRecord[];
  companyAgents: AgentRecord[];
  companyGoals: GoalRecord[];
  companyProjects: ProjectRecord[];
  companyWorkspaces: WorkspaceRecord[];
  companyCosts: CostRecord[];
  filteredActivity: ReturnType<ProfileSnapshot["activity"]["filter"]>;
  companySecrets: ProfileSnapshot["secrets"];
  companyDocuments: DocumentRecord[];
  companyKnowledge: KnowledgeEntryRecord[];
  companyMeetings: MeetingRecord[];
  companySprints: SprintRecord[];
  socialAccounts: SocialAccountRecord[];
  browserActions: BrowserActionRecord[];
  inboxItems: InboxItem[];
  companyMetrics: CompanyMetrics | null;
  standupReport: StandupReport | null;
  selectedRunId: string | null;
  // selections
  selectedTask: TaskRecord | null;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  selectedConnector: ProfileSnapshot["connectors"][number] | null;
  setSelectedConnectorId: (id: string | null) => void;
  selectedApproval: ApprovalRecord | null;
  selectedApprovalId: string | null;
  setSelectedApprovalId: (id: string | null) => void;
  selectedAgent: AgentRecord | null;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
  selectedGoal: GoalRecord | null;
  selectedGoalId: string | null;
  setSelectedGoalId: (id: string | null) => void;
  selectedProject: ProjectRecord | null;
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  selectedWorkspace: WorkspaceRecord | null;
  setSelectedWorkspaceId: (id: string | null) => void;
  selectedCommunicationEntityId: string | null;
  setSelectedCommunicationEntityId: (id: string | null) => void;
  taskViewMode: "list" | "kanban";
  setTaskViewMode: (mode: "list" | "kanban") => void;
  // actions
  navigateTo: (section: SectionId, entityId?: string) => void;
  setSection: (section: SectionId) => void;
  setConsoleOpen: (value: boolean) => void;
  setSelectedRunId: (id: string | null) => void;
  refresh: () => Promise<void>;
  startRun: (taskId: string) => Promise<void>;
  cancelRun: (runId: string) => Promise<void>;
  openPathWithFeedback: (path: string) => Promise<void>;
  setError: (error: string | null) => void;
  // transitions
  pageTransition: { duration: number; ease?: readonly [number, number, number, number] } | { duration: number };
}

export function SectionContentView({
  section,
  error,
  snapshot,
  currentCompany,
  locale,
  tasks,
  runs,
  approvals,
  pendingApprovals,
  companyAgents,
  companyGoals,
  companyProjects,
  companyWorkspaces,
  companyCosts,
  filteredActivity,
  companySecrets,
  companyDocuments,
  companyKnowledge,
  companyMeetings,
  companySprints,
  socialAccounts,
  browserActions,
  inboxItems,
  companyMetrics,
  standupReport,
  selectedTask,
  selectedTaskId,
  setSelectedTaskId,
  selectedConnector,
  setSelectedConnectorId,
  selectedApproval,
  selectedApprovalId,
  setSelectedApprovalId,
  selectedAgent: _selectedAgent,
  selectedAgentId,
  setSelectedAgentId,
  selectedGoal: _selectedGoal,
  selectedGoalId,
  setSelectedGoalId,
  selectedProject: _selectedProject,
  selectedProjectId,
  setSelectedProjectId,
  selectedWorkspace,
  setSelectedWorkspaceId,
  selectedCommunicationEntityId,
  setSelectedCommunicationEntityId,
  taskViewMode,
  setTaskViewMode,
  selectedRunId,
  navigateTo,
  setSection,
  setConsoleOpen,
  setSelectedRunId,
  refresh,
  startRun,
  cancelRun,
  openPathWithFeedback,
  setError,
  pageTransition,
}: SectionContentViewProps) {
  return (
    <div className={`flex-1 ${section === "communication" ? "flex flex-col overflow-hidden" : "overflow-auto"}`}>
      <div className={section === "communication" ? "flex min-h-0 flex-1 flex-col" : "mx-auto flex w-full max-w-[1040px] flex-col px-6 py-6 lg:px-10 lg:py-8"}>

        {error ? (
          <div className={`flex items-center gap-3 rounded-lg bg-destructive-muted px-4 py-3 text-[13px] text-destructive ${section === "communication" ? "mx-6 mt-4" : "mb-6"}`}>
            <WarningCircle size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className={section === "communication" ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1"}>
          <ErrorBoundary>
            <AnimatePresence mode="wait">
              <motion.div
                key={section}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={pageTransition}
                className={section === "communication" ? "flex min-h-0 flex-1 flex-col" : "space-y-14"}
                style={section === "communication" ? { height: "100%" } : undefined}
              >
                <OrganizationSections
                  section={section}
                  snapshot={snapshot}
                  currentCompany={currentCompany}
                  companyAgents={companyAgents}
                  companyGoals={companyGoals}
                  companyProjects={companyProjects}
                  companyWorkspaces={companyWorkspaces}
                  selectedAgentId={selectedAgentId}
                  setSelectedAgentId={setSelectedAgentId}
                  selectedGoalId={selectedGoalId}
                  setSelectedGoalId={setSelectedGoalId}
                  selectedProjectId={selectedProjectId}
                  setSelectedProjectId={setSelectedProjectId}
                  setSection={setSection}
                  refresh={refresh}
                />

                <ExecutionSections
                  section={section}
                  snapshot={snapshot}
                  currentCompany={currentCompany}
                  tasks={tasks}
                  runs={runs}
                  approvals={approvals}
                  pendingApprovals={pendingApprovals}
                  companyAgents={companyAgents}
                  companyGoals={companyGoals}
                  companyProjects={companyProjects}
                  companyWorkspaces={companyWorkspaces}
                  companyCosts={companyCosts}
                  companyDocuments={companyDocuments}
                  filteredActivity={filteredActivity}
                  selectedRunId={selectedRunId}
                  selectedTask={selectedTask}
                  selectedTaskId={selectedTaskId}
                  setSelectedTaskId={setSelectedTaskId}
                  selectedConnector={selectedConnector}
                  setSelectedConnectorId={setSelectedConnectorId}
                  selectedApproval={selectedApproval}
                  selectedApprovalId={selectedApprovalId}
                  setSelectedApprovalId={setSelectedApprovalId}
                  selectedGoalId={selectedGoalId}
                  setSelectedGoalId={setSelectedGoalId}
                  taskViewMode={taskViewMode}
                  setTaskViewMode={setTaskViewMode}
                  setSection={setSection}
                  setConsoleOpen={setConsoleOpen}
                  setSelectedRunId={setSelectedRunId}
                  setSelectedCommunicationEntityId={setSelectedCommunicationEntityId}
                  refresh={refresh}
                  startRun={startRun}
                  cancelRun={cancelRun}
                  openPathWithFeedback={openPathWithFeedback}
                  setError={setError}
                />

                <OperationsSections
                  section={section}
                  snapshot={snapshot}
                  currentCompany={currentCompany}
                  locale={locale}
                  tasks={tasks}
                  runs={runs}
                  companyAgents={companyAgents}
                  companyProjects={companyProjects}
                  companyWorkspaces={companyWorkspaces}
                  companyDocuments={companyDocuments}
                  companyKnowledge={companyKnowledge}
                  companyMeetings={companyMeetings}
                  companySprints={companySprints}
                  socialAccounts={socialAccounts}
                  browserActions={browserActions}
                  inboxItems={inboxItems}
                  companyMetrics={companyMetrics}
                  standupReport={standupReport}
                  companySecrets={companySecrets}
                  selectedWorkspace={selectedWorkspace}
                  setSelectedWorkspaceId={setSelectedWorkspaceId}
                  selectedCommunicationEntityId={selectedCommunicationEntityId}
                  setSelectedCommunicationEntityId={setSelectedCommunicationEntityId}
                  setSelectedTaskId={setSelectedTaskId}
                  setSelectedApprovalId={setSelectedApprovalId}
                  setSection={setSection}
                  navigateTo={navigateTo}
                  refresh={refresh}
                  openPathWithFeedback={openPathWithFeedback}
                  setError={setError}
                  filteredActivity={filteredActivity}
                  companyCosts={companyCosts}
                  companyGoals={companyGoals}
                />
              </motion.div>
            </AnimatePresence>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
