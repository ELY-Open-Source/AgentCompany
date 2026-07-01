import { useState } from "react";
import type { AgentRecord, TaskRecord, TaskRunRecord } from "../../../shared/domain";
import type { ChatPresenceRecord } from "../../../shared/chat-domain";

interface VirtualOfficeProps {
  agents: AgentRecord[];
  tasks: TaskRecord[];
  taskRuns: TaskRunRecord[];
  presence: ChatPresenceRecord[];
  orgId: string;
}

type Status = "active" | "thinking" | "busy" | "idle";

interface Desk {
  agent: AgentRecord;
  status: Status;
  task: string | null;
}

const SKIN = ["#f4c28b", "#e8b472", "#c68e5b", "#a56c3e", "#8b5232"];
const SHIRT = ["#5b8dd9", "#d95b7a", "#5bbf6f", "#d9a65b", "#9b6fd9", "#5bc4c4"];

function stableColor(palette: string[], name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

function resolveDesks(props: VirtualOfficeProps): Desk[] {
  const { agents, tasks, taskRuns, presence, orgId } = props;
  return agents.filter((a) => a.orgId === orgId).map((agent) => {
    const p = presence.find((r) => r.principalType === "agent" && r.principalId === agent.id);
    const activeTask = tasks.find((t) => t.orgId === orgId && t.assigneeAgentId === agent.id && t.status === "in_progress");
    const running = taskRuns.some((r) => r.agentId === agent.id && r.state === "running");
    let status: Status = "idle";
    if (running) status = "active";
    else if (p?.status === "thinking") status = "thinking";
    else if (p?.status === "waiting_approval" || p?.status === "busy") status = "busy";
    else if (p?.status === "active" || p?.status === "online") status = "active";
    return { agent, status, task: activeTask?.title ?? null };
  });
}

export function VirtualOffice(props: VirtualOfficeProps) {
  const desks = resolveDesks(props);
  const [hovered, setHovered] = useState<string | null>(null);

  const floors = new Map<string, Desk[]>();
  for (const d of desks) {
    const dept = d.agent.department;
    if (!floors.has(dept)) floors.set(dept, []);
    floors.get(dept)!.push(d);
  }

  if (desks.length === 0) return null;

  return (
    <div style={{ padding: "6px 4px", overflowY: "auto", overflowX: "hidden", height: "100%" }}>
      {[...floors.entries()].map(([dept, agents]) => (
        <div key={dept} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-4)", padding: "0 6px 3px" }}>
            {dept}
          </div>
          <div style={{
            background: "var(--panel-2)",
            borderRadius: 8,
            padding: "6px 4px",
            display: "flex",
            flexWrap: "wrap",
            gap: 2,
          }}>
            {agents.map((d) => (
              <PixelDesk key={d.agent.id} desk={d} isHovered={hovered === d.agent.id} onHover={setHovered} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PixelDesk({ desk, isHovered, onHover }: { desk: Desk; isHovered: boolean; onHover: (id: string | null) => void }) {
  const skin = stableColor(SKIN, desk.agent.name);
  const shirt = stableColor(SHIRT, desk.agent.name + desk.agent.role);
  const glow = desk.status === "active" || desk.status === "thinking";

  return (
    <div
      style={{
        width: 42,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "4px 0 2px",
        borderRadius: 6,
        cursor: "default",
        position: "relative",
        background: isHovered ? "var(--hover)" : "transparent",
      }}
      onMouseEnter={() => onHover(desk.agent.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Pixel person */}
      <div style={{ position: "relative", width: 16, height: 24 }}>
        {/* Head */}
        <div style={{ width: 8, height: 8, borderRadius: 2, background: skin, margin: "0 auto" }} />
        {/* Body */}
        <div style={{ width: 12, height: 8, borderRadius: "2px 2px 0 0", background: shirt, margin: "1px auto 0" }} />
        {/* Legs */}
        <div style={{ display: "flex", justifyContent: "center", gap: 2 }}>
          <div style={{ width: 4, height: 6, background: "#555", borderRadius: "0 0 1px 1px" }} />
          <div style={{ width: 4, height: 6, background: "#555", borderRadius: "0 0 1px 1px" }} />
        </div>
        {/* Status dot */}
        <div style={{
          position: "absolute",
          top: -1,
          right: -1,
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: statusColor(desk.status),
          boxShadow: glow ? `0 0 4px ${statusColor(desk.status)}` : undefined,
        }} />
      </div>
      {/* Desk surface */}
      <div style={{ width: 20, height: 3, background: "var(--border)", borderRadius: 1, marginTop: 1 }} />
      {/* Name */}
      <div style={{
        fontSize: 7,
        color: "var(--text-3)",
        marginTop: 2,
        textAlign: "center",
        maxWidth: 40,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}>
        {desk.agent.name.split(" ")[0]}
      </div>
      {isHovered && <Tip desk={desk} />}
    </div>
  );
}

function Tip({ desk }: { desk: Desk }) {
  return (
    <div style={{
      position: "absolute",
      bottom: "calc(100% + 2px)",
      right: 0,
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      padding: "4px 8px",
      zIndex: 50,
      boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      maxWidth: 180,
    }}>
      <div style={{ fontSize: 11, fontWeight: 560, color: "var(--text-1)" }}>{desk.agent.name}</div>
      <div style={{ fontSize: 9, color: "var(--text-3)" }}>{desk.agent.role}</div>
      {desk.task && <div style={{ fontSize: 9, color: statusColor(desk.status), overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{desk.task}</div>}
    </div>
  );
}

function statusColor(s: Status): string {
  if (s === "active") return "#34d399";
  if (s === "thinking") return "#818cf8";
  if (s === "busy") return "#fbbf24";
  return "#ccc";
}
