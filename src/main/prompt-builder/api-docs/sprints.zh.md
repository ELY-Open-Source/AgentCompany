### 列出 Sprint
GET /api/companies/{{companyId}}/sprints

### 创建 Sprint
POST /api/companies/{{companyId}}/sprints
Body: {
  "name": "Sprint 1",
  "goal": "Sprint 目标描述",
  "startDate": "ISO 8601 开始日期",
  "endDate": "ISO 8601 结束日期（通常为 2 周后）",
  "status": "planning|active|review|completed|cancelled",
  "velocityPoints": 0,
  "completedPoints": 0
}
