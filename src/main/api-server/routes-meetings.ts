import { z } from "zod";
import { validateTaskCreation } from "../task-quality-gates";
import type { AgentApiServer } from "./server-core";

type MeetingRow = {
  id: string; companyId: string; type: string; title: string;
  organizerAgentId: string; participantAgentIds: string;
  scheduledAt: string; durationMinutes: number;
  agendaJson: string; notesJson: string | null;
  decisionsJson: string | null; actionItemsJson: string | null;
  status: string; createdAt: string; updatedAt: string;
};

export function registerMeetingRoutes(server: AgentApiServer) {
  const db = server.db;
  const onDomainChanged = server.onDomainChanged;
  const onWakeAgent = server.onWakeAgent;

  server.addRoute("POST", "/api/companies/:companyId/meetings", (_req, res, params, token, body) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }

    const meetingCreateSchema = z.object({
      type: z.string().default("department_sync"),
      title: z.string().default("Meeting"),
      participantAgentIds: z.string().default("[]"),
      scheduledAt: z.string().default(new Date().toISOString()),
      durationMinutes: z.number().default(30),
      agendaJson: z.string().default("[]"),
    });

    const parsed = meetingCreateSchema.safeParse(body);
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid meeting payload", details: parsed.error.issues });
      return;
    }

    const input = parsed.data;
    try {
      const parsedParticipants = JSON.parse(input.participantAgentIds) as string[];
      for (const agentId of parsedParticipants) {
        if (typeof agentId !== "string" || !db.belongsToCompany("agents", agentId, token.companyId)) {
          server.json(res, 400, { error: "Meeting participants must belong to the current company" });
          return;
        }
      }
    } catch {
      server.json(res, 400, { error: "participantAgentIds must be a JSON array of agent ids" });
      return;
    }
    const id = db.saveMeeting({
      companyId: token.companyId,
      type: input.type,
      title: input.title,
      organizerAgentId: token.agentId,
      participantAgentIds: input.participantAgentIds,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      agendaJson: input.agendaJson,
      status: "scheduled",
    });
    onDomainChanged();
    server.json(res, 201, { id });
  });

  server.addRoute("GET", "/api/companies/:companyId/meetings", (_req, res, params, token) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const meetings = db.queryAll<MeetingRow>(
      "select id, company_id as companyId, type, title, organizer_agent_id as organizerAgentId, participant_agent_ids as participantAgentIds, scheduled_at as scheduledAt, duration_minutes as durationMinutes, agenda_json as agendaJson, notes_json as notesJson, decisions_json as decisionsJson, action_items_json as actionItemsJson, status, created_at as createdAt, updated_at as updatedAt from meetings where company_id = ? order by scheduled_at desc",
      token.companyId,
    );
    server.json(res, 200, meetings);
  });

  server.addRoute("PATCH", "/api/meetings/:meetingId", (_req, res, params, token, body) => {
    const rows = db.queryAll<MeetingRow>(
      "select id, company_id as companyId, type, title, organizer_agent_id as organizerAgentId, participant_agent_ids as participantAgentIds, scheduled_at as scheduledAt, duration_minutes as durationMinutes, agenda_json as agendaJson, notes_json as notesJson, decisions_json as decisionsJson, action_items_json as actionItemsJson, status, created_at as createdAt, updated_at as updatedAt from meetings where id = ? and company_id = ? limit 1",
      params.meetingId, token.companyId,
    );
    const existing = rows[0] ?? null;
    if (!existing) {
      server.json(res, 404, { error: "Meeting not found" });
      return;
    }

    const meetingUpdateSchema = z.object({
      type: z.string().optional(),
      title: z.string().optional(),
      notesJson: z.string().optional(),
      decisionsJson: z.string().optional(),
      actionItemsJson: z.string().optional(),
      status: z.string().optional(),
      scheduledAt: z.string().optional(),
    });

    const parsed = meetingUpdateSchema.safeParse(body);
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid meeting update payload", details: parsed.error.issues });
      return;
    }

    const data = parsed.data;
    let actionItems: Array<{ title?: string; assigneeAgentId?: string; description?: string }> = [];
    if (data.actionItemsJson) {
      try {
        actionItems = JSON.parse(data.actionItemsJson) as Array<{ title?: string; assigneeAgentId?: string; description?: string }>;
      } catch {
        server.json(res, 400, { error: "actionItemsJson must be valid JSON" });
        return;
      }
      for (const item of actionItems) {
        if (item.assigneeAgentId && !db.belongsToCompany("agents", item.assigneeAgentId, token.companyId)) {
          server.json(res, 400, { error: "Meeting action item assignees must belong to the current company" });
          return;
        }
      }
    }
    db.saveMeeting({
      id: params.meetingId,
      companyId: token.companyId,
      type: data.type ?? "department_sync",
      title: data.title ?? "Meeting",
      notesJson: data.notesJson,
      decisionsJson: data.decisionsJson,
      actionItemsJson: data.actionItemsJson,
      status: data.status,
      scheduledAt: data.scheduledAt ?? new Date().toISOString(),
    });
    onDomainChanged();
    // When action items are added, create tasks for them automatically
    if (actionItems.length > 0) {
      for (const item of actionItems) {
        if (item.title && typeof item.title === "string") {
          const meetingTaskValidation = validateTaskCreation(
            { title: item.title, description: item.description ?? `Action item from meeting: ${data.title ?? existing.title}` },
            false,
          );
          if (!meetingTaskValidation.valid) {
            // Log but skip invalid meeting action items rather than failing the whole request
            continue;
          }
          db.saveTask({
            companyId: token.companyId,
            title: item.title,
            description: item.description ?? `Action item from meeting: ${data.title ?? existing.title}`,
            assigneeAgentId: item.assigneeAgentId ?? null,
            status: item.assigneeAgentId ? "todo" : "backlog",
            priority: "medium",
          });
          if (item.assigneeAgentId) {
            onWakeAgent(item.assigneeAgentId, token.companyId, "assignment");
          }
        }
      }
    }
    server.json(res, 200, { updated: true });
  });
}
