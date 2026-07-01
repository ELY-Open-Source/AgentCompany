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
  runningNow: boolean;
}

function resolveDesks(props: VirtualOfficeProps): AgentDesk[] {
  const { agents, tasks, taskRuns, presence, orgId } = props;
  return agents.filter((a) => a.orgId === orgId).map((agent) => {
    const p = presence.find((r) => r.principalType === "agent" && r.principalId === agent.id);
    const activeTask = tasks.find((t) => t.orgId === orgId && t.assigneeAgentId === agent.id && t.status === "in_progress");
    const runningNow = taskRuns.some((r) => r.agentId === agent.id && r.state === "running");
    return { agent, status: mapStatus(p?.status, runningNow), currentTask: activeTask?.title ?? null, runningNow };
  });
}

function mapStatus(raw: string | undefined, running: boolean): PresenceStatus {
  if (running) return "active";
  if (!raw) return "idle";
  if (raw === "thinking") return "thinking";
  if (raw === "waiting_approval" || raw === "busy") return "busy";
  if (raw === "active" || raw === "online") return "active";
  return "idle";
}

const STATUS_COLOR: Record<PresenceStatus, string> = {
  active: "#34d399",
  thinking: "#818cf8",
  busy: "#fbbf24",
  idle: "rgba(120,120,120,0.35)",
};

const DESK_BG: CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 10,
  padding: "10px 6px 8px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  position: "relative",
  cursor: "default",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

const MONITOR: CSSProperties = {
  width: 28,
  height: 18,
  borderRadius: 3,
  border: "1.5px solid rgba(255,255,255,0.12)",
  marginBottom: 2,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 8,
  position: "relative",
  overflow: "hidden",
};

export function VirtualOffice(props: VirtualOfficeProps) {
  const desks = resolveDesks(props);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const departments = new Map<string, AgentDesk[]>();
  for (const desk of desks) {
    const dept = desk.agent.department;
    if (!departments.has(dept)) departments.set(dept, []);
    departments.get(dept)!.push(desk);
  }

  if (desks.length === 0) return null;

  return (
    <div style={{ padding: "12px 10px", overflowY: "auto", height: "100%" }}>
      {[...departments.entries()].map(([dept, deptDesks]) => (
        <Room key={dept} label={dept} desks={deptDesks} hoveredId={hoveredId} onHover={setHoveredId} />
      ))}
    </div>
  );
}

function Room({ label, desks, hoveredId, onHover }: {
  label: string;
  desks: AgentDesk[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--text-4)",
        padding: "0 4px 5px",
      }}>
        {label}
      </div>
      <div style={{
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 12,
        padding: 6,
        background: "rgba(255,255,255,0.015)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, 72px)",
        gap: 4,
        justifyContent: "start",
      }}>
        {desks.map((desk) => (
          <Workstation key={desk.agent.id} desk={desk} hovered={hoveredId === desk.agent.id} onHover={onHover} />
        ))}
      </div>
    </div>
  );
}

function Workstation({ desk, hovered, onHover }: { desk: AgentDesk; hovered: boolean; onHover: (id: string | null) => void }) {
  const color = STATUS_COLOR[desk.status];
  const glowing = desk.status === "active" || desk.status === "thinking";
  return (
    <div
      style={{
        ...DESK_BG,
        borderColor: hovered ? "rgba(255,255,255,0.14)" : undefined,
        boxShadow: glowing ? `0 0 12px -4px ${color}` : undefined,
      }}
      onMouseEnter={() => onHover(desk.agent.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div style={{ ...MONITOR, borderColor: glowing ? color : undefined }}>
        {glowing && <div style={{ width: "100%", height: "100%", background: `${color}22` }} />}
      </div>
      <div style={{ width: 6, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: "0 0 2px 2px", marginBottom: 4 }} />
      <div style={{ position: "relative" }}>
        <Avatar name={desk.agent.name} size="sm" bot />
        <div style={{
          position: "absolute",
          bottom: -1,
          right: -2,
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          border: "1.5px solid var(--bg)",
          boxShadow: glowing ? `0 0 5px ${color}` : undefined,
        }} />
      </div>
      <div style={{
        fontSize: 9,
        color: "var(--text-3)",
        marginTop: 3,
        textAlign: "center",
        lineHeight: 1.15,
        maxWidth: 64,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {desk.agent.name.split(" ")[0]}
      </div>
      {hovered && (
        <Tooltip name={desk.agent.name} role={desk.agent.role} task={desk.currentTask} status={desk.status} />
      )}
    </div>
  );
}

function Tooltip({ name, role, task, status }: { name: string; role: string; task: string | null; status: PresenceStatus }) {
  return (
    <div style={{
      position: "absolute",
      bottom: "calc(100% + 6px)",
      left: "50%",
      transform: "translateX(-50%)",
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: "6px 10px",
      zIndex: 30,
      boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
      pointerEvents: "none",
      minWidth: 120,
      maxWidth: 200,
    }}>
      <div style={{ fontSize: 12, fontWeight: 560, color: "var(--text-1)", marginBottom: 1 }}>{name}</div>
      <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: task ? 4 : 0 }}>{role}</div>
      {task && (
        <div style={{
          fontSize: 10,
          color: STATUS_COLOR[status],
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {task}
        </div>
      )}
    </div>
  );
}
