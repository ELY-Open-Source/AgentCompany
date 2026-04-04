import { useCallback, useEffect, useMemo, useState } from "react";
import {
  mergeConnectorModelEntries,
  type ConnectorModelEntry,
} from "@shared/connector-models";
import { isConnectorExecutionReady } from "@shared/connector-policy";
import type { AppLocale } from "@shared/locale";
import type { ConnectorId, ProfileSnapshot } from "@shared/types";
import { unwrap } from "../../lib/desktop";
import type { TranslationFn } from "../../i18n";

interface UseConnectorModelSelectionResult {
  executionReadyConnectors: ProfileSnapshot["connectors"];
  hasAtLeastOneReady: boolean;
  selectedConnectorId: ConnectorId | "";
  setSelectedConnectorId: (value: ConnectorId | "") => void;
  selectedConnector: ProfileSnapshot["connectors"][number] | null;
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  connectorModels: ConnectorModelEntry[];
  connectorModelPools: Array<{
    connector: ProfileSnapshot["connectors"][number];
    models: ConnectorModelEntry[];
  }>;
  modelOptions: Array<{ id: string; label: string }>;
  loadingModels: boolean;
  totalEnabledModels: number;
  selectedConnectorEnabledModels: number;
  toggleConnectorModel: (connectorId: ConnectorId, modelId: string) => Promise<void>;
}

export function useConnectorModelSelection(
  connectors: ProfileSnapshot["connectors"],
  currentLocale: AppLocale,
  t: TranslationFn,
  setError: (error: string | null) => void,
): UseConnectorModelSelectionResult {
  const executionReadyConnectors = useMemo(
    () => connectors.filter((connector) => isConnectorExecutionReady(connector)),
    [connectors],
  );
  const hasAtLeastOneReady = executionReadyConnectors.length > 0;

  const [selectedConnectorId, setSelectedConnectorId] = useState<ConnectorId | "">(
    executionReadyConnectors[0]?.id ?? "",
  );
  const [selectedModel, setSelectedModel] = useState("");
  const [connectorModelsById, setConnectorModelsById] = useState<Record<string, ConnectorModelEntry[]>>({});
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    if (!selectedConnectorId && executionReadyConnectors[0]) {
      setSelectedConnectorId(executionReadyConnectors[0].id);
      return;
    }
    if (selectedConnectorId && !executionReadyConnectors.some((connector) => connector.id === selectedConnectorId)) {
      setSelectedConnectorId(executionReadyConnectors[0]?.id ?? "");
    }
  }, [executionReadyConnectors, selectedConnectorId]);

  const selectedConnector =
    executionReadyConnectors.find((connector) => connector.id === selectedConnectorId) ??
    executionReadyConnectors[0] ??
    null;

  const loadConnectorModels = useCallback(async (connector: ProfileSnapshot["connectors"][number]) => {
    if (connector.id.startsWith("claude_compat")) {
      const configuredModels = (connector.model ?? "")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean)
        .map((model) => ({ id: model, label: model }));
      const disabledResult = await window.agentCompany.getConnectorDisabledModels(connector.id);
      const disabledModels = disabledResult.ok ? disabledResult.data : [];
      return mergeConnectorModelEntries(configuredModels, disabledModels);
    }

    const [enabledResult, disabledResult] = await Promise.all([
      window.agentCompany.listConnectorModels(connector.id),
      window.agentCompany.getConnectorDisabledModels(connector.id),
    ]);
    const enabledModels = enabledResult.ok ? enabledResult.data : [];
    const disabledModels = disabledResult.ok ? disabledResult.data : [];
    return mergeConnectorModelEntries(enabledModels, disabledModels);
  }, []);

  useEffect(() => {
    if (!hasAtLeastOneReady) {
      setConnectorModelsById({});
      setSelectedModel("");
      return;
    }

    let cancelled = false;
    setLoadingModels(true);

    const loadModels = async () => {
      try {
        const entries = await Promise.all(
          executionReadyConnectors.map(async (connector) => [connector.id, await loadConnectorModels(connector)] as const),
        );
        if (cancelled) return;
        setConnectorModelsById(Object.fromEntries(entries));
      } catch {
        if (cancelled) return;
        setConnectorModelsById({});
        setSelectedModel("");
      } finally {
        if (!cancelled) {
          setLoadingModels(false);
        }
      }
    };

    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [executionReadyConnectors, hasAtLeastOneReady, loadConnectorModels]);

  const connectorModels = useMemo(
    () => connectorModelsById[selectedConnectorId] ?? [],
    [connectorModelsById, selectedConnectorId],
  );

  useEffect(() => {
    if (!selectedConnectorId) {
      setSelectedModel("");
      return;
    }
    setSelectedModel((currentModel) =>
      currentModel && connectorModels.some((entry) => entry.enabled && entry.id === currentModel)
        ? currentModel
        : "",
    );
  }, [connectorModels, selectedConnectorId]);

  const modelOptions = useMemo(
    () => connectorModels
      .filter((model) => model.enabled)
      .map((model) => ({ id: model.id, label: model.label })),
    [connectorModels],
  );

  const connectorModelPools = useMemo(
    () =>
      executionReadyConnectors.map((connector) => ({
        connector,
        models: connectorModelsById[connector.id] ?? [],
      })),
    [connectorModelsById, executionReadyConnectors],
  );

  const totalEnabledModels = useMemo(
    () =>
      Object.values(connectorModelsById).reduce(
        (count, models) => count + models.filter((model) => model.enabled).length,
        0,
      ),
    [connectorModelsById],
  );

  const selectedConnectorEnabledModels = useMemo(
    () => connectorModels.filter((model) => model.enabled).length,
    [connectorModels],
  );

  const toggleConnectorModel = useCallback(async (connectorId: ConnectorId, modelId: string) => {
    const connectorModels = connectorModelsById[connectorId];
    if (!connectorModels) {
      return;
    }

    const currentEntry = connectorModels.find((model) => model.id === modelId);
    if (!currentEntry) {
      return;
    }

    const updatedModels = connectorModels.map((model) =>
      model.id === modelId ? { ...model, enabled: !model.enabled } : model,
    );
    const updatedModelMap = {
      ...connectorModelsById,
      [connectorId]: updatedModels,
    };
    const nextEnabledCount = Object.values(updatedModelMap).reduce(
      (count, models) => count + models.filter((model) => model.enabled).length,
      0,
    );

    if (currentEntry.enabled && nextEnabledCount === 0) {
      setError(
        currentLocale === "zh"
          ? "至少保留一个全局启用模型，CEO 才能继续为团队分配工作。"
          : "Keep at least one enabled model across all providers so the CEO can keep staffing the team.",
      );
      return;
    }

    const previousModels = connectorModelsById;
    setConnectorModelsById(updatedModelMap);
    setError(null);

    try {
      unwrap(
        await window.agentCompany.setConnectorDisabledModels({
          connectorId,
          disabledModels: updatedModels
            .filter((model) => !model.enabled)
            .map((model) => ({ id: model.id, label: model.label })),
        }),
      );
    } catch (error) {
      setConnectorModelsById(previousModels);
      setError(error instanceof Error ? error.message : t("onboarding.unableToBootstrap"));
    }
  }, [connectorModelsById, currentLocale, setError, t]);

  return {
    executionReadyConnectors,
    hasAtLeastOneReady,
    selectedConnectorId,
    setSelectedConnectorId,
    selectedConnector,
    selectedModel,
    setSelectedModel,
    connectorModels,
    connectorModelPools,
    modelOptions,
    loadingModels,
    totalEnabledModels,
    selectedConnectorEnabledModels,
    toggleConnectorModel,
  };
}
