### Add Knowledge Entry (lessons learned, best practices)
POST /api/companies/{{companyId}}/knowledge
Body: {
  "category": "lesson_learned|best_practice|decision|process|technical|business|onboarding|incident",
  "topic": "What we learned",
  "content": "Detailed description of the knowledge",
  "importance": "high|medium|low",
  "referencedEntityType": "task|project|goal",
  "referencedEntityId": "{optionalEntityId}"
}

### List Knowledge Base
GET /api/companies/{{companyId}}/knowledge
