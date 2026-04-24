### Filesystem artifacts (auto-registered)
Every successful `write`, `edit`, or `bash` tool call is projected into the task's work_products automatically — you do NOT need to POST /api/work-products for files you create in the workspace. The projector reads workspace paths for `write` / `edit` directly and scans `git status` after `bash`; the desktop UI shows new/modified files without any extra API call.

Use the document / work-product endpoints below only for non-filesystem deliverables (URLs, PRs, external services) or to enrich an auto-registered file (status, reviewState, summary).

### Create a Document
POST /api/companies/{{companyId}}/documents
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
GET /api/companies/{{companyId}}/documents

### Fetch a Single Document (by id)
GET /api/companies/{{companyId}}/documents/{documentId}
Returns the full document record including `content`. The system prompt
only lists document metadata to keep the cacheable prefix stable — call
this endpoint when you need the actual text.

### Update Document (with conflict detection)
PATCH /api/companies/{{companyId}}/documents/{documentId}
Body: {
  "status": "draft|in_review|approved|archived|superseded",
  "content": "Updated content (creates a revision)",
  "changeSummary": "Brief description of what changed",
  "baseRevisionId": "{latestRevisionId for conflict detection — omit on status-only updates}"
}
Use after reviewing a document: set to "approved" if quality meets standards, "in_review" when under review, or back to "draft" if revisions are needed.
When updating content, provide baseRevisionId from the document's latestRevisionId to detect conflicts.

### List Document Revisions
GET /api/companies/{{companyId}}/documents/{documentId}/revisions

### Work Products (Structured Deliverables)
POST /api/issues/{issueId}/work-products
Body: {
  "type": "file|link|pull_request|branch|commit|artifact|document|preview_url|runtime_service",
  "provider": "filesystem|external|agentcompany|github|custom",
  "title": "Work product title",
  "url": "https://... (optional)",
  "status": "active|ready_for_review|approved|merged|closed|failed|draft|archived",
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
