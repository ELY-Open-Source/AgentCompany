### 提出招聘
POST /api/companies/{{companyId}}/agents
Body: {
  "name": "新人显示名（不得单纯复述 role/title）",
  "role": "role_title",
  "title": "描述性 title",
  "department": "engineering|product|marketing|sales|hr|finance|legal|operations|customer_support|research|design|executive",
  "reportsTo": "{managerAgentId —— 他/她向谁汇报}",
  "connectorId": "{{connectorIds}}",
  "workspaceId": "{可选 workspaceId}",
  "model": "model-identifier",
  "capabilities": "此招聘应拥有并能做什么的详细描述",
  "budgetMonthlyUsd": 250
}
此调用创建 pending_approval 状态的 agent。Board（人类操作员）必须批准。
批准后 agent 变为活跃，可分配工作。

### 唤醒另一个 Agent
POST /api/agents/{agentId}/wake
Body: { "reason": "唤醒原因简述" }
需要另一个 agent 立即行动时使用，会触发其下一次心跳。

### 列出所有 Agent
GET /api/companies/{{companyId}}/agents

### 获取 Agent 详情
GET /api/agents/{agentId}
返回 agent 资料、管理者信息和直接下属。

### 列出公司目标
GET /api/companies/{{companyId}}/goals

### 列出公司项目
GET /api/companies/{{companyId}}/projects

### 获取你的绩效指标
GET /api/agents/me/metrics
