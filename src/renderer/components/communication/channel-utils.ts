import type { AgentMessageRecord, AgentRecord, CommentRecord, MessageChannel, ProjectRecord, TaskRecord } from "@shared/types"
import type { ChannelDescriptor, TaskDiscussionDescriptor } from "./ChannelHeader"

const BOARD_ID = "__board__"

function labelForParticipant(id: string | undefined, agentMap: Map<string, AgentRecord>): string {
  if (!id) return "Unknown"
  if (id === BOARD_ID) return "Board"
  return agentMap.get(id)?.name ?? id.slice(0, 8)
}

/**
 * Resolve the participant-pair key that a direct message belongs to.
 *
 * A chat is a conversation thread, not a one-hop DM pair. When the user
 * writes "@CEO 更新一下进度" inside their chat with 张工程师, CEO's
 * reply targets `__board__` (the human reader) via
 * `toAgentId=__board__, parentMessageId=<original>`. Keying that reply
 * by `sort(fromAgent, toAgent)` alone would split it into a separate
 * Board↔CEO pane and strand the user in two half-conversations. By
 * walking `parentMessageId` back to the root of the thread and using
 * the root's participant pair, every reply in the chain lands in the
 * same chat surface the sender originally chose.
 *
 * Cycle guard: `parentMessageId` is user-supplied in some replies, so a
 * malformed cycle must not wedge the UI. We bail out once the visit set
 * sees an id twice and treat the current message as its own root.
 */
function resolveDirectThreadPair(
  msg: AgentMessageRecord,
  byId: Map<string, AgentMessageRecord>,
): [string, string] | null {
  const visited = new Set<string>()
  let cursor: AgentMessageRecord | undefined = msg
  while (cursor && cursor.parentMessageId && !visited.has(cursor.id)) {
    visited.add(cursor.id)
    const parent = byId.get(cursor.parentMessageId)
    if (!parent || parent.channel !== "direct" || !parent.toAgentId) break
    cursor = parent
  }
  if (!cursor || !cursor.toAgentId) return null
  const ids = [cursor.fromAgentId, cursor.toAgentId].sort()
  return [ids[0]!, ids[1]!]
}

export function deriveChannels(messages: AgentMessageRecord[], agents: AgentRecord[], projects?: ProjectRecord[]): ChannelDescriptor[] {
  const channelMap = new Map<string, ChannelDescriptor>()
  const agentMap = new Map(agents.map((a) => [a.id, a]))
  const projectMap = new Map((projects ?? []).map((p) => [p.id, p]))
  const byId = new Map(messages.map((m) => [m.id, m]))

  channelMap.set("company-all", { key: "company-all", kind: "message", channel: "company", label: "#company-wide", targetId: null, agentId: null, participantIds: [] })

  const activeDepts = new Set<string>()
  for (const agent of agents) { if (agent.department && agent.status !== "terminated") activeDepts.add(agent.department) }
  for (const dept of activeDepts) {
    const key = `department-${dept}`
    channelMap.set(key, { key, kind: "message", channel: "department", label: `#${dept.replace(/_/g, "-")}`, targetId: dept, agentId: null, participantIds: [] })
  }

  for (const msg of messages) {
    let key: string; let label: string; let agentId: string | null = null
    let participantIds: string[] = []
    switch (msg.channel) {
      case "direct": {
        const pair = resolveDirectThreadPair(msg, byId)
        if (pair && pair[0] === pair[1]) continue
        if (!pair) { key = "direct-broadcast"; label = "Broadcast DMs" }
        else {
          key = `direct-${pair.join("-")}`
          label = `${labelForParticipant(pair[0], agentMap)} \u2194 ${labelForParticipant(pair[1], agentMap)}`
          agentId = pair.find((id) => id !== BOARD_ID) ?? pair[1] ?? null
          participantIds = pair
        }
        break }
      case "department": { const d = msg.channelTargetId ?? "general"; key = `department-${d}`; label = `#${d.replace(/_/g, "-")}`; break }
      case "company": { key = "company-all"; label = "#company-wide"; break }
      case "project": { const pid = msg.channelTargetId ?? "general"; key = `project-${pid}`; label = projectMap.get(pid)?.name ?? `#project-${pid.slice(0, 8)}`; break }
      case "incident": { const iid = msg.channelTargetId ?? "room"; key = `incident-${iid}`; label = iid === "room" ? "#incident-room" : `#incident-${iid.slice(0, 8)}`; break }
    }
    if (!channelMap.has(key)) {
      channelMap.set(key, { key, kind: "message", channel: msg.channel, label, targetId: msg.channelTargetId, agentId, participantIds })
    }
  }

  const order: MessageChannel[] = ["company", "department", "project", "incident", "direct"]
  return Array.from(channelMap.values()).sort((a, b) => { const ai = order.indexOf(a.channel); const bi = order.indexOf(b.channel); return ai !== bi ? ai - bi : a.label.localeCompare(b.label) })
}

export function deriveTaskDiscussionChannels(comments: CommentRecord[], tasks: TaskRecord[], forcedTaskId?: string | null): TaskDiscussionDescriptor[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]))
  const activeIds = tasks.filter((t) => ["todo", "in_progress", "in_review", "blocked"].includes(t.status)).map((t) => t.id)
  const ids = new Set([...comments.map((c) => c.taskId), ...activeIds, ...(forcedTaskId ? [forcedTaskId] : [])])

  return Array.from(ids).map((taskId) => {
    const task = taskMap.get(taskId)
    return { key: `task-${taskId}`, kind: "task" as const, taskId, label: task ? `${task.title}${task.status === "blocked" ? " \u00b7 blocked" : task.status === "in_review" ? " \u00b7 review" : ""}` : `Task ${taskId.slice(0, 8)}` }
  }).sort((l, r) => {
    const lt = taskMap.get(l.taskId); const rt = taskMap.get(r.taskId)
    const pw: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
    const lw = lt ? pw[lt.priority] ?? 0 : 0; const rw = rt ? pw[rt.priority] ?? 0 : 0
    return lw !== rw ? rw - lw : l.label.localeCompare(r.label)
  })
}

export function getChannelMessages(messages: AgentMessageRecord[], channel: ChannelDescriptor): AgentMessageRecord[] {
  const byId = new Map(messages.map((m) => [m.id, m]))
  return messages.filter((msg) => {
    if (channel.channel === "company" && msg.channel === "company") return true
    if (channel.channel === "department" && msg.channel === "department") return msg.channelTargetId === channel.targetId
    if (channel.channel === "project" && msg.channel === "project") return msg.channelTargetId === channel.targetId
    if (channel.channel === "incident" && msg.channel === "incident") return msg.channelTargetId === channel.targetId
    if (channel.channel === "direct" && msg.channel === "direct") {
      if (channel.key === "direct-broadcast") return !msg.toAgentId
      if (!msg.toAgentId || channel.participantIds.length < 2) return false
      const pair = resolveDirectThreadPair(msg, byId)
      if (!pair) return false
      if (pair[0] === pair[1]) return false
      return pair[0] === channel.participantIds[0] && pair[1] === channel.participantIds[1]
    }
    return false
  })
}
