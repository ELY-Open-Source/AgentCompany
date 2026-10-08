import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { optionalStringArray } from "./agent-tool-args";
import { LIST_SKIPPED_DIRECTORIES } from "./agent-workspace-tools";
import { inputBudgetTokens } from "./context-budget";
import type { AgentToolContext } from "./agent-tools";
import { resolveWorkspacePath } from "./files/workspace-path";
import type { JsonRecord } from "./provider-http";
import { currentRunId } from "./run-control";
import { effectiveModel } from "./task-run-preparation";

const AUDITOR_SETTING = "Settings > Advanced > Goal audit";
const UNFINISHED_SHOWN = 5;

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

/** Unfinished work of a goal besides the task asking to close it; bookkeeping tasks (chat wakes, reviews) do not count. */
export function unfinishedGoalTasks(db: DatabaseSync, goalId: string, exceptTaskId: string | null): string[] {
  const rows = db.prepare(`
    select title from tasks where goal_id = ? and status <> 'done' and origin is null and (? is null or id <> ?)
    order by rowid limit ?
  `).all(goalId, exceptTaskId, exceptTaskId, UNFINISHED_SHOWN) as Array<{ title: string }>;
  return rows.map((row) => row.title);
}

/** What a verdict rests on, each stamped as it entered the audit: the goal, the pointers, and what the auditor read in the real workspace. */
export class AuditBasis {
  private readonly stamps = new Map<string, string>();
  /** The audit's copy and its file hashes taken before any command ran, i.e. the workspace as the audit found it. */
  private copy: { root: string; atStart: Map<string, string> } | null = null;
  /** Files that existed at the start and that the auditor's own commands changed or removed in the copy. */
  private editedFiles: string[] = [];

  constructor(private readonly db: DatabaseSync, private readonly goalId: string, private readonly workspaceRoot: string | null, pointers: ResultPointers) {
    this.note("goal:");
    for (const file of pointers.files) this.noteFile(file);
    for (const document of pointers.documents) this.noteDocument(document.id);
  }

  /** When the auditor works in a copy, a read file is stamped as the copy held it at the start: what the auditor saw. */
  auditInCopy(copyRoot: string): void {
    this.copy = { root: copyRoot, atStart: hashTree(copyRoot) };
  }

  noteFile(path: string): void {
    if (!this.workspaceRoot) return;
    const relative = canonicalRelative(this.copy?.root ?? this.workspaceRoot, path.trim());
    const key = `file:${relative}`;
    if (this.stamps.has(key)) return;
    this.stamps.set(key, this.copy ? this.copy.atStart.get(relative) ?? this.absentStamp(relative) : this.stamp(key));
  }

  /** Called before the copy is deleted: any file the audit found that its own commands changed means it judged its own edits. */
  closeCopy(): void {
    if (!this.copy) return;
    const now = hashTree(this.copy.root);
    this.editedFiles = [...this.copy.atStart].filter(([path, hash]) => now.get(path) !== hash).map(([path]) => path);
  }

  editedInCopy(): string[] {
    return this.editedFiles;
  }

  noteDocument(id: string): void {
    this.note(`doc:${id.trim()}`);
  }

  /** Whether anything the verdict rests on is different now. */
  changed(): boolean {
    return [...this.stamps].some(([key, stamp]) => this.stamp(key) !== stamp);
  }

  private note(key: string): void {
    if (!this.stamps.has(key)) this.stamps.set(key, this.stamp(key));
  }

  private stamp(key: string): string {
    if (key === "goal:") return JSON.stringify(this.db.prepare("select title, description, status from goals where id = ?").get(this.goalId));
    if (key.startsWith("doc:")) {
      const row = this.db.prepare("select version from documents where id = ?").get(key.slice(4)) as { version: number } | undefined;
      return row ? `v${row.version}` : "missing";
    }
    const relative = key.slice(5);
    if (inSkippedDirectory(relative)) return "untracked";
    const absolute = resolveWorkspacePath(this.workspaceRoot!, relative).absolute;
    return existsSync(absolute) ? hashFile(absolute) : "missing";
  }

  private absentStamp(relative: string): string {
    return inSkippedDirectory(relative) ? "untracked" : "missing";
  }
}

/** A path as the disk spells it, so differently cased reads of one file on a case-insensitive disk share one stamp. */
function canonicalRelative(root: string, path: string): string {
  const { absolute, relativePosix } = resolveWorkspacePath(root, path);
  if (!existsSync(absolute)) return relativePosix;
  const actual = relative(realpathSync.native(root), realpathSync.native(absolute)).split(sep).join("/");
  return actual.startsWith("..") ? relativePosix : actual;
}

/** Build and dependency folders are not evidence of record; they are left out of stamps, as list_files leaves them out. */
function inSkippedDirectory(relative: string): boolean {
  return relative.split("/").slice(0, -1).some((part) => LIST_SKIPPED_DIRECTORIES.has(part));
}

function hashFile(absolute: string): string {
  return createHash("sha256").update(readFileSync(absolute)).digest("hex");
}

function hashTree(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!LIST_SKIPPED_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        hashes.set(relative, hashFile(join(directory, entry.name)));
      }
    }
  };
  walk(root, "");
  return hashes;
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
