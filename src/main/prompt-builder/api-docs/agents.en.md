### Propose a Hire
POST /api/companies/{{companyId}}/agents
Body: {
  "name": "New hire display name (must not repeat role/title)",
  "role": "role_title",
  "title": "Descriptive title",
  "department": "engineering|product|marketing|sales|hr|finance|legal|operations|customer_support|research|design|executive",
  "reportsTo": "{managerAgentId — who this person reports to}",
  "connectorId": "{{connectorIds}}",
  "workspaceId": "{optionalWorkspaceId}",
  "model": "model-identifier",
  "capabilities": "Detailed description of what this hire should own and be able to do",
  "budgetMonthlyUsd": 250
}
This creates the agent in pending_approval state. The Board (human operator) must approve.
After approval, the agent becomes active and can be assigned work.

### Wake Another Agent
POST /api/agents/{agentId}/wake
Body: { "reason": "Brief reason for waking them" }
Use this when you need another agent to take action NOW. This triggers their next heartbeat.

### List All Agents
GET /api/companies/{{companyId}}/agents

### Get Agent Details
GET /api/agents/{agentId}
Returns agent profile, manager info, and direct reports.

### List Company Goals
GET /api/companies/{{companyId}}/goals

### List Company Projects
GET /api/companies/{{companyId}}/projects

### Get Your Performance Metrics
GET /api/agents/me/metrics
