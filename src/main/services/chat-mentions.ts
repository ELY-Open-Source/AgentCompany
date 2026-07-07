import type { DatabaseSync } from "node:sqlite";
import { canonicalMentionHandle } from "../../shared/mention-handles";

export interface MentionTarget {
  type: "employee" | "agent" | "board" | "org_group";
  id: string;
}

interface MentionCandidate extends MentionTarget {
  handle: string;
}

export interface ResolvedMention {
  target: MentionTarget;
  offsetStart: number;
  offsetEnd: number;
}

export function resolveChatMentions(db: DatabaseSync, orgId: string, spaceId: string, body: string): ResolvedMention[] {
  const mentions: ResolvedMention[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/(^|\s)@([A-Za-z][A-Za-z0-9_-]{1,63})/g)) {
    const token = match[2];
    const target = resolveMention(db, orgId, spaceId, token);
    const offsetStart = match.index + match[1].length;
    const key = `${target.type}:${target.id}:${offsetStart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({ target, offsetStart, offsetEnd: offsetStart + token.length + 1 });
  }
  return mentions;
}

export function recordChatMentions(db: DatabaseSync, messageId: string, mentions: ResolvedMention[]): void {
  for (const mention of mentions) {
    db.prepare(`
      insert into chat_mentions(message_id, target_type, target_id, offset_start, offset_end)
      values (?, ?, ?, ?, ?)
    `).run(messageId, mention.target.type, mention.target.id, mention.offsetStart, mention.offsetEnd);
  }
}

function resolveMention(db: DatabaseSync, orgId: string, spaceId: string, token: string): MentionTarget {
  const handles = mentionLookupHandles(token);
  if (handles.has("board")) return { type: "board", id: orgId };
  if (handles.has("oncall")) return { type: "org_group", id: `${orgId}:oncall` };
  const candidates = mentionCandidates(db, orgId, spaceId).filter((candidate) => handles.has(candidate.handle));
  const unique = new Map(candidates.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate]));
  if (unique.size === 0) throw new Error(`Mention @${token} could not be resolved.`);
  if (unique.size > 1) throw new Error(`Mention @${token} is ambiguous.`);
  const target = [...unique.values()][0];
  return { type: target.type, id: target.id };
}

function mentionCandidates(db: DatabaseSync, orgId: string, spaceId: string): MentionCandidate[] {
  const employees = db.prepare(`
    select employees.id, employees.display_name
    from employees
    join chat_memberships memberships
      on memberships.principal_type = 'employee'
      and memberships.principal_id = employees.id
      and memberships.space_id = ?
    where employees.org_id = ?
  `).all(spaceId, orgId) as Array<{ id: string; display_name: string }>;
  const agents = db.prepare(`
    select agents.id, agents.name
    from agents
    join chat_memberships memberships
      on memberships.principal_type = 'agent'
      and memberships.principal_id = agents.id
      and memberships.space_id = ?
    where agents.org_id = ?
  `).all(spaceId, orgId) as Array<{ id: string; name: string }>;
  return [
    ...employees.flatMap((employee) => principalMentionHandles("employee", employee.id, employee.display_name)),
    ...agents.flatMap((agent) => principalMentionHandles("agent", agent.id, agent.name)),
  ];
}

function principalMentionHandles(type: "employee" | "agent", id: string, name: string): MentionCandidate[] {
  const handles = new Set([canonicalMentionHandle(name), id.toLowerCase()].filter((handle) => handle.length > 0));
  return [...handles].map((handle) => ({ type, id, handle }));
}

function mentionLookupHandles(token: string): Set<string> {
  return new Set([token.toLowerCase(), canonicalMentionHandle(token)].filter((handle) => handle.length > 0));
}
