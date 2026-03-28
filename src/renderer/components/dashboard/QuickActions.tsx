import { Robot } from "@phosphor-icons/react";
import type { AgentRecord } from "@shared/types";
import { getAgentInitials } from "../../lib/formatters";

const statusGlow: Record<string, string> = {
  running: "ring-2 ring-[color:var(--primary)] ring-opacity-50",
  active: "ring-1 ring-[color:var(--primary)] ring-opacity-30",
  idle: "",
  paused: "opacity-60",
  error: "ring-2 ring-[color:var(--destructive)] ring-opacity-50",
  pending_approval: "ring-1 ring-[color:var(--destructive)] ring-opacity-40",
  terminated: "opacity-40",
};

function AgentCard({ agent, onClick }: { agent: AgentRecord; onClick: () => void }) {
  const initials = getAgentInitials(agent.name);
  const isActive = agent.status === "running" || agent.status === "active";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 group relative flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-3 py-3.5 text-center transition duration-150 hover:border-border hover:shadow-sm ${statusGlow[agent.status] ?? ""}`}
    >
      <div className="relative">
        <div className={`flex h-12 w-12 items-center justify-center rounded-full text-[15px] font-bold ${
          isActive ? "bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"
        }`}>
          {initials}
        </div>
        {agent.status === "running" ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-600 dark:bg-green-400 opacity-40" style={{ willChange: "transform" }} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600 dark:bg-green-400" />
          </span>
        ) : (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[color:var(--card)]"
            style={{
              backgroundColor: agent.status === "error"
                ? "var(--destructive)"
                : agent.status === "active"
                  ? "var(--primary)"
                  : agent.status === "pending_approval"
                    ? "var(--destructive)"
                    : agent.status === "paused" || agent.status === "terminated"
                      ? "var(--muted-foreground)"
                      : "var(--muted-foreground)",
            }}
          />
        )}
      </div>
      <div className="w-full min-w-0">
        <div className="truncate text-[12px] font-semibold text-foreground">{agent.name}</div>
        <div className="truncate text-[10px] text-muted-foreground">{agent.title || agent.role}</div>
      </div>
    </button>
  );
}

export function WorkforceGrid({ agents, onSelectAgent }: { agents: AgentRecord[]; onSelectAgent: (id: string) => void }) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
        <Robot size={32} className="mb-3 text-muted-foreground" />
        <div className="text-[14px] font-medium text-muted-foreground">No agents hired yet</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} onClick={() => onSelectAgent(agent.id)} />
      ))}
    </div>
  );
}
