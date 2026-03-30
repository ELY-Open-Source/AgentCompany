import { motion } from "framer-motion";
import {
  CheckCircle,
  XCircle,
  ArrowRight,
  ArrowCounterClockwise,
  Terminal,
} from "@phosphor-icons/react";
import { ActionButton } from "../ui";

interface NodeCheckStepProps {
  nodeStatus: { installed: boolean; version: string | null } | null;
  checking: boolean;
  onCheck: () => void;
  onInstall: (command: string) => void;
  onContinue: () => void;
  onBack: () => void;
  t: (key: string) => string;
}

const INSTALL_COMMANDS: Record<string, { label: string; code: string; command: string }> = {
  darwin: {
    label: "macOS",
    code: "brew install node@22",
    command: "brew install node@22",
  },
  win32: {
    label: "Windows",
    code: "winget install -e --id OpenJS.NodeJS.LTS",
    command: "winget install -e --id OpenJS.NodeJS.LTS",
  },
  linux: {
    label: "Linux",
    code: `# Download and install nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash

# in lieu of restarting the shell
\\. "$HOME/.nvm/nvm.sh"

# Download and install Node.js:
nvm install 22

# Verify the Node.js version:
node -v`,
    command: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash && \\. "$HOME/.nvm/nvm.sh" && nvm install 22`,
  },
};

export function NodeCheckStep({
  nodeStatus,
  checking,
  onCheck,
  onInstall,
  onContinue,
  onBack,
  t,
}: NodeCheckStepProps) {
  const platform = window.agentCompany.platform;
  const platformInfo = INSTALL_COMMANDS[platform] ?? INSTALL_COMMANDS.linux;

  return (
    <motion.div
      key="nodecheck"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="bg-card border border-border shadow-sm w-full rounded-lg p-7"
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t("onboarding.stepLabel1")} 1 / 5 — {t("onboarding.nodeCheckStep")}
      </div>
      <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-foreground">
        {t("onboarding.nodeCheckTitle")}
      </div>
      <div className="mb-6 h-px bg-[color:var(--border)]" />

      {/* Status */}
      <div className="mb-5 flex items-center gap-2.5 text-[13px]">
        {checking ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
        ) : nodeStatus?.installed ? (
          <CheckCircle size={18} weight="fill" className="shrink-0 text-success" />
        ) : nodeStatus ? (
          <XCircle size={18} weight="fill" className="shrink-0 text-destructive" />
        ) : null}

        {checking ? (
          <span className="text-muted-foreground">{t("onboarding.providerChecking")}...</span>
        ) : nodeStatus?.installed ? (
          <span className="font-medium text-success">
            {t("onboarding.nodeInstalled").replace("{version}", nodeStatus.version ?? "")}
          </span>
        ) : nodeStatus ? (
          <span className="font-medium text-destructive">
            {t("onboarding.nodeNotInstalled")}
          </span>
        ) : null}
      </div>

      {/* Platform-specific install instructions (shown when not installed) */}
      {nodeStatus && !nodeStatus.installed && (
        <div className="mb-5 space-y-3">
          <div className="text-[12px] font-medium text-muted-foreground">
            {platformInfo.label}
          </div>
          <pre className="bg-muted rounded-lg border border-border px-4 py-3 font-mono text-[12px] leading-relaxed text-foreground whitespace-pre-wrap">
            {platformInfo.code}
          </pre>
          <ActionButton
            label={t("onboarding.installNodeTerminal")}
            onClick={() => onInstall(platformInfo.command)}
            icon={Terminal}
          />
        </div>
      )}

      {/* Check Again */}
      <div className="mb-6">
        <ActionButton
          label={t("onboarding.checkAgain")}
          onClick={onCheck}
          icon={ArrowCounterClockwise}
        />
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          {t("onboarding.back")}
        </button>
        <ActionButton
          label={t("onboarding.continue")}
          onClick={onContinue}
          icon={ArrowRight}
          tone="accent"
          disabled={!nodeStatus?.installed}
        />
      </div>
    </motion.div>
  );
}
