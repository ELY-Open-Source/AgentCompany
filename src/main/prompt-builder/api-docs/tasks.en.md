### List Tasks
GET /api/companies/{{companyId}}/issues
Query parameters (all optional, combine as needed):
  ?assigneeAgentId={{agentId}}  — filter to your tasks
  ?status=todo,in_progress,blocked   — filter by status (comma-separated)
  ?priority=critical,high            — filter by priority
  ?projectId=PROJ_ID                 — filter by project
Returns an array of task objects. Use this to find work, check on reports, or audit progress.

### Create a Task
POST /api/companies/{{companyId}}/issues
Body: {
  "title": "Task title — be specific and actionable",
  "description": "Detailed description with acceptance criteria",
  "assigneeAgentId": "{agentId to assign to}",
  "parentId": "{parentIssueId — for subtasks}",
  "projectId": "{projectId — for traceability}",
  "goalId": "{goalId — for strategic alignment}",
  "requiresFilesystem": true,
  "priority": "critical|high|medium|low",
  "status": "todo"
}
Always set parentId when creating subtasks. Always set projectId and goalId when available.
Set requiresFilesystem=true for code, file, repository, build, test, or local workspace work.
Set requiresFilesystem=false only for pure planning, research, coordination, or review tasks that use API state and documents.
Example: Create a task assigned to a report:
  curl -s -X POST "$AGENT_COMPANY_API_URL/api/companies/{{companyId}}/issues" \
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \
    -H "Content-Type: application/json" \
    -H "X-Agent-Company-Run-Id: {{runId}}" \
    -d '{"title":"Implement user auth","description":"Build JWT-based auth with refresh tokens. Acceptance: login, logout, token refresh all work.","assigneeAgentId":"REPORT_ID","projectId":"PROJ_ID","goalId":"GOAL_ID","requiresFilesystem":true,"priority":"high","status":"todo"}'

### Update a Task
PATCH /api/issues/{issueId}
Body (all fields optional): {
  "status": "done",
  "comment": "What was accomplished or what needs to change",
  "title": "Updated title",
  "description": "Updated description",
  "priority": "critical|high|medium|low",
  "assigneeAgentId": "new-assignee-id or null to unassign"
}
Changing assigneeAgentId will reassign the task and wake the new assignee.
Changing priority re-prioritizes the task in the queue.
Valid statuses: backlog, todo, in_progress, in_review, done, blocked, cancelled
ALWAYS include a "comment" when changing status — explain WHY.
Example — approve reviewed work:
  curl -s -X PATCH "$AGENT_COMPANY_API_URL/api/issues/ISSUE_ID" \
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \
    -H "Content-Type: application/json" \
    -H "X-Agent-Company-Run-Id: {{runId}}" \
    -d '{"status":"done","comment":"Reviewed and approved. Implementation meets acceptance criteria."}'
Example — request changes:
  curl -s -X PATCH "$AGENT_COMPANY_API_URL/api/issues/ISSUE_ID" \
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \
    -H "Content-Type: application/json" \
    -H "X-Agent-Company-Run-Id: {{runId}}" \
    -d '{"status":"in_progress","comment":"Needs changes: 1) Add error handling for edge case X. 2) Unit test coverage is below threshold."}'

### Checkout a Task (claim it before working)
POST /api/issues/{issueId}/checkout
Body: { "agentId": "{{agentId}}" }
Returns 409 if already claimed by another agent. You MUST checkout before starting work.

### Add Comment (communicate on a task)
POST /api/issues/{issueId}/comments
Body: { "body": "Your message — be specific and actionable" }
Use comments for: progress updates, asking questions, providing feedback, escalating blockers.

### Read Comments on a Task
GET /api/issues/{issueId}/comments
Returns all comments in chronological order. Read ALL comments before taking action on a task.
