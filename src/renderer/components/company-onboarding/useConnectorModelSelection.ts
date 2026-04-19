import { useCallback, useEffect, useMemo, useState } from "react";
import {
  mergeConnectorModelEntries,
  type ConnectorModelEntry,
} from "@shared/connector-models";
import { isConnectorExecutionReady } from "@shared/connector-policy";
import type { AppLocale } from "@shared/locale";
import type { ConnectorId, ProfileSnapshot } from "@shared/types";
import type { TranslationFn } from "../../i18n";

/**
 * Structural equality over the per-connector model catalog. Returns true
 * when the two maps hold the same connector ids, each list in the same
 * order, and each entry has the same id/label/enabled flag. Used to keep
 * React state references stable across snapshot refreshes so an open
 * native <select> dropdown is not torn down mid-interaction.
 */
function connectorCatalogsEqual(
  a: Record<string, ConnectorModelEntry[]>,
  b: Record<string, ConnectorModelEntry[]>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const listA = a[key];
    const listB = b[key];
    if (!listB || listA.length !== listB.length) return false;
    for (let i = 0; i < listA.length; i++) {
      const x = listA[i];
      const y = listB[i];
      if (x.id !== y.id || x.label !== y.label || x.enabled !== y.enabled) return false;
    }
  }
  return true;
}

/**
 * Per-connector disabled-model list, shaped to feed straight into
 * `bootstrapOnboarding`'s input. Empty array means "every model enabled."
 */
export interface ConnectorPoolSelection {
  connectorId: ConnectorId;
  disabledModels: Array<{ id: string; label: string }>;
}

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
  toggleConnectorModel: (connectorId: ConnectorId, modelId: string) => void;
  setAllConnectorModels: (connectorId: ConnectorId, enabled: boolean) => void;
  /**
   * Snapshot of the user's per-connector disabled selections, ready
   * to be committed with the company creation in `bootstrapOnboarding`.
   */
  poolSelections: ConnectorPoolSelection[];
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

  // Onboarding is a pre-commit phase — the company does not exist in
  // the DB yet, so there is no persisted disabled-models list to read.
  // Initial state is "every model enabled"; user toggles mutate local
  // state only, and `bootstrapOnboarding` persists the final selection
  // when the company is created. This removes the global-leak bug
  // where a deleted company's disabled list inherited into the next.
  const loadConnectorModels = useCallback(async (connector: ProfileSnapshot["connectors"][number]) => {
    if (connector.id.startsWith("claude_compat")) {
      const configuredModels = (connector.model ?? "")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean)
        .map((model) => ({ id: model, label: model }));
      return mergeConnectorModelEntries(configuredModels, []);
    }

    const enabledResult = await window.agentCompany.listConnectorModels(connector.id);
    const enabledModels = enabledResult.ok ? enabledResult.data : [];
    return mergeConnectorModelEntries(enabledModels, []);
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
        const next = Object.fromEntries(entries);
        // Guard against no-op state updates: snapshot refreshes re-run this
        // effect with the same CONNECTORS data, and returning a new object
        // reference here cascades through `connectorModels` → `modelOptions`
        // and collapses any open native <select> dropdown. Only call
        // setConnectorModelsById when the catalog actually changed.
        setConnectorModelsById((previous) =>
          connectorCatalogsEqual(previous, next) ? previous : next,
        );
      } catch (error) {
        if (cancelled) return;
        console.warn(
          `[onboarding/useConnectorModelSelection] connector model fetch failed; clearing catalog: ${error instanceof Error ? error.message : String(error)}`,
        );
        setConnectorModelsById((previous) => (Object.keys(previous).length === 0 ? previous : {}));
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
    const enabledModels = connectorModels.filter((entry) => entry.enabled);
    if (enabledModels.length === 0) {
      setSelectedModel("");
      return;
    }
    setSelectedModel((currentModel) => {
      if (currentModel && enabledModels.some((entry) => entry.id === currentModel)) {
        return currentModel;
      }
      const connectorDefinition = executionReadyConnectors.find((c) => c.id === selectedConnectorId);
      const preferred = connectorDefinition?.model;
      if (preferred && enabledModels.some((entry) => entry.id === preferred)) {
        return preferred;
      }
      return enabledModels[0]?.id ?? "";
    });
  }, [connectorModels, selectedConnectorId, executionReadyConnectors]);

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

  const toggleConnectorModel = useCallback((connectorId: ConnectorId, modelId: string) => {
    const connectorModels = connectorModelsById[connectorId];
    if (!connectorModels) return;

    const currentEntry = connectorModels.find((model) => model.id === modelId);
    if (!currentEntry) return;

    const updatedModels = connectorModels.map((model) =>
      model.id === modelId ? { ...model, enabled: !model.enabled } : model,
    );
    const updatedModelMap = { ...connectorModelsById, [connectorId]: updatedModels };
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

    setConnectorModelsById(updatedModelMap);
    setError(null);
    // Unused dependency: t is left in the closure list below for
    // consistency with the error-copy callbacks; avoids a hook
    // re-identity when the translator ref swaps locales.
    void t;
  }, [connectorModelsById, currentLocale, setError, t]);

  /**
   * Bulk-flip every model of one connector on or off. Pure local state
   * during onboarding; persistence happens at `bootstrapOnboarding`.
   * Disabling-all is allowed even if it zeroes the global enabled
   * count — the continue gate at the wizard level catches that.
   */
  const setAllConnectorModels = useCallback(
    (connectorId: ConnectorId, enabled: boolean) => {
      const connectorModels = connectorModelsById[connectorId];
      if (!connectorModels || connectorModels.length === 0) return;
      const updatedModels = connectorModels.map((model) => ({ ...model, enabled }));
      setConnectorModelsById({ ...connectorModelsById, [connectorId]: updatedModels });
      setError(null);
    },
    [connectorModelsById, setError],
  );

  const poolSelections = useMemo<ConnectorPoolSelection[]>(
    () =>
      Object.entries(connectorModelsById).map(([connectorId, models]) => ({
        connectorId: connectorId as ConnectorId,
        disabledModels: models
          .filter((model) => !model.enabled)
          .map((model) => ({ id: model.id, label: model.label })),
      })),
    [connectorModelsById],
  );

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
    setAllConnectorModels,
    poolSelections,
  };
}
