import type { DatabaseSync } from "node:sqlite";
import type { CreateMeetingInput, DeleteMeetingInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

export class MeetingService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  create(input: CreateMeetingInput): string {
    const id = createId("mtg");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into meetings(id, org_id, title, meeting_type, status, scheduled_at, duration_minutes, agenda, notes, decisions, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.title.trim(), input.meetingType, "scheduled", input.scheduledAt, input.durationMinutes, input.agenda.trim(), "", "", now, now);
    this.audit.record({
      orgId: input.orgId,
      entityType: "meeting",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { title: input.title.trim(), meetingType: input.meetingType },
    });
    return id;
  }

  delete(input: DeleteMeetingInput): void {
    const result = this.db.prepare("delete from meetings where id = ? and org_id = ?").run(input.meetingId, input.orgId);
    if (result.changes === 0) throw new Error("Meeting was not found.");
  }
}
