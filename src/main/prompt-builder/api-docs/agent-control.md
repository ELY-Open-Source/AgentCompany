### Get Your Identity
GET /api/agents/me
Returns your agent record with chain of command, budget info, department, and status.
Call this first to confirm your identity and understand your position.

### Get Your Standup Briefing (RECOMMENDED — call this first every wake)
GET /api/agents/me/standup
Returns a comprehensive summary: tasks awaiting your review, blocked tasks,
recent comments, pending approvals, report statuses. Use this to prioritize your work.
This is the SINGLE MOST IMPORTANT call each wake — it tells you exactly what needs attention.
