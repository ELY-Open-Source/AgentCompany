import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Warning } from "@phosphor-icons/react";
import type { BudgetIncidentRecord } from "@shared/types";
import { ActionButton, EmptyState, ListFrame, ListRow } from "../ui";
import { formatTime } from "../../lib/formatters";

interface IncidentListProps {
  companyId: string;
  agents: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
}

const STATUS_STYLES: Record<string, string> = {
  open: "text-destructive bg-destructive-muted",
  resolved: "text-success bg-success-muted",
  auto_resolved_limit_increase: "text-primary bg-accent",
  auto_closed: "text-muted-foreground bg-muted",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  resolved: "Resolved",
  auto_resolved_limit_increase: "Auto-resolved",
  auto_closed: "Auto-closed",
};

export function IncidentList({ companyId, agents, projects }: IncidentListProps) {
  const [incidents, setIncidents] = useState<BudgetIncidentRecord[]>([]);
  const [filter, setFilter] = useState<"all" | "open">("open");

  const loadData = useCallback(async () => {
    const result = await window.agentCompany.listBudgetIncidents({ companyId, status: filter });
    if (result.ok) setIncidents(result.data);
  }, [companyId, filter]);

  useEffect(() => { void loadData(); }, [loadData]);

  function getScopeName(scopeType: string, scopeId: string): string {
    if (scopeType === "company") return "Company";
    if (scopeType === "agent") {
      const agent = agents.find((a) => a.id === scopeId);
      return agent ? agent.name : scopeId.slice(0, 8);
    }
    if (scopeType === "project") {
      const project = projects.find((p) => p.id === scopeId);
      return project ? project.name : scopeId.slice(0, 8);
    }
    return scopeId.slice(0, 8);
  }

  async function handleResolve(incidentId: string) {
    const result = await window.agentCompany.resolveBudgetIncident({ companyId, incidentId });
    if (result.ok) void loadData();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-[15px] font-semibold text-foreground">Budget Incidents</h3>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          {(["open", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-[5px] px-3 py-1 text-[12px] font-medium transition ${
                filter === f
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "open" ? "Open" : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {incidents.length === 0 ? (
          <EmptyState
            title="No budget incidents"
            detail={filter === "open" ? "No open incidents. All spending is within limits." : "No incidents recorded yet."}
          />
        ) : (
          <ListFrame>
            {incidents.map((incident) => {
              const isWarn = incident.thresholdType === "warn_threshold";
              return (
                <ListRow key={incident.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                            isWarn
                              ? "text-warning bg-warning-muted"
                              : "text-destructive bg-destructive-muted"
                          }`}
                        >
                          {isWarn ? <Warning size={10} weight="bold" /> : null}
                          {isWarn ? "Warning" : "Hard Stop"}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${STATUS_STYLES[incident.status] ?? STATUS_STYLES.open}`}>
                          {STATUS_LABELS[incident.status] ?? incident.status}
                        </span>
                      </div>

                      <div className="mt-1.5 flex items-center gap-2 text-[12px] text-muted-foreground">
                        <span className="capitalize">{incident.scopeType}</span>
                        <span className="text-muted-foreground">&middot;</span>
                        <span className="font-medium text-foreground">{getScopeName(incident.scopeType, incident.scopeId)}</span>
                      </div>

                      <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="font-[family-name:var(--font-mono)]" style={{ fontVariantNumeric: "tabular-nums" }}>
                          ${(incident.amountObserved / 100).toFixed(2)} / ${(incident.amountLimit / 100).toFixed(2)}
                        </span>
                        <span>{formatTime(incident.windowStart)} - {formatTime(incident.windowEnd)}</span>
                      </div>
                    </div>

                    {incident.status === "open" ? (
                      <ActionButton
                        label="Resolve"
                        icon={CheckCircle}
                        onClick={() => void handleResolve(incident.id)}
                      />
                    ) : null}
                  </div>
                </ListRow>
              );
            })}
          </ListFrame>
        )}
      </div>
    </div>
  );
}
