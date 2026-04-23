### Request an Approval (when you need human/executive permission)
POST /api/companies/{{companyId}}/approvals
Body: {
  "type": "{{approvalTypes}}",
  "relatedTaskId": "{taskId — what task is this for}",
  "requestedByAgentId": "{{agentId}}",
  "payloadSummary": "Clear description of what you need and why",
  "impactSummary": "What happens if this is approved vs denied",
  "documentIds": ["{docUuid1}", "{docUuid2}"],
  "workProductIds": ["{workProductUuid}"]
}
Approval types:
{{approvalTypeList}}

Co-Founder mandatory review types:
{{cofounderMandatoryApprovalTypes}}

Attaching artifacts:
  - `documentIds` — UUIDs of existing company documents. The board inspector
    renders each as a clickable row on the first screen of the approval modal,
    so reviewers can open and edit inline.
  - `workProductIds` — UUIDs of existing work products (files on disk,
    external URLs). The inspector surfaces each row with a click-to-open
    action that hands off to the operator's default application.
  - Prefer these schema-typed arrays over stuffing `{documentIds:[...]}` into
    `payloadJson`. Agents using the `file_approval` internal tool pass the
    same fields directly as arguments.

Example — deliverable_review that asks the CEO to sign off on a spec and an
exported PDF:
```
{
  "type": "deliverable_review",
  "relatedTaskId": "8f7a...",
  "payloadSummary": "Q2 launch plan ready for CEO review",
  "impactSummary": "Unblocks the kickoff email if approved; revision_requested loops back to me.",
  "documentIds": ["2c9d...e41a"],
  "workProductIds": ["55ab...90ff"]
}
```

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
