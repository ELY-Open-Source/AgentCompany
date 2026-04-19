import { createContext, useContext, type ReactNode } from "react";
import type { AppLocale } from "@shared/locale";
import type {
  ConnectorId,
  OnboardingBootstrapResult,
  ProfileSnapshot,
} from "@shared/types";
import type { ConnectorModelEntry } from "@shared/connector-models";
import type { TerminalCommandKey } from "@shared/contracts";
import type { TranslationFn } from "../../i18n";

/**
 * Wizard-level shell state: locale, translation, load/error, finalized
 * launch snapshot. Narrow on purpose so that typing in a step does not
 * invalidate every consumer.
 */
export interface OnboardingWizardContextValue {
  currentLocale: AppLocale;
  t: TranslationFn;
  error: string | null;
  loading: boolean;
  launchSummary: OnboardingBootstrapResult | null;
  nodeStatus: { installed: boolean; version: string | null } | null;
  nodeChecking: boolean;
  onCheckNode: () => void;
  onInstallCommand: (commandKey: TerminalCommandKey) => void;
}

const OnboardingWizardContext = createContext<OnboardingWizardContextValue | null>(null);

export function OnboardingWizardProvider({
  value,
  children,
}: {
  value: OnboardingWizardContextValue;
  children: ReactNode;
}) {
  return <OnboardingWizardContext.Provider value={value}>{children}</OnboardingWizardContext.Provider>;
}

export function useOnboardingWizard(): OnboardingWizardContextValue {
  const ctx = useContext(OnboardingWizardContext);
  if (!ctx) {
    throw new Error("useOnboardingWizard must be used within an OnboardingWizardProvider");
  }
  return ctx;
}

/**
 * Connector/model slice. Shared by CompanyStep, ModelPoolStep, LaunchStep.
 */
export interface OnboardingConnectorsContextValue {
  connectors: ProfileSnapshot["connectors"];
  hasAtLeastOneReady: boolean;
  onTestConnector: (connectorId: string) => void;
  onSaveConnector: (
    connectorId: string,
    envBindingText: string,
    model: string | null,
    notes?: string,
  ) => void;

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
  onSetAllConnectorModels: (connectorId: ConnectorId, enabled: boolean) => void;
}

const OnboardingConnectorsContext = createContext<OnboardingConnectorsContextValue | null>(null);

export function OnboardingConnectorsProvider({
  value,
  children,
}: {
  value: OnboardingConnectorsContextValue;
  children: ReactNode;
}) {
  return (
    <OnboardingConnectorsContext.Provider value={value}>
      {children}
    </OnboardingConnectorsContext.Provider>
  );
}

export function useOnboardingConnectors(): OnboardingConnectorsContextValue {
  const ctx = useContext(OnboardingConnectorsContext);
  if (!ctx) {
    throw new Error(
      "useOnboardingConnectors must be used within an OnboardingConnectorsProvider",
    );
  }
  return ctx;
}
