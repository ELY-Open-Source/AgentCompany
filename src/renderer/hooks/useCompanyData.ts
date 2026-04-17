import { useMemo } from "react";
import type { CompanyRecord, ProfileSnapshot, SectionId } from "@shared/types";
import { useAppStore } from "../state/store";

function filterByCompany<T extends { companyId: string }>(
  items: T[] | undefined,
  currentCompany: CompanyRecord | null,
): T[] {
  if (!items) return [];
  if (!currentCompany) return items;
  return items.filter((item) => item.companyId === currentCompany.id);
}

export function useCompanyData(
  snapshot: ProfileSnapshot | null,
  currentCompany: CompanyRecord | null,
) {
  const selectedRunId = useAppStore((s) => s.selectedRunId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const selectedApprovalId = useAppStore((s) => s.selectedApprovalId);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const selectedGoalId = useAppStore((s) => s.selectedGoalId);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);

  const tasks = useMemo(() => filterByCompany(snapshot?.tasks, currentCompany), [snapshot, currentCompany]);
  const approvals = useMemo(() => filterByCompany(snapshot?.approvals, currentCompany), [snapshot, currentCompany]);
  const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.state === "pending"), [approvals]);
  const runs = useMemo(() => filterByCompany(snapshot?.runs, currentCompany), [snapshot, currentCompany]);
  const companyAgents = useMemo(() => filterByCompany(snapshot?.agents, currentCompany), [snapshot, currentCompany]);
  const companyGoals = useMemo(() => filterByCompany(snapshot?.goals, currentCompany), [snapshot, currentCompany]);
  const companyProjects = useMemo(() => filterByCompany(snapshot?.projects, currentCompany), [snapshot, currentCompany]);
  const companyWorkspaces = useMemo(() => filterByCompany(snapshot?.workspaces, currentCompany), [snapshot, currentCompany]);
  const companyCosts = useMemo(() => filterByCompany(snapshot?.costs, currentCompany), [snapshot, currentCompany]);
  const filteredActivity = useMemo(() => filterByCompany(snapshot?.activity, currentCompany), [snapshot, currentCompany]);
  const companySecrets = useMemo(() => filterByCompany(snapshot?.secrets, currentCompany), [snapshot, currentCompany]);
  const companyDocuments = useMemo(() => filterByCompany(snapshot?.documents, currentCompany), [snapshot, currentCompany]);
  const companyKnowledge = useMemo(() => filterByCompany(snapshot?.knowledgeBase, currentCompany), [snapshot, currentCompany]);
  const companyMeetings = useMemo(() => filterByCompany(snapshot?.meetings, currentCompany), [snapshot, currentCompany]);
  const companySprints = useMemo(() => filterByCompany(snapshot?.sprints, currentCompany), [snapshot, currentCompany]);

  const selectedTask = selectedTaskId ? (tasks.find((task) => task.id === selectedTaskId) ?? null) : null;
  const selectedApproval = selectedApprovalId ? (approvals.find((approval) => approval.id === selectedApprovalId) ?? null) : null;
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const selectedAgent = companyAgents.find((a) => a.id === selectedAgentId) ?? null;
  const selectedGoal = companyGoals.find((g) => g.id === selectedGoalId) ?? null;
  const selectedProject = companyProjects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedWorkspace = companyWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? companyWorkspaces[0] ?? null;

  const navBadgesSource = useAppStore((s) => s.badges);
  const navBadges = useMemo<Partial<Record<SectionId, { count: number; tone: "default" | "warn" | "danger" }>>>(() => navBadgesSource ? {
    runs:
      navBadgesSource.failedRuns > 0
        ? { count: navBadgesSource.failedRuns, tone: "danger" }
        : navBadgesSource.activeRuns > 0
          ? { count: navBadgesSource.activeRuns, tone: "default" }
          : undefined,
    tasks: navBadgesSource.todoTasks > 0 ? { count: navBadgesSource.todoTasks, tone: "default" } : undefined,
    approvals: navBadgesSource.pendingApprovals > 0 ? { count: navBadgesSource.pendingApprovals, tone: "warn" } : undefined,
    communication: navBadgesSource.unreadMessages > 0 ? { count: navBadgesSource.unreadMessages, tone: "warn" } : undefined,
  } : {}, [navBadgesSource]);

  return {
    tasks,
    approvals,
    pendingApprovals,
    runs,
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
    selectedTask,
    selectedApproval,
    selectedRun,
    selectedAgent,
    selectedGoal,
    selectedProject,
    selectedWorkspace,
    navBadges,
  };
}
