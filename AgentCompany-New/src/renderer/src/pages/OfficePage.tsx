import { useEffect, useMemo, useRef } from "react";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";
import { hashString, renderOffice, type RenderPerson } from "./office/office-renderer";
import { OfficeSimulation, cameraFor } from "./office/simulation";
import type { AgentActivity, OfficeAgentInput } from "./office/office-types";

const FPS_INTERVAL = 1000 / 24;

export function OfficePage({ snapshot }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<OfficeSimulation | null>(null);
  if (simRef.current === null) simRef.current = new OfficeSimulation();

  const inputs = useMemo<OfficeAgentInput[]>(() => {
    const orgAgents = snapshot.agents
      .filter((agent) => agent.orgId === orgId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const orgTasks = snapshot.tasks.filter((task) => task.orgId === orgId);
    return orgAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      title: agent.title,
      department: agent.department,
      roleLevel: agent.roleLevel,
      activity: resolveActivity(snapshot.chatPresence, snapshot.taskRuns, agent.id),
      taskTitle: orgTasks.find((task) => task.assigneeAgentId === agent.id && task.status === "in_progress")?.title ?? null,
    }));
  }, [snapshot.agents, snapshot.tasks, snapshot.chatPresence, snapshot.taskRuns, orgId]);

  useEffect(() => {
    simRef.current!.sync(inputs);
  }, [inputs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;
    let raf = 0;
    let lastFrame = 0;

    const tick = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      if (now - lastFrame < FPS_INTERVAL) return;
      lastFrame = now;

      const viewW = canvas.clientWidth;
      const viewH = canvas.clientHeight;
      if (viewW === 0 || viewH === 0) return;
      const dpr = window.devicePixelRatio || 1;
      const backingW = Math.round(viewW * dpr);
      const backingH = Math.round(viewH * dpr);
      if (canvas.width !== backingW || canvas.height !== backingH) {
        canvas.width = backingW;
        canvas.height = backingH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const sim = simRef.current!;
      const camera = cameraFor(sim.plan.world, viewW, viewH, {
        x: sim.plan.world.w / 2,
        y: viewH / 2,
      });
      const people: RenderPerson[] = sim.agents.map((agent) => ({
        id: agent.input.id,
        name: agent.input.name,
        activity: agent.input.activity,
        x: agent.x,
        y: agent.y,
        desk: agent.isCeo ? sim.plan.ceoDesk : sim.plan.desks[agent.deskIndex!].bounds,
        isCeo: agent.isCeo,
        animSeed: hashString(agent.input.id) % 100,
      }));
      renderOffice(ctx, viewW, viewH, sim.plan, camera, people, now);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div style={{ flex: 1, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

function resolveActivity(
  presence: Array<{ principalType: string; principalId: string; status: string }>,
  runs: Array<{ agentId: string | null; state: string }>,
  agentId: string,
): AgentActivity {
  if (runs.some((run) => run.agentId === agentId && run.state === "running")) return "active";
  const record = presence.find((row) => row.principalType === "agent" && row.principalId === agentId);
  if (record?.status === "thinking") return "thinking";
  if (record?.status === "waiting_approval" || record?.status === "busy") return "busy";
  if (record?.status === "active" || record?.status === "online") return "active";
  return "idle";
}
