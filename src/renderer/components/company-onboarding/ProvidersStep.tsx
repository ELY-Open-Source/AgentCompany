import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, FloppyDisk, SignIn } from "@phosphor-icons/react";
import { ActionButton } from "../ui";
import {
  CompatProviderCard,
  InstallBlock,
  ProviderCard,
  StatusBadge,
  INPUT_CLS,
} from "./ProvidersStepShared";
import { getStepNumber, TOTAL_STEPS } from "./OnboardingHero";
import { useOnboarding } from "./OnboardingContext";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ProvidersStepProps {
  onContinue: () => void;
  onBack: () => void;
}

const COMPAT_SLOTS = ["claude_compatible", "claude_compat_2", "claude_compat_3", "claude_compat_4", "claude_compat_5", "claude_compat_6", "claude_compat_7", "claude_compat_8", "claude_compat_9", "claude_compat_10"] as const;

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ProvidersStep({ onContinue, onBack }: ProvidersStepProps) {
  const {
    connectors,
    onTestConnector,
    onSaveConnector,
    onLoginConnector,
    onInstallCommand,
    hasAtLeastOneReady,
    error,
    t,
  } = useOnboarding();

  const [expandedCard, setExpandedCard] = useState<string | null>("claude");

  const claudeConnector = connectors.find((c) => c.id === "claude_local");
  const codexConnector = connectors.find((c) => c.id === "codex_local");
  const geminiConnector = connectors.find((c) => c.id === "gemini_local");

  function parseEnvValue(envText: string, key: string): string {
    const line = envText.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1) : "";
  }

  const [claudeApiKey, setClaudeApiKey] = useState(() =>
    parseEnvValue(claudeConnector?.envBindingText ?? "", "ANTHROPIC_API_KEY"),
  );
  const [codexApiKey, setCodexApiKey] = useState(() =>
    parseEnvValue(codexConnector?.envBindingText ?? "", "OPENAI_API_KEY"),
  );

  const compatSlots = COMPAT_SLOTS.map((id) => connectors.find((c) => c.id === id));
  const activeCompatSlots = COMPAT_SLOTS.filter((id) => {
    const c = connectors.find((conn) => conn.id === id);
    return c && c.envBindingText.includes("ANTHROPIC_BASE_URL");
  });
  const nextAvailableSlot = COMPAT_SLOTS.find((id) => !activeCompatSlots.includes(id)) ?? null;
  const visibleCompatSlots = [...activeCompatSlots];
  if (nextAvailableSlot && !visibleCompatSlots.includes(nextAvailableSlot)) {
    visibleCompatSlots.push(nextAvailableSlot);
  }

  const claudeStatus = claudeConnector?.status ?? "not_installed";
  const codexStatus = codexConnector?.status ?? "not_installed";
  const geminiStatus = geminiConnector?.status ?? "not_installed";

  const toggle = (card: string) => setExpandedCard((prev) => (prev === card ? null : card));

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

  return (
    <motion.div
      key="providers"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="w-full rounded-lg border border-border bg-card p-7 shadow-sm"
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t("onboarding.stepLabelProviders")} {getStepNumber("providers")} / {TOTAL_STEPS}
      </div>
      <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-foreground">
        {t("onboarding.providersTitle")}
      </div>
      <div className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        {t("onboarding.providersSubtitle")}
      </div>
      <div className="mb-6 h-px bg-[color:var(--border)]" />

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
              commandKeyUnix="install_claude_unix"
              commandKeyWin32="install_claude_win32"
              onInstall={onInstallCommand}
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
              commandKeyUnix="install_codex"
              commandKeyWin32={null}
              onInstall={onInstallCommand}
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
              commandKeyUnix="install_gemini"
              commandKeyWin32={null}
              onInstall={onInstallCommand}
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

        {/* ---- Compatible API providers ---- */}
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

      {error ? (
        <div className="mt-5 rounded-lg border border-[color:var(--destructive)] bg-destructive-muted px-4 py-3 text-[13px] text-destructive">
          {error}
        </div>
      ) : null}

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
