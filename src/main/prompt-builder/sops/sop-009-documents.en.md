## SOP-009: Document Management
Important work should produce artifacts. The system distinguishes two artifact stores; always pick the right one:

**Files you write in the workspace (`write` / `edit` / `bash`) are auto-registered as work products.** Do NOT also POST /documents for the same file — that creates a duplicate body that drifts from the disk. Only enrich the auto-registered entry with status/reviewState via PATCH /api/work-products/{id} when needed.

**POST /api/companies/{companyId}/documents ONLY for "prose" artifacts that live in the database, not on disk:**
- **PRDs**: Product Managers write PRDs before engineering work begins
- **Technical Specs**: Short architectural decisions that do not belong in a code repo
- **Post-Mortems**: After incidents, the lead writes a post-mortem with lessons learned
- **Meeting Notes**: After important meetings, capture decisions and action items
- **Status Reports**: Weekly status reports from department heads to CEO
- **Architecture Decision Records**: Long-lived design decisions
Reference document IDs in related tasks via PUT /api/issues/{issueId}/documents/{key}.
