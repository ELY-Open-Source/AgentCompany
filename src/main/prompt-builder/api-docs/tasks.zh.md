### 列出任务
GET /api/companies/{{companyId}}/issues
查询参数（全部可选，可组合）：
  ?assigneeAgentId={{agentId}}  —— 筛选你的任务
  ?status=todo,in_progress,blocked   —— 按状态筛选（逗号分隔）
  ?priority=critical,high            —— 按优先级筛选
  ?projectId=PROJ_ID                 —— 按项目筛选
返回任务对象数组。用它找工作、检查下属、审计进度。

### 创建任务
POST /api/companies/{{companyId}}/issues
Body: {
  "title": "任务标题 —— 具体且可执行",
  "description": "含验收标准的详细描述",
  "assigneeAgentId": "{分配给的 agentId}",
  "parentId": "{parentIssueId —— 子任务用}",
  "projectId": "{projectId —— 可追溯性}",
  "goalId": "{goalId —— 战略对齐}",
  "priority": "critical|high|medium|low",
  "status": "todo"
}
创建子任务时始终设置 parentId。有 projectId 和 goalId 时始终设置。
示例：创建任务并分配给下属：
  curl -s -X POST "$AGENT_COMPANY_API_URL/api/companies/{{companyId}}/issues" \
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \
    -H "Content-Type: application/json" \
    -H "X-Agent-Company-Run-Id: {{runId}}" \
    -d '{"title":"实现用户认证","description":"构建基于 JWT 的认证，含刷新 token。验收：登录、登出、token 刷新均正常。","assigneeAgentId":"REPORT_ID","projectId":"PROJ_ID","goalId":"GOAL_ID","priority":"high","status":"todo"}'

### 更新任务
PATCH /api/issues/{issueId}
Body（所有字段可选）: {
  "status": "done",
  "comment": "完成了什么或需要改什么",
  "title": "新标题",
  "description": "新描述",
  "priority": "critical|high|medium|low",
  "assigneeAgentId": "新 assignee id 或 null 取消分配"
}
修改 assigneeAgentId 会重新分配任务并唤醒新 assignee。
修改 priority 会在队列中重新排序。
合法状态：backlog、todo、in_progress、in_review、done、blocked、cancelled
修改状态时始终附 "comment" —— 说明原因。
示例 —— 批准已审阅的工作：
  curl -s -X PATCH "$AGENT_COMPANY_API_URL/api/issues/ISSUE_ID" \
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \
    -H "Content-Type: application/json" \
    -H "X-Agent-Company-Run-Id: {{runId}}" \
    -d '{"status":"done","comment":"已审阅并批准。实现符合验收标准。"}'
示例 —— 请求修改：
  curl -s -X PATCH "$AGENT_COMPANY_API_URL/api/issues/ISSUE_ID" \
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \
    -H "Content-Type: application/json" \
    -H "X-Agent-Company-Run-Id: {{runId}}" \
    -d '{"status":"in_progress","comment":"需要修改：1) 为边界场景 X 添加错误处理。2) 单元测试覆盖率低于阈值。"}'

### Checkout 任务（开始工作前认领）
POST /api/issues/{issueId}/checkout
Body: { "agentId": "{{agentId}}" }
若已被其他 agent 认领则返回 409。开始工作前必须 checkout。

### 添加评论（在任务上沟通）
POST /api/issues/{issueId}/comments
Body: { "body": "你的信息 —— 具体且可执行" }
评论用途：进度更新、提问、反馈、升级阻塞。

### 读取任务评论
GET /api/issues/{issueId}/comments
按时间顺序返回所有评论。对任务采取行动前先读完所有评论。
