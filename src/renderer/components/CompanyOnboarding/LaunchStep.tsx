import { motion } from "framer-motion";
import { CheckCircle, Rocket } from "@phosphor-icons/react";
import type { OnboardingBootstrapResult, ProfileSnapshot } from "@shared/types";
import { ActionButton } from "../ui";

interface LaunchStepProps {
  launchSummary: OnboardingBootstrapResult;
  selectedConnector: ProfileSnapshot["connectors"][number] | null;
  onFinish: () => void;
  loading: boolean;
  error: string | null;
  t: (key: string) => string;
}

export function LaunchStep({
  launchSummary,
  selectedConnector,
  onFinish,
  loading,
  error,
  t,
}: LaunchStepProps) {
  return (
    <motion.div
      key="launch"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
      className="surface w-full rounded-[8px] p-7"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--success-soft)] text-[color:var(--success)]">
        <CheckCircle size={24} weight="fill" />
      </div>
      <h2 className="mt-5 text-[28px] tracking-[-0.03em] text-[color:var(--text)]">
        {launchSummary.companyName} {t("onboarding.isLive")}
      </h2>
      <p className="mt-3 text-[14px] leading-relaxed text-[color:var(--muted)]">
        {launchSummary.runId ? t("onboarding.launchDescription") : t("onboarding.launchDescriptionDeferred")}
      </p>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("onboarding.connector")}</div>
          <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
            {selectedConnector?.label ?? t("onboarding.unavailable")}
          </div>
        </div>
        <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("onboarding.leadAgent")}</div>
          <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
            {launchSummary.leadAgentId ? t("onboarding.ceoAgentCreated") : t("onboarding.leadAgentUnavailable")}
          </div>
        </div>
        <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("onboarding.primaryWorkspace")}</div>
          <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
            {launchSummary.workspaceId ? t("onboarding.registered") : t("onboarding.notBound")}
          </div>
        </div>
        <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("onboarding.kickoffProject")}</div>
          <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
            {launchSummary.projectId ? t("onboarding.created") : t("onboarding.unavailable")}
          </div>
        </div>
        <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("onboarding.initialRun")}</div>
          <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
            {launchSummary.runId ? t("onboarding.queuedInOrchestration") : t("onboarding.deferredUntilReady")}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-[8px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
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
