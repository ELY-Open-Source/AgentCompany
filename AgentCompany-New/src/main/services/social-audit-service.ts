import type { DatabaseSync } from "node:sqlite";
import { createId } from "../../shared/ids";

type SocialAuditMetadata = Record<string, unknown>;

export interface RecordSocialAuditInput {
  orgId: string;
  socialAccountId: string | null;
  sourceType: string;
  sourceId: string | null;
  eventType: string;
  actorType: string;
  actorId: string | null;
  policyDecision: string;
  evidenceFileId?: string | null;
  metadata: SocialAuditMetadata;
  createdAt?: string;
}

export class SocialAuditService {
  constructor(private readonly db: DatabaseSync) {}

  record(input: RecordSocialAuditInput): string {
    const id = createId("saud");
    this.db.prepare(`
      insert into social_audit_records(
        id, org_id, social_account_id, source_type, source_id, event_type,
        actor_type, actor_id, policy_decision, evidence_file_id, metadata_json, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      input.socialAccountId,
      requireText(input.sourceType, "Social audit source type is required."),
      input.sourceId,
      requireText(input.eventType, "Social audit event type is required."),
      requireText(input.actorType, "Social audit actor type is required."),
      input.actorId,
      requireText(input.policyDecision, "Social audit policy decision is required."),
      input.evidenceFileId ?? null,
      JSON.stringify(input.metadata),
      input.createdAt ?? new Date().toISOString(),
    );
    return id;
  }
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}
