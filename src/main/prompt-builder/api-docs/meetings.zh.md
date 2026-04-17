### 安排会议
POST /api/companies/{{companyId}}/meetings
Body: {
  "type": "standup|sprint_planning|sprint_review|retrospective|one_on_one|all_hands|department_sync|incident_review|hiring_committee|budget_review",
  "title": "会议标题",
  "participantAgentIds": "JSON 序列化的 agent id 数组",
  "scheduledAt": "ISO 8601 时间",
  "durationMinutes": 30,
  "agendaJson": "JSON 序列化的议程项数组"
}

### 更新会议（添加笔记、决策）
PATCH /api/meetings/{meetingId}
Body: {
  "notesJson": "JSON 序列化的会议笔记数组",
  "decisionsJson": "JSON 序列化的决策数组",
  "actionItemsJson": "JSON 序列化的行动项数组",
  "status": "completed"
}
