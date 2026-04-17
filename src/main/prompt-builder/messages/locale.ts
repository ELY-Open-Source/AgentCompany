import type { AppLocale } from "@shared/locale";

/**
 * Normalize an optional incoming locale into one of the bundled locales.
 * Anything other than the explicit "zh" variant falls back to "en", matching
 * the rest of the prompt builder's behavior.
 */
export function resolveLocale(locale: AppLocale | undefined): AppLocale {
  return locale === "zh" ? "zh" : "en";
}
