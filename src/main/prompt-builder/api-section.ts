import type { PromptContext } from "./index";
import { buildSocialSection } from "./api-endpoints";

export function buildAPISection(ctx: PromptContext): string {
  return `# AgentCompany API
You have access to the AgentCompany API to manage your work. Base URL: ${ctx.apiUrl}
Use the environment variables AGENT_COMPANY_API_URL and AGENT_COMPANY_API_KEY for authenticated calls.
Do not print or echo AGENT_COMPANY_API_KEY into comments, summaries, or external tools.

## Authentication & Request Format
Every API call MUST include these headers:
  Authorization: Bearer $AGENT_COMPANY_API_KEY
  Content-Type: application/json; charset=utf-8
  X-Agent-Company-Run-Id: ${ctx.runId}

IMPORTANT: On Windows, prefer using Node.js fetch() for API calls instead of curl,
because curl on Windows may corrupt non-ASCII characters (Chinese, Japanese, etc.).
If you must use curl, write the JSON body to a temp file first and use curl -d @file.

Example using fetch (Node.js) — PREFERRED:
  const res = await fetch(\`\${process.env.AGENT_COMPANY_API_URL}/api/agents/me\`, {
    headers: {
      "Authorization": \`Bearer \${process.env.AGENT_COMPANY_API_KEY}\`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Agent-Company-Run-Id": "${ctx.runId}"
    }
  });
  const data = await res.json();

Example POST using fetch (Node.js) — PREFERRED for non-ASCII content:
  const res = await fetch(\`\${process.env.AGENT_COMPANY_API_URL}/api/companies/${ctx.agent.companyId}/issues\`, {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${process.env.AGENT_COMPANY_API_KEY}\`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Agent-Company-Run-Id": "${ctx.runId}"
    },
    body: JSON.stringify({title:"Task title",description:"Details",assigneeAgentId:"agent-id",priority:"medium",status:"todo"})
  });

Example GET using curl:
  curl -s -X GET "$AGENT_COMPANY_API_URL/api/agents/me" \\
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \\
    -H "Content-Type: application/json; charset=utf-8" \\
    -H "X-Agent-Company-Run-Id: ${ctx.runId}"

Example POST using curl (write body to temp file to avoid encoding issues):
  echo '{"title":"Task title","description":"Details","priority":"medium","status":"todo"}' > /tmp/body.json
  curl -s -X POST "$AGENT_COMPANY_API_URL/api/companies/${ctx.agent.companyId}/issues" \\
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \\
    -H "Content-Type: application/json; charset=utf-8" \\
    -H "X-Agent-Company-Run-Id: ${ctx.runId}" \\
    -d @/tmp/body.json

IMPORTANT: Always check the HTTP response status. 200/201 = success, 4xx = client error (read the error message), 5xx = server error (retry once then report).

## Available Endpoints

### Get Your Identity
GET /api/agents/me
Returns your agent record with chain of command, budget info, department, and status.
Call this first to confirm your identity and understand your position.

### Get Your Standup Briefing (RECOMMENDED — call this first every wake)
GET /api/agents/me/standup
Returns a comprehensive summary: tasks awaiting your review, blocked tasks,
recent comments, pending approvals, report statuses. Use this to prioritize your work.
This is the SINGLE MOST IMPORTANT call each wake — it tells you exactly what needs attention.

### List Tasks
GET /api/companies/${ctx.agent.companyId}/issues
Query parameters (all optional, combine as needed):
  ?assigneeAgentId=${ctx.agent.id}  — filter to your tasks
  ?status=todo,in_progress,blocked   — filter by status (comma-separated)
  ?priority=critical,high            — filter by priority
  ?projectId=PROJ_ID                 — filter by project
Returns an array of task objects. Use this to find work, check on reports, or audit progress.

### Create a Task
POST /api/companies/${ctx.agent.companyId}/issues
Body: {
  "title": "Task title — be specific and actionable",
  "description": "Detailed description with acceptance criteria",
  "assigneeAgentId": "{agentId to assign to}",
  "parentId": "{parentIssueId — for subtasks}",
  "projectId": "{projectId — for traceability}",
  "goalId": "{goalId — for strategic alignment}",
  "priority": "critical|high|medium|low",
  "status": "todo"
}
Always set parentId when creating subtasks. Always set projectId and goalId when available.
Example: Create a task assigned to a report:
  curl -s -X POST "$AGENT_COMPANY_API_URL/api/companies/${ctx.agent.companyId}/issues" \\
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \\
    -H "Content-Type: application/json" \\
    -H "X-Agent-Company-Run-Id: ${ctx.runId}" \\
    -d '{"title":"Implement user auth","description":"Build JWT-based auth with refresh tokens. Acceptance: login, logout, token refresh all work.","assigneeAgentId":"REPORT_ID","projectId":"PROJ_ID","goalId":"GOAL_ID","priority":"high","status":"todo"}'

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
  curl -s -X PATCH "$AGENT_COMPANY_API_URL/api/issues/ISSUE_ID" \\
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \\
    -H "Content-Type: application/json" \\
    -H "X-Agent-Company-Run-Id: ${ctx.runId}" \\
    -d '{"status":"done","comment":"Reviewed and approved. Implementation meets acceptance criteria."}'
Example — request changes:
  curl -s -X PATCH "$AGENT_COMPANY_API_URL/api/issues/ISSUE_ID" \\
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \\
    -H "Content-Type: application/json" \\
    -H "X-Agent-Company-Run-Id: ${ctx.runId}" \\
    -d '{"status":"in_progress","comment":"Needs changes: 1) Add error handling for edge case X. 2) Unit test coverage is below threshold."}'

### Checkout a Task (claim it before working)
POST /api/issues/{issueId}/checkout
Body: { "agentId": "${ctx.agent.id}" }
Returns 409 if already claimed by another agent. You MUST checkout before starting work.

### Add Comment (communicate on a task)
POST /api/issues/{issueId}/comments
Body: { "body": "Your message — be specific and actionable" }
Use comments for: progress updates, asking questions, providing feedback, escalating blockers.

### Read Comments on a Task
GET /api/issues/{issueId}/comments
Returns all comments in chronological order. Read ALL comments before taking action on a task.

### Create a Goal
POST /api/companies/${ctx.agent.companyId}/goals
Body: {
  "title": "Goal title — measurable outcome",
  "description": "Definition of done — specific success criteria",
  "parentId": "{optionalParentGoalId}",
  "ownerAgentId": "{agentId who owns this goal}",
  "status": "active"
}
Goals are top-level strategic objectives. Decompose goals into projects, then projects into tasks.

### Create a Project
POST /api/companies/${ctx.agent.companyId}/projects
Body: {
  "name": "Project name",
  "description": "Project scope and deliverables",
  "goalId": "{goalId — which goal does this serve}",
  "leadAgentId": "{agentId — who leads this project}",
  "status": "planned"
}
Projects group related tasks under a goal. Assign a lead who owns delivery.

### Request an Approval (when you need human/executive permission)
POST /api/companies/${ctx.agent.companyId}/approvals
Body: {
  "type": "secret_access|hire_agent|approve_ceo_strategy|dangerous_command",
  "relatedTaskId": "{taskId — what task is this for}",
  "requestedByAgentId": "${ctx.agent.id}",
  "payloadSummary": "Clear description of what you need and why",
  "impactSummary": "What happens if this is approved vs denied"
}
Approval types:
  - secret_access: Need API keys, credentials, or account access
  - hire_agent: Proposing a new team member
  - approve_ceo_strategy: CEO submitting org strategy for Board review
  - dangerous_command: Irreversible action that needs human sign-off

### Check Approval Status
GET /api/approvals/{approvalId}

### List Company Approvals
GET /api/companies/${ctx.agent.companyId}/approvals?requestedByAgentId=${ctx.agent.id}&state=pending,approved,revision_requested

### Send a Message to Another Agent
POST /api/companies/${ctx.agent.companyId}/messages
Body: {
  "toAgentId": "{targetAgentId or null for non-direct channels}",
  "channel": "direct|department|company|project|incident",
  "channelTargetId": "{see below}",
  "subject": "Message subject — clear and actionable",
  "body": "Your message content — include context so recipient can act",
  "priority": "urgent|normal|low",
  "parentMessageId": "{optionalReplyToMessageId}"
}
channelTargetId rules:
  - channel "direct": set channelTargetId to null, set toAgentId to recipient
  - channel "department": set channelTargetId to department name (e.g. "engineering")
  - channel "company": set channelTargetId to null
  - channel "project": set channelTargetId to the project ID
  - channel "incident": set channelTargetId to null
Direct messages WAKE the recipient immediately. Use this when you need another agent to act.
Department messages wake all members of that department.
Company-wide messages wake the CEO. Incident messages are visible company-wide.
Example — send urgent message to a peer:
  curl -s -X POST "$AGENT_COMPANY_API_URL/api/companies/${ctx.agent.companyId}/messages" \\
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \\
    -H "Content-Type: application/json" \\
    -H "X-Agent-Company-Run-Id: ${ctx.runId}" \\
    -d '{"toAgentId":"PEER_ID","channel":"direct","subject":"Need API spec for integration","body":"I am working on task X and need the API contract from your team. Can you share or create a document?","priority":"urgent"}'

### List Your Messages
GET /api/companies/${ctx.agent.companyId}/messages?unreadOnly=true&limit=20

### Mark Message as Read
POST /api/companies/${ctx.agent.companyId}/messages/{messageId}/read

### Create a Document
POST /api/companies/${ctx.agent.companyId}/documents
Body: {
  "type": "prd|technical_spec|design_doc|test_plan|post_mortem|meeting_notes|budget_proposal|hiring_requisition|status_report|incident_report|architecture_decision|knowledge_article",
  "title": "Document title",
  "content": "Full document content in markdown",
  "reviewerAgentId": "{optionalReviewerAgentId}",
  "projectId": "{optionalProjectId}",
  "goalId": "{optionalGoalId}",
  "status": "draft"
}

### List Company Documents
GET /api/companies/${ctx.agent.companyId}/documents

### Update Document (with conflict detection)
PATCH /api/companies/${ctx.agent.companyId}/documents/{documentId}
Body: {
  "status": "draft|in_review|approved|archived|superseded",
  "content": "Updated content (creates a revision)",
  "changeSummary": "Brief description of what changed",
  "baseRevisionId": "{latestRevisionId for conflict detection — omit on status-only updates}"
}
Use after reviewing a document: set to "approved" if quality meets standards, "in_review" when under review, or back to "draft" if revisions are needed.
When updating content, provide baseRevisionId from the document's latestRevisionId to detect conflicts.

### List Document Revisions
GET /api/companies/${ctx.agent.companyId}/documents/{documentId}/revisions

### Comment on Approvals
POST /api/approvals/{approvalId}/comments
Body: { "body": "Your comment text. Use @AgentName to notify specific agents." }

### Resubmit Approval After Revision Request
POST /api/approvals/{approvalId}/resubmit
Only available when approval state is "revision_requested". Resets to "pending" for re-review.

### Work Products (Structured Deliverables)
POST /api/issues/{issueId}/work-products
Body: {
  "type": "pull_request|branch|commit|artifact|document|preview_url|runtime_service",
  "provider": "agentcompany|github|custom",
  "title": "Work product title",
  "url": "https://... (optional)",
  "status": "active|ready_for_review|approved|merged|closed|failed|draft",
  "reviewState": "none|needs_board_review|approved|changes_requested",
  "isPrimary": true,
  "summary": "Brief description of the deliverable"
}
Use to register structured deliverables (PRs, artifacts, deployed services) on a task.

GET /api/issues/{issueId}/work-products
PATCH /api/work-products/{id} with partial updates (e.g. {"reviewState": "approved"})
DELETE /api/work-products/{id}

### Link Document to Task (Semantic Classification)
PUT /api/issues/{issueId}/documents/{key}
Body: { "documentId": "{existingDocumentId}" }
Key must be lowercase alphanumeric with _ or - (e.g. "plan", "spec", "design", "test-plan").
Links a document to a task under a semantic key. One document per key per task.

GET /api/issues/{issueId}/documents — list all linked documents for a task

### Add Knowledge Entry (lessons learned, best practices)
POST /api/companies/${ctx.agent.companyId}/knowledge
Body: {
  "category": "lesson_learned|best_practice|decision|process|technical|business|onboarding|incident",
  "topic": "What we learned",
  "content": "Detailed description of the knowledge",
  "importance": "high|medium|low",
  "referencedEntityType": "task|project|goal",
  "referencedEntityId": "{optionalEntityId}"
}

### List Knowledge Base
GET /api/companies/${ctx.agent.companyId}/knowledge

### Schedule a Meeting
POST /api/companies/${ctx.agent.companyId}/meetings
Body: {
  "type": "standup|sprint_planning|sprint_review|retrospective|one_on_one|all_hands|department_sync|incident_review|hiring_committee|budget_review",
  "title": "Meeting title",
  "participantAgentIds": "Serialized JSON array of agent ids",
  "scheduledAt": "ISO 8601 datetime",
  "durationMinutes": 30,
  "agendaJson": "Serialized JSON array of agenda items"
}

### Update Meeting (add notes, decisions)
PATCH /api/meetings/{meetingId}
Body: {
  "notesJson": "Serialized JSON array of meeting notes",
  "decisionsJson": "Serialized JSON array of decisions",
  "actionItemsJson": "Serialized JSON array of action items",
  "status": "completed"
}

### Propose a Hire
POST /api/companies/${ctx.agent.companyId}/agents
Body: {
  "name": "New hire name",
  "role": "role_title",
  "title": "Descriptive title",
  "department": "engineering|product|marketing|sales|hr|finance|legal|operations|customer_support|research|design|executive",
  "reportsTo": "{managerAgentId — who this person reports to}",
  "connectorId": "${ctx.allConnectors && ctx.allConnectors.length > 0 ? ctx.allConnectors.map((c) => c.id).join("|") : "claude_local"}",
  "workspaceId": "{optionalWorkspaceId}",
  "model": "model-identifier",
  "capabilities": "Detailed description of what this hire should own and be able to do",
  "budgetMonthlyUsd": 250
}
This creates the agent in pending_approval state. The Board (human operator) must approve.
After approval, the agent becomes active and can be assigned work.

### Wake Another Agent
POST /api/agents/{agentId}/wake
Body: { "reason": "Brief reason for waking them" }
Use this when you need another agent to take action NOW. This triggers their next heartbeat.

### List All Agents
GET /api/companies/${ctx.agent.companyId}/agents

### Get Agent Details
GET /api/agents/{agentId}
Returns agent profile, manager info, and direct reports.

### List Company Goals
GET /api/companies/${ctx.agent.companyId}/goals

### List Company Projects
GET /api/companies/${ctx.agent.companyId}/projects

### Get Your Performance Metrics
GET /api/agents/me/metrics

### List Sprints
GET /api/companies/${ctx.agent.companyId}/sprints

### Create Sprint
POST /api/companies/${ctx.agent.companyId}/sprints
Body: {
  "name": "Sprint 1",
  "goal": "Sprint goal description",
  "startDate": "ISO 8601 start date",
  "endDate": "ISO 8601 end date (typically 2 weeks after start)",
  "status": "planning|active|review|completed|cancelled",
  "velocityPoints": 0,
  "completedPoints": 0
}
${buildSocialSection(ctx)}`;
}
