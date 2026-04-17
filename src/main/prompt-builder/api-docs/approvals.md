### Request an Approval (when you need human/executive permission)
POST /api/companies/{{companyId}}/approvals
Body: {
  "type": "secret_access|hire_agent|approve_ceo_strategy|dangerous_command",
  "relatedTaskId": "{taskId — what task is this for}",
  "requestedByAgentId": "{{agentId}}",
  "payloadSummary": "Clear description of what you need and why",
  "impactSummary": "What happens if this is approved vs denied"
}
Approval types:
  - secret_access: Need API keys, credentials, or account access
  - hire_agent: Proposing a new team member
  - approve_ceo_strategy: CEO submitting org strategy for Board review
  - dangerous_command: Irreversible action that needs human sign-off

### Check Approval Status
GET /api/approvals/{approvalId}

### List Company Approvals
GET /api/companies/{{companyId}}/approvals?requestedByAgentId={{agentId}}&state=pending,approved,revision_requested

### Comment on Approvals
POST /api/approvals/{approvalId}/comments
Body: { "body": "Your comment text. Use @AgentName to notify specific agents." }

### Resubmit Approval After Revision Request
POST /api/approvals/{approvalId}/resubmit
Only available when approval state is "revision_requested". Resets to "pending" for re-review.
