import { useEffect, useRef, useMemo, useCallback } from "react";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";
import { drawScene, type OfficeAgent } from "./office/office-renderer";

const FACE_COLORS = ["#4a90d9", "#50b866", "#9b59b6", "#e67e22", "#e74c3c", "#3498db", "#1abc9c", "#f39c12"];
const SHIRT_COLORS = ["#5b8dd9", "#d95b7a", "#5bbf6f", "#d9a65b", "#9b6fd9", "#5bc4c4", "#d97b5b", "#7fd95b"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pick(palette: string[], seed: string): string {
  return palette[hash(seed) % palette.length];
}

export function OfficePage({ snapshot }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef<OfficeAgent[]>([]);
  const animRef = useRef(0);
  const startRef = useRef(Date.now());

  const orgAgents = useMemo(() => snapshot.agents.filter((a) => a.orgId === orgId), [snapshot.agents, orgId]);
  const orgTasks = useMemo(() => snapshot.tasks.filter((t) => t.orgId === orgId), [snapshot.tasks, orgId]);

  useEffect(() => {
    const existing = agentsRef.current;
    agentsRef.current = orgAgents.map((a, i) => {
      const prev = existing.find((e) => e.id === a.id);
      const status = resolveStatus(snapshot.chatPresence, snapshot.taskRuns, a.id);
      const task = orgTasks.find((t) => t.assigneeAgentId === a.id && t.status === "in_progress")?.title ?? null;
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        department: a.department,
        status,
        task,
        x: prev?.x ?? 100 + i * 120,
        y: prev?.y ?? 200,
        targetX: prev?.targetX ?? 100 + i * 120,
        targetY: prev?.targetY ?? 200,
        deskX: 0,
        deskY: 0,
        faceColor: pick(FACE_COLORS, a.name),
        shirtColor: pick(SHIRT_COLORS, a.name + a.role),
        frame: prev?.frame ?? hash(a.id) % 100,
        facing: prev?.facing ?? 1,
      };
    });
  }, [orgAgents, orgTasks, snapshot.chatPresence, snapshot.taskRuns]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const time = Date.now() - startRef.current;
    const agents = agentsRef.current;

    for (const agent of agents) {
      const dx = agent.targetX - agent.x;
      const dy = agent.targetY - agent.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1) {
        agent.x += (dx / dist) * 0.8;
        agent.y += (dy / dist) * 0.8;
        agent.frame += 0.1;
        agent.facing = dx > 0 ? 1 : -1;
      }
    }

    drawScene(ctx, w, h, agents, time);
    animRef.current = requestAnimationFrame(render);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render]);

  useEffect(() => {
    const wander = setInterval(() => {
      for (const agent of agentsRef.current) {
        if (agent.status === "idle") {
          agent.targetX = agent.deskX + DESK_CENTER_OFFSET + (Math.random() * 100 - 50);
          agent.targetY = agent.deskY + 56 + (Math.random() * 40 - 20);
        } else {
          agent.targetX = agent.deskX + DESK_CENTER_OFFSET;
          agent.targetY = agent.deskY + 56;
        }
      }
    }, 4000);
    return () => clearInterval(wander);
  }, []);

  return (
    <div style={{ flex: 1, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

const DESK_CENTER_OFFSET = 50;

function resolveStatus(
  presence: Array<{ principalType: string; principalId: string; status: string }>,
  runs: Array<{ agentId: string | null; state: string }>,
  agentId: string,
): OfficeAgent["status"] {
  if (runs.some((r) => r.agentId === agentId && r.state === "running")) return "active";
  const p = presence.find((r) => r.principalType === "agent" && r.principalId === agentId);
  if (p?.status === "thinking") return "thinking";
  if (p?.status === "waiting_approval" || p?.status === "busy") return "busy";
  if (p?.status === "active" || p?.status === "online") return "active";
  return "idle";
}
