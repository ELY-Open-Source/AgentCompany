import { useCallback, useEffect, useState } from "react";
import { ArrowSquareOut, FloppyDisk, Plus, Trash } from "../ui/icons";
import type { ConnectorRecord } from "@shared/types";
import { unwrap } from "../../lib/desktop";
import {
  COMPATIBLE_PROVIDERS,
  INPUT_CLS,
  ModelToggleList,
  ProviderCard,
  StatusBadge,
  parseEnvValue,
  type ModelEntry,
} from "./ModelManagementShared";

/* ------------------------------------------------------------------ */
/*  Compatible provider card                                           */
/* ------------------------------------------------------------------ */

export function CompatProviderCard({
  slotId,
  connector,
  zh,
  onSaved,
  expanded,
  onToggle,
  onCleared,
}: {
  slotId: string;
  connector: ConnectorRecord | null;
  zh: boolean;
  onSaved: () => Promise<void>;
  expanded: boolean;
  onToggle: () => void;
  onCleared?: () => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState<string>(() => {
    const saved = connector?.notes ?? "";
    const match = COMPATIBLE_PROVIDERS.find((p) => p.label === saved);
    return match?.id ?? COMPATIBLE_PROVIDERS[0].id;
  });

  const [apiKey, setApiKey] = useState(() =>
    parseEnvValue(connector?.envBindingText ?? "", "ANTHROPIC_API_KEY"),
  );
  const [baseUrl, setBaseUrl] = useState<string>(
    () =>
      parseEnvValue(connector?.envBindingText ?? "", "ANTHROPIC_BASE_URL") ||
      COMPATIBLE_PROVIDERS[0].baseUrl,
  );
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [newModel, setNewModel] = useState("");
  const [saving, setSaving] = useState(false);

  const status = connector?.status ?? "not_installed";
  const providerLabel =
    COMPATIBLE_PROVIDERS.find((p) => p.id === selectedProvider)?.label ??
    "Compatible API";
  const displayTitle = connector?.notes || providerLabel;

  // Sync form state when connector changes externally (e.g. after save + refresh)
  useEffect(() => {
    setApiKey(parseEnvValue(connector?.envBindingText ?? "", "ANTHROPIC_API_KEY"));
    const savedBase = parseEnvValue(connector?.envBindingText ?? "", "ANTHROPIC_BASE_URL");
    if (savedBase) setBaseUrl(savedBase);
    const saved = connector?.notes ?? "";
    const match = COMPATIBLE_PROVIDERS.find((p) => p.label === saved);
    if (match) setSelectedProvider(match.id);
  }, [connector?.envBindingText, connector?.notes]);

  const loadModels = useCallback(async () => {
    if (!connector) {
      setModels([]);
      return;
    }
    try {
      const raw = connector.model ?? "";
      const allModelIds = raw
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      const disabledResult = await window.agentCompany.getConnectorDisabledModels(
        connector.id,
      );
      const disabledSet = new Set(
        (disabledResult.ok ? disabledResult.data : []).map((m) => m.id),
      );
      setModels(
        allModelIds.map((id) => ({
          id,
          label: id,
          enabled: !disabledSet.has(id),
        })),
      );
    } catch {
      /* non-fatal */
    }
  }, [connector]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  function handleProviderChange(providerId: string) {
    setSelectedProvider(providerId);
    const provider = COMPATIBLE_PROVIDERS.find((p) => p.id === providerId);
    if (provider) setBaseUrl(provider.baseUrl);
  }

  function addModel() {
    const trimmed = newModel.trim();
    if (!trimmed || models.some((m) => m.id === trimmed)) return;
    setModels((prev) => [...prev, { id: trimmed, label: trimmed, enabled: true }]);
    setNewModel("");
  }

  function removeModel(modelId: string) {
    setModels((prev) => prev.filter((m) => m.id !== modelId));
  }

  async function handleToggleModel(modelId: string) {
    if (!connector) return;
    const prev = models;
    const updated = models.map((m) =>
      m.id === modelId ? { ...m, enabled: !m.enabled } : m,
    );
    setModels(updated);
    const newDisabled = updated
      .filter((m) => !m.enabled)
      .map((m) => ({ id: m.id, label: m.label }));
    try {
      unwrap(
        await window.agentCompany.setConnectorDisabledModels({
          connectorId: connector.id,
          disabledModels: newDisabled,
        }),
      );
      await onSaved();
    } catch {
      setModels(prev);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const lines: string[] = [];
      if (apiKey.trim()) lines.push(`ANTHROPIC_API_KEY=${apiKey.trim()}`);
      if (baseUrl.trim()) lines.push(`ANTHROPIC_BASE_URL=${baseUrl.trim()}`);
      const label =
        COMPATIBLE_PROVIDERS.find((p) => p.id === selectedProvider)?.label ?? "";
      const modelsCsv =
        models.map((m) => m.id).join(",") || null;
      unwrap(
        await window.agentCompany.saveConnector({
          id: slotId as ConnectorRecord["id"],
          command: connector?.command ?? "claude",
          model: modelsCsv,
          envBindingText: lines.join("\n"),
          notes: label,
        }),
      );
      await window.agentCompany.testConnector(slotId as ConnectorRecord["id"]);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!connector) return;
    try {
      unwrap(
        await window.agentCompany.saveConnector({
          id: connector.id,
          command: connector.command,
          model: null,
          envBindingText: "",
          notes: "",
        }),
      );
      unwrap(
        await window.agentCompany.setConnectorDisabledModels({
          connectorId: connector.id,
          disabledModels: [],
        }),
      );
      await onSaved();
      onCleared?.();
    } catch {
      /* non-fatal */
    }
  }

  const selectedProviderData = COMPATIBLE_PROVIDERS.find(
    (p) => p.id === selectedProvider,
  );
  const isConfigured =
    connector &&
    (connector.envBindingText.includes("ANTHROPIC_BASE_URL") ||
      connector.envBindingText.includes("ANTHROPIC_API_KEY"));

  return (
    <ProviderCard
      title={displayTitle}
      badge={<StatusBadge status={status} zh={zh} />}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
          {zh ? "选择提供商" : "Select provider"}
        </label>
        <select
          className={INPUT_CLS}
          value={selectedProvider}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          {COMPATIBLE_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id} className="bg-card text-foreground">
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {selectedProviderData?.docUrl ? (
        <button
          type="button"
          onClick={() => window.open(selectedProviderData.docUrl, "_blank")}
          className="inline-flex items-center gap-1 text-[12px] text-primary transition hover:underline"
        >
          <ArrowSquareOut size={12} />
          {zh ? "查看文档" : "View docs"}
        </button>
      ) : null}

      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
          ANTHROPIC_API_KEY
        </label>
        <input
          type="password"
          className={INPUT_CLS}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
        />
      </div>

      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
          ANTHROPIC_BASE_URL
        </label>
        <input
          className={INPUT_CLS}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
        />
      </div>

      <ModelToggleList
        models={models}
        onToggle={(id) => void handleToggleModel(id)}
        onRemove={removeModel}
        canRemove
        zh={zh}
      />

      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
          {zh ? "添加模型" : "Add model"}
        </label>
        <div className="flex gap-2">
          <input
            className={INPUT_CLS}
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder={zh ? "输入模型名称" : "model-name"}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addModel();
              }
            }}
          />
          <button
            type="button"
            onClick={addModel}
            disabled={!newModel.trim()}
            className="shrink-0 rounded-lg border border-border bg-card px-3 py-2 text-[12px] font-medium text-foreground transition hover:bg-muted disabled:opacity-40"
            aria-label={zh ? "添加模型" : "Add model"}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted disabled:opacity-40"
        >
          <FloppyDisk size={14} />
          {saving
            ? zh
              ? "保存中..."
              : "Saving..."
            : zh
              ? "保存并检查"
              : "Save & Check"}
        </button>
        {isConfigured ? (
          <button
            type="button"
            onClick={() => void handleClear()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-destructive transition hover:bg-muted"
          >
            <Trash size={14} />
            {zh ? "清除配置" : "Clear"}
          </button>
        ) : null}
      </div>
    </ProviderCard>
  );
}
