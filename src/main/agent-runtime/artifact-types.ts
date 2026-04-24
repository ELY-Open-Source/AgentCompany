import type { Logger } from "./artifact-logging";

export type ArtifactProjectorRunContext = {
  runId: string;
  agentId: string;
  companyId: string;
  taskId: string | null;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceMode: "exclusive" | "shared" | "none";
  logger?: Logger;
  /**
   * mtime snapshot captured at run start for workspaces that are NOT
   * a git repo. Diff-against-baseline is how completion reconciliation
   * finds files the agent wrote without a `.git` to fall back on.
   */
  workspaceBaseline: WorkspaceBaseline | null;
};

export interface WorkspaceBaseline {
  /** Relative path -> mtimeMs at capture. */
  mtimeByRelPath: Map<string, number>;
  /** Unix ms at which the baseline was taken. */
  capturedAt: number;
  /** True when the walker stopped early because the cap was hit; the baseline is still usable for captured paths. */
  truncated: boolean;
}

export type ProjectionOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "inserted"; workProductId: string; relativePath: string }
  | { kind: "updated"; workProductId: string; relativePath: string }
  | { kind: "retired"; workProductId: string; relativePath: string };

export interface GitChangeSet {
  changed: string[];
  deleted: string[];
}

export type ChangeSource = "git" | "baseline" | "none";

export interface ChangeSet {
  source: ChangeSource;
  /** Paths, relative to the workspace root, that currently exist on disk with a new or advanced mtime. */
  changed: string[];
  /** Paths, relative to the workspace root, that the detector reports as removed during the run. */
  deleted: string[];
  /** Reason the source chose to skip, meaningful when source is "none". */
  skipReason?: string;
  /**
   * True when the baseline walker stopped before sampling the whole
   * tree. Callers surface it as a `baseline_truncated` skip outcome.
   */
  coverageTruncated?: boolean;
}
