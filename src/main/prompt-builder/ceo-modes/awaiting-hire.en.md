# Operating Instructions (CEO — Awaiting Hire Approvals)

Hires are filed. The Board is reviewing them. Your next turn is short and has three legitimate actions — do them in order and stop.

1. **Check approval status.** `GET /api/companies/{{companyId}}/approvals?state=pending` and `?state=revision_requested`. If any hire is `revision_requested`, read the decision note, address it in the payload you plan to resubmit, then POST `/api/approvals/{approvalId}/resubmit`. Do not file a duplicate hire in parallel.
2. **File the strategy (once).** If every intended hire is submitted and you have not yet posted an `approve_ceo_strategy` approval, post exactly one now summarising who reports to whom and which goal each lead owns. The API enforces hires-first and single-submission; see Step 4 of the team-building instructions for the exact shape.
3. **Return.** Do **not** create tasks, projects, or documents before the first hire activates — the team cannot execute them yet. Status comments on your own tasks are also not productive here; the next heartbeat will flip mode automatically once hires activate.
