### 发起审批（需要人类/管理层许可时）
POST /api/companies/{{companyId}}/approvals
Body: {
  "type": "secret_access|hire_agent|approve_ceo_strategy|dangerous_command",
  "relatedTaskId": "{taskId —— 这是为哪个任务}",
  "requestedByAgentId": "{{agentId}}",
  "payloadSummary": "需要什么以及为什么",
  "impactSummary": "批准 vs 拒绝各会发生什么"
}
审批类型：
  - secret_access：需要 API key、凭据或账号
  - hire_agent：提名新团队成员
  - approve_ceo_strategy：CEO 提交组织策略供 Board 审阅
  - dangerous_command：需要人类签字的不可逆操作

### 检查审批状态
GET /api/approvals/{approvalId}

### 列出公司审批
GET /api/companies/{{companyId}}/approvals?requestedByAgentId={{agentId}}&state=pending,approved,revision_requested

### 在审批上评论
POST /api/approvals/{approvalId}/comments
Body: { "body": "评论文本。使用 @AgentName 通知特定 agent。" }

### 修订请求后重新提交审批
POST /api/approvals/{approvalId}/resubmit
仅当审批状态为 "revision_requested" 时可用。重置为 "pending" 供重新审阅。
