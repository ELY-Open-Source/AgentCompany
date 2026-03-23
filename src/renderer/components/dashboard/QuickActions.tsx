import { Robot } from "@phosphor-icons/react";
import type { AgentRecord } from "@shared/types";
import { getAgentInitials } from "../../lib/formatters";

const statusGlow: Record<string, string> = {
  running: "ring-2 ring-[color:var(--success)] ring-opacity-50",
  active: "ring-1 ring-[color:var(--success)] ring-opacity-30",
  idle: "",
  paused: "opacity-60",
  error: "ring-2 ring-[color:var(--danger)] ring-opacity-50",
  pending_approval: "ring-1 ring-[color:var(--warn)] ring-opacity-40",
  terminated: "opacity-40",
};

function AgentCard({ agent, onClick }: { agent: AgentRecord; onClick: () => void }) {
  const initials = getAgentInitials(agent.name);
  const isActive = agent.status === "running" || agent.status === "active";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring group relative flex flex-col items-center gap-2 rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-3.5 text-center transition duration-150 hover:border-[color:var(--line-strong)] hover:shadow-sm ${statusGlow[agent.status] ?? ""}`}
    >
      <div className="relative">
        <div className={`flex h-12 w-12 items-center justify-center rounded-full text-[15px] font-bold ${
          isActive ? "bg-[color:var(--success-soft)] text-[color:var(--success)]" : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)]"
        }`}>
          {initials}
        </div>
        {agent.status === "running" ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--success)] opacity-40" style={{ willChange: "transform" }} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[color:var(--success)]" />
          </span>
        ) : (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[color:var(--panel)]"
            style={{
              backgroundColor: agent.status === "error"
                ? "var(--danger)"
                : agent.status === "active"
                  ? "var(--success)"
                  : agent.status === "pending_approval"
                    ? "var(--warn)"
                    : agent.status === "paused" || agent.status === "terminated"
                      ? "var(--muted)"
                      : "var(--muted)",
            }}
          />
        )}
      </div>
      <div className="w-full min-w-0">
        <div className="truncate text-[12px] font-semibold text-[color:var(--text)]">{agent.name}</div>
        <div className="truncate text-[10px] text-[color:var(--muted)]">{agent.title || agent.role}</div>
      </div>
    </button>
  );
}

export function WorkforceGrid({ agents, onSelectAgent }: { agents: AgentRecord[]; onSelectAgent: (id: string) => void }) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-[color:var(--line)] py-10 text-center">
        <Robot size={32} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">No agents hired yet</div>
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
