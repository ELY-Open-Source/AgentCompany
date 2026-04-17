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

export const oauthAuthInfoSchema = z.object({
  connectorId: z.string(),
  url: z.string().url(),
  instructions: z.string().optional(),
});

export const oauthProgressSchema = z.object({
  connectorId: z.string(),
  message: z.string(),
});

export const oauthStatusSchema = z.object({
  connectorId: z.string(),
  status: z.enum(["active", "cancelled", "error", "in_progress"]),
  errorMessage: z.string().optional(),
});

export const oauthPromptRequestSchema = z.object({
  connectorId: z.string(),
  requestId: z.string(),
  message: z.string(),
  placeholder: z.string().optional(),
  allowEmpty: z.boolean().optional(),
});

export const oauthManualCodeRequestSchema = z.object({
  connectorId: z.string(),
  requestId: z.string(),
});

export type OAuthStartInput = z.infer<typeof oauthStartInputSchema>;
export type OAuthAuthInfoEvent = z.infer<typeof oauthAuthInfoSchema>;
export type OAuthProgressEvent = z.infer<typeof oauthProgressSchema>;
export type OAuthStatusEvent = z.infer<typeof oauthStatusSchema>;
export type OAuthPromptRequestEvent = z.infer<typeof oauthPromptRequestSchema>;
export type OAuthManualCodeRequestEvent = z.infer<typeof oauthManualCodeRequestSchema>;
export type OAuthPromptResponseInput = z.infer<typeof oauthPromptResponseSchema>;
export type OAuthManualCodeResponseInput = z.infer<typeof oauthManualCodeResponseSchema>;
