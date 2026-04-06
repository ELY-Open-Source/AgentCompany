/**
 * Attachment Content Resolver
 *
 * Resolves document content for message attachments so agents can actually
 * read attached documents instead of only seeing titles.
 *
 * Previously, attachments were rendered as [Attached: title] with no content.
 * Now the full document text is included, truncated within a per-message budget.
 */

import type { DocumentRecord } from "@shared/types";

interface AttachmentEntry {
  type?: string;
  id?: string;
  title?: string;
}

/**
 * Resolve attachment content from document records.
 * Returns a formatted block of document content for prompt injection,
 * with each document truncated proportionally within the total budget.
 */
export function resolveAttachmentContent(
  attachmentsJson: string,
  documents: DocumentRecord[],
  maxTotalChars: number = 8000,
): string {
  let entries: AttachmentEntry[];
  try {
    const parsed = JSON.parse(attachmentsJson);
    if (!Array.isArray(parsed) || parsed.length === 0) return "";
    entries = parsed;
  } catch {
    return "";
  }

  const docEntries = entries.filter(
    (e): e is typeof e & { id: string } => e.type === "document" && typeof e.id === "string",
  );
  if (docEntries.length === 0) return "";

  const docMap = new Map(documents.map((d) => [d.id, d]));
  const resolved: Array<{ title: string; content: string }> = [];

  for (const entry of docEntries) {
    const doc = docMap.get(entry.id);
    if (!doc || !doc.content) continue;
    resolved.push({ title: doc.title || entry.title || "Untitled", content: doc.content });
  }

  if (resolved.length === 0) return "";

  const budgetPerDoc = Math.floor(maxTotalChars / resolved.length);
  const parts: string[] = [];

  for (const { title, content } of resolved) {
    const truncated = content.length > budgetPerDoc
      ? content.slice(0, budgetPerDoc) + "..."
      : content;
    parts.push(`--- ${title} ---\n${truncated}\n---`);
  }

  return parts.join("\n\n");
}
