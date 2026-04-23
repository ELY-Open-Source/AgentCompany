import type { AgentMessageRecord, AgentRecord } from "@shared/types"

export interface MessageFilters {
  search: string
  priority: string
}

export const DEFAULT_MESSAGE_FILTERS: MessageFilters = {
  search: "",
  priority: "all",
}

export function hasActiveMessageFilters(filters: MessageFilters): boolean {
  return filters.search.length > 0 || filters.priority !== "all"
}

export function filterChannelMessages(
  messages: AgentMessageRecord[],
  filters: MessageFilters,
  agentMap: Map<string, AgentRecord>,
  searchQuery: string,
): AgentMessageRecord[] {
  let result = messages
  if (filters.search && !searchQuery) {
    const query = filters.search.toLowerCase()
    result = result.filter((message) =>
      message.subject.toLowerCase().includes(query)
      || message.body.toLowerCase().includes(query)
      || (agentMap.get(message.fromAgentId)?.name ?? "").toLowerCase().includes(query)
    )
  }
  if (filters.priority !== "all") {
    result = result.filter((message) => message.priority === filters.priority)
  }
  return result
}
