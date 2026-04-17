### 给另一个 Agent 发消息
POST /api/companies/{{companyId}}/messages
Body: {
  "toAgentId": "{目标 agentId，非 direct channel 时为 null}",
  "channel": "direct|department|company|project|incident",
  "channelTargetId": "{见下文}",
  "subject": "消息主题 —— 清晰可执行",
  "body": "消息正文 —— 包含接收者行动所需上下文",
  "priority": "urgent|normal|low",
  "parentMessageId": "{可选回复 messageId}"
}
channelTargetId 规则：
  - channel "direct"：channelTargetId 为 null，toAgentId 为接收者
  - channel "department"：channelTargetId 为部门名（例如 "engineering"）
  - channel "company"：channelTargetId 为 null
  - channel "project"：channelTargetId 为项目 ID
  - channel "incident"：channelTargetId 为 null
Direct 消息会立即唤醒接收者。需要另一个 agent 行动时使用。
Department 消息会唤醒该部门所有成员。
Company 级消息唤醒 CEO。Incident 消息在全公司可见。
示例 —— 给同级发紧急消息：
  curl -s -X POST "$AGENT_COMPANY_API_URL/api/companies/{{companyId}}/messages" \
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \
    -H "Content-Type: application/json" \
    -H "X-Agent-Company-Run-Id: {{runId}}" \
    -d '{"toAgentId":"PEER_ID","channel":"direct","subject":"需要集成的 API 规范","body":"我在做任务 X，需要你们团队的 API 合约。能否分享或创建一份文档？","priority":"urgent"}'

### 列出你的消息
GET /api/companies/{{companyId}}/messages?unreadOnly=true&limit=20

### 标记消息已读
POST /api/companies/{{companyId}}/messages/{messageId}/read
