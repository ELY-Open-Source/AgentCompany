import { useEffect, useRef, useMemo } from "react";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";
import { drawScene, layoutPositions, type OfficeAgent } from "./office/office-renderer";

const FACE = ["#4a90d9", "#50b866", "#9b59b6", "#e67e22", "#e74c3c", "#1abc9c", "#f39c12", "#3498db"];
const SHIRT = ["#5b8dd9", "#d95b7a", "#5bbf6f", "#d9a65b", "#9b6fd9", "#5bc4c4", "#d97b5b", "#7fd95b"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function OfficePage({ snapshot }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef<OfficeAgent[]>([]);
  const animRef = useRef(0);
  const lastFrameRef = useRef(0);

  const orgAgents = useMemo(() => snapshot.agents.filter((a) => a.orgId === orgId), [snapshot.agents, orgId]);
  const orgTasks = useMemo(() => snapshot.tasks.filter((t) => t.orgId === orgId), [snapshot.tasks, orgId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const positions = layoutPositions(orgAgents.length, w);
    const existing = agentsRef.current;

    agentsRef.current = orgAgents.map((a, i) => {
      const prev = existing.find((e) => e.id === a.id);
      const pos = positions[i];
      const status = resolveStatus(snapshot.chatPresence, snapshot.taskRuns, a.id);
      const task = orgTasks.find((t) => t.assigneeAgentId === a.id && t.status === "in_progress")?.title ?? null;
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        department: a.department,
        status,
        task,
        x: prev?.x ?? pos.x,
        y: prev?.y ?? pos.y,
        targetX: pos.x,
        targetY: pos.y,
        faceColor: FACE[hash(a.name) % FACE.length],
        shirtColor: SHIRT[hash(a.name + a.role) % SHIRT.length],
        frame: hash(a.id) % 100,
      };
    });
  }, [orgAgents, orgTasks, snapshot.chatPresence, snapshot.taskRuns]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;
    const FPS_INTERVAL = 1000 / 30;

    const tick = (now: number) => {
      if (!running) return;
      animRef.current = requestAnimationFrame(tick);

      const elapsed = now - lastFrameRef.current;
      if (elapsed < FPS_INTERVAL) return;
      lastFrameRef.current = now - (elapsed % FPS_INTERVAL);

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      for (const agent of agentsRef.current) {
        const dx = agent.targetX - agent.x;
        const dy = agent.targetY - agent.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1) {
          agent.x += (dx / dist) * 0.7;
          agent.y += (dy / dist) * 0.7;
          agent.frame += 0.08;
        }
      }

      drawScene(ctx, w, h, agentsRef.current, now);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const positions = layoutPositions(agentsRef.current.length, w);

    const wander = setInterval(() => {
      agentsRef.current.forEach((agent, i) => {
        const pos = positions[i];
        if (!pos) return;
        if (agent.status === "idle") {
          agent.targetX = pos.x + ((hash(agent.id + String(Date.now()).slice(0, -3)) % 60) - 30);
          agent.targetY = pos.y + ((hash(agent.name + String(Date.now()).slice(0, -3)) % 30) - 15);
        } else {
          agent.targetX = pos.x;
          agent.targetY = pos.y;
        }
      });
    }, 5000);

    return () => clearInterval(wander);
  }, []);

  return (
    <div style={{ flex: 1, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

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
