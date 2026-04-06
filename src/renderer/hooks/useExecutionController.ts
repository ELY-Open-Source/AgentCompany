import { useAppStore } from "../state/store";

/**
 * Fine-grained subscriptions for execution domain:
 * runs, approvals, costs, budgets, selected run/approval/task/connector.
 *
 * Cross-domain actions (startRun, cancelRun) are composed in useAppController
 * because they need refresh() from useCompanyController.
 */
export function useExecutionController() {
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);
  const selectedConnectorId = useAppStore((s) => s.selectedConnectorId);
  const setSelectedConnectorId = useAppStore((s) => s.setSelectedConnectorId);
  const selectedApprovalId = useAppStore((s) => s.selectedApprovalId);
  const setSelectedApprovalId = useAppStore((s) => s.setSelectedApprovalId);
  const selectedRunId = useAppStore((s) => s.selectedRunId);
  const setSelectedRunId = useAppStore((s) => s.setSelectedRunId);

  return {
    selectedTaskId,
    setSelectedTaskId,
    selectedConnectorId,
    setSelectedConnectorId,
    selectedApprovalId,
    setSelectedApprovalId,
    selectedRunId,
    setSelectedRunId,
  };
}
