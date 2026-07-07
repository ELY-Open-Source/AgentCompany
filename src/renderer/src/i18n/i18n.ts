import { zh } from "./zh";

/**
 * UI strings ship in English and the English source string is the key —
 * the Chinese dictionary maps it to its translation, and a missing entry
 * renders the English source. The language is fixed per process (changing
 * it relaunches the app), injected synchronously through preload argv so
 * the first paint is already in the right language.
 */
const language: "en" | "zh" =
  typeof window !== "undefined" && window.agentCompany ? window.agentCompany.language : "en";

export function t(source: string, vars?: Record<string, string | number>): string {
  const template = language === "zh" ? zh[source] ?? source : source;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match: string, name: string) => String(vars[name] ?? ""));
}
