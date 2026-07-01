import { useState } from "react";
import type { AgentRecord, TaskRecord } from "../../../shared/domain";
import type { ChatPresenceRecord } from "../../../shared/chat-domain";
import { Avatar } from "./ui";

interface VirtualOfficeProps {
  agents: AgentRecord[];
  tasks: TaskRecord[];
  presence: ChatPresenceRecord[];
  orgId: string;
}

type PresenceStatus = "active" | "thinking" | "busy" | "idle";

interface AgentDesk {
  agent: AgentRecord;
  status: PresenceStatus;
  statusText: string;
  currentTask: string | null;
}

function resolveDesks(props: VirtualOfficeProps): AgentDesk[] {
  const { agents, tasks, presence, orgId } = props;
  const orgAgents = agents.filter((a) => a.orgId === orgId);
  return orgAgents.map((agent) => {
    const p = presence.find((r) => r.principalType === "agent" && r.principalId === agent.id);
    const activeTask = tasks.find(
      (t) => t.orgId === orgId && t.assigneeAgentId === agent.id && t.status === "in_progress",
    );
    const status = mapStatus(p?.status);
    return {
      agent,
      status,
      statusText: p?.statusText ?? "",
      currentTask: activeTask?.title ?? null,
    };
  });
}

function mapStatus(raw: string | undefined): PresenceStatus {
  if (!raw) return "idle";
  if (raw === "thinking") return "thinking";
  if (raw === "waiting_approval" || raw === "busy") return "busy";
  if (raw === "active" || raw === "online") return "active";
  return "idle";
}

const STATUS_RING: Record<PresenceStatus, string> = {
  active: "var(--green)",
  thinking: "var(--accent)",
  busy: "var(--amber)",
  idle: "var(--text-4)",
};

const DEPT_FLOOR: Record<string, { label: string; color: string }> = {
  engineering: { label: "Engineering", color: "var(--accent-soft)" },
  product: { label: "Product", color: "rgba(168, 130, 255, 0.08)" },
  design: { label: "Design", color: "rgba(255, 170, 130, 0.08)" },
  marketing: { label: "Marketing", color: "rgba(130, 200, 255, 0.08)" },
  operations: { label: "Operations", color: "rgba(180, 180, 180, 0.06)" },
};

function floorForDept(dept: string): { label: string; color: string } {
  const key = dept.toLowerCase();
  return DEPT_FLOOR[key] ?? { label: dept, color: "rgba(180, 180, 180, 0.06)" };
}

export function VirtualOffice(props: VirtualOfficeProps) {
  const desks = resolveDesks(props);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const departments = new Map<string, AgentDesk[]>();
  for (const desk of desks) {
    const dept = desk.agent.department;
    if (!departments.has(dept)) departments.set(dept, []);
    departments.get(dept)!.push(desk);
  }

  if (desks.length === 0) {
    return <div style={{ padding: 24, color: "var(--text-3)", fontSize: 13 }}>No agents yet</div>;
  }

  return (
    <div style={{ padding: "12px 8px", overflowY: "auto", height: "100%" }}>
      {[...departments.entries()].map(([dept, deptDesks]) => {
        const floor = floorForDept(dept);
        return (
          <div key={dept} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--text-3)",
              padding: "0 8px 6px",
            }}>
              {floor.label}
            </div>
            <div style={{
              background: floor.color,
              borderRadius: 10,
              padding: 8,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, 64px)",
              gap: 4,
              justifyContent: "start",
            }}>
              {deptDesks.map((desk) => (
                <DeskCell
                  key={desk.agent.id}
                  desk={desk}
                  hovered={hoveredId === desk.agent.id}
                  onHover={setHoveredId}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeskCell({
  desk,
  hovered,
  onHover,
}: {
  desk: AgentDesk;
  hovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const ring = STATUS_RING[desk.status];
  const isWorking = desk.status === "active" || desk.status === "thinking";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "6px 2px",
        borderRadius: 8,
        cursor: "default",
        position: "relative",
        transition: "background 0.15s",
        background: hovered ? "rgba(255,255,255,0.06)" : "transparent",
      }}
      onMouseEnter={() => onHover(desk.agent.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div style={{ position: "relative" }}>
        <Avatar name={desk.agent.name} size="lg" bot />
        <div style={{
          position: "absolute",
          bottom: -1,
          right: -1,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: ring,
          border: "2px solid var(--panel)",
          boxShadow: isWorking ? `0 0 4px ${ring}` : undefined,
        }} />
      </div>
      <div style={{
        fontSize: 10,
        color: "var(--text-2)",
        marginTop: 4,
        textAlign: "center",
        lineHeight: 1.2,
        maxWidth: 60,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {desk.agent.name.split(" ")[0]}
      </div>
      {hovered && desk.currentTask && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 11,
          color: "var(--text-1)",
          whiteSpace: "nowrap",
          maxWidth: 200,
          overflow: "hidden",
          textOverflow: "ellipsis",
          zIndex: 20,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          marginBottom: 4,
          pointerEvents: "none",
        }}>
          {desk.currentTask}
        </div>
      )}
    </div>
  );
}
