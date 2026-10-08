import type { DatabaseSync } from "node:sqlite";
import { optionalEnum, optionalLimit, optionalText, requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import { APPLICABLE_KNOWLEDGE_SQL, applicableKnowledgeArgs, KnowledgeService, type KnowledgeReader } from "./knowledge-service";
import type { JsonRecord } from "./provider-http";
import type { ToolDefinition } from "./provider-tool-turn";
import { relevantItems } from "./relevance";

const PROMPT_ENTRY_LIMIT = 5;
const PROMPT_ENTRY_CHARS = 600;
const IMPORTANCE = ["low", "normal", "high"] as const;
const SCOPES = ["organization", "project", "goal", "task", "agent"] as const;

interface KnowledgeRow {
  id: string;
  topic: string;
  category: string;
  content: string;
  importance: string;
  scope_type: string;
  valid_until: string | null;
  updated_at: string;
}

export const KNOWLEDGE_TOOLS: ToolDefinition[] = [
  {
    name: "search_knowledge",
    description: "Search the company knowledge base — decisions, preferences, verified facts, and lessons recorded by the team.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Words to look for." },
        limit: { type: "number", description: "Most entries to return (default 10, max 30)." },
      },
      required: ["query"],
    },
  },
  {
    name: "record_knowledge",
    description: "Record something the company should remember: a decision, a preference, a verified fact, or why something failed. Scope it to where it applies; pass supersedes to replace an outdated entry.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        topic: { type: "string", description: "Short title." },
        content: { type: "string", description: "The knowledge itself, self-contained." },
        category: { type: "string", description: "e.g. decision, preference, fact, lesson." },
        importance: { type: "string", enum: ["low", "normal", "high"] },
        scope: { type: "string", enum: [...SCOPES], description: "Where it applies: the whole company (default), this task's project, goal, or task, or only you (agent)." },
        valid_until: { type: "string", description: "UTC ISO time after which it no longer applies." },
        supersedes: { type: "string", description: "id of an older entry this one replaces." },
      },
      required: ["topic", "content", "category"],
    },
  },
];

export function searchKnowledgeTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const query = requireString(args.query, "query");
  const limit = optionalLimit(args.limit, "limit", 10, 30);
  const found = relevantItems(knowledgeRows(deps.db, readerOf(ctx)), describeEntry, query, limit);
  if (found.length === 0) return `No knowledge matches "${query}".`;
  return found.map(formatEntry).join("\n\n");
}

export function recordKnowledgeTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const importance = optionalEnum(args.importance, "importance", IMPORTANCE, "normal");
  const scope = optionalEnum(args.scope, "scope", SCOPES, "organization") as (typeof SCOPES)[number];
  const id = new KnowledgeService(deps.db).create({
    orgId: ctx.orgId,
    topic: requireString(args.topic, "topic"),
    category: requireString(args.category, "category"),
    content: requireString(args.content, "content"),
    importance,
    sourceType: "agent",
    sourceId: ctx.agent.id,
    scopeType: scope,
    scopeId: scopeIdFor(ctx, scope),
    validUntil: optionalText(args.valid_until, "valid_until"),
    supersedesId: optionalText(args.supersedes, "supersedes"),
  });
  return `Recorded knowledge entry ${id}.`;
}

/** Prompt lines for the entries most relevant to a task. */
export function relevantKnowledgeLines(db: DatabaseSync, reader: KnowledgeReader, taskText: string): string[] {
  const found = relevantItems(knowledgeRows(db, reader), describeEntry, taskText, PROMPT_ENTRY_LIMIT);
  if (found.length === 0) return [];
  return [
    "",
    "Company knowledge that may apply (search_knowledge for more):",
    ...found.map((entry) => `- ${entry.topic} [${labels(entry)}]: ${clip(entry.content)}`),
  ];
}

function knowledgeRows(db: DatabaseSync, reader: KnowledgeReader): KnowledgeRow[] {
  return db.prepare(`
    select id, topic, category, content, importance, scope_type, valid_until, updated_at from knowledge_entries
    where ${APPLICABLE_KNOWLEDGE_SQL} order by updated_at desc
  `).all(...applicableKnowledgeArgs(reader)) as unknown as KnowledgeRow[];
}

function readerOf(ctx: AgentToolContext): KnowledgeReader {
  return { orgId: ctx.orgId, agentId: ctx.agent.id, projectId: ctx.taskProjectId, goalId: ctx.taskGoalId, taskId: ctx.taskId };
}

function scopeIdFor(ctx: AgentToolContext, scope: (typeof SCOPES)[number]): string | null {
  if (scope === "organization") return null;
  if (scope === "agent") return ctx.agent.id;
  const id = scope === "project" ? ctx.taskProjectId : scope === "goal" ? ctx.taskGoalId : ctx.taskId;
  if (!id) throw new Error(`This run has no ${scope} to scope knowledge to.`);
  return id;
}

function labels(entry: KnowledgeRow): string {
  const validity = entry.valid_until ? `, valid until ${entry.valid_until}` : "";
  return `${entry.category}, ${entry.importance}, ${entry.scope_type}${validity}, id=${entry.id}`;
}

function describeEntry(entry: KnowledgeRow): string {
  return `${entry.topic} ${entry.category} ${entry.content}`;
}

function formatEntry(entry: KnowledgeRow): string {
  return `${entry.topic} [${labels(entry)}, updated ${entry.updated_at}]\n${entry.content}`;
}

function clip(text: string): string {
  return text.length > PROMPT_ENTRY_CHARS ? `${text.slice(0, PROMPT_ENTRY_CHARS)}…` : text;
}
