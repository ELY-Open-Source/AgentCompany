import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { FILE_SCAN_STATE } from "../../shared/domain";
import { requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { JsonRecord } from "./provider-http";
import type { ToolDefinition } from "./provider-tool-turn";

const ATTACHMENT_CHAR_LIMIT = 24_000;

export const ATTACHMENT_TOOLS: ToolDefinition[] = [
  {
    name: "read_attachment",
    description: "Read a file attached to a message or handed off to you, by the file_id shown next to the message.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { file_id: { type: "string" } },
      required: ["file_id"],
    },
  },
];

/** " [attachments: a.md (file_id=…)]" for a message, or "". */
export function attachmentNote(db: DatabaseSync, messageId: string): string {
  const files = db.prepare(`
    select f.id, f.name from chat_attachments ca join file_objects f on f.id = ca.file_id
    where ca.message_id = ? order by f.name
  `).all(messageId) as Array<{ id: string; name: string }>;
  if (files.length === 0) return "";
  return ` [attachments: ${files.map((file) => `${file.name} (file_id=${file.id})`).join(", ")}]`;
}

export function readAttachmentTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const fileId = requireString(args.file_id, "file_id");
  const file = deps.db.prepare("select name, storage_path, scan_state from file_objects where id = ? and org_id = ?")
    .get(fileId, ctx.orgId) as { name: string; storage_path: string; scan_state: string } | undefined;
  if (!file) throw new Error(`No file with file_id "${fileId}".`);
  if (file.scan_state !== FILE_SCAN_STATE.APPROVED) throw new Error(`${file.name} was blocked by the file scan and cannot be read.`);
  const bytes = readFileSync(file.storage_path);
  const content = utf8Text(bytes);
  if (content === null) return `${file.name} is a binary file (${bytes.length} bytes); it has no text to read.`;
  if (content.length <= ATTACHMENT_CHAR_LIMIT) return content;
  return `${content.slice(0, ATTACHMENT_CHAR_LIMIT)}\n\n[truncated: showing the first ${ATTACHMENT_CHAR_LIMIT} of ${content.length} characters]`;
}

function utf8Text(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
