import type { DatabaseSync } from "node:sqlite";
import type { ReadAll } from "./helpers";
import { ensureId, nowIso } from "./helpers";

/**
 * Meeting row shape returned by listMeetings / getMeeting — used by
 * meeting routes. Mirrors the historical inline SQL projection so HTTP
 * response bodies stay byte-stable.
 */
export type MeetingListRow = {
  id: string;
  companyId: string;
  type: string;
  title: string;
  organizerAgentId: string;
  participantAgentIds: string;
  scheduledAt: string;
  durationMinutes: number;
  agendaJson: string;
  notesJson: string | null;
  decisionsJson: string | null;
  actionItemsJson: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

const MEETING_LIST_COLUMNS =
  "select id, company_id as companyId, type, title, organizer_agent_id as organizerAgentId, participant_agent_ids as participantAgentIds, scheduled_at as scheduledAt, duration_minutes as durationMinutes, agenda_json as agendaJson, notes_json as notesJson, decisions_json as decisionsJson, action_items_json as actionItemsJson, status, created_at as createdAt, updated_at as updatedAt from meetings";

/**
 * Sprint row shape returned by listSprints — used by
 * GET /api/companies/:companyId/sprints. Mirrors the historical inline
 * SQL projection.
 */
export type SprintListRow = {
  id: string;
  companyId: string;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  status: string;
  retrospectiveNotes: string | null;
  velocityPoints: number;
  completedPoints: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Knowledge entry row shape returned by listKnowledgeEntries — used by
 * GET /api/companies/:companyId/knowledge. Mirrors the historical inline
 * SQL projection so HTTP responses stay byte-stable.
 */
export type KnowledgeListRow = {
  id: string;
  companyId: string;
  category: string;
  topic: string;
  content: string;
  authorAgentId: string;
  importance: string;
  tagsJson: string;
  referencedEntityType: string | null;
  referencedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function buildKnowledgeMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
) {
  return {
    listMeetings(companyId: string): MeetingListRow[] {
      return readAll<MeetingListRow>(
        `${MEETING_LIST_COLUMNS} where company_id = ? order by scheduled_at desc`,
        companyId,
      );
    },

    getMeeting(meetingId: string, companyId: string): MeetingListRow | null {
      const row = getDb()
        .prepare(`${MEETING_LIST_COLUMNS} where id = ? and company_id = ? limit 1`)
        .get(meetingId, companyId) as MeetingListRow | undefined;
      return row ?? null;
    },

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

    /**
     * Returns all knowledge entries for a company, ordered by updated_at desc.
     * Used by GET /api/companies/:companyId/knowledge.
     */
    listKnowledgeEntries(companyId: string): KnowledgeListRow[] {
      return readAll<KnowledgeListRow>(
        "select id, company_id as companyId, category, topic, content, author_agent_id as authorAgentId, importance, tags_json as tagsJson, referenced_entity_type as referencedEntityType, referenced_entity_id as referencedEntityId, created_at as createdAt, updated_at as updatedAt from knowledge_base where company_id = ? order by updated_at desc",
        companyId,
      );
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

    /**
     * Collects the set of deliverable signals produced by a single run.
     * Each signal reflects a distinct artifact surface:
     *
     *  - knowledge entry bound to the run (or written during its window)
     *  - document bound to the run (or written during its window)
     *  - filesystem `work_product` registered with `created_by_run_id = run`
     *  - substantial task comment (>100 chars) posted during the run window
     *
     * The caller in `automation-run-completion` decides which signals are
     * acceptable for a given task type, so schema changes to any of the
     * source tables surface here rather than in an opaque boolean.
     */
    collectRunDeliverableSignals(
      runId: string,
      companyId: string,
      taskId: string,
    ): {
      hasKnowledgeEntry: boolean;
      hasDocument: boolean;
      hasWorkProduct: boolean;
      hasSubstantialComment: boolean;
    } {
      const causalKnowledge = readAll<{ id: string }>(
        "select id from knowledge_base where company_id = ? and source_run_id = ? limit 1",
        companyId, runId,
      );
      const legacyKnowledge = causalKnowledge.length === 0
        ? readAll<{ id: string }>(
            "select id from knowledge_base where company_id = ? and source_run_id is null and created_at >= (select started_at from runs where id = ?) limit 1",
            companyId, runId,
          )
        : [];

      const causalDocs = readAll<{ id: string }>(
        "select id from documents where company_id = ? and source_run_id = ? limit 1",
        companyId, runId,
      );
      const legacyDocs = causalDocs.length === 0
        ? readAll<{ id: string }>(
            "select id from documents where company_id = ? and source_run_id is null and created_at >= (select started_at from runs where id = ?) limit 1",
            companyId, runId,
          )
        : [];

      // Pre-v45 provenance was frozen at creation; post-v45 every upsert
      // refreshes `last_touched_by_run_id`. Querying by either side keeps
      // the deliverable signal correct for a run that edited a pre-existing
      // work product as well as a run that created a new one.
      const workProducts = readAll<{ id: string }>(
        "select id from work_products where company_id = ? and (last_touched_by_run_id = ? or created_by_run_id = ?) limit 1",
        companyId, runId, runId,
      );

      const recentComments = readAll<{ body: string }>(
        "select body from task_comments where task_id = ? and created_at >= (select started_at from runs where id = ?) and length(body) > 100",
        taskId, runId,
      );

      return {
        hasKnowledgeEntry: causalKnowledge.length > 0 || legacyKnowledge.length > 0,
        hasDocument: causalDocs.length > 0 || legacyDocs.length > 0,
        hasWorkProduct: workProducts.length > 0,
        hasSubstantialComment: recentComments.length > 0,
      };
    },

    /**
     * Returns all sprints for a company, ordered by start_date desc.
     * Used by GET /api/companies/:companyId/sprints.
     */
    listSprints(companyId: string): SprintListRow[] {
      return readAll<SprintListRow>(
        "select id, company_id as companyId, name, goal, start_date as startDate, end_date as endDate, status, retrospective_notes as retrospectiveNotes, velocity_points as velocityPoints, completed_points as completedPoints, created_at as createdAt, updated_at as updatedAt from sprints where company_id = ? order by start_date desc",
        companyId,
      );
    },
  };
}
