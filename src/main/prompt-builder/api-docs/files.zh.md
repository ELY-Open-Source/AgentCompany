### 创建文档
POST /api/companies/{{companyId}}/documents
Body: {
  "type": "prd|technical_spec|design_doc|test_plan|post_mortem|meeting_notes|budget_proposal|hiring_requisition|status_report|incident_report|architecture_decision|knowledge_article",
  "title": "文档标题",
  "content": "完整的 markdown 文档内容",
  "reviewerAgentId": "{可选 reviewerAgentId}",
  "projectId": "{可选 projectId}",
  "goalId": "{可选 goalId}",
  "status": "draft"
}

### 列出公司文档
GET /api/companies/{{companyId}}/documents

### 更新文档（带冲突检测）
PATCH /api/companies/{{companyId}}/documents/{documentId}
Body: {
  "status": "draft|in_review|approved|archived|superseded",
  "content": "新内容（会生成一个修订版）",
  "changeSummary": "改动摘要",
  "baseRevisionId": "{用于冲突检测的 latestRevisionId —— 仅改状态时可省略}"
}
审阅文档后使用：质量达标设为 "approved"、审阅中设为 "in_review"、需修改时改回 "draft"。
更新内容时，提供文档的 latestRevisionId 作为 baseRevisionId 以检测冲突。

### 列出文档修订
GET /api/companies/{{companyId}}/documents/{documentId}/revisions

### Work Products（结构化交付物）
POST /api/issues/{issueId}/work-products
Body: {
  "type": "pull_request|branch|commit|artifact|document|preview_url|runtime_service",
  "provider": "agentcompany|github|custom",
  "title": "Work product 标题",
  "url": "https://...（可选）",
  "status": "active|ready_for_review|approved|merged|closed|failed|draft",
  "reviewState": "none|needs_board_review|approved|changes_requested",
  "isPrimary": true,
  "summary": "交付物简要描述"
}
用于在任务上登记结构化交付物（PR、artifact、已部署服务）。

GET /api/issues/{issueId}/work-products
PATCH /api/work-products/{id} 局部更新（例如 {"reviewState": "approved"}）
DELETE /api/work-products/{id}

### 把文档关联到任务（语义分类）
PUT /api/issues/{issueId}/documents/{key}
Body: { "documentId": "{existingDocumentId}" }
Key 必须为小写字母数字，可含 _ 或 -（例如 "plan"、"spec"、"design"、"test-plan"）。
把一个文档以语义键关联到任务。每个任务每个键只能有一个文档。

GET /api/issues/{issueId}/documents —— 列出任务的所有关联文档
