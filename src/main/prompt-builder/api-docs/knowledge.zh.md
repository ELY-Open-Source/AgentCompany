### 添加知识条目（经验教训、最佳实践）
POST /api/companies/{{companyId}}/knowledge
Body: {
  "category": "lesson_learned|best_practice|decision|process|technical|business|onboarding|incident",
  "topic": "我们学到了什么",
  "content": "详细的知识描述",
  "importance": "high|medium|low",
  "referencedEntityType": "task|project|goal",
  "referencedEntityId": "{可选 entity id}"
}

### 列出知识库
GET /api/companies/{{companyId}}/knowledge
