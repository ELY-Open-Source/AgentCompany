import {
  CheckCircle,
  XCircle,
  ArrowRight,
  ArrowCounterClockwise,
  Terminal,
} from "../ui/icons";
import { ActionButton } from "../ui";
import type { TerminalCommandKey } from "@shared/contracts";
import { OnboardingStep } from "./OnboardingStep";
import { useOnboarding } from "./OnboardingContext";

interface NodeCheckStepProps {
  onContinue: () => void;
  onBack: () => void;
}

const INSTALL_COMMANDS: Record<string, { label: string; code: string; commandKey: TerminalCommandKey }> = {
  darwin: {
    label: "macOS",
    code: "brew install node@22",
    commandKey: "install_node_darwin",
  },
  win32: {
    label: "Windows",
    code: "winget install -e --id OpenJS.NodeJS.LTS",
    commandKey: "install_node_win32",
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
    commandKey: "install_node_linux",
  },
};

export function NodeCheckStep({ onContinue, onBack }: NodeCheckStepProps) {
  const { nodeStatus, nodeChecking, onCheckNode, onInstallCommand, t } = useOnboarding();
  const platform = window.agentCompany.platform;
  const platformInfo = INSTALL_COMMANDS[platform] ?? INSTALL_COMMANDS.linux;

  return (
    <OnboardingStep
      step="nodecheck"
      eyebrow={`${t("onboarding.stepLabel1")} — ${t("onboarding.nodeCheckStep")}`}
      title={t("onboarding.nodeCheckTitle")}
    >
      {/* Status */}
      <div className="mb-5 flex items-center gap-2.5 text-[13px]">
        {nodeChecking ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
        ) : nodeStatus?.installed ? (
          <CheckCircle size={18} weight="fill" className="shrink-0 text-success" />
        ) : nodeStatus ? (
          <XCircle size={18} weight="fill" className="shrink-0 text-destructive" />
        ) : null}

        {nodeChecking ? (
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
            onClick={() => onInstallCommand(platformInfo.commandKey)}
            icon={Terminal}
          />
        </div>
      )}

      {/* Check Again */}
      <div className="mb-6">
        <ActionButton
          label={t("onboarding.checkAgain")}
          onClick={onCheckNode}
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
    </OnboardingStep>
  );
}
