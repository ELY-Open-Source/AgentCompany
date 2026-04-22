export type WarningSuppressionCategory =
  | "node-sqlite-experimental-warning"
  | "electron-disposed-web-frame-send";

interface SuppressionRule<TInput> {
  category: WarningSuppressionCategory;
  reason: string;
  matches: (input: TInput) => boolean;
}

export const WARNING_SUPPRESSION_RULES: ReadonlyArray<SuppressionRule<unknown>> = [
  {
    category: "node-sqlite-experimental-warning",
    reason: "Node emits this before the local SQLite profile store can run; the runtime version pins the API surface.",
    matches: isSqliteExperimentalWarning,
  },
];

export const CONSOLE_ERROR_SUPPRESSION_RULES: ReadonlyArray<SuppressionRule<unknown[]>> = [
  {
    category: "electron-disposed-web-frame-send",
    reason: "Electron logs a send to a disposed renderer frame during close, reload, or HMR after the send has become a no-op.",
    matches: isDisposedWebFrameSend,
  },
];

export function classifyWarningSuppression(warning: unknown): WarningSuppressionCategory | null {
  return WARNING_SUPPRESSION_RULES.find((rule) => rule.matches(warning))?.category ?? null;
}

export function classifyConsoleErrorSuppression(args: unknown[]): WarningSuppressionCategory | null {
  return CONSOLE_ERROR_SUPPRESSION_RULES.find((rule) => rule.matches(args))?.category ?? null;
}

function isSqliteExperimentalWarning(warning: unknown): boolean {
  if (typeof warning === "string") {
    return /SQLite is an experimental feature/.test(warning);
  }
  if (warning instanceof Error) {
    return warning.name === "ExperimentalWarning" && /SQLite/.test(warning.message);
  }
  return false;
}

function isDisposedWebFrameSend(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const first = args[0];
  if (typeof first !== "string") return false;
  if (!first.startsWith("Error sending from webFrameMain")) return false;
  const payload = args[1];
  const message = payload instanceof Error ? payload.message : String(payload ?? "");
  return message.includes("Render frame was disposed");
}
