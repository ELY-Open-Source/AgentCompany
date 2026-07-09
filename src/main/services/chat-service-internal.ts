import type { DatabaseSync } from "node:sqlite";
import type { CreateChatSpaceInput, SendMessageInput } from "../../shared/commands";
import type { FileScanState } from "../../shared/domain";
import { parseBoardCommand } from "./board-intervention-service";

export const RETENTION_POLICIES = new Set(["standard_365d", "restricted_365d"]);

export const ALLOWED_SLASH_COMMANDS = new Set([
  "agent",
  "handoff",
  "approve",
  "deny",
  "skill",
  "runbook",
  "file",
  "escalate",
  "board",
]);

export interface FileAttachmentRow {
  id: string;
  sha256: string;
  scan_state: FileScanState;
  scan_labels_json: string;
  storage_path: string;
  owner_type: string;
  owner_id: string | null;
}

export interface SpaceRow {
  id: string;
  org_id: string;
  name: string;
  visibility: string;
  space_type: string;
}

export interface ThreadRow {
  id: string;
  board_state: string;
  controlled_by_type: "employee" | "agent" | "board" | null;
  controlled_by_id: string | null;
}

export interface PrincipalRef {
  type: "employee" | "agent";
  id: string;
}

export interface SlashInvocation {
  command: string;
  args: string;
}

export interface ApprovalRequester {
  type: "employee" | "agent" | "system";
  id: string | null;
}

export function parseSlashInvocation(body: string): SlashInvocation | null {
  const match = body.match(/^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2] ?? "" };
}

export function validateSlashInvocation(slash: SlashInvocation): void {
  if (slash.command === "escalate" && slash.args.trim().length === 0) {
    throw new Error("Slash command /escalate requires details.");
  }
  if (slash.command === "approve" || slash.command === "deny") parseApprovalDecisionTarget(slash);
  if (slash.command === "board") parseBoardCommand(slash.args);
}

export function parseApprovalDecisionTarget(slash: SlashInvocation): string {
  const approvalId = slash.args.trim().split(/\s+/, 1)[0] ?? "";
  if (!approvalId) throw new Error(`Slash command /${slash.command} requires an approval id.`);
  return approvalId;
}

export function firstToken(value: string): string {
  return value.trim().split(/\s+/, 1)[0] ?? "";
}

export function approvalRequester(senderType: SendMessageInput["senderType"], sender: PrincipalRef | null): ApprovalRequester {
  if (senderType === "system") return { type: "system", id: null };
  if (!sender) throw new Error("Approval requester is missing.");
  if (senderType === "agent") return { type: "agent", id: sender.id };
  return { type: "employee", id: sender.id };
}

export function spaceName(db: DatabaseSync, spaceId: string): string {
  const row = db.prepare("select name from chat_spaces where id = ?").get(spaceId) as { name: string } | undefined;
  if (!row) throw new Error("Chat space was not found.");
  return row.name;
}

export function createThreadTitle(body: string): string {
  const firstLine = body.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

export function retentionPolicy(value: string | undefined, visibility: CreateChatSpaceInput["visibility"]): string {
  const policy = value ?? (visibility === "restricted" ? "restricted_365d" : "standard_365d");
  if (!RETENTION_POLICIES.has(policy)) throw new Error("Chat retention policy is invalid.");
  return policy;
}
