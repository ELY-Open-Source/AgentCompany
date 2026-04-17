import { z } from "zod";
import { automationTriggerEnum } from "./helpers";

export const startRunSchema = z.object({
  companyId: z.string().uuid(),
  taskId: z.string().uuid(),
});

export const cancelRunSchema = z.object({
  companyId: z.string().uuid(),
  runId: z.string().uuid(),
});

export const runLogSchema = z.object({
  companyId: z.string().uuid(),
  runId: z.string().uuid(),
});

export const runLogChunkSchema = z.object({
  companyId: z.string().uuid(),
  runId: z.string().uuid(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1024).max(262_144).default(65_536),
});

export const triggerBrowserLoginSchema = z.object({
  companyId: z.string().uuid(),
  socialAccountId: z.string().uuid(),
});

export const browserActionQuerySchema = z.object({
  companyId: z.string().uuid(),
  socialAccountId: z.string().uuid().optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const cancelBrowserActionSchema = z.object({
  actionId: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const workflowInputSchema = z.object({
  id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  companyId: z.string().uuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(500).default(""),
  stepsJson: z.string().default("[]"),
  triggerType: automationTriggerEnum,
  triggerConfigJson: z.string().default("{}"),
  status: z.enum(["draft", "active", "paused", "completed", "failed"]).default("draft"),
});

export const runWorkflowSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const importSkillSchema = z.object({
  companyId: z.string().min(1),
  source: z.string().min(1),
});

export const listSkillsSchema = z.object({
  companyId: z.string().min(1),
});

export const getSkillDetailSchema = z.object({
  companyId: z.string().min(1),
  skillId: z.string().min(1),
});

export const getSkillMarkdownSchema = z.object({
  companyId: z.string().min(1),
  slug: z.string().min(1),
});

export const deleteSkillSchema = z.object({
  companyId: z.string().min(1),
  skillId: z.string().min(1),
});

export const assignSkillToAgentSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  skillId: z.string().min(1),
});

export const removeSkillFromAgentSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  skillId: z.string().min(1),
});

export const checkSkillUpdateSchema = z.object({
  companyId: z.string().min(1),
  skillId: z.string().min(1),
});

export const listSkillAgentsSchema = z.object({
  companyId: z.string().min(1),
  skillId: z.string().min(1),
});

export const listAgentSkillsSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
});

export const terminalCommandKeys = [
  "install_node_darwin",
  "install_node_win32",
  "install_node_linux",
  "install_claude_unix",
  "install_claude_win32",
  "install_codex",
  "install_gemini",
] as const;

export type TerminalCommandKey = (typeof terminalCommandKeys)[number];

export const openTerminalCommandSchema = z.object({
  commandKey: z.enum(terminalCommandKeys),
});
