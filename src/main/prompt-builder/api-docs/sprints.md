### List Sprints
GET /api/companies/{{companyId}}/sprints

### Create Sprint
POST /api/companies/{{companyId}}/sprints
Body: {
  "name": "Sprint 1",
  "goal": "Sprint goal description",
  "startDate": "ISO 8601 start date",
  "endDate": "ISO 8601 end date (typically 2 weeks after start)",
  "status": "planning|active|review|completed|cancelled",
  "velocityPoints": 0,
  "completedPoints": 0
}
