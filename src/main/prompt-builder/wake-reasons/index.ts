import type { AppLocale } from "@shared/locale";
import { resolveLocale } from "../messages/locale";
import type { WakeReason, WakeReasonEntry, WakeReasonVars } from "./en";
import { WAKE_REASONS } from "./en";
import { WAKE_REASONS_ZH, FALLBACK_ZH, ACTION_REQUIRED_ZH } from "./zh";

export type { WakeReason, WakeReasonEntry, WakeReasonVars };

const BUNDLES: Record<AppLocale, Record<WakeReason, WakeReasonEntry>> = {
  en: WAKE_REASONS,
  zh: WAKE_REASONS_ZH,
};

const FALLBACKS: Record<AppLocale, (reason: string) => string> = {
  en: (reason) => `Trigger: ${reason}\nAction required: Check your standup briefing and messages for context on why you were woken.`,
  zh: FALLBACK_ZH,
};

const ACTION_REQUIRED_LABEL: Record<AppLocale, string> = {
  en: "Action required:",
  zh: ACTION_REQUIRED_ZH,
};

export function renderWakeReason(
  reason: string,
  vars: WakeReasonVars,
  locale?: AppLocale,
): string {
  const lang = resolveLocale(locale);
  const entry = BUNDLES[lang][reason as WakeReason];
  if (!entry) return FALLBACKS[lang](reason);
  const steps = entry.steps(vars)
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");
  return `${entry.title}\n${ACTION_REQUIRED_LABEL[lang]}\n${steps}`;
}
