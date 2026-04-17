import { motion } from "framer-motion";
import { CheckCircle, Rocket } from "../ui/icons";
import { ActionButton } from "../ui";
import {
  useOnboardingConnectors,
  useOnboardingWizard,
} from "./OnboardingContext";

interface LaunchStepProps {
  onFinish: () => void;
}

export function LaunchStep({ onFinish }: LaunchStepProps) {
  const { launchSummary, loading, error, t } = useOnboardingWizard();
  const { selectedConnector } = useOnboardingConnectors();

  if (!launchSummary) return null;

  return (
    <motion.div
      key="launch"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
      className="bg-card border border-border shadow-sm w-full rounded-lg p-7"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-muted text-success">
        <CheckCircle size={24} weight="fill" />
      </div>
      <h2 className="mt-5 text-[28px] tracking-[-0.03em] text-foreground">
        {launchSummary.companyName} {t("onboarding.isLive")}
      </h2>
      <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
        {launchSummary.runId ? t("onboarding.launchDescription") : t("onboarding.launchDescriptionDeferred")}
      </p>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-muted px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("onboarding.connector")}</div>
          <div className="mt-1 text-[13px] font-medium text-foreground">
            {selectedConnector?.label ?? t("onboarding.unavailable")}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("onboarding.leadAgent")}</div>
          <div className="mt-1 text-[13px] font-medium text-foreground">
            {launchSummary.leadAgentId ? t("onboarding.ceoAgentCreated") : t("onboarding.leadAgentUnavailable")}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("onboarding.primaryWorkspace")}</div>
          <div className="mt-1 text-[13px] font-medium text-foreground">
            {launchSummary.workspaceId ? t("onboarding.registered") : t("onboarding.notBound")}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("onboarding.kickoffProject")}</div>
          <div className="mt-1 text-[13px] font-medium text-foreground">
            {launchSummary.projectId ? t("onboarding.created") : t("onboarding.unavailable")}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("onboarding.initialRun")}</div>
          <div className="mt-1 text-[13px] font-medium text-foreground">
            {launchSummary.runId ? t("onboarding.queuedInOrchestration") : t("onboarding.deferredUntilReady")}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-lg border border-[color:var(--destructive)] bg-destructive-muted px-4 py-3 text-[13px] text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-8 flex items-center justify-end">
        <ActionButton
          label={loading ? t("onboarding.opening") : t("onboarding.openControlCenter")}
          onClick={onFinish}
          icon={Rocket}
          tone="accent"
          loading={loading}
        />
      </div>
    </motion.div>
  );
}
