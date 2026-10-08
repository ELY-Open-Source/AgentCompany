/** The task content an approval covers, as SQL over a `tasks t` row; one expression for recording and checking keeps them comparable. */
export const TASK_SNAPSHOT_SQL = "json_object('title', t.title, 'description', t.description, 'assignee', t.assignee_agent_id, 'risk', t.risk, 'workspace', t.workspace_id, 'filesystem', t.requires_filesystem)";

export const TASK_APPROVAL_KINDS_SQL = "('task_risk', 'task_execution')";
