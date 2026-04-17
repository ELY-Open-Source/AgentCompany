import { createContext, useContext, type ReactNode } from "react";
import type { AppLocale } from "@shared/locale";
import type {
  ConnectorId,
  ExecutionMode,
  OnboardingBootstrapResult,
  ProfileSnapshot,
} from "@shared/types";
import type { ConnectorModelEntry } from "@shared/connector-models";
import type { TerminalCommandKey } from "@shared/contracts";
import type { TranslationFn } from "../../i18n";

export interface OnboardingContextValue {
  currentLocale: AppLocale;
  t: TranslationFn;

  error: string | null;
  loading: boolean;

  nodeStatus: { installed: boolean; version: string | null } | null;
  nodeChecking: boolean;
  onCheckNode: () => void;
  onInstallCommand: (commandKey: TerminalCommandKey) => void;

  connectors: ProfileSnapshot["connectors"];
  hasAtLeastOneReady: boolean;
  onTestConnector: (connectorId: string) => void;
  onSaveConnector: (
    connectorId: string,
    envBindingText: string,
    model: string | null,
    notes?: string,
  ) => void;
  onLoginConnector: (connectorId: string) => void;

  companyName: string;
  setCompanyName: (value: string) => void;
  companyDescription: string;
  setCompanyDescription: (value: string) => void;

  selectedConnectorId: ConnectorId | "";
  setSelectedConnectorId: (value: ConnectorId | "") => void;
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  selectedConnector: ProfileSnapshot["connectors"][number] | null;

  executionReadyConnectors: ProfileSnapshot["connectors"];
  connectorModelPools: Array<{
    connector: ProfileSnapshot["connectors"][number];
    models: ConnectorModelEntry[];
  }>;
  modelOptions: Array<{ id: string; label: string }>;
  loadingModels: boolean;
  totalEnabledModels: number;
  selectedConnectorEnabledModels: number;
  onToggleConnectorModel: (connectorId: ConnectorId, modelId: string) => void;

  workspacePath: string;
  setWorkspacePath: (value: string) => void;
  onPickDirectory: () => void;

  executionMode: ExecutionMode;
  setExecutionMode: (value: ExecutionMode) => void;

  goalTitle: string;
  setGoalTitle: (value: string) => void;
  goalDescription: string;
  setGoalDescription: (value: string) => void;

  launchSummary: OnboardingBootstrapResult | null;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({
  value,
  children,
}: {
  value: OnboardingContextValue;
  children: ReactNode;
}) {
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return ctx;
}
