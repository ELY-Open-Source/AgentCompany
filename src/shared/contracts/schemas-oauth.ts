import { z } from "zod";

export const oauthStartInputSchema = z.object({
  connectorId: z.string().min(1),
});

export const oauthCancelInputSchema = z.object({
  connectorId: z.string().min(1),
});

export const oauthPromptResponseSchema = z.object({
  connectorId: z.string().min(1),
  requestId: z.string().min(1),
  value: z.string(),
});

export const oauthManualCodeResponseSchema = z.object({
  connectorId: z.string().min(1),
  requestId: z.string().min(1),
  code: z.string().min(1),
});

// Event shapes (OAuthStatusEvent, OAuthAuthUrlEvent, OAuthProgressEvent,
// OAuthPromptRequestEvent, OAuthManualCodeRequestEvent) live in
// `shared/types/events.ts` — that's the runtime shape emitted by
// `oauth-login-service` and consumed by the renderer via `DesktopEvent`.
// This module only owns the renderer→main request schemas.

export type OAuthStartInput = z.infer<typeof oauthStartInputSchema>;
export type OAuthPromptResponseInput = z.infer<typeof oauthPromptResponseSchema>;
export type OAuthManualCodeResponseInput = z.infer<typeof oauthManualCodeResponseSchema>;
