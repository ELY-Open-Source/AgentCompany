/** The task content an approval covers, as SQL over a `tasks t` row; one expression for recording and checking keeps them comparable. */
export const TASK_SNAPSHOT_SQL = "json_object('title', t.title, 'description', t.description, 'assignee', t.assignee_agent_id, 'risk', t.risk, 'workspace', t.workspace_id, 'filesystem', t.requires_filesystem)";

export const TASK_APPROVAL_KINDS_SQL = "('task_risk', 'task_execution')";

/** What approving file access really allows: commands are not confined to the workspace. */
export const HOST_ACCESS_NOTE = "Approving lets this task run commands on this computer with your user's file access: they can read and change files outside the workspace. Only their environment is cleaned of keys and your profile.";
