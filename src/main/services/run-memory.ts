import type { DatabaseSync } from "node:sqlite";
import { KnowledgeService } from "./knowledge-service";

const MEMORY_CHARS = 2_000;

/** Keeps what a run of real work concluded, for its project or the whole company. */
export function recordRunMemory(
  db: DatabaseSync,
  input: { orgId: string; runId: string; projectId: string | null; taskTitle: string; outcome: "completed" | "failed"; text: string },
): void {
  const text = input.text.trim();
  if (!text) return;
  new KnowledgeService(db).create({
    orgId: input.orgId,
    topic: `${input.outcome === "completed" ? "Outcome" : "Failure"}: ${input.taskTitle}`,
    category: input.outcome === "completed" ? "run_outcome" : "failure_cause",
    content: text.length > MEMORY_CHARS ? `${text.slice(0, MEMORY_CHARS)}…` : text,
    importance: "normal",
    sourceType: "task_run",
    sourceId: input.runId,
    scopeType: input.projectId ? "project" : "organization",
    scopeId: input.projectId,
    validUntil: null,
    supersedesId: null,
  });
}
