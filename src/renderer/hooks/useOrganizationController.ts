import { useAppStore } from "../state/store";

/**
 * Fine-grained subscriptions for organization domain:
 * goals, projects, sprints, departments, workspaces, agents.
 */
export function useOrganizationController() {
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useAppStore((s) => s.setSelectedAgentId);
  const selectedGoalId = useAppStore((s) => s.selectedGoalId);
  const setSelectedGoalId = useAppStore((s) => s.setSelectedGoalId);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useAppStore((s) => s.setSelectedProjectId);
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const setSelectedWorkspaceId = useAppStore((s) => s.setSelectedWorkspaceId);

  return {
    selectedAgentId,
    setSelectedAgentId,
    selectedGoalId,
    setSelectedGoalId,
    selectedProjectId,
    setSelectedProjectId,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
  };
}
