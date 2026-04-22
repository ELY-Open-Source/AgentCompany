import type { RunStatus, RunUsageStatus } from "@shared/types";

export type TerminalAssistantStopReason = "error" | "aborted";

export interface AssistantUsageProbe {
  role?: string;
  stopReason?: string;
  usage?: {
    input?: unknown;
    output?: unknown;
  };
}

export interface AttributableAssistantUsageProbe extends AssistantUsageProbe {
  role: "assistant";
  usage: {
    input: number;
    output: number;
  };
}

export interface RunUsageClassificationInput {
  runStatus: RunStatus;
  errorMessage: string | null;
  sawAttributableUsage: boolean;
  terminalStopReason: TerminalAssistantStopReason | null;
}

export function isTerminalAssistantStopReason(reason: string | undefined): reason is TerminalAssistantStopReason {
  return reason === "error" || reason === "aborted";
}

export function hasAttributableAssistantUsage(
  message: AssistantUsageProbe | undefined,
): message is AttributableAssistantUsageProbe {
  if (message?.role !== "assistant") return false;
  if (typeof message.usage?.input !== "number" || typeof message.usage.output !== "number") return false;
  if (
    isTerminalAssistantStopReason(message.stopReason)
    && message.usage.input === 0
    && message.usage.output === 0
  ) {
    return false;
  }
  return true;
}

export function classifyRunUsage(input: RunUsageClassificationInput): RunUsageStatus {
  if (input.terminalStopReason === "error") return "error_stop";
  if (input.terminalStopReason === "aborted") {
    return input.sawAttributableUsage ? "ok" : "aborted_before_usage";
  }
  if (input.sawAttributableUsage) return "ok";
  if (input.runStatus === "cancelled" || input.runStatus === "interrupted") return "aborted_before_usage";
  if (input.errorMessage || input.runStatus === "failed" || input.runStatus === "timed_out") return "pre_first_message";
  return "pre_first_message";
}

export function deriveLegacyRunUsageStatus(input: {
  runStatus: RunStatus;
  unattributedCost: boolean;
}): RunUsageStatus {
  if (!input.unattributedCost) return "ok";
  if (input.runStatus === "cancelled" || input.runStatus === "interrupted") return "aborted_before_usage";
  return "pre_first_message";
}
