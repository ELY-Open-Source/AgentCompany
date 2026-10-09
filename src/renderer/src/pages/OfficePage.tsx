import { isBusinessTask } from "./work/task-helpers";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee } from "./types";
import { hashString, renderOffice, type RenderPerson } from "./office/office-renderer";
import { OfficeSimulation, cameraFor, type MoveInput } from "./office/simulation";
import { AgentDetailCard } from "./office/AgentDetailCard";
import { officeActivityLabel } from "../i18n/labels";
import { cardPositionFor, CARD_FALLBACK_H } from "./office/agent-card-position";
import type { AgentActivity, Camera, OfficeAgentInput, Vec } from "./office/office-types";
import { t } from "../i18n/i18n";

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
  const cameraRef = useRef<Camera>({ x: 0, y: 0 });
  const selectedIdRef = useRef<string | null>(null);
  const cardBoxRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<"select" | "whip">("select");
  const toolRef = useRef(tool);
  const simRef = useRef<OfficeSimulation | null>(null);
  if (simRef.current === null) simRef.current = new OfficeSimulation();

  const inputs = useMemo<OfficeAgentInput[]>(() => {
    const orgAgents = snapshot.agents
      .filter((agent) => agent.orgId === orgId && agent.lifecycle === "active")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const orgTasks = snapshot.tasks.filter((task) => task.orgId === orgId && isBusinessTask(task));
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

  const selectedAgent = selectedId ? inputs.find((input) => input.id === selectedId) ?? null : null;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (toolRef.current === "whip") setTool("select");
      else if (selectedIdRef.current) setSelectedId(null);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

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
      cameraRef.current = camera;
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
        hitReactMs: agent.hitReactMs,
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
          hitReactMs: 0,
        });
      }
      renderOffice(ctx, viewW, viewH, sim.plan, camera, people, now, new Date(), selectedIdRef.current, sim.effects);

      // The detail card rides beside its agent, even while they walk.
      const cardBox = cardBoxRef.current;
      const selected = selectedIdRef.current
        ? sim.agents.find((agent) => agent.input.id === selectedIdRef.current) ?? null
        : null;
      if (cardBox && selected) {
        const cardH = cardBox.offsetHeight || CARD_FALLBACK_H;
        const position = cardPositionFor({ x: selected.x, y: selected.y }, camera, viewW, viewH, cardH);
        cardBox.style.transform = `translate(${position.left}px, ${position.top}px)`;
        cardBox.style.visibility = "visible";
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const worldPointFrom = (event: MouseEvent<HTMLCanvasElement>): Vec | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left + cameraRef.current.x,
      y: event.clientY - bounds.top + cameraRef.current.y,
    };
  };

  const onCanvasClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const point = worldPointFrom(event);
    if (!point) return;
    const hit = simRef.current!.hitTest(point);
    if (tool === "whip") {
      if (hit) simRef.current!.whip(hit.input.id);
      return;
    }
    setSelectedId(hit ? hit.input.id : null);
  };

  const onCanvasMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const point = worldPointFrom(event);
    if (!canvas || !point) return;
    if (tool === "whip") {
      canvas.style.cursor = "crosshair";
      return;
    }
    canvas.style.cursor = simRef.current!.hitTest(point) ? "pointer" : "default";
  };

  return (
    <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t("Office floor. People here: {count}. The person list in the toolbar shows each of them.", { count: inputs.length })}
        onClick={onCanvasClick}
        onMouseMove={onCanvasMouseMove}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {selectedAgent && (
        <div ref={cardBoxRef} style={{ position: "absolute", left: 0, top: 0, willChange: "transform", visibility: "hidden" }}>
          <AgentDetailCard agent={selectedAgent} onClose={() => setSelectedId(null)} />
        </div>
      )}
      <div className="office-toolbar" role="toolbar" aria-label={t("Office tools")}>
        <select
          className="input"
          aria-label={t("Show a person")}
          value={selectedId ?? ""}
          onChange={(event) => {
            setTool("select");
            setSelectedId(event.target.value || null);
          }}
          style={{ width: 200, height: 30 }}
        >
          <option value="">{t("Show a person…")}</option>
          {inputs.map((input) => <option key={input.id} value={input.id}>{t("{name}, {activity}", { name: input.name, activity: officeActivityLabel(input.activity) })}</option>)}
        </select>
        <button
          type="button"
          className={`office-tool ${tool === "whip" ? "active" : ""}`.trim()}
          aria-pressed={tool === "whip"}
          title={t("Crack the whip: slackers in the snack bar or restroom hustle back to their desks. Working or meeting agents are unaffected.")}
          onClick={() => {
            setSelectedId(null);
            setTool(tool === "whip" ? "select" : "whip");
          }}
        >
          <span aria-hidden>⚡</span> {t("Whip")}
        </button>
      </div>
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
