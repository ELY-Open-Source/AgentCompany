import type { DatabaseSync } from "node:sqlite";
import { withSavepoint } from "../database/connection";
import { describeSend } from "./agent-message-presence";
import { optionalString, optionalStringArray, requireString } from "./agent-tool-args";
import type { AgentToolContext, AgentToolDeps } from "./agent-tools";
import type { JsonRecord } from "./provider-http";

export function sendMessageTool(deps: AgentToolDeps, ctx: AgentToolContext, args: JsonRecord): string {
  const channel = optionalString(args.channel);
  const to = optionalString(args.to);
  const body = requireString(args.body, "body");
  const threadId = optionalString(args.thread_id);
  const attachmentFileIds = optionalStringArray(args.attachment_file_ids, "attachment_file_ids");
  if (Boolean(channel) === Boolean(to)) throw new Error('Pass exactly one of "to" (direct message) or "channel".');

  const destination = to
    ? directSpaceWith(deps, ctx, to)
    : channelSpace(deps.db, ctx.orgId, channel!);

  const sent = withSavepoint(deps.db, "agent_send_message", () => {
    const messageId = deps.chat.sendMessage({
      orgId: ctx.orgId,
      spaceId: destination.spaceId,
      threadId,
      senderType: "agent",
      senderId: ctx.agent.id,
      bodyMd: body,
      attachmentFileIds,
    });
    const row = deps.db.prepare("select thread_id from chat_messages where id = ?").get(messageId) as { thread_id: string };
    return { messageId, threadId: row.thread_id };
  });
  if (destination.kind === "direct") {
    return [
      `Your direct message to ${destination.counterpartName} is delivered; they can see it and reply in your conversation.`,
      `To stay in this conversation, reply with to="${destination.counterpartName}" and thread_id="${sent.threadId}".`,
    ].join(" ");
  }
  return describeSend(deps.db, ctx.agent.id, destination.label, destination.spaceId, sent.messageId, sent.threadId);
}

interface ChannelDestination {
  kind: "channel";
  spaceId: string;
  label: string;
}

interface DirectDestination {
  kind: "direct";
  spaceId: string;
  counterpartName: string;
}

function channelSpace(db: DatabaseSync, orgId: string, channel: string): ChannelDestination {
  const space = db.prepare(
    "select id from chat_spaces where org_id = ? and lower(name) = lower(?) and space_type <> 'direct' limit 1",
  ).get(orgId, channel) as { id: string } | undefined;
  if (!space) throw new Error(`No channel named "${channel}".`);
  return { kind: "channel", spaceId: space.id, label: channel };
}

function directSpaceWith(deps: AgentToolDeps, ctx: AgentToolContext, teammateName: string): DirectDestination {
  const counterpart = resolveTeammateByName(deps.db, ctx.orgId, teammateName);
  if (counterpart.type === "agent" && counterpart.id === ctx.agent.id) {
    throw new Error("You cannot open a direct conversation with yourself.");
  }
  const spaceId = deps.chat.ensureDirectSpace(
    ctx.orgId,
    { type: "agent", id: ctx.agent.id },
    { type: counterpart.type, id: counterpart.id },
  );
  return { kind: "direct", spaceId, counterpartName: counterpart.name };
}

function resolveTeammateByName(
  db: DatabaseSync,
  orgId: string,
  name: string,
): { type: "agent" | "employee"; id: string; name: string } {
  const trimmed = name.trim();
  const agent = db.prepare(
    "select id, name from agents where org_id = ? and lower(name) = lower(?) and lifecycle = 'active' limit 1",
  ).get(orgId, trimmed) as { id: string; name: string } | undefined;
  if (agent) return { type: "agent", id: agent.id, name: agent.name };
  const employee = db.prepare(
    "select id, display_name from employees where org_id = ? and lower(display_name) = lower(?) limit 1",
  ).get(orgId, trimmed) as { id: string; display_name: string } | undefined;
  if (employee) return { type: "employee", id: employee.id, name: employee.display_name };
  throw new Error(`No teammate named "${name}".`);
}
