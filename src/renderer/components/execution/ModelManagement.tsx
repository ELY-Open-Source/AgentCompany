import { useCallback, useEffect, useState } from "react";
import {
  CaretDown,
  CaretRight,
  FloppyDisk,
  Plus,
  SignIn,
  Trash,
  ArrowSquareOut,
  X as XIcon,
} from "@phosphor-icons/react";
import type { ConnectorRecord, ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { unwrap } from "../../lib/desktop";

/* ------------------------------------------------------------------ */
/*  Compatible-API provider presets (mirrors ProvidersStep)             */
/* ------------------------------------------------------------------ */

const COMPATIBLE_PROVIDERS = [
  { id: "minimax", label: "MiniMax", baseUrl: "https://api.minimax.io/anthropic", docUrl: "https://platform.minimax.io/docs/token-plan/claude-code" },
  { id: "minimax_cn", label: "MiniMax (CN)", baseUrl: "https://api.minimaxi.com/anthropic", docUrl: "https://platform.minimax.io/docs/token-plan/claude-code" },
  { id: "kimi", label: "Kimi", baseUrl: "https://api.kimi.com/coding/", docUrl: "https://www.kimi.com/code/docs/en/more/third-party-agents.html" },
  { id: "kimi_cn", label: "Kimi CN", baseUrl: "https://api.moonshot.cn/anthropic", docUrl: "https://platform.moonshot.cn/docs/guide/agent-support" },
  { id: "glm", label: "GLM (ZhiPu)", baseUrl: "https://api.z.ai/api/anthropic", docUrl: "https://docs.z.ai/devpack/tool/claude" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api", docUrl: "https://openrouter.ai/docs/guides/coding-agents/claude-code-integration" },
  { id: "tencent", label: "Tencent Coding Plan", baseUrl: "https://api.lkeap.cloud.tencent.com/coding/anthropic", docUrl: "https://cloud.tencent.com/document/product/1772/128951" },
  { id: "poe", label: "POE", baseUrl: "https://api.poe.com", docUrl: "https://creator.poe.com/docs/external-applications/claude-code" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", docUrl: "https://api-docs.deepseek.com/guides/anthropic_api" },
  { id: "alibaba", label: "Alibaba Coding Plan", baseUrl: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic", docUrl: "https://www.alibabacloud.com/help/en/model-studio/claude-code-coding-plan" },
  { id: "alibaba_cn", label: "Alibaba Coding Plan (CN)", baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic", docUrl: "https://help.aliyun.com/zh/model-studio/claude-code-coding-plan" },
  { id: "bailing", label: "BaiLing", baseUrl: "https://api.tbox.cn/api/anthropic", docUrl: "https://alipaytbox.yuque.com/sxs0ba/ling/best_practices_claudecode" },
  { id: "nanogpt", label: "NanoGPT", baseUrl: "https://nano-gpt.com/api/v1", docUrl: "https://docs.nano-gpt.com/integrations/claude-code#manual-configuration-all-platforms" },
  { id: "zhipu_cn", label: "ZhiPu (CN)", baseUrl: "https://open.bigmodel.cn/api/anthropic", docUrl: "https://docs.bigmodel.cn/cn/coding-plan/tool/claude" },
  { id: "ollama", label: "Ollama (Local)", baseUrl: "http://localhost:11434", docUrl: "https://docs.ollama.com/integrations/claude-code" },
  { id: "custom", label: "Custom", baseUrl: "", docUrl: "" },
] as const;

const COMPAT_SLOTS = [
  "claude_compatible", "claude_compat_2", "claude_compat_3", "claude_compat_4", "claude_compat_5",
  "claude_compat_6", "claude_compat_7", "claude_compat_8", "claude_compat_9", "claude_compat_10",
] as const;

/* ------------------------------------------------------------------ */
/*  Shared                                                             */
/* ------------------------------------------------------------------ */

const INPUT_CLS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground";

interface ModelManagementProps {
  connectors: ProfileSnapshot["connectors"];
  locale: AppLocale;
  onSaved: () => Promise<void>;
}

interface ModelEntry {
  id: string;
  label: string;
  enabled: boolean;
}

type ConnectorStatus = ProfileSnapshot["connectors"][number]["status"];

function parseEnvValue(text: string, key: string): string {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : "";
}

/* ------------------------------------------------------------------ */
/*  StatusBadge                                                        */
/* ------------------------------------------------------------------ */

function StatusBadge({ status, zh }: { status: ConnectorStatus; zh: boolean }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-muted px-2 py-0.5 text-[11px] font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {zh ? "就绪" : "Ready"}
      </span>
    );
  }
  if (status === "not_installed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        {zh ? "未安装" : "Not installed"}
      </span>
    );
  }
  if (status === "auth_required") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        {zh ? "需登录" : "Auth required"}
      </span>
    );
  }
  if (status === "detected" || (status as string) === "checking") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground border-t-primary" />
        {zh ? "检测中" : "Checking"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-caution-muted px-2 py-0.5 text-[11px] font-medium text-caution">
      <span className="h-1.5 w-1.5 rounded-full bg-caution" />
      {status.replaceAll("_", " ")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  ProviderCard                                                       */
/* ------------------------------------------------------------------ */

function ProviderCard({
  title,
  badge,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  badge: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-3 transition hover:bg-muted/50"
      >
        <div className="flex items-center gap-2.5">
          {expanded ? (
            <CaretDown size={14} className="text-muted-foreground" />
          ) : (
            <CaretRight size={14} className="text-muted-foreground" />
          )}
          <span className="text-[13px] font-semibold text-foreground">{title}</span>
        </div>
        {badge}
      </button>
      {expanded && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toggle switch                                                      */
/* ------------------------------------------------------------------ */

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-success" : "bg-muted-foreground/30"}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-[3px]"}`}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Model toggle list                                                  */
/* ------------------------------------------------------------------ */

function ModelToggleList({
  models,
  onToggle,
  onRemove,
  canRemove,
  zh,
}: {
  models: ModelEntry[];
  onToggle: (id: string) => void;
  onRemove?: (id: string) => void;
  canRemove: boolean;
  zh: boolean;
}) {
  if (models.length === 0) {
    return (
      <div className="text-[12px] text-muted-foreground">
        {zh ? "暂无模型" : "No models available"}
      </div>
    );
  }
  const enabledCount = models.filter((m) => m.enabled).length;
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">
        {zh ? "模型" : "Models"} ({enabledCount}/{models.length} {zh ? "已启用" : "enabled"})
      </div>
      <div className="space-y-1">
        {models.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2"
          >
            <div className="flex items-center gap-2.5">
              <ToggleSwitch
                checked={m.enabled}
                onChange={() => onToggle(m.id)}
                label={`${m.enabled ? "Disable" : "Enable"} ${m.label}`}
              />
              <span
                className={`text-[12px] ${m.enabled ? "text-foreground" : "text-muted-foreground line-through"}`}
              >
                {m.label}
              </span>
            </div>
            {canRemove && onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(m.id)}
                className="text-muted-foreground transition hover:text-destructive"
                aria-label={`Remove ${m.label}`}
              >
                <XIcon size={12} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Native provider card (Claude Code / Codex / Gemini)                */
/* ------------------------------------------------------------------ */

function NativeProviderCard({
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

/* ------------------------------------------------------------------ */
/*  Compatible provider card                                           */
/* ------------------------------------------------------------------ */

function CompatProviderCard({
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
  }, [connector?.id, connector?.model]);

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
      await window.agentCompany.testConnector(slotId);
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

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ModelManagement({
  connectors,
  locale,
  onSaved,
}: ModelManagementProps) {
  const zh = locale === "zh";
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const claudeConnector = connectors.find((c) => c.id === "claude_local");
  const codexConnector = connectors.find((c) => c.id === "codex_local");
  const geminiConnector = connectors.find((c) => c.id === "gemini_local");

  const activeCompatSlots = COMPAT_SLOTS.filter((id) => {
    const c = connectors.find((conn) => conn.id === id);
    return (
      c &&
      (c.envBindingText.includes("ANTHROPIC_BASE_URL") ||
        c.envBindingText.includes("ANTHROPIC_API_KEY"))
    );
  });
  const nextAvailableSlot =
    COMPAT_SLOTS.find((id) => !activeCompatSlots.includes(id)) ?? null;
  const visibleCompatSlots = [...activeCompatSlots];
  if (nextAvailableSlot && !visibleCompatSlots.includes(nextAvailableSlot)) {
    visibleCompatSlots.push(nextAvailableSlot);
  }

  const toggle = (card: string) =>
    setExpandedCard((prev) => (prev === card ? null : card));

  return (
    <div className="space-y-3">
      {claudeConnector ? (
        <NativeProviderCard
          connector={claudeConnector}
          zh={zh}
          onSaved={onSaved}
          expanded={expandedCard === "claude_local"}
          onToggle={() => toggle("claude_local")}
        />
      ) : null}

      {codexConnector ? (
        <NativeProviderCard
          connector={codexConnector}
          zh={zh}
          onSaved={onSaved}
          expanded={expandedCard === "codex_local"}
          onToggle={() => toggle("codex_local")}
        />
      ) : null}

      {geminiConnector ? (
        <NativeProviderCard
          connector={geminiConnector}
          zh={zh}
          onSaved={onSaved}
          expanded={expandedCard === "gemini_local"}
          onToggle={() => toggle("gemini_local")}
        />
      ) : null}

      {visibleCompatSlots.map((slotId) => (
        <CompatProviderCard
          key={slotId}
          slotId={slotId}
          connector={connectors.find((c) => c.id === slotId) ?? null}
          zh={zh}
          onSaved={onSaved}
          expanded={expandedCard === slotId}
          onToggle={() => toggle(slotId)}
          onCleared={() => setExpandedCard(null)}
        />
      ))}
    </div>
  );
}
