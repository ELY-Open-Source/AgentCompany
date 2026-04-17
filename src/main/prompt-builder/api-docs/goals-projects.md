### Create a Goal
POST /api/companies/{{companyId}}/goals
Body: {
  "title": "Goal title — measurable outcome",
  "description": "Definition of done — specific success criteria",
  "parentId": "{optionalParentGoalId}",
  "ownerAgentId": "{agentId who owns this goal}",
  "status": "active"
}
Goals are top-level strategic objectives. Decompose goals into projects, then projects into tasks.

### Create a Project
POST /api/companies/{{companyId}}/projects
Body: {
  "name": "Project name",
  "description": "Project scope and deliverables",
  "goalId": "{goalId — which goal does this serve}",
  "leadAgentId": "{agentId — who leads this project}",
  "status": "planned"
}
Projects group related tasks under a goal. Assign a lead who owns delivery.
