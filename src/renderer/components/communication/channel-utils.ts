import type { AgentMessageRecord, AgentRecord, CommentRecord, MessageChannel, ProjectRecord, TaskRecord } from "@shared/types"
import type { ChannelDescriptor, TaskDiscussionDescriptor } from "./ChannelHeader"

export function deriveChannels(messages: AgentMessageRecord[], agents: AgentRecord[], projects?: ProjectRecord[]): ChannelDescriptor[] {
  const channelMap = new Map<string, ChannelDescriptor>()
  const agentMap = new Map(agents.map((a) => [a.id, a]))
  const projectMap = new Map((projects ?? []).map((p) => [p.id, p]))

  channelMap.set("company-all", { key: "company-all", kind: "message", channel: "company", label: "#company-wide", targetId: null, agentId: null, participantIds: [] })

  const activeDepts = new Set<string>()
  for (const agent of agents) { if (agent.department && agent.status !== "terminated") activeDepts.add(agent.department) }
  for (const dept of activeDepts) {
    const key = `department-${dept}`
    channelMap.set(key, { key, kind: "message", channel: "department", label: `#${dept.replace(/_/g, "-")}`, targetId: dept, agentId: null, participantIds: [] })
  }

  for (const msg of messages) {
    let key: string; let label: string; let agentId: string | null = null
    switch (msg.channel) {
      case "direct": {
        const otherId = msg.toAgentId
        if (!otherId) { key = "direct-broadcast"; label = "Broadcast DMs" }
        else { const ids = [msg.fromAgentId, otherId].sort(); key = `direct-${ids.join("-")}`; const f = agentMap.get(ids[0] ?? ""); const s = agentMap.get(ids[1] ?? ""); label = `${f?.name ?? (ids[0] ? ids[0].slice(0, 8) : "Unknown")} \u2194 ${s?.name ?? (ids[1] ? ids[1].slice(0, 8) : "Unknown")}`; agentId = ids[1] ?? null }
        break }
      case "department": { const d = msg.channelTargetId ?? "general"; key = `department-${d}`; label = `#${d.replace(/_/g, "-")}`; break }
      case "company": { key = "company-all"; label = "#company-wide"; break }
      case "project": { const pid = msg.channelTargetId ?? "general"; key = `project-${pid}`; label = projectMap.get(pid)?.name ?? `#project-${pid.slice(0, 8)}`; break }
      case "incident": { const iid = msg.channelTargetId ?? "room"; key = `incident-${iid}`; label = iid === "room" ? "#incident-room" : `#incident-${iid.slice(0, 8)}`; break }
    }
    if (!channelMap.has(key)) {
      channelMap.set(key, { key, kind: "message", channel: msg.channel, label, targetId: msg.channelTargetId, agentId, participantIds: msg.channel === "direct" && msg.toAgentId ? [msg.fromAgentId, msg.toAgentId].sort() : [] })
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
  return messages.filter((msg) => {
    if (channel.channel === "company" && msg.channel === "company") return true
    if (channel.channel === "department" && msg.channel === "department") return msg.channelTargetId === channel.targetId
    if (channel.channel === "project" && msg.channel === "project") return msg.channelTargetId === channel.targetId
    if (channel.channel === "incident" && msg.channel === "incident") return msg.channelTargetId === channel.targetId
    if (channel.channel === "direct" && msg.channel === "direct") {
      if (channel.key === "direct-broadcast") return !msg.toAgentId
      if (!msg.toAgentId || channel.participantIds.length < 2) return false
      const ids = [msg.fromAgentId, msg.toAgentId].sort()
      return ids[0] === channel.participantIds[0] && ids[1] === channel.participantIds[1]
    }
    return false
  })
}
