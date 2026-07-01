import { useEffect, useRef, useMemo } from "react";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";

type Status = "active" | "thinking" | "busy" | "idle";

interface OfficeAgent {
  id: string;
  name: string;
  department: string;
  status: Status;
  task: string | null;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  skin: string;
  shirt: string;
  frame: number;
  facing: "left" | "right";
}

const SKIN = ["#f4c28b", "#e8b472", "#c68e5b", "#a56c3e", "#8b5232"];
const SHIRT = ["#5b8dd9", "#d95b7a", "#5bbf6f", "#d9a65b", "#9b6fd9", "#5bc4c4", "#d97b5b", "#5b9bd9"];
const DESK_COLOR = "#c8b89a";
const FLOOR_COLOR = "#f0ebe3";
const WALL_COLOR = "#e8e3db";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function stableColor(palette: string[], name: string): string {
  return palette[hash(name) % palette.length];
}

function deriveStatus(presence: Array<{ principalType: string; principalId: string; status: string }>, runs: Array<{ agentId: string | null; state: string }>, agentId: string): Status {
  if (runs.some((r) => r.agentId === agentId && r.state === "running")) return "active";
  const p = presence.find((r) => r.principalType === "agent" && r.principalId === agentId);
  if (p?.status === "thinking") return "thinking";
  if (p?.status === "waiting_approval" || p?.status === "busy") return "busy";
  if (p?.status === "active" || p?.status === "online") return "active";
  return "idle";
}

export function OfficePage({ snapshot }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef<OfficeAgent[]>([]);
  const animRef = useRef<number>(0);

  const orgAgents = useMemo(() => snapshot.agents.filter((a) => a.orgId === orgId), [snapshot.agents, orgId]);
  const orgTasks = useMemo(() => snapshot.tasks.filter((t) => t.orgId === orgId), [snapshot.tasks, orgId]);

  useEffect(() => {
    const existing = agentsRef.current;
    agentsRef.current = orgAgents.map((a, i) => {
      const prev = existing.find((e) => e.id === a.id);
      const status = deriveStatus(snapshot.chatPresence, snapshot.taskRuns, a.id);
      const task = orgTasks.find((t) => t.assigneeAgentId === a.id && t.status === "in_progress")?.title ?? null;
      const deskX = 80 + (i % 6) * 120;
      const deskY = 100 + Math.floor(i / 6) * 140;
      return {
        id: a.id,
        name: a.name,
        department: a.department,
        status,
        task,
        x: prev?.x ?? deskX,
        y: prev?.y ?? deskY,
        targetX: status === "idle" ? deskX + (hash(a.id + String(Date.now()).slice(0, -4)) % 60) - 30 : deskX,
        targetY: status === "idle" ? deskY + (hash(a.name + String(Date.now()).slice(0, -4)) % 40) - 20 : deskY,
        skin: stableColor(SKIN, a.name),
        shirt: stableColor(SHIRT, a.name + a.role),
        frame: prev?.frame ?? 0,
        facing: prev?.facing ?? "right",
      };
    });
  }, [orgAgents, orgTasks, snapshot.chatPresence, snapshot.taskRuns]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;
    const tick = () => {
      if (!running) return;
      const w = canvas.clientWidth * 2;
      const h = canvas.clientHeight * 2;
      canvas.width = w;
      canvas.height = h;
      ctx.scale(2, 2);

      drawOffice(ctx, canvas.clientWidth, canvas.clientHeight, agentsRef.current);

      for (const agent of agentsRef.current) {
        const dx = agent.targetX - agent.x;
        const dy = agent.targetY - agent.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1) {
          const speed = 0.6;
          agent.x += (dx / dist) * speed;
          agent.y += (dy / dist) * speed;
          agent.frame += 0.08;
          agent.facing = dx > 0 ? "right" : "left";
        }
      }

      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      for (const agent of agentsRef.current) {
        if (agent.status === "idle") {
          const baseX = 80 + (agentsRef.current.indexOf(agent) % 6) * 120;
          const baseY = 100 + Math.floor(agentsRef.current.indexOf(agent) / 6) * 140;
          agent.targetX = baseX + (Math.random() * 80 - 40);
          agent.targetY = baseY + (Math.random() * 60 - 30);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ flex: 1, overflow: "hidden", background: FLOOR_COLOR }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }}
      />
    </div>
  );
}

function drawOffice(ctx: CanvasRenderingContext2D, w: number, h: number, agents: OfficeAgent[]) {
  ctx.fillStyle = FLOOR_COLOR;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = WALL_COLOR;
  ctx.fillRect(0, 0, w, 50);

  for (let x = 20; x < w; x += 160) {
    drawWindow(ctx, x, 8, 60, 36);
  }

  const deptGroups = new Map<string, OfficeAgent[]>();
  for (const a of agents) {
    if (!deptGroups.has(a.department)) deptGroups.set(a.department, []);
    deptGroups.get(a.department)!.push(a);
  }

  let groupIdx = 0;
  for (const [dept, group] of deptGroups) {
    const gx = 40 + (groupIdx % 3) * ((w - 60) / 3);
    const gy = 60 + Math.floor(groupIdx / 3) * 150;

    ctx.fillStyle = "rgba(0,0,0,0.04)";
    ctx.fillRect(gx, gy, (w - 100) / 3, 130);
    ctx.strokeStyle = "rgba(0,0,0,0.06)";
    ctx.strokeRect(gx, gy, (w - 100) / 3, 130);

    ctx.fillStyle = "#999";
    ctx.font = "9px monospace";
    ctx.fillText(dept.toUpperCase(), gx + 6, gy + 12);

    for (let i = 0; i < group.length; i++) {
      const dx = gx + 30 + i * 70;
      const dy = gy + 50;
      drawDesk(ctx, dx, dy);
    }
    groupIdx++;
  }

  const sorted = [...agents].sort((a, b) => a.y - b.y);
  for (const agent of sorted) {
    drawPixelPerson(ctx, agent);
  }
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#b8d4e8";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#d0c8c0";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
}

function drawDesk(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = DESK_COLOR;
  ctx.fillRect(x - 16, y, 32, 4);
  ctx.fillStyle = "#a89880";
  ctx.fillRect(x - 4, y + 4, 2, 12);
  ctx.fillRect(x + 2, y + 4, 2, 12);

  ctx.fillStyle = "#444";
  ctx.fillRect(x - 8, y - 12, 16, 10);
  ctx.fillStyle = "#6af";
  ctx.fillRect(x - 7, y - 11, 14, 8);
}

function drawPixelPerson(ctx: CanvasRenderingContext2D, agent: OfficeAgent) {
  const x = Math.round(agent.x);
  const y = Math.round(agent.y);
  const bobble = agent.status === "active" ? Math.sin(agent.frame * 3) * 1.5 : 0;
  const legOffset = Math.abs(Math.sin(agent.frame * 2)) > 0.5 ? 1 : 0;

  ctx.fillStyle = agent.skin;
  ctx.fillRect(x - 3, y - 18 + bobble, 6, 6);

  ctx.fillStyle = "#333";
  const eyeX = agent.facing === "right" ? 1 : -2;
  ctx.fillRect(x + eyeX, y - 16 + bobble, 1, 1);
  ctx.fillRect(x + eyeX + 2, y - 16 + bobble, 1, 1);

  ctx.fillStyle = agent.shirt;
  ctx.fillRect(x - 4, y - 12 + bobble, 8, 8);

  ctx.fillStyle = "#555";
  ctx.fillRect(x - 3, y - 4 + bobble, 3, 5 + legOffset);
  ctx.fillRect(x, y - 4 + bobble, 3, 5 + (1 - legOffset));

  if (agent.status === "active") {
    ctx.fillStyle = "#34d399";
    ctx.beginPath();
    ctx.arc(x + 5, y - 19 + bobble, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (agent.status === "thinking") {
    ctx.fillStyle = "#818cf8";
    ctx.fillText("?", x + 4, y - 18 + bobble);
  }

  ctx.fillStyle = "#777";
  ctx.font = "8px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(agent.name.split(" ")[0], x, y + 8);
  ctx.textAlign = "start";
}
