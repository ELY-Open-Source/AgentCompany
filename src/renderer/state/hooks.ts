import { useAppStore } from "./store";

// Navigation slice selectors
export const useSection = () => useAppStore((s) => s.section);
export const useSetSection = () => useAppStore((s) => s.setSection);
export const useNavigateTo = () => useAppStore((s) => s.navigateTo);
export const useCommandPaletteOpen = () =>
  useAppStore((s) => s.commandPaletteOpen);
export const useConsoleOpen = () => useAppStore((s) => s.consoleOpen);
export const useSidebarCollapsed = () =>
  useAppStore((s) => s.sidebarCollapsed);

// Company slice selectors
export const useSnapshot = () => useAppStore((s) => s.snapshot);
export const useCurrentCompanyId = () =>
  useAppStore((s) => s.currentCompanyId);
export const useError = () => useAppStore((s) => s.error);
export const useInboxItems = () => useAppStore((s) => s.inboxItems);
export const useCompanyMetrics = () => useAppStore((s) => s.companyMetrics);
export const useStandupReport = () => useAppStore((s) => s.standupReport);
export const useBadges = () => useAppStore((s) => s.badges);

// Selection slice selectors
export const useSelectedTaskId = () => useAppStore((s) => s.selectedTaskId);
export const useSelectedAgentId = () =>
  useAppStore((s) => s.selectedAgentId);
export const useSelectedApprovalId = () =>
  useAppStore((s) => s.selectedApprovalId);
export const useSelectedRunId = () => useAppStore((s) => s.selectedRunId);
export const useSelectedGoalId = () => useAppStore((s) => s.selectedGoalId);
export const useSelectedProjectId = () =>
  useAppStore((s) => s.selectedProjectId);
export const useSelectedWorkspaceId = () =>
  useAppStore((s) => s.selectedWorkspaceId);
export const useSelectedConnectorId = () =>
  useAppStore((s) => s.selectedConnectorId);
export const useSelectedCommunicationEntityId = () =>
  useAppStore((s) => s.selectedCommunicationEntityId);

// UI slice selectors
export const useLocale = () => useAppStore((s) => s.locale);
export const useShowOnboarding = () => useAppStore((s) => s.showOnboarding);
export const useTaskViewMode = () => useAppStore((s) => s.taskViewMode);

// Social slice selectors
export const useSocialAccounts = () => useAppStore((s) => s.socialAccounts);
export const useBrowserActions = () => useAppStore((s) => s.browserActions);
