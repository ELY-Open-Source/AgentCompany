### Schedule a Meeting
POST /api/companies/{{companyId}}/meetings
Body: {
  "type": "standup|sprint_planning|sprint_review|retrospective|one_on_one|all_hands|department_sync|incident_review|hiring_committee|budget_review",
  "title": "Meeting title",
  "participantAgentIds": "Serialized JSON array of agent ids",
  "scheduledAt": "ISO 8601 datetime",
  "durationMinutes": 30,
  "agendaJson": "Serialized JSON array of agenda items"
}

### Update Meeting (add notes, decisions)
PATCH /api/meetings/{meetingId}
Body: {
  "notesJson": "Serialized JSON array of meeting notes",
  "decisionsJson": "Serialized JSON array of decisions",
  "actionItemsJson": "Serialized JSON array of action items",
  "status": "completed"
}
