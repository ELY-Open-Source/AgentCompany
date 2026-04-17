import { z } from "zod";
import { optionalId } from "./helpers";

export const companyInputSchema = z.object({
  id: optionalId,
  name: z.string().min(2).max(80),
  description: z.string().max(500).default(""),
  status: z.enum(["active", "paused", "archived"]).default("active"),
  autoApproveHires: z.boolean().default(false),
  reviewDeliverables: z.boolean().default(false),
  executionMode: z.enum(["ai_ceo", "ai_cofounder"]).default("ai_ceo"),
});

/**
 * Pure pi-mono connector catalog ids. Single source of truth: this zod enum.
 * The TS `ConnectorId` alias (`shared/types/enums.ts`) and the catalog
 * (`shared/connector-catalog.ts`) both derive from it. Adding a connector
 * requires editing this list only.
 */
export const connectorIdEnum = z.enum([
  // OAuth (5)
  "claude-pro",
  "openai-codex",
  "github-copilot",
  "gemini-cli",
  "antigravity",
  // API key (18)
  "anthropic",
  "openai",
  "google",
  "mistral",
  "groq",
  "cerebras",
  "xai",
  "openrouter",
  "vercel-ai-gateway",
  "zai",
  "opencode",
  "opencode-go",
  "huggingface",
  "kimi-coding",
  "minimax",
  "minimax-cn",
  "fireworks",
  "fireworks-firepass",
  // Cloud (3)
  "amazon-bedrock",
  "azure-openai",
  "google-vertex",
]);

export type ConnectorId = z.infer<typeof connectorIdEnum>;

export const connectorInputSchema = z.object({
  id: connectorIdEnum,
  command: z.string().min(1),
  model: z.string().nullable().optional(),
  envBindingText: z.string().default(""),
  notes: z.string().default(""),
});

export const connectorDisabledModelsSchema = z.object({
  connectorId: connectorInputSchema.shape.id,
  disabledModels: z.array(z.object({ id: z.string(), label: z.string() })),
});

export const workspaceInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  name: z.string().min(2).max(80),
  localPath: z.string().min(1),
  repoUrl: z.string().default(""),
  repoRef: z.string().default(""),
  projectId: optionalId,
  isPrimary: z.boolean().default(false),
});

export const settingsSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  locale: z.enum(["en", "zh"]).optional(),
  updatesEnabled: z.boolean().optional(),
  logRetentionDays: z.number().int().min(1).max(365).optional(),
});

export const bootstrapOnboardingSchema = z.object({
  companyName: z.string().min(2).max(80),
  companyDescription: z.string().max(500).default(""),
  workspacePath: z.string().default(""),
  autoApproveHires: z.boolean().default(true),
  reviewDeliverables: z.boolean().default(false),
  executionMode: z.enum(["ai_ceo", "ai_cofounder"]).default("ai_ceo"),
  goalTitle: z.string().default(""),
  goalDescription: z.string().default(""),
  connectorId: connectorInputSchema.shape.id.optional(),
  connectorModel: z.string().default(""),
});

export const socialAccountInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  platform: z.enum(["twitter", "linkedin", "instagram", "facebook", "reddit", "youtube", "tiktok", "bluesky", "discord", "threads", "pinterest", "telegram", "whatsapp", "wechat", "weibo", "xiaohongshu", "douyin", "bilibili", "zhihu", "other"]),
  accountName: z.string().min(1).max(120),
  displayName: z.string().max(120).default(""),
  profileUrl: z.string().max(500).default(""),
  credentialSecretId: optionalId,
  status: z.enum(["active", "logged_in", "login_required", "suspended", "paused"]).default("login_required"),
  requireApproval: z.boolean().default(true),
  metadataJson: z.string().default("{}"),
});

export const secretInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  name: z.string().min(2).max(80),
  description: z.string().default(""),
  value: z.string().min(1).max(2000),
});
