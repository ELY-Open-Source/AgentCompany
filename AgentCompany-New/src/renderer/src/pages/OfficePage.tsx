import { useEffect, useMemo, useRef } from "react";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee } from "./types";
import { hashString, renderOffice, type RenderPerson } from "./office/office-renderer";
import { OfficeSimulation, cameraFor, type MoveInput } from "./office/simulation";
import type { AgentActivity, OfficeAgentInput } from "./office/office-types";

const FPS_INTERVAL = 1000 / 24;

const KEY_BINDINGS: Record<string, keyof MoveInput> = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function OfficePage({ snapshot }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<MoveInput>({ up: false, down: false, left: false, right: false });
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
    simRef.current!.syncPlayer(employee.id, employee.displayName);
  }, [employee.id, employee.displayName]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
    const onKeyDown = (event: KeyboardEvent) => {
      const key = KEY_BINDINGS[event.code];
      if (!key || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      keysRef.current[key] = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = KEY_BINDINGS[event.code];
      if (!key) return;
      keysRef.current[key] = false;
    };
    const releaseAll = () => {
      keysRef.current = { up: false, down: false, left: false, right: false };
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
    };
  }, []);

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
      const elapsed = now - lastFrame;
      if (elapsed < FPS_INTERVAL) return;
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
      sim.step(elapsed, keysRef.current);
      const focus = sim.player ? { x: sim.player.x, y: sim.player.y } : { x: sim.plan.world.w / 2, y: viewH / 2 };
      const camera = cameraFor(sim.plan.world, viewW, viewH, focus);
      const people: RenderPerson[] = sim.agents.map((agent) => ({
        id: agent.input.id,
        name: agent.input.name,
        activity: agent.input.activity,
        x: agent.x,
        y: agent.y,
        desk: agent.isCeo ? sim.plan.ceoDesk : sim.plan.desks[agent.deskIndex!].bounds,
        isCeo: agent.isCeo,
        isPlayer: false,
        animSeed: hashString(agent.input.id) % 100,
        appearance: agent.appearance,
        facing: agent.facing,
        walkPhase: agent.walkPhase,
        carrying: agent.carrying,
      }));
      if (sim.player) {
        people.push({
          id: `board:${sim.player.employeeId}`,
          name: sim.player.name,
          activity: "idle",
          x: sim.player.x,
          y: sim.player.y,
          desk: null,
          isCeo: false,
          isPlayer: true,
          animSeed: hashString(sim.player.employeeId) % 100,
          appearance: sim.player.appearance,
          facing: sim.player.facing,
          walkPhase: sim.player.walkPhase,
          carrying: null,
        });
      }
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
