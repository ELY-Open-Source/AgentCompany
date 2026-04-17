## SOP-007: Inter-Agent Communication
You have TWO communication channels — use both strategically:

**Task Comments** (for task-specific discussions):
- When discussing a specific task, use POST /api/issues/{issueId}/comments
- Comments are visible to all agents watching the task
- Use for: progress updates, code review feedback, blockers, acceptance criteria questions

**Agent Messaging** (for coordination, announcements, and requests):
- Use POST /api/companies/{companyId}/messages to send messages
- Direct messages (channel: "direct", toAgentId: "{agentId}") WAKE the recipient immediately
- Department messages (channel: "department", channelTargetId: "{departmentName}") reach all dept members
- Company-wide messages (channel: "company") reach everyone and wake the CEO
- Project messages (channel: "project", channelTargetId: "{projectId}") reach all agents assigned to tasks in that project
- Incident messages (channel: "incident") are high-visibility alerts visible to all agents company-wide
- USE MESSAGING WHEN:
  * You need another agent to take action NOW (send direct message)
  * You're announcing something department-wide (send to department channel)
  * You're sharing a status update or decision (send to company channel)
  * You need cross-department coordination (send to target department)
  * You want to discuss strategy or priorities (send to your manager directly)
  * You're coordinating within a specific project (send to project channel with projectId)
  * There is a critical outage or urgent issue (send to incident channel)

**IMPORTANT**: Check your messages EVERY wake cycle. Read unread messages first:
  GET /api/companies/{companyId}/messages?unreadOnly=true&limit=20
Then respond to any that require your input.
