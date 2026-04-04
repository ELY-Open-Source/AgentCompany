import { useMemo } from "react";
import type { CompanyRecord, ProfileSnapshot, SectionId } from "@shared/types";
import { useAppStore } from "../state/store";

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

  const tasks = useMemo(() => snapshot?.tasks.filter((task) => !currentCompany || task.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const approvals = useMemo(() => snapshot?.approvals.filter((approval) => !currentCompany || approval.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.state === "pending"), [approvals]);
  const runs = useMemo(() => snapshot?.runs.filter((run) => !currentCompany || run.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companyAgents = useMemo(() => snapshot?.agents.filter((a) => !currentCompany || a.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companyGoals = useMemo(() => snapshot?.goals.filter((g) => !currentCompany || g.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companyProjects = useMemo(() => snapshot?.projects.filter((p) => !currentCompany || p.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companyWorkspaces = useMemo(() => snapshot?.workspaces.filter((workspace) => !currentCompany || workspace.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companyCosts = useMemo(() => snapshot?.costs.filter((entry) => !currentCompany || entry.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const filteredActivity = useMemo(() => snapshot?.activity.filter((entry) => !currentCompany || entry.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companySecrets = useMemo(() => snapshot?.secrets.filter((secret) => !currentCompany || secret.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companyDocuments = useMemo(() => snapshot?.documents?.filter((d) => !currentCompany || d.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companyKnowledge = useMemo(() => snapshot?.knowledgeBase?.filter((k) => !currentCompany || k.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companyMeetings = useMemo(() => snapshot?.meetings?.filter((m) => !currentCompany || m.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);
  const companySprints = useMemo(() => snapshot?.sprints?.filter((s) => !currentCompany || s.companyId === currentCompany.id) ?? [], [snapshot, currentCompany]);

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
