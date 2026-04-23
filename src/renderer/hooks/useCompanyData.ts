import { useMemo } from "react";
import type { CompanyRecord, ProfileSnapshot, SectionId } from "@shared/types";
import { deriveSidebarBadges } from "@shared/sidebar-badges";
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
  const editingAgentId = useAppStore((s) => s.editingAgentId);
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
  const companyWorkProducts = useMemo(() => filterByCompany(snapshot?.workProducts, currentCompany), [snapshot, currentCompany]);
  const companyKnowledge = useMemo(() => filterByCompany(snapshot?.knowledgeBase, currentCompany), [snapshot, currentCompany]);
  const companyMeetings = useMemo(() => filterByCompany(snapshot?.meetings, currentCompany), [snapshot, currentCompany]);
  const companySprints = useMemo(() => filterByCompany(snapshot?.sprints, currentCompany), [snapshot, currentCompany]);

  // HOOK-005 fix: memoize selection derivations so their identity is stable
  // across renders when the backing collections and selected id have not
  // changed.
  const selectedTask = useMemo(
    () => (selectedTaskId ? (tasks.find((task) => task.id === selectedTaskId) ?? null) : null),
    [selectedTaskId, tasks],
  );
  const selectedApproval = useMemo(
    () => (selectedApprovalId ? (approvals.find((approval) => approval.id === selectedApprovalId) ?? null) : null),
    [selectedApprovalId, approvals],
  );
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );
  const selectedAgent = useMemo(
    () => companyAgents.find((a) => a.id === selectedAgentId) ?? null,
    [companyAgents, selectedAgentId],
  );
  const editingAgent = useMemo(
    () => companyAgents.find((a) => a.id === editingAgentId) ?? null,
    [companyAgents, editingAgentId],
  );
  const selectedGoal = useMemo(
    () => companyGoals.find((g) => g.id === selectedGoalId) ?? null,
    [companyGoals, selectedGoalId],
  );
  const selectedProject = useMemo(
    () => companyProjects.find((p) => p.id === selectedProjectId) ?? null,
    [companyProjects, selectedProjectId],
  );
  const selectedWorkspace = useMemo(
    () => companyWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? companyWorkspaces[0] ?? null,
    [companyWorkspaces, selectedWorkspaceId],
  );

  // Derive sidebar badge counts from the snapshot. Single source of truth —
  // no separate `store.badges` cache to drift when messages get marked read
  // or approvals get accepted between server-side aggregations.
  const navBadges = useMemo<Partial<Record<SectionId, { count: number; tone: "default" | "warn" | "danger" }>>>(() => {
    if (!snapshot) return {};
    const badges = deriveSidebarBadges(snapshot, currentCompany?.id ?? null);
    return {
      runs:
        badges.failedRuns > 0
          ? { count: badges.failedRuns, tone: "danger" }
          : badges.activeRuns > 0
            ? { count: badges.activeRuns, tone: "default" }
            : undefined,
      tasks: badges.todoTasks > 0 ? { count: badges.todoTasks, tone: "default" } : undefined,
      approvals: badges.pendingApprovals > 0 ? { count: badges.pendingApprovals, tone: "warn" } : undefined,
      communication: badges.unreadMessages > 0 ? { count: badges.unreadMessages, tone: "warn" } : undefined,
    };
  }, [snapshot, currentCompany?.id]);

  return useMemo(() => ({
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
    companyWorkProducts,
    companyKnowledge,
    companyMeetings,
    companySprints,
    selectedTask,
    selectedApproval,
    selectedRun,
    selectedAgent,
    editingAgent,
    selectedGoal,
    selectedProject,
    selectedWorkspace,
    navBadges,
  }), [
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
    companyWorkProducts,
    companyKnowledge,
    companyMeetings,
    companySprints,
    selectedTask,
    selectedApproval,
    selectedRun,
    selectedAgent,
    editingAgent,
    selectedGoal,
    selectedProject,
    selectedWorkspace,
    navBadges,
  ]);
}

export type CompanyData = ReturnType<typeof useCompanyData>;
