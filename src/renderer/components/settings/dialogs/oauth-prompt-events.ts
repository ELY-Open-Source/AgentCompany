import type { DesktopEvent } from "@shared/types";

export type PendingOAuthPrompt =
  | {
      kind: "prompt";
      connectorId: string;
      requestId: string;
      message: string;
      placeholder?: string;
      allowEmpty?: boolean;
    }
  | {
      kind: "manual-code";
      connectorId: string;
      requestId: string;
      authUrl?: string;
      instructions?: string;
    };

export function nextOAuthPromptState(
  current: PendingOAuthPrompt | null,
  event: DesktopEvent,
): PendingOAuthPrompt | null {
  if (event.type === "oauth:prompt-request") {
    return {
      kind: "prompt",
      connectorId: event.connectorId,
      requestId: event.requestId,
      message: event.message,
      placeholder: event.placeholder,
      allowEmpty: event.allowEmpty,
    };
  }

  if (event.type === "oauth:manual-code-request") {
    return {
      kind: "manual-code",
      connectorId: event.connectorId,
      requestId: event.requestId,
      authUrl: event.authUrl,
      instructions: event.instructions,
    };
  }

  if (event.type === "oauth:status" && current?.connectorId === event.connectorId) {
    return event.status === "in_progress" || event.status === "pending"
      ? current
      : null;
  }

  return current;
}
