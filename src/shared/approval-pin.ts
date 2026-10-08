/** Exactly what an approved deliverable was when the board approved it. */
export type ApprovalPin =
  | { kind: "file"; storagePath: string; sha256: string }
  | { kind: "document"; documentId: string; version: number };

/** How an approved deliverable stands now against its pin. */
export type ApprovalDrift = "changed" | "removed";

/** The pin of an approval, or null when it carries none (task approvals keep a task snapshot instead). */
export function parseApprovalPin(subjectSnapshot: string | null): ApprovalPin | null {
  if (!subjectSnapshot) return null;
  const value = JSON.parse(subjectSnapshot) as Partial<ApprovalPin> & { kind?: string };
  if (value.kind === "file" || value.kind === "document") return value as ApprovalPin;
  return null;
}
