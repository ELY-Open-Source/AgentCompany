import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CaretDown,
  CaretRight,
  ArrowSquareOut,
  FloppyDisk,
  SignIn,
  Terminal,
} from "@phosphor-icons/react";
import type { ProfileSnapshot } from "@shared/types";
import { ActionButton } from "../ui";

/* ------------------------------------------------------------------ */
/*  Compatible-API provider presets                                    */
/* ------------------------------------------------------------------ */

const COMPATIBLE_PROVIDERS = [
  { id: "minimax", label: "MiniMax", baseUrl: "https://api.minimax.io/anthropic", docUrl: "https://platform.minimax.io/docs/token-plan/claude-code" },
  { id: "minimax_cn", label: "MiniMax (CN)", baseUrl: "https://api.minimaxi.com/anthropic", docUrl: "https://platform.minimax.io/docs/token-plan/claude-code" },
  { id: "kimi", label: "Kimi", baseUrl: "https://api.kimi.com/coding/", docUrl: "https://www.kimi.com/code/docs/en/more/third-party-agents.html" },
  { id: "kimi_cn", label: "Kimi CN", baseUrl: "https://api.moonshot.cn/anthropic", docUrl: "https://platform.moonshot.cn/docs/guide/agent-support#macos-%E5%92%8C-linux-1" },
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

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ProvidersStepProps {
  connectors: ProfileSnapshot["connectors"];
  onTestConnector: (connectorId: string) => void;
  onSaveConnector: (connectorId: string, envBindingText: string, model: string | null, notes?: string) => void;
  onLoginConnector: (connectorId: string) => void;
  onInstallCommand: (title: string, command: string) => void;
  hasAtLeastOneReady: boolean;
  onContinue: () => void;
  onBack: () => void;
  error: string | null;
  t: (key: string) => string;
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

type ConnectorStatus = ProfileSnapshot["connectors"][number]["status"];

function StatusBadge({ status, t }: { status: ConnectorStatus; t: (key: string) => string }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-muted px-2 py-0.5 text-[11px] font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {t("onboarding.providerReady")}
      </span>
    );
  }
  if (status === "not_installed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        {t("onboarding.providerNotInstalled")}
      </span>
    );
  }
  if (status === "auth_required") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        {t("onboarding.providerAuthRequired")}
      </span>
    );
  }
  if (status === "detected" || status === "checking" as string) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground border-t-primary" />
        {t("onboarding.providerChecking")}
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
/*  Shared input class                                                 */
/* ------------------------------------------------------------------ */

const INPUT_CLS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground";

/* ------------------------------------------------------------------ */
/*  Provider card wrapper                                              */
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
          {expanded ? <CaretDown size={14} className="text-muted-foreground" /> : <CaretRight size={14} className="text-muted-foreground" />}
          <span className="text-[13px] font-semibold text-foreground">{title}</span>
        </div>
        {badge}
      </button>
      {expanded && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Install snippet                                                    */
/* ------------------------------------------------------------------ */

function InstallBlock({
  macLinuxCmd,
  windowsCmd,
  onInstall,
  title,
  t,
}: {
  macLinuxCmd: string;
  windowsCmd: string | null;
  onInstall: (title: string, command: string) => void;
  title: string;
  t: (key: string) => string;
}) {
  const platform = window.agentCompany?.platform ?? "linux";
  const isWindows = platform === "win32";
  const cmd = isWindows && windowsCmd ? windowsCmd : macLinuxCmd;

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-muted-foreground">{t("onboarding.providerInstall")}</div>
      {!isWindows && (
        <div className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[12px] text-foreground">
          {macLinuxCmd}
        </div>
      )}
      {isWindows && windowsCmd && (
        <div className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[12px] text-foreground">
          {windowsCmd}
        </div>
      )}
      <button
        type="button"
        onClick={() => onInstall(title, cmd)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted"
      >
        <Terminal size={14} />
        {t("onboarding.providerInstall")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Compatible provider card (one per slot)                            */
/* ------------------------------------------------------------------ */

function CompatProviderCard({
  slotId,
  connector,
  claudeInstalled,
  onSaveConnector,
  onInstallCommand,
  expanded,
  onToggle,
  t,
}: {
  slotId: string;
  connector: ProfileSnapshot["connectors"][number] | null;
  claudeInstalled: boolean;
  onSaveConnector: ProvidersStepProps["onSaveConnector"];
  onInstallCommand: ProvidersStepProps["onInstallCommand"];
  expanded: boolean;
  onToggle: () => void;
  t: (key: string) => string;
}) {
  function parseEnv(text: string, key: string): string {
    const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1) : "";
  }

  const [selectedProvider, setSelectedProvider] = useState<string>(() => {
    const saved = connector?.notes ?? "";
    const match = COMPATIBLE_PROVIDERS.find((p) => p.label === saved);
    return match?.id ?? COMPATIBLE_PROVIDERS[0].id;
  });
  const [apiKey, setApiKey] = useState(() => parseEnv(connector?.envBindingText ?? "", "ANTHROPIC_API_KEY"));
  const [baseUrl, setBaseUrl] = useState<string>(() =>
    parseEnv(connector?.envBindingText ?? "", "ANTHROPIC_BASE_URL") || COMPATIBLE_PROVIDERS[0].baseUrl,
  );
  const [models, setModels] = useState<string[]>(() => {
    const raw = connector?.model ?? "";
    return raw.split(",").map((m) => m.trim()).filter(Boolean);
  });
  const [newModel, setNewModel] = useState("");

  const status = connector?.status ?? "not_installed";
  const providerLabel = COMPATIBLE_PROVIDERS.find((p) => p.id === selectedProvider)?.label ?? t("onboarding.claudeCompatibleLabel");
  const displayTitle = connector?.notes || providerLabel;

  function handleProviderChange(providerId: string) {
    setSelectedProvider(providerId);
    const provider = COMPATIBLE_PROVIDERS.find((p) => p.id === providerId);
    if (provider) setBaseUrl(provider.baseUrl);
  }

  function handleSave() {
    const lines: string[] = [];
    if (apiKey.trim()) lines.push(`ANTHROPIC_API_KEY=${apiKey.trim()}`);
    if (baseUrl.trim()) lines.push(`ANTHROPIC_BASE_URL=${baseUrl.trim()}`);
    const label = COMPATIBLE_PROVIDERS.find((p) => p.id === selectedProvider)?.label ?? "";
    const modelsCsv = models.join(",") || null;
    onSaveConnector(slotId, lines.join("\n"), modelsCsv, label);
  }

  function addModel() {
    const trimmed = newModel.trim();
    if (!trimmed) return;
    setModels((prev) => {
      if (prev.includes(trimmed)) return prev;
      return [...prev, trimmed];
    });
    setNewModel("");
  }

  const selectedProviderData = COMPATIBLE_PROVIDERS.find((p) => p.id === selectedProvider);

  return (
    <ProviderCard
      title={displayTitle}
      badge={<StatusBadge status={status} t={t} />}
      expanded={expanded}
      onToggle={onToggle}
    >
      {!claudeInstalled && (
        <InstallBlock
          macLinuxCmd="curl -fsSL https://claude.ai/install.sh | bash"
          windowsCmd="irm https://claude.ai/install.ps1 | iex"
          onInstall={onInstallCommand}
          title="Install Claude Code"
          t={t}
        />
      )}

      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
          {t("onboarding.providerSelectProvider")}
        </label>
        <select
          className={INPUT_CLS}
          value={selectedProvider}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          {COMPATIBLE_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id} className="bg-card text-foreground">{p.label}</option>
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
          {t("onboarding.providerViewDocs")}
        </button>
      ) : null}

      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">{t("onboarding.providerApiKey")}</label>
        <input type="password" className={INPUT_CLS} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
      </div>

      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">{t("onboarding.providerBaseUrl")}</label>
        <input className={INPUT_CLS} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
      </div>

      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">{t("onboarding.providerModel")}</label>
        {models.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {models.map((m) => (
              <span key={m} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[12px] text-foreground">
                {m}
                <button type="button" onClick={() => setModels(models.filter((x) => x !== m))} className="ml-0.5 text-muted-foreground hover:text-destructive">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className={INPUT_CLS}
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder="model-name"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModel(); } }}
          />
          <button
            type="button"
            onClick={addModel}
            disabled={!newModel.trim()}
            className="shrink-0 rounded-lg border border-border bg-card px-3 py-2 text-[12px] font-medium text-foreground transition hover:bg-muted disabled:opacity-40"
          >+</button>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted"
      >
        <FloppyDisk size={14} />
        {t("onboarding.providerSaveCheck")}
      </button>
    </ProviderCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ProvidersStep({
  connectors,
  onTestConnector,
  onSaveConnector,
  onLoginConnector,
  onInstallCommand,
  hasAtLeastOneReady,
  onContinue,
  onBack,
  error,
  t,
}: ProvidersStepProps) {
  // Expansion state
  const [expandedCard, setExpandedCard] = useState<string | null>("claude");

  // Connector lookups
  const claudeConnector = connectors.find((c) => c.id === "claude_local");
  const codexConnector = connectors.find((c) => c.id === "codex_local");
  const geminiConnector = connectors.find((c) => c.id === "gemini_local");
  const compatConnector = connectors.find((c) => c.id === "claude_compatible");

  // Parse env bindings from connector data for form initialization
  function parseEnvValue(envText: string, key: string): string {
    const line = envText.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1) : "";
  }

  // Claude Code (Official) form — init from saved connector data
  const [claudeApiKey, setClaudeApiKey] = useState(() =>
    parseEnvValue(claudeConnector?.envBindingText ?? "", "ANTHROPIC_API_KEY"),
  );

  // Codex form
  const [codexApiKey, setCodexApiKey] = useState(() =>
    parseEnvValue(codexConnector?.envBindingText ?? "", "OPENAI_API_KEY"),
  );

  // Compatible API slots
  const COMPAT_SLOTS = ["claude_compatible", "claude_compat_2", "claude_compat_3", "claude_compat_4", "claude_compat_5", "claude_compat_6", "claude_compat_7", "claude_compat_8", "claude_compat_9", "claude_compat_10"] as const;
  const compatSlots = COMPAT_SLOTS.map((id) => connectors.find((c) => c.id === id));
  // A slot is "active" if it has been configured (has ANTHROPIC_BASE_URL)
  const activeCompatSlots = COMPAT_SLOTS.filter((id) => {
    const c = connectors.find((conn) => conn.id === id);
    return c && c.envBindingText.includes("ANTHROPIC_BASE_URL");
  });
  const nextAvailableSlot = COMPAT_SLOTS.find((id) => !activeCompatSlots.includes(id)) ?? null;
  // Always show active slots + the first empty slot for adding
  const visibleCompatSlots = [...activeCompatSlots];
  if (nextAvailableSlot && !visibleCompatSlots.includes(nextAvailableSlot)) {
    visibleCompatSlots.push(nextAvailableSlot);
  }

  const claudeStatus = claudeConnector?.status ?? "not_installed";
  const codexStatus = codexConnector?.status ?? "not_installed";
  const geminiStatus = geminiConnector?.status ?? "not_installed";

  const toggle = (card: string) => setExpandedCard((prev) => (prev === card ? null : card));

  /* ------ save helpers ------ */

  function handleClaudeSave() {
    const lines: string[] = [];
    if (claudeApiKey.trim()) lines.push(`ANTHROPIC_API_KEY=${claudeApiKey.trim()}`);
    onSaveConnector("claude_local", lines.join("\n"), null);
  }

  function handleCodexSave() {
    const lines: string[] = [];
    if (codexApiKey.trim()) lines.push(`OPENAI_API_KEY=${codexApiKey.trim()}`);
    onSaveConnector("codex_local", lines.join("\n"), null);
  }

  function openExternalDoc(url: string) {
    window.open(url, "_blank");
  }

  return (
    <motion.div
      key="providers"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="w-full rounded-lg border border-border bg-card p-7 shadow-sm"
    >
      {/* Step label */}
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t("onboarding.stepLabel1")} 2 / 5 — {t("onboarding.providersStep")}
      </div>
      <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-foreground">
        {t("onboarding.providersTitle")}
      </div>
      <div className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        {t("onboarding.providersSubtitle")}
      </div>
      <div className="mb-6 h-px bg-[color:var(--border)]" />

      {/* Provider cards */}
      <div className="space-y-3">

        {/* ---- Card 1: Claude Code (Official) ---- */}
        <ProviderCard
          title={t("onboarding.claudeCodeLabel")}
          badge={<StatusBadge status={claudeStatus} t={t} />}
          expanded={expandedCard === "claude"}
          onToggle={() => toggle("claude")}
        >
          {claudeStatus === "not_installed" && (
            <InstallBlock
              macLinuxCmd="curl -fsSL https://claude.ai/install.sh | bash"
              windowsCmd="irm https://claude.ai/install.ps1 | iex"
              onInstall={onInstallCommand}
              title="Install Claude Code"
              t={t}
            />
          )}

          <button
            type="button"
            onClick={() => onLoginConnector("claude_local")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted"
          >
            <SignIn size={14} />
            {t("onboarding.providerLogin")}
          </button>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
              {t("onboarding.providerApiKey")} <span className="font-normal">(optional)</span>
            </label>
            <input
              type="password"
              className={INPUT_CLS}
              value={claudeApiKey}
              onChange={(e) => setClaudeApiKey(e.target.value)}
              placeholder="sk-ant-..."
            />
          </div>

          <button
            type="button"
            onClick={handleClaudeSave}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted"
          >
            <FloppyDisk size={14} />
            {t("onboarding.providerSaveCheck")}
          </button>
        </ProviderCard>

        {/* ---- Card 2: Codex (Official) ---- */}
        <ProviderCard
          title={t("onboarding.codexLabel")}
          badge={<StatusBadge status={codexStatus} t={t} />}
          expanded={expandedCard === "codex"}
          onToggle={() => toggle("codex")}
        >
          {codexStatus === "not_installed" && (
            <InstallBlock
              macLinuxCmd="npm i -g @openai/codex"
              windowsCmd={null}
              onInstall={onInstallCommand}
              title="Install Codex"
              t={t}
            />
          )}

          <button
            type="button"
            onClick={() => onLoginConnector("codex_local")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted"
          >
            <SignIn size={14} />
            {t("onboarding.providerLogin")}
          </button>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
              {t("onboarding.providerApiKey")} (OPENAI_API_KEY)
            </label>
            <input
              type="password"
              className={INPUT_CLS}
              value={codexApiKey}
              onChange={(e) => setCodexApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>

          <button
            type="button"
            onClick={handleCodexSave}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted"
          >
            <FloppyDisk size={14} />
            {t("onboarding.providerSaveCheck")}
          </button>
        </ProviderCard>

        {/* ---- Card 3: Gemini CLI (Official) ---- */}
        <ProviderCard
          title={t("onboarding.geminiLabel")}
          badge={<StatusBadge status={geminiStatus} t={t} />}
          expanded={expandedCard === "gemini"}
          onToggle={() => toggle("gemini")}
        >
          {geminiStatus === "not_installed" && (
            <InstallBlock
              macLinuxCmd="npm install -g @google/gemini-cli"
              windowsCmd={null}
              onInstall={onInstallCommand}
              title="Install Gemini CLI"
              t={t}
            />
          )}

          <button
            type="button"
            onClick={() => onLoginConnector("gemini_local")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted"
          >
            <SignIn size={14} />
            {t("onboarding.providerLogin")}
          </button>

          <button
            type="button"
            onClick={() => onTestConnector("gemini_local")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted"
          >
            <FloppyDisk size={14} />
            {t("onboarding.providerCheck")}
          </button>
        </ProviderCard>

        {/* ---- Compatible API providers (up to 3 slots) ---- */}
        {visibleCompatSlots.map((slotId) => (
          <CompatProviderCard
            key={slotId}
            slotId={slotId}
            connector={compatSlots[COMPAT_SLOTS.indexOf(slotId)] ?? null}
            claudeInstalled={claudeStatus !== "not_installed"}
            onSaveConnector={onSaveConnector}
            onInstallCommand={onInstallCommand}
            expanded={expandedCard === slotId}
            onToggle={() => toggle(slotId)}
            t={t}
          />
        ))}
      </div>

      {/* Error message */}
      {error ? (
        <div className="mt-5 rounded-lg border border-[color:var(--destructive)] bg-destructive-muted px-4 py-3 text-[13px] text-destructive">
          {error}
        </div>
      ) : null}

      {/* Bottom bar */}
      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          {t("onboarding.back")}
        </button>

        <div className="flex items-center gap-4">
          {!hasAtLeastOneReady && (
            <span className="text-[12px] text-muted-foreground">
              {t("onboarding.providerAtLeastOne")}
            </span>
          )}
          <ActionButton
            label={t("onboarding.continue")}
            onClick={onContinue}
            icon={ArrowRight}
            tone="accent"
            disabled={!hasAtLeastOneReady}
          />
        </div>
      </div>
    </motion.div>
  );
}
