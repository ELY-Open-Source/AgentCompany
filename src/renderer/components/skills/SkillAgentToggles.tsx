import { useCallback, useEffect, useState } from "react";
import type { AgentRecord, SkillRecord } from "@shared/types";
import { useAppStore } from "../../state/store";

type SkillAgentTogglesProps =
  | { mode: "skill"; companyId: string; skillId: string; agents: AgentRecord[] }
  | { mode: "agent"; companyId: string; agentId: string; skills: SkillRecord[] };

export function SkillAgentToggles(props: SkillAgentTogglesProps) {
  const { companyId, mode } = props;
  const skillId = mode === "skill" ? props.skillId : "";
  const agentId = mode === "agent" ? props.agentId : "";
  const addToast = useAppStore((s) => s.addToast);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (mode === "skill") {
        const result = await window.agentCompany.listSkillAgents(companyId, skillId);
        if (!cancelled && result.ok) setAssignedIds(new Set(result.data));
      } else {
        const result = await window.agentCompany.listAgentSkills(companyId, agentId);
        if (!cancelled && result.ok) setAssignedIds(new Set(result.data));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [mode, companyId, skillId, agentId]);

  const handleToggle = useCallback(
    async (targetId: string) => {
      setTogglingId(targetId);
      const isAssigned = assignedIds.has(targetId);
      const resolvedAgentId = mode === "skill" ? targetId : agentId;
      const resolvedSkillId = mode === "skill" ? skillId : targetId;

      const result = isAssigned
        ? await window.agentCompany.removeSkillFromAgent(companyId, resolvedAgentId, resolvedSkillId)
        : await window.agentCompany.assignSkillToAgent(companyId, resolvedAgentId, resolvedSkillId);

      if (result.ok) {
        setAssignedIds((prev) => {
          const next = new Set(prev);
          if (isAssigned) next.delete(targetId);
          else next.add(targetId);
          return next;
        });
      } else {
        addToast(result.error.message, "danger");
      }
      setTogglingId(null);
    },
    [assignedIds, mode, companyId, addToast, skillId, agentId],
  );

  const items: Array<{ id: string; name: string; detail?: string }> =
    mode === "skill"
      ? props.agents.map((a) => ({ id: a.id, name: a.name, detail: a.role }))
      : props.skills.map((s) => ({ id: s.id, name: s.name, detail: s.description ?? undefined }));

  if (items.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-[13px] text-muted-foreground">
        {mode === "skill" ? "No agents in this company" : "No skills imported yet"}
      </p>
    );
  }

  return (
    <div>
      {items.map((item) => {
        const isAssigned = assignedIds.has(item.id);
        const isToggling = togglingId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            disabled={isToggling}
            className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left transition hover:bg-muted disabled:opacity-60"
            onClick={() => void handleToggle(item.id)}
          >
            {/* Toggle indicator */}
            <span
              className={`flex h-[18px] w-[32px] shrink-0 items-center rounded-full p-[2px] transition-colors ${
                isAssigned
                  ? "bg-primary"
                  : "bg-[color:var(--border)]"
              }`}
            >
              <span
                className={`block h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform ${
                  isAssigned ? "translate-x-[14px]" : "translate-x-0"
                }`}
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-foreground">
                {item.name}
              </div>
              {item.detail ? (
                <div className="truncate text-[12px] text-muted-foreground">
                  {item.detail}
                </div>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
