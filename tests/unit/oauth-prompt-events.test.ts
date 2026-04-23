import { describe, expect, it } from "vitest";
import type { DesktopEvent } from "@shared/types";
import {
  nextOAuthPromptState,
  type PendingOAuthPrompt,
} from "../../src/renderer/components/settings/dialogs/oauth-prompt-events";

describe("OAuth prompt event state", () => {
  const pendingManualCode: PendingOAuthPrompt = {
    kind: "manual-code",
    connectorId: "openai-codex",
    requestId: "request-1",
    authUrl: "https://example.com/oauth",
    instructions: "Authorize",
  };

  it("closes a stale manual-code dialog when the same connector becomes active", () => {
    const event: DesktopEvent = {
      type: "oauth:status",
      connectorId: "openai-codex",
      status: "active",
    };

    expect(nextOAuthPromptState(pendingManualCode, event)).toBeNull();
  });

  it("keeps the dialog open for in-progress status events", () => {
    const event: DesktopEvent = {
      type: "oauth:status",
      connectorId: "openai-codex",
      status: "in_progress",
    };

    expect(nextOAuthPromptState(pendingManualCode, event)).toEqual(pendingManualCode);
  });

  it("ignores terminal status events for a different connector", () => {
    const event: DesktopEvent = {
      type: "oauth:status",
      connectorId: "claude-pro",
      status: "active",
    };

    expect(nextOAuthPromptState(pendingManualCode, event)).toEqual(pendingManualCode);
  });

  it("opens manual-code requests from the event payload", () => {
    const event: DesktopEvent = {
      type: "oauth:manual-code-request",
      connectorId: "openai-codex",
      requestId: "request-2",
      authUrl: "https://example.com/code",
      instructions: "Copy code",
    };

    expect(nextOAuthPromptState(null, event)).toEqual({
      kind: "manual-code",
      connectorId: "openai-codex",
      requestId: "request-2",
      authUrl: "https://example.com/code",
      instructions: "Copy code",
    });
  });
});
