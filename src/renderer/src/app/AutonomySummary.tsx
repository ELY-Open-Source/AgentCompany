import { COMPANY_PRESETS } from "../../../shared/company-presets";
import { t } from "../i18n/i18n";

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;
const RISK_NAMES = { low: () => t("Low"), medium: () => t("Medium"), high: () => t("High") };

/** Everything a mode decides and everything both modes preset, read from the same values the company is created with. */
export function AutonomySummary({ mode }: { mode: "ai_ceo" | "ai_cofounder" }) {
  const gated = { level: RISK_NAMES[COMPANY_PRESETS.taskRiskCeiling](), amount: dollars(COMPANY_PRESETS.hireReviewAboveCents) };
  return (
    <section aria-label={t("What this mode allows")} style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.6 }}>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li>{mode === "ai_ceo"
          ? t("Approved without you: tasks above {level} risk, tasks that run commands in a workspace, and hires over {amount} a month.", gated)
          : t("Waiting for you: tasks above {level} risk, tasks that run commands in a workspace, and hires over {amount} a month.", gated)}</li>
        <li>{mode === "ai_ceo"
          ? t("Deliverables are written without review.")
          : t("Deliverables wait for your review before they are written.")}</li>
        <li>{t("The CEO starts with a {ceo} monthly budget, and each agent it hires gets {hire}.", { ceo: dollars(COMPANY_PRESETS.ceoBudgetCents), hire: dollars(COMPANY_PRESETS.agentHireBudgetCents) })}</li>
        <li>{t("Each department holds up to {count} agents and {amount} a month in agent budgets.", { count: COMPANY_PRESETS.departmentHeadcount, amount: dollars(COMPANY_PRESETS.departmentBudgetCents) })}</li>
        <li>{t("Each provider allows {count} model calls a month.", { count: COMPANY_PRESETS.providerMonthlyRequests.toLocaleString("en-US") })}</li>
        <li>{t("An approved workspace task runs commands with your user's file access; they are not confined to the workspace folder.")}</li>
        <li>{t("Later you can change the mode, hire approval and deliverable review in Settings, General; provider limits in Settings, Providers; and agent budgets on Team.")}</li>
      </ul>
    </section>
  );
}
