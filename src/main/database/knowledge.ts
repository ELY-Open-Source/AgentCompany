import type { DatabaseSync } from "node:sqlite";
import type { ReadAll } from "./helpers";
import { ensureId, nowIso } from "./helpers";

export function buildKnowledgeMethods(
  getDb: () => DatabaseSync,
  _readAll: ReadAll,
) {
  return {
    saveMeeting(input: {
      id?: string | null; companyId: string; type: string; title: string; organizerAgentId?: string | null;
      participantAgentIds?: string; scheduledAt: string; durationMinutes?: number;
      agendaJson?: string; notesJson?: string; decisionsJson?: string; actionItemsJson?: string;
      status?: string;
    }) {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      const existing = getDb().prepare("select id from meetings where id = ?").get(id) as { id: string } | undefined;
      if (existing) {
        getDb().prepare(
          "update meetings set type = ?, title = ?, organizer_agent_id = ?, participant_agent_ids = ?, scheduled_at = ?, duration_minutes = ?, agenda_json = ?, notes_json = ?, decisions_json = ?, action_items_json = ?, status = ?, updated_at = ? where id = ?",
        ).run(input.type, input.title, input.organizerAgentId ?? null, input.participantAgentIds ?? "[]", input.scheduledAt, input.durationMinutes ?? 30, input.agendaJson ?? "[]", input.notesJson ?? "[]", input.decisionsJson ?? "[]", input.actionItemsJson ?? "[]", input.status ?? "scheduled", ts, id);
      } else {
        getDb().prepare(
          "insert into meetings (id, company_id, type, title, organizer_agent_id, participant_agent_ids, scheduled_at, duration_minutes, agenda_json, notes_json, decisions_json, action_items_json, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, input.companyId, input.type, input.title, input.organizerAgentId ?? null, input.participantAgentIds ?? "[]", input.scheduledAt, input.durationMinutes ?? 30, input.agendaJson ?? "[]", input.notesJson ?? "[]", input.decisionsJson ?? "[]", input.actionItemsJson ?? "[]", input.status ?? "scheduled", ts, ts);
      }
      return id;
    },

    deleteMeeting(id: string, companyId: string) {
      getDb().prepare("delete from meetings where id = ? and company_id = ?").run(id, companyId);
    },

    saveKnowledgeEntry(input: {
      id?: string | null; companyId: string; category: string; topic: string; content: string;
      authorAgentId?: string | null; importance?: string; tagsJson?: string;
      referencedEntityType?: string | null; referencedEntityId?: string | null;
      sourceRunId?: string | null;
    }) {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      const existing = getDb().prepare("select id from knowledge_base where id = ?").get(id) as { id: string } | undefined;
      if (existing) {
        getDb().prepare(
          "update knowledge_base set category = ?, topic = ?, content = ?, author_agent_id = ?, importance = ?, tags_json = ?, referenced_entity_type = ?, referenced_entity_id = ?, source_run_id = coalesce(?, source_run_id), updated_at = ? where id = ?",
        ).run(input.category, input.topic, input.content, input.authorAgentId ?? null, input.importance ?? "medium", input.tagsJson ?? "[]", input.referencedEntityType ?? null, input.referencedEntityId ?? null, input.sourceRunId ?? null, ts, id);
      } else {
        getDb().prepare(
          "insert into knowledge_base (id, company_id, category, topic, content, author_agent_id, importance, tags_json, referenced_entity_type, referenced_entity_id, source_run_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, input.companyId, input.category, input.topic, input.content, input.authorAgentId ?? null, input.importance ?? "medium", input.tagsJson ?? "[]", input.referencedEntityType ?? null, input.referencedEntityId ?? null, input.sourceRunId ?? null, ts, ts);
      }
      return id;
    },

    deleteKnowledgeEntry(id: string, companyId: string) {
      getDb().prepare("delete from knowledge_base where id = ? and company_id = ?").run(id, companyId);
    },

    saveSprint(input: {
      id?: string | null; companyId: string; name: string; goal?: string;
      startDate: string; endDate: string; status?: string; retrospectiveNotes?: string;
      velocityPoints?: number; completedPoints?: number;
    }) {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      const existing = getDb().prepare("select id from sprints where id = ?").get(id) as { id: string } | undefined;
      if (existing) {
        getDb().prepare(
          "update sprints set name = ?, goal = ?, start_date = ?, end_date = ?, status = ?, retrospective_notes = ?, velocity_points = ?, completed_points = ?, updated_at = ? where id = ?",
        ).run(input.name, input.goal ?? "", input.startDate, input.endDate, input.status ?? "planning", input.retrospectiveNotes ?? "", input.velocityPoints ?? 0, input.completedPoints ?? 0, ts, id);
      } else {
        getDb().prepare(
          "insert into sprints (id, company_id, name, goal, start_date, end_date, status, retrospective_notes, velocity_points, completed_points, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, input.companyId, input.name, input.goal ?? "", input.startDate, input.endDate, input.status ?? "planning", input.retrospectiveNotes ?? "", input.velocityPoints ?? 0, input.completedPoints ?? 0, ts, ts);
      }
      return id;
    },

    deleteSprint(id: string, companyId: string) {
      getDb().prepare("delete from sprints where id = ? and company_id = ?").run(id, companyId);
    },
  };
}
