import { useCallback, useEffect, useState } from "react";
import { FloppyDisk, Plus, X as XIcon } from "@phosphor-icons/react";
import type { ConnectorRecord, ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { unwrap } from "../../lib/desktop";
import { ActionButton } from "../ui";

interface ModelManagementProps {
  connectors: ProfileSnapshot["connectors"];
  locale: AppLocale;
  onSaved: () => Promise<void>;
}

/** Check if a claude_compat connector has been configured (has env bindings). */
function isConfigured(c: ConnectorRecord): boolean {
  return c.envBindingText.includes("ANTHROPIC_BASE_URL") || c.envBindingText.includes("ANTHROPIC_API_KEY");
}

function getDisplayName(connector: ConnectorRecord): string {
  if (connector.id.startsWith("claude_compat") && connector.notes) return connector.notes;
  return connector.label;
}

function CompatModelEditor({
  connector,
  locale,
  onSaved,
}: {
  connector: ConnectorRecord;
  locale: AppLocale;
  onSaved: () => Promise<void>;
}) {
  const [models, setModels] = useState<string[]>(() => {
    const raw = connector.model ?? "";
    return raw.split(",").map((m) => m.trim()).filter(Boolean);
  });
  const [newModel, setNewModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const raw = connector.model ?? "";
    setModels(raw.split(",").map((m) => m.trim()).filter(Boolean));
    setDirty(false);
  }, [connector.model]);

  function addModel() {
    const trimmed = newModel.trim();
    if (!trimmed || models.includes(trimmed)) return;
    setModels((prev) => [...prev, trimmed]);
    setNewModel("");
    setDirty(true);
  }

  function removeModel(m: string) {
    setModels((prev) => prev.filter((x) => x !== m));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      unwrap(await window.agentCompany.saveConnector({
        id: connector.id,
        command: connector.command,
        model: models.join(",") || null,
        envBindingText: connector.envBindingText,
        notes: connector.notes,
      }));
      setDirty(false);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-2 text-[13px] font-semibold text-foreground">{getDisplayName(connector)}</div>
      {models.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {models.map((m) => (
            <span
              key={m}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2.5 py-1 text-[12px] text-foreground"
            >
              {m}
              <button
                type="button"
                onClick={() => removeModel(m)}
                className="ml-0.5 text-muted-foreground transition hover:text-destructive"
                aria-label={`Remove ${m}`}
              >
                <XIcon size={10} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="mb-2 text-[12px] text-muted-foreground">
          {locale === "zh" ? "未配置模型" : "No models configured"}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={newModel}
          onChange={(e) => setNewModel(e.target.value)}
          placeholder={locale === "zh" ? "输入模型名称" : "model-name"}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModel(); } }}
        />
        <button
          type="button"
          onClick={addModel}
          disabled={!newModel.trim()}
          className="shrink-0 rounded-lg border border-border bg-card p-2 text-foreground transition hover:bg-muted disabled:opacity-40"
          aria-label="Add model"
        >
          <Plus size={14} />
        </button>
        {dirty ? (
          <ActionButton
            label={locale === "zh" ? "保存" : "Save"}
            tone="accent"
            icon={FloppyDisk}
            onClick={() => void handleSave()}
            loading={saving}
          />
        ) : null}
      </div>
    </div>
  );
}

function NativeModelList({
  connector,
  locale,
}: {
  connector: ConnectorRecord;
  locale: AppLocale;
}) {
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);

  const loadModels = useCallback(async () => {
    try {
      const result = await window.agentCompany.listConnectorModels(connector.id);
      if (result.ok && result.data.length > 0) {
        setModels(result.data);
      }
    } catch { /* non-fatal */ }
  }, [connector.id]);

  useEffect(() => { void loadModels(); }, [loadModels]);

  return (
    <div>
      <div className="mb-2 text-[13px] font-semibold text-foreground">{getDisplayName(connector)}</div>
      {models.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {models.map((m) => (
            <span
              key={m.id}
              className="inline-block rounded-md border border-border bg-muted px-2.5 py-1 text-[12px] text-foreground"
            >
              {m.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-muted-foreground">
          {locale === "zh" ? "使用默认模型" : "Using default model"}
        </div>
      )}
    </div>
  );
}

export function ModelManagement({ connectors, locale, onSaved }: ModelManagementProps) {
  // Show native connectors that are ready + claude_compat connectors that are configured
  const visibleConnectors = connectors.filter((c) => {
    if (c.id.startsWith("claude_compat")) return isConfigured(c);
    return c.status === "ready";
  });

  if (visibleConnectors.length === 0) {
    return (
      <div className="py-6 text-center text-[13px] text-muted-foreground">
        {locale === "zh" ? "暂无就绪的提供商" : "No ready providers"}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {visibleConnectors.map((connector) =>
        connector.id.startsWith("claude_compat") ? (
          <CompatModelEditor key={connector.id} connector={connector} locale={locale} onSaved={onSaved} />
        ) : (
          <NativeModelList key={connector.id} connector={connector} locale={locale} />
        ),
      )}
    </div>
  );
}
