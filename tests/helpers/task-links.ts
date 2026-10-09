import type { DatabaseSync } from "node:sqlite";
import type { WritingMode } from "../../src/shared/domain";

/** A task's current links, for edits in tests that change other fields and keep these. */
export function currentLinks(db: DatabaseSync, taskId: string) {
  const row = db.prepare("select project_id, goal_id, workspace_id, requires_filesystem, writing_mode from tasks where id = ?").get(taskId) as {
    project_id: string | null; goal_id: string | null; workspace_id: string | null; requires_filesystem: number; writing_mode: WritingMode;
  };
  return { projectId: row.project_id, goalId: row.goal_id, workspaceId: row.workspace_id, requiresFilesystem: row.requires_filesystem === 1, writingMode: row.writing_mode };
}
