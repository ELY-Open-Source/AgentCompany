import { useCallback, useEffect, useState } from "react";
import { FloppyDisk, SignIn } from "../ui/icons";
import type { ConnectorRecord } from "@shared/types";
import { unwrap } from "../../lib/desktop";
import {
  INPUT_CLS,
  ModelToggleList,
  ProviderCard,
  StatusBadge,
  parseEnvValue,
  type ModelEntry,
} from "./ModelManagementShared";

/* ------------------------------------------------------------------ */
/*  Native provider card (Claude Code / Codex / Gemini)                */
/* ------------------------------------------------------------------ */

export function NativeProviderCard({
  connector,
  zh,
  onSaved,
  expanded,
  onToggle,
}: {
  connector: ConnectorRecord;
  zh: boolean;
  onSaved: () => Promise<void>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [saving, setSaving] = useState(false);

  const envKeyName = connector.id === "codex_local" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const [apiKey, setApiKey] = useState(() => parseEnvValue(connector.envBindingText, envKeyName));

  useEffect(() => {
    setApiKey(parseEnvValue(connector.envBindingText, envKeyName));
  }, [connector.envBindingText, envKeyName]);

  const loadModels = useCallback(async () => {
    try {
      const [enabledResult, disabledResult] = await Promise.all([
        window.agentCompany.listConnectorModels(connector.id),
        window.agentCompany.getConnectorDisabledModels(connector.id),
      ]);
      const enabled = enabledResult.ok ? enabledResult.data : [];
      const disabled = disabledResult.ok ? disabledResult.data : [];
      setModels([
        ...enabled.map((m) => ({ ...m, enabled: true })),
        ...disabled.map((m) => ({ ...m, enabled: false })),
      ]);
    } catch {
      /* non-fatal */
    }
  }, [connector.id]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  async function handleToggleModel(modelId: string) {
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
      if (apiKey.trim()) lines.push(`${envKeyName}=${apiKey.trim()}`);
      unwrap(
        await window.agentCompany.saveConnector({
          id: connector.id,
          command: connector.command,
          model: connector.model,
          envBindingText: lines.join("\n"),
          notes: connector.notes,
        }),
      );
      await window.agentCompany.testConnector(connector.id);
      await onSaved();
      void loadModels();
    } finally {
      setSaving(false);
    }
  }

  async function handleLogin() {
    await window.agentCompany.openConnectorAuthTerminal(connector.id);
  }

  const showApiKey = connector.id === "claude_local" || connector.id === "codex_local";

  return (
    <ProviderCard
      title={connector.label}
      badge={<StatusBadge status={connector.status} zh={zh} />}
      expanded={expanded}
      onToggle={onToggle}
    >
      <button
        type="button"
        onClick={() => void handleLogin()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted"
      >
        <SignIn size={14} />
        {zh ? "登录" : "Login"}
      </button>

      {showApiKey ? (
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
            {envKeyName}{" "}
            <span className="font-normal">({zh ? "可选" : "optional"})</span>
          </label>
          <input
            type="password"
            className={INPUT_CLS}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={connector.id === "codex_local" ? "sk-..." : "sk-ant-..."}
          />
        </div>
      ) : null}

      <ModelToggleList
        models={models}
        onToggle={(id) => void handleToggleModel(id)}
        canRemove={false}
        zh={zh}
      />

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
    </ProviderCard>
  );
}
