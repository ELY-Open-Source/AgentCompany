import { useEffect, useMemo, useState } from "react";
import type { AgentRecord } from "@shared/types";
import { getAgentInitials } from "../../../lib/formatters";

interface ComposerMentionDropdownProps {
  agents: AgentRecord[];
  query: string;
  onSelect: (agent: AgentRecord | null) => void;
  position: { top: number; left: number };
}

export function ComposerMentionDropdown({
  agents,
  query,
  onSelect,
  position,
}: ComposerMentionDropdownProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return agents
      .filter(
        (a) =>
          a.status !== "terminated" &&
          (a.name.toLowerCase().includes(q) ||
            a.title?.toLowerCase().includes(q) ||
            a.department?.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [agents, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (filtered[selectedIndex]) {
          e.preventDefault();
          onSelect(filtered[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        onSelect(null);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [filtered, selectedIndex, onSelect]);

  if (filtered.length === 0) return null;

  return (
    <div
      className="absolute z-50 w-64 rounded-xl border border-border bg-card shadow-xl"
      style={{ top: position.top, left: position.left }}
    >
      {filtered.map((agent, i) => (
        <button
          key={agent.id}
          type="button"
          onClick={() => onSelect(agent)}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
            i === selectedIndex ? "bg-primary/10" : "hover:bg-muted"
          } ${i === 0 ? "rounded-t-xl" : ""} ${i === filtered.length - 1 ? "rounded-b-xl" : ""}`}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
            {getAgentInitials(agent.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-foreground">
              {agent.name}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {agent.title}
              {agent.department ? ` · ${agent.department}` : ""}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
