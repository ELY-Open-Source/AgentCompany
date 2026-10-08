import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { parseApprovalPin, type ApprovalDrift, type ApprovalPin } from "../../shared/approval-pin";

const CHECKED_APPROVALS = 24;

/** Approved deliverables whose content no longer matches what was approved, read from disk and the library now. */
export function approvalDrifts(db: DatabaseSync, orgId: string): Record<string, ApprovalDrift> {
  const rows = db.prepare(`
    select id, subject_snapshot from approvals
    where org_id = ? and state = 'approved' and kind = 'deliverable_review' and subject_snapshot is not null
    order by decided_at desc limit ?
  `).all(orgId, CHECKED_APPROVALS) as Array<{ id: string; subject_snapshot: string }>;
  const drifts: Record<string, ApprovalDrift> = {};
  for (const row of rows) {
    const pin = parseApprovalPin(row.subject_snapshot);
    const drift = pin ? driftOf(db, orgId, pin) : null;
    if (drift) drifts[row.id] = drift;
  }
  return drifts;
}

function driftOf(db: DatabaseSync, orgId: string, pin: ApprovalPin): ApprovalDrift | null {
  if (pin.kind === "file") {
    if (!existsSync(pin.storagePath)) return "removed";
    return createHash("sha256").update(readFileSync(pin.storagePath)).digest("hex") === pin.sha256 ? null : "changed";
  }
  const document = db.prepare("select version from documents where id = ? and org_id = ?").get(pin.documentId, orgId) as { version: number } | undefined;
  if (!document) return "removed";
  return document.version === pin.version ? null : "changed";
}
