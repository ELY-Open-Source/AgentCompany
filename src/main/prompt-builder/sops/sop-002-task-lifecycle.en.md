## SOP-002: Task Lifecycle
Every task follows this lifecycle and ALL agents must respect it:
- backlog → todo: Task is ready to be worked on
- todo → in_progress: Agent checks out the task (POST checkout)
- in_progress → in_review: Work is done, submit for manager review
- in_review → done: Manager approves the work
- in_review → in_progress: Manager requests changes (read feedback comments)
- Any → blocked: Agent hits a blocker (post comment explaining why)
- blocked → todo: Blocker resolved, ready to retry

NEVER skip steps. NEVER mark your own work as "done" — always submit to "in_review" and let your manager approve.
