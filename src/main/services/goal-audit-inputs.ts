import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { optionalStringArray } from "./agent-tool-args";
import { inputBudgetTokens } from "./context-budget";
import type { AgentToolContext } from "./agent-tools";
import { resolveWorkspacePath } from "./files/workspace-path";
import type { JsonRecord } from "./provider-http";
import { currentRunId } from "./run-control";
import { effectiveModel } from "./task-run-preparation";

const AUDITOR_SETTING = "Settings > Advanced > Goal audit";

export interface GoalAuditor {
  providerId: string;
  model: string;
  inputBudgetTokens: number;
}

/** Where the result lives, as the executor points to it; the auditor gets these, never the executor's account of the work. */
export interface ResultPointers {
  files: string[];
  documents: Array<{ id: string; title: string }>;
}

/** The model that audits goals: the org's own choice, never the executor's model, so the two do not share one model's blind spots. */
export function goalAuditor(db: DatabaseSync, ctx: AgentToolContext, executorProviderId: string): GoalAuditor {
  const org = db.prepare("select audit_provider_id, audit_model_id from organizations where id = ?")
    .get(ctx.orgId) as { audit_provider_id: string | null; audit_model_id: string | null };
  if (!org.audit_provider_id || !org.audit_model_id) {
    throw new Error(`Goal audits need an auditor model of their own, different from the executor's. Ask the board to set one in ${AUDITOR_SETTING}.`);
  }
  const runId = currentRunId();
  const pinned = runId ? (db.prepare("select run_model from task_runs where id = ?").get(runId) as { run_model: string | null } | undefined)?.run_model ?? null : null;
  const providerModel = (db.prepare("select model from providers where id = ?").get(executorProviderId) as { model: string | null } | undefined)?.model ?? null;
  const executorModel = pinned ?? effectiveModel(ctx.agent.modelId, providerModel);
  if (org.audit_provider_id === executorProviderId && org.audit_model_id === executorModel) {
    throw new Error(`The goal auditor is set to the executor's own model (${executorModel}); the board must choose a different one in ${AUDITOR_SETTING}.`);
  }
  const provider = db.prepare("select context_window_tokens from providers where id = ? and org_id = ?")
    .get(org.audit_provider_id, ctx.orgId) as { context_window_tokens: number } | undefined;
  if (!provider) throw new Error(`The goal auditor's provider no longer exists; the board must choose another in ${AUDITOR_SETTING}.`);
  // The audit fits the auditor's own context window, not the executor's.
  return { providerId: org.audit_provider_id, model: org.audit_model_id, inputBudgetTokens: inputBudgetTokens(provider.context_window_tokens) };
}

/** The board's choice of goal auditor: a provider of this org and a model name. */
export function setGoalAuditor(db: DatabaseSync, input: { orgId: string; providerId: string; modelId: string }): void {
  const provider = db.prepare("select id from providers where id = ? and org_id = ?").get(input.providerId, input.orgId);
  if (!provider) throw new Error("The goal auditor's provider was not found.");
  const model = input.modelId.trim();
  if (!model) throw new Error("The goal auditor needs a model.");
  db.prepare("update organizations set audit_provider_id = ?, audit_model_id = ? where id = ?").run(input.providerId, model, input.orgId);
  console.info(`[goal-audit] org ${input.orgId} audits goals with ${model} on ${input.providerId}`);
}

/** Checks the executor's pointers before any audit spend: every file in the workspace and every document must exist. */
export function resultPointers(db: DatabaseSync, ctx: AgentToolContext, args: JsonRecord): ResultPointers {
  const files = optionalStringArray(args.files, "files");
  const documentIds = optionalStringArray(args.documents, "documents");
  if (files.length + documentIds.length === 0) {
    throw new Error("Point to the result: files (workspace paths) and/or documents (doc ids) that hold it.");
  }
  for (const file of files) {
    if (!ctx.workspace) throw new Error("No workspace is bound to this task, so files cannot be pointed to; point to documents instead.");
    if (!existsSync(resolveWorkspacePath(ctx.workspace.localPath, file).absolute)) throw new Error(`There is no file ${file} in the workspace.`);
  }
  const documents = documentIds.map((id) => {
    const document = db.prepare("select id, title from documents where id = ? and org_id = ?").get(id, ctx.orgId) as { id: string; title: string } | undefined;
    if (!document) throw new Error(`There is no document ${id}.`);
    return document;
  });
  return { files, documents };
}
