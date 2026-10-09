import { RISK_LEVEL, type RiskLevel } from "../../../../shared/domain";
import { t } from "../../i18n/i18n";

/** How each risk level is labelled and coloured on approval cards and dialogs. */
export const RISK_TONES: Record<RiskLevel, { label: string; color: string }> = {
  [RISK_LEVEL.HIGH]: { label: t("High risk"), color: "var(--red)" },
  [RISK_LEVEL.MEDIUM]: { label: t("Medium risk"), color: "var(--amber)" },
  [RISK_LEVEL.LOW]: { label: t("Low risk"), color: "var(--text-3)" },
};
