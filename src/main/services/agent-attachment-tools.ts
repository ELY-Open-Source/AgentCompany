import { readVerifiedFile } from "./files/file-object-store";
import type { DatabaseSync } from "node:sqlite";
import { FILE_SCAN_STATE } from "../../shared/domain";
import { requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { JsonRecord } from "./provider-http";
import type { ToolDefinition } from "./provider-tool-turn";
import { PAGE_TOOL_PROPERTIES, pageText, readPageArgs } from "./text-paging";

export const ATTACHMENT_TOOLS: ToolDefinition[] = [
  {
    name: "read_attachment",
    description: "Read a file attached to a message or handed off to you, by the file_id shown next to the message — whole, a range of lines, or only the lines matching a search.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { file_id: { type: "string" }, ...PAGE_TOOL_PROPERTIES },
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
  const file = deps.db.prepare("select name, storage_path, sha256, scan_state from file_objects where id = ? and org_id = ?")
    .get(fileId, ctx.orgId) as { name: string; storage_path: string; sha256: string; scan_state: string } | undefined;
  if (!file) throw new Error(`No file with file_id "${fileId}".`);
  if (file.scan_state !== FILE_SCAN_STATE.APPROVED) throw new Error(`${file.name} was blocked by the file scan and cannot be read.`);
  const bytes = readVerifiedFile({ name: file.name, storagePath: file.storage_path, sha256: file.sha256 });
  const content = utf8Text(bytes);
  if (content === null) return `${file.name} is a binary file (${bytes.length} bytes); it has no text to read.`;
  return pageText(file.name, content, readPageArgs(args));
}

function utf8Text(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
