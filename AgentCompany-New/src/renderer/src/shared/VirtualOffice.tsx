import { useState, type CSSProperties } from "react";
import type { AgentRecord, TaskRecord, TaskRunRecord } from "../../../shared/domain";
import type { ChatPresenceRecord } from "../../../shared/chat-domain";
import { Avatar } from "./ui";

interface VirtualOfficeProps {
  agents: AgentRecord[];
  tasks: TaskRecord[];
  taskRuns: TaskRunRecord[];
  presence: ChatPresenceRecord[];
  orgId: string;
}

type PresenceStatus = "active" | "thinking" | "busy" | "idle";

interface AgentDesk {
  agent: AgentRecord;
  status: PresenceStatus;
  currentTask: string | null;
}

function resolveDesks(props: VirtualOfficeProps): AgentDesk[] {
  const { agents, tasks, taskRuns, presence, orgId } = props;
  return agents.filter((a) => a.orgId === orgId).map((agent) => {
    const p = presence.find((r) => r.principalType === "agent" && r.principalId === agent.id);
    const activeTask = tasks.find((t) => t.orgId === orgId && t.assigneeAgentId === agent.id && t.status === "in_progress");
    const running = taskRuns.some((r) => r.agentId === agent.id && r.state === "running");
    return { agent, status: deriveStatus(p?.status, running), currentTask: activeTask?.title ?? null };
  });
}

function deriveStatus(raw: string | undefined, running: boolean): PresenceStatus {
  if (running) return "active";
  if (raw === "thinking") return "thinking";
  if (raw === "waiting_approval" || raw === "busy") return "busy";
  if (raw === "active" || raw === "online") return "active";
  return "idle";
}

const COLOR: Record<PresenceStatus, string> = {
  active: "#34d399",
  thinking: "#818cf8",
  busy: "#fbbf24",
  idle: "rgba(120,120,120,0.3)",
};

export function VirtualOffice(props: VirtualOfficeProps) {
  const desks = resolveDesks(props);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const floors = new Map<string, AgentDesk[]>();
  for (const desk of desks) {
    const dept = desk.agent.department;
    if (!floors.has(dept)) floors.set(dept, []);
    floors.get(dept)!.push(desk);
  }

  if (desks.length === 0) return null;

  const floorEntries = [...floors.entries()];
  const activeCount = desks.filter((d) => d.status === "active" || d.status === "thinking").length;

  return (
    <div style={{ padding: "8px 6px", overflowY: "auto", height: "100%" }}>
      <BuildingHeader total={desks.length} active={activeCount} />
      <div style={buildingFrame}>
        {floorEntries.map(([dept, deptDesks], index) => (
          <Floor
            key={dept}
            label={dept}
            level={floorEntries.length - index}
            desks={deptDesks}
            hoveredId={hoveredId}
            onHover={setHoveredId}
          />
        ))}
      </div>
    </div>
  );
}

function BuildingHeader({ total, active }: { total: number; active: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px 8px", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: active > 0 ? "#34d399" : "rgba(120,120,120,0.3)" }} />
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>{active}/{total}</span>
      </div>
    </div>
  );
}

const buildingFrame: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 12,
  overflow: "hidden",
  background: "rgba(0,0,0,0.08)",
};

function Floor({ label, level, desks, hoveredId, onHover }: {
  label: string;
  level: number;
  desks: AgentDesk[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}) {
  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px 2px",
      }}>
        <span style={{ fontSize: 8, fontWeight: 700, color: "var(--text-4)", fontVariantNumeric: "tabular-nums", width: 12 }}>{level}F</span>
        <span style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-4)" }}>{label}</span>
      </div>
      <div style={{
        padding: "4px 6px 8px",
        display: "flex",
        flexWrap: "wrap",
        gap: 3,
      }}>
        {desks.map((desk) => (
          <Workstation key={desk.agent.id} desk={desk} hovered={hoveredId === desk.agent.id} onHover={onHover} />
        ))}
      </div>
    </div>
  );
}

function Workstation({ desk, hovered, onHover }: { desk: AgentDesk; hovered: boolean; onHover: (id: string | null) => void }) {
  const color = COLOR[desk.status];
  const alive = desk.status === "active" || desk.status === "thinking";
  return (
    <div
      style={{
        width: 56,
        padding: "5px 3px 4px",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        position: "relative",
        cursor: "default",
        transition: "background 0.15s",
        background: hovered ? "rgba(255,255,255,0.05)" : "transparent",
      }}
      onMouseEnter={() => onHover(desk.agent.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Monitor */}
      <div style={{
        width: 24,
        height: 15,
        borderRadius: 2,
        border: `1.5px solid ${alive ? color : "rgba(255,255,255,0.08)"}`,
        marginBottom: 1,
        position: "relative",
        overflow: "hidden",
        transition: "border-color 0.2s",
      }}>
        {alive && <ScreenGlow color={color} />}
      </div>
      {/* Monitor stand */}
      <div style={{ width: 4, height: 2, background: "rgba(255,255,255,0.06)" }} />
      <div style={{ width: 10, height: 1, background: "rgba(255,255,255,0.06)", borderRadius: 1, marginBottom: 3 }} />
      {/* Agent */}
      <div style={{ position: "relative" }}>
        <Avatar name={desk.agent.name} size="sm" bot />
        <div style={{
          position: "absolute",
          bottom: -1,
          right: -2,
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          border: "1.5px solid var(--bg)",
          transition: "background 0.2s",
        }} />
      </div>
      <div style={{
        fontSize: 8,
        color: "var(--text-3)",
        marginTop: 2,
        textAlign: "center",
        maxWidth: 52,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {desk.agent.name.split(" ")[0]}
      </div>
      {hovered && <HoverCard desk={desk} />}
    </div>
  );
}

function ScreenGlow({ color }: { color: string }) {
  return (
    <div style={{
      position: "absolute",
      inset: 0,
      background: `${color}33`,
      animation: "office-pulse 2s ease-in-out infinite",
    }}>
      <div style={{ width: "60%", height: 2, background: `${color}55`, margin: "3px 2px", borderRadius: 1 }} />
      <div style={{ width: "40%", height: 2, background: `${color}44`, margin: "1px 2px", borderRadius: 1 }} />
    </div>
  );
}

function HoverCard({ desk }: { desk: AgentDesk }) {
  const color = COLOR[desk.status];
  return (
    <div style={{
      position: "absolute",
      bottom: "calc(100% + 4px)",
      left: "50%",
      transform: "translateX(-50%)",
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: "6px 10px",
      zIndex: 30,
      boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
      pointerEvents: "none",
      minWidth: 110,
      maxWidth: 190,
    }}>
      <div style={{ fontSize: 11, fontWeight: 560, color: "var(--text-1)" }}>{desk.agent.name}</div>
      <div style={{ fontSize: 9, color: "var(--text-3)", marginBottom: desk.currentTask ? 3 : 0 }}>{desk.agent.role}</div>
      {desk.currentTask && (
        <div style={{
          fontSize: 9,
          color,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {desk.currentTask}
        </div>
      )}
    </div>
  );
}
