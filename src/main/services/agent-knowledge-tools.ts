import type { DatabaseSync } from "node:sqlite";
import { optionalEnum, optionalLimit, requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import { KnowledgeService } from "./knowledge-service";
import type { JsonRecord } from "./provider-http";
import type { ToolDefinition } from "./provider-tool-turn";
import { relevantItems } from "./relevance";

const PROMPT_ENTRY_LIMIT = 5;
const PROMPT_ENTRY_CHARS = 600;
const IMPORTANCE = ["low", "normal", "high"] as const;

interface KnowledgeRow {
  id: string;
  topic: string;
  category: string;
  content: string;
  importance: string;
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
    description: "Record something the company should remember: a decision, a preference, a verified fact, or why something failed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        topic: { type: "string", description: "Short title." },
        content: { type: "string", description: "The knowledge itself, self-contained." },
        category: { type: "string", description: "e.g. decision, preference, fact, lesson." },
        importance: { type: "string", enum: ["low", "normal", "high"] },
      },
      required: ["topic", "content", "category"],
    },
  },
];

export function searchKnowledgeTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const query = requireString(args.query, "query");
  const limit = optionalLimit(args.limit, "limit", 10, 30);
  const found = relevantItems(knowledgeRows(deps.db, ctx.orgId), describeEntry, query, limit);
  if (found.length === 0) return `No knowledge matches "${query}".`;
  return found.map(formatEntry).join("\n\n");
}

export function recordKnowledgeTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const importance = optionalEnum(args.importance, "importance", IMPORTANCE, "normal");
  const id = new KnowledgeService(deps.db).create({
    orgId: ctx.orgId,
    topic: requireString(args.topic, "topic"),
    category: requireString(args.category, "category"),
    content: requireString(args.content, "content"),
    importance,
    sourceType: "agent",
    sourceId: ctx.agent.id,
  });
  return `Recorded knowledge entry ${id}.`;
}

/** Prompt lines for the entries most relevant to a task. */
export function relevantKnowledgeLines(db: DatabaseSync, orgId: string, taskText: string): string[] {
  const found = relevantItems(knowledgeRows(db, orgId), describeEntry, taskText, PROMPT_ENTRY_LIMIT);
  if (found.length === 0) return [];
  return [
    "",
    "Company knowledge that may apply (search_knowledge for more):",
    ...found.map((entry) => `- ${entry.topic} [${entry.category}, ${entry.importance}, id=${entry.id}]: ${clip(entry.content)}`),
  ];
}

function knowledgeRows(db: DatabaseSync, orgId: string): KnowledgeRow[] {
  return db.prepare(`
    select id, topic, category, content, importance, updated_at from knowledge_entries
    where org_id = ? order by updated_at desc
  `).all(orgId) as unknown as KnowledgeRow[];
}

function describeEntry(entry: KnowledgeRow): string {
  return `${entry.topic} ${entry.category} ${entry.content}`;
}

function formatEntry(entry: KnowledgeRow): string {
  return `${entry.topic} [${entry.category}, ${entry.importance}, id=${entry.id}, updated ${entry.updated_at}]\n${entry.content}`;
}

function clip(text: string): string {
  return text.length > PROMPT_ENTRY_CHARS ? `${text.slice(0, PROMPT_ENTRY_CHARS)}…` : text;
}
