import type { WakeReason, WakeReasonEntry, WakeReasonVars } from "./en";
import { WAKE_REASONS } from "./en";

export type { WakeReason, WakeReasonEntry, WakeReasonVars };

export function renderWakeReason(
  reason: string,
  vars: WakeReasonVars,
): string {
  const entry = WAKE_REASONS[reason as WakeReason];
  if (!entry) {
    return `Trigger: ${reason}\nAction required: Check your standup briefing and messages for context on why you were woken.`;
  }
  const steps = entry.steps(vars)
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");
  return `${entry.title}\nAction required:\n${steps}`;
}
